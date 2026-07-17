import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { digestToMarkdown, loadEnv, shanghaiDate, validateDigest } from "./digest-utils.mjs";

const root = process.cwd();
await loadEnv(path.join(root, ".env"));

const args = new Set(process.argv.slice(2));
const date = process.env.DIGEST_DATE || shanghaiDate();
const model = process.env.GEMINI_MODEL || "gemini-3.5-flash";
const timeout = Number(process.env.GEMINI_TIMEOUT_MS || 240000);
const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
if (!apiKey) {
  console.error("Missing GEMINI_API_KEY. Copy .env.example to .env and add your Google AI Studio key.");
  process.exit(1);
}

const schema = JSON.parse(await readFile(path.join(root, "schemas/digest.schema.json"), "utf8"));
delete schema.$schema;
const policy = await readFile(path.join(root, "prompts/editorial-policy.md"), "utf8");
const archiveDir = path.join(root, "chatgpt_output");
const jsonDir = path.join(root, "data/issues");
const researchDir = path.join(root, "data/research");
await mkdir(archiveDir, { recursive: true });
await mkdir(jsonDir, { recursive: true });
await mkdir(researchDir, { recursive: true });

const outputMarkdown = path.join(archiveDir, `${date}.md`);
const outputJson = path.join(jsonDir, `${date}.json`);
if (!args.has("--force")) {
  for (const filename of [outputMarkdown, outputJson]) {
    try {
      const existing = await readFile(filename, "utf8");
      if (existing.trim()) {
        console.error(`${path.relative(root, filename)} already exists. Use --force only when intentionally replacing an issue.`);
        process.exit(1);
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

const archiveFiles = (await readdir(archiveDir))
  .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name) && name < `${date}.md`)
  .sort().reverse();
const recentSources = await Promise.all(archiveFiles.slice(0, 7).map(async (name) => ({
  name,
  source: await readFile(path.join(archiveDir, name), "utf8")
})));

const recentContext = recentSources.map(({ name, source }) => {
  const summary = source.match(/## Issue Summary \/ 本期索引([\s\S]*)$/i)?.[1];
  const storyLines = [...source.matchAll(/\* \*\*(?:Chinese Headline|中文标题):\*\*\s*([\s\S]*?)(?=\n\s*\* \*\*)/gi)]
    .map((match) => match[1].replace(/[*\n]/g, " ").replace(/\s+/g, " ").trim());
  return `### ${name}\n${summary?.trim() || `Stories: ${storyLines.join(" | ")}`}`;
}).join("\n\n");

const previousIssueNumbers = recentSources.flatMap(({ source }) => [
  ...[...source.matchAll(/\* \*\*Issue No\.:\*\*\s*(\d+)/gi)].map((match) => Number(match[1])),
  ...[...source.matchAll(/^issue:\s*["']?(\d+)["']?\s*$/gim)].map((match) => Number(match[1]))
]);
const issueNumber = Math.max(0, ...previousIssueNumbers) + 1;
const sharedContext = `Today in Asia/Shanghai is ${date}. The issue number will be ${String(issueNumber).padStart(3, "0")}.

Recent seven-issue context:

${recentContext || "No previous issues are available."}`;

const researchInput = `${policy}

${sharedContext}

This is the research stage. Use Google Search actively across all five editorial entrances. Produce a source dossier for the strongest candidates only. For each candidate include the exact title, specific source URL, publication date, verified facts, relevance, proposed section, and duplication assessment. Do not write the final magazine and do not invent missing details.`;

function extractInteraction(interaction) {
  const contentBlocks = interaction?.steps?.flatMap((step) => step.content || []) || [];
  const textBlocks = contentBlocks.filter((content) => content.type === "text" && content.text);
  const text = interaction?.output_text ?? interaction?.outputText ?? textBlocks.at(-1)?.text;
  const citations = [];
  for (const block of textBlocks) {
    for (const annotation of block.annotations || []) {
      if (annotation.type === "url_citation" && annotation.url) {
        citations.push({ title: annotation.title || annotation.url, url: annotation.url });
      }
    }
  }
  return {
    text,
    citations: [...new Map(citations.map((citation) => [citation.url, citation])).values()]
  };
}

const normalizeUrl = (value) => {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith("utm_") || key === "gclid") url.searchParams.delete(key);
    }
    return url.href.replace(/\/$/, "");
  } catch { return ""; }
};

function citationErrors(digest, citations) {
  const allowed = new Set(citations.map(({ url }) => normalizeUrl(url)));
  return digest.stories
    .filter((story) => !allowed.has(normalizeUrl(story.source_url)))
    .map((story) => `Source URL was not returned by Google Search citations: ${story.source_url}`);
}

async function verifySourceUrls(digest) {
  const errors = [];
  const warnings = [];
  await Promise.all(digest.stories.map(async (story) => {
    try {
      const response = await fetch(story.source_url, {
        redirect: "follow",
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; MukiDailyDigest/1.0)",
          accept: "text/html,application/xhtml+xml"
        },
        signal: AbortSignal.timeout(15000)
      });
      if (response.status === 404 || response.status === 410) errors.push(`${story.source_url} returned HTTP ${response.status}.`);
      else if (!response.ok) warnings.push(`${story.source_url} could not be fully verified (HTTP ${response.status}).`);
    } catch (error) {
      warnings.push(`${story.source_url} could not be reached for verification (${error.message}).`);
    }
  }));
  return { errors, warnings };
}

async function requestGemini({ label, input, tools, responseFormat }) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      console.log(`${label} with ${model} (attempt ${attempt}/2, timeout ${Math.round(timeout / 1000)}s)...`);
      const body = { model, input };
      if (tools?.length) body.tools = tools;
      if (responseFormat) body.response_format = responseFormat;
      const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout)
      });
      const responseText = await response.text();
      if (!response.ok) {
        const error = new Error(`Gemini HTTP ${response.status}: ${responseText.slice(0, 800)}`);
        error.retryable = response.status >= 500 || response.status === 408;
        throw error;
      }
      const result = extractInteraction(JSON.parse(responseText));
      if (!result.text) throw new Error("Gemini returned no text output.");
      return result;
    } catch (error) {
      if (attempt === 2 || error.retryable === false) throw error;
      const delay = 1000 * (2 ** (attempt - 1));
      console.warn(`Gemini request failed: ${error.message}. Retrying in ${delay}ms.`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

const research = await requestGemini({
  label: `Researching ${date}`,
  input: researchInput,
  tools: [{ type: "google_search" }]
});

if (!research.citations.length) throw new Error("Grounded research returned no URL citations; refusing to create an unauditable issue.");
const citationList = research.citations.map((citation, index) => `[S${index + 1}] ${citation.title}: ${citation.url}`).join("\n");

const edited = await requestGemini({
  label: `Editing ${date}`,
  input: `${policy}\n\n${sharedContext}\n\nThis is the grounded research dossier:\n\n${research.text}\n\nThese are the only allowed sources. Copy source_url exactly from this list; never construct, repair, shorten, or guess a URL:\n\n${citationList}\n\nCreate the final issue using only this dossier and source list. Set publication_date only when that exact date is explicitly supported by the dossier; otherwise use null. The final date must be exactly ${date}. Return only schema-compliant JSON.`,
  responseFormat: {
    type: "text",
    mime_type: "application/json",
    schema
  }
});
const outputText = edited.text;
let digest;
try {
  digest = JSON.parse(outputText);
} catch (error) {
  throw new Error(`Gemini returned invalid JSON: ${error.message}`);
}

let validation = validateDigest(digest, date);
validation.errors.push(...citationErrors(digest, research.citations));
if (validation.errors.length) {
  console.warn("The first draft failed validation; asking Gemini for one repair pass:");
  console.warn(validation.errors.map((error) => `- ${error}`).join("\n"));
  const repaired = await requestGemini({
    label: `Repairing ${date}`,
    input: `${policy}\n\n${sharedContext}\n\nRepair the following draft so it passes every validation error. The only allowed source URLs are listed below. Copy them exactly; never invent a replacement URL. Set publication_date only when the dossier explicitly supports that exact date; otherwise use null. If two stories use the same source URL, keep the stronger story or merge the overlap and publish fewer stories. Editor's Pick must use the exact source_url of a retained story. Return only schema-compliant JSON.\n\nGrounded dossier:\n${research.text}\n\nAllowed sources:\n${citationList}\n\nValidation errors:\n${validation.errors.map((error) => `- ${error}`).join("\n")}\n\nDraft:\n${JSON.stringify(digest, null, 2)}`,
    responseFormat: {
      type: "text",
      mime_type: "application/json",
      schema
    }
  });
  try {
    digest = JSON.parse(repaired.text);
  } catch (error) {
    throw new Error(`Gemini returned invalid JSON during repair: ${error.message}`);
  }
  validation = validateDigest(digest, date);
  validation.errors.push(...citationErrors(digest, research.citations));
}

for (const warning of validation.warnings) console.warn(`Warning: ${warning}`);
if (validation.errors.length) {
  console.error(validation.errors.map((error) => `- ${error}`).join("\n"));
  throw new Error("Generated issue failed validation; no files were published.");
}

const sourceVerification = await verifySourceUrls(digest);
for (const warning of sourceVerification.warnings) console.warn(`Warning: ${warning}`);
if (sourceVerification.errors.length) {
  console.error(sourceVerification.errors.map((error) => `- ${error}`).join("\n"));
  throw new Error("One or more source pages do not exist; no files were published.");
}

for (const story of digest.stories) {
  if (story.image_url && !/^https?:\/\//i.test(story.image_url)) story.image_url = null;
}

digest.issue_number = issueNumber;
await writeFile(path.join(researchDir, `${date}.json`), `${JSON.stringify({ date, model, dossier: research.text, citations: research.citations }, null, 2)}\n`);
await writeFile(outputJson, `${JSON.stringify(digest, null, 2)}\n`);
await writeFile(outputMarkdown, digestToMarkdown(digest, issueNumber));
console.log(`Created ${path.relative(root, outputJson)} and ${path.relative(root, outputMarkdown)}.`);
console.log("Run npm run build to render the website.");
