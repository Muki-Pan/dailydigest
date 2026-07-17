import { readFile } from "node:fs/promises";

export const SECTIONS = [
  "Visual Culture Signal",
  "AI Research / Creative Tech Signal",
  "Feminist Structure Signal",
  "China / East Asia Signal",
  "Archive / Long Read / Opportunity"
];

export function shanghaiDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

export async function loadEnv(filename) {
  try {
    const source = await readFile(filename, "utf8");
    for (const line of source.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]]) continue;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      process.env[match[1]] = value;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

const text = (value) => typeof value === "string" ? value.trim() : "";
const url = (value) => {
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : "";
  } catch { return ""; }
};

export function validateDigest(digest, expectedDate) {
  const errors = [];
  const warnings = [];
  if (!digest || typeof digest !== "object" || Array.isArray(digest)) return { errors: ["Digest must be an object."], warnings };
  if (digest.date !== expectedDate) errors.push(`date must be ${expectedDate}, received ${digest.date || "empty"}`);
  if (digest.issue_number !== undefined && (!Number.isInteger(digest.issue_number) || digest.issue_number < 1)) errors.push("issue_number must be a positive integer.");
  if (!["24h", "7d", "30d"].includes(digest.search_window)) errors.push("search_window must be 24h, 7d, or 30d.");
  for (const field of ["reading_time", "why_today", "intro", "opening_signal", "closing_signal", "repetition_notes"]) {
    if (!text(digest[field])) errors.push(`${field} is required.`);
  }
  if (!Array.isArray(digest.topics) || !digest.topics.length) errors.push("topics must contain at least one item.");
  if (!Array.isArray(digest.stories) || digest.stories.length < 1 || digest.stories.length > 5) {
    errors.push("stories must contain 1 to 5 items.");
    return { errors, warnings };
  }
  const seenSections = new Set();
  const seenUrls = new Set();
  for (const [index, story] of digest.stories.entries()) {
    const label = `stories[${index}]`;
    if (!SECTIONS.includes(story.section)) errors.push(`${label}.section is invalid.`);
    if (seenSections.has(story.section)) errors.push(`${label}.section duplicates ${story.section}.`);
    seenSections.add(story.section);
    if (!["New", "Follow-up", "Ongoing", "Background Signal"].includes(story.continuity)) errors.push(`${label}.continuity is invalid.`);
    for (const field of ["title_zh", "title_en", "summary_zh", "summary_en", "why_muki_cares", "editorial_signal", "source_name"]) {
      if (!text(story[field])) errors.push(`${label}.${field} is required.`);
    }
    if (story.publication_date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(text(story.publication_date))) errors.push(`${label}.publication_date must be YYYY-MM-DD or null.`);
    const sourceUrl = url(story.source_url);
    if (!sourceUrl) errors.push(`${label}.source_url is not a valid HTTP URL.`);
    if (seenUrls.has(sourceUrl)) errors.push(`${label}.source_url is duplicated.`);
    seenUrls.add(sourceUrl);
    if (!Array.isArray(story.theme_tags) || !story.theme_tags.length) errors.push(`${label}.theme_tags must not be empty.`);
    if (story.image_url && !url(story.image_url)) warnings.push(`${label}.image_url is invalid and will be removed.`);
  }
  if (!digest.editors_pick || !seenUrls.has(url(digest.editors_pick.link))) errors.push("editors_pick.link must exactly match a selected story source_url.");
  return { errors, warnings };
}

const cleanLine = (value = "") => String(value).replace(/\r?\n+/g, " ").trim();

export function digestToMarkdown(digest, issueNumber) {
  const stories = digest.stories.map((story, index) => `# Story ${String(index + 1).padStart(2, "0")}

* **Category:** ${cleanLine(story.section)} · ${cleanLine(story.continuity)}
* **Chinese Headline:** ${cleanLine(story.title_zh)}
* **English Headline:** ${cleanLine(story.title_en)}
* **Chinese Summary:** ${story.summary_zh.trim()}
* **English Summary:** ${story.summary_en.trim()}
* **Why it matters:** ${story.why_muki_cares.trim()}
* **Editorial Signal:** ${cleanLine(story.editorial_signal)}
* **Theme Tags:** ${story.theme_tags.join(" · ")}
* **Source:** ${cleanLine(story.source_name)}
* **Source URL:** [${cleanLine(story.source_name)}](${story.source_url})
* **Publication Date:** ${cleanLine(story.publication_date)}
* **Image URL:** ${story.image_url || ""}
* **Image Caption:** ${cleanLine(story.image_caption || "")}

---`).join("\n\n");

  return `# Daily Digest for Muki

## Issue metadata

* **Date:** ${digest.date}
* **Issue No.:** ${String(issueNumber).padStart(3, "0")}
* **Estimated Reading Time:** ${cleanLine(digest.reading_time)}
* **Topics:** ${digest.topics.join(" · ")}
* **Search Window:** ${digest.search_window}

---

## Why these stories today?

${digest.why_today.trim()}

## Intro

${digest.intro.trim()}

---

# Page 1

${stories}

## Opening Signal

${digest.opening_signal.trim()}

---

# Page 2

## Editor’s Pick

* **Type:** ${cleanLine(digest.editors_pick.type)}
* **Title:** ${cleanLine(digest.editors_pick.title)}
* **Why Muki may care:** ${digest.editors_pick.why_muki_may_care.trim()}
* **Link:** ${digest.editors_pick.link}

## Empty Sections / Not Included Today

${[...digest.empty_sections, ...digest.excluded_topics].map((item) => `- ${cleanLine(item)}`).join("\n") || "- None"}

# Closing Signal

${digest.closing_signal.trim()}

## Issue Summary / 本期索引

### Stories

${digest.stories.map((story, index) => `${index + 1}. [${story.section}] ${story.title_zh} / ${story.title_en}`).join("\n")}

### Covered Entities

${digest.covered_entities.join(" · ")}

### Theme Tags

${[...new Set(digest.stories.flatMap((story) => story.theme_tags))].join(" · ")}

### Repetition Notes

${digest.repetition_notes.trim()}
`;
}
