import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const inputDir = path.join(root, "chatgpt_output");
const structuredDir = path.join(root, "data/issues");
const publicDir = path.join(root, "public");
const issueDir = path.join(publicDir, "issues");

const clean = (value = "") => value
  .replace(/\(\[[^\]]+\]\[\d+\]\)/g, "")
  .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
  .replace(/\*\*/g, "")
  .replace(/^>\s?/gm, "")
  .replace(/\s+/g, " ")
  .trim();

const escapeHtml = (value = "") => value.replace(/[&<>\"]/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;"
}[char]));

function field(block, label) {
  return clean(rawField(block, label));
}

function rawField(block, label) {
  return block.match(new RegExp(`\\* \\*\\*${label}[:：]\\*\\*[ \\t]*([\\s\\S]*?)(?=\\n\\s*\\* \\*\\*[^\\n]+[:：]\\*\\*|\\n---|$)`, "i"))?.[1]?.trim() || "";
}

const fieldAny = (block, ...labels) => {
  for (const label of labels) {
    const value = field(block, label);
    if (value) return value;
  }
  return "";
};

function sourceUrl(block, references) {
  const raw = rawField(block, "Source URL") || rawField(block, "来源链接");
  const direct = raw.match(/\[[^\]]+\]\((https?:\/\/[^)]+)\)/)?.[1] || raw.match(/https?:\/\/[^\s)]+/)?.[0];
  const reference = raw.match(/\[[^\]]+\]\[(\d+)\]/)?.[1];
  return (direct || references.get(reference) || "").replace(/\?utm_source=.*$/, "");
}

function parseDate(value) {
  const parts = value.match(/(\d{4}).*?(\d{1,2}).*?(\d{1,2})/);
  return parts ? `${parts[1]}-${parts[2].padStart(2, "0")}-${parts[3].padStart(2, "0")}` : value;
}

function parseDigest(source, filename) {
  const references = new Map([...source.matchAll(/^\[(\d+)\]:\s+(https?:\/\/\S+)/gm)].map((match) => [match[1], match[2]]));
  const yaml = (name) => source.match(new RegExp(`^${name}:\\s*(.+)$`, "mi"))?.[1]?.trim() || "";
  const dateLabel = fieldAny(source, "Date", "日期") || yaml("date");
  const legacyBlocks = [...source.matchAll(/^#{1,6}\s+Story\s+(\d+)([\s\S]*?)(?=^#{1,6}\s+(?:Story\s+\d+|Editor|Opportunities|Closing|Footer)\b|(?![\s\S]))/gim)]
    .map((match) => ({ number: match[1], heading: "", block: match[2] }));
  const sectionBlocks = [...source.matchAll(/^##\s+(0[1-5])\s+([^\n]+)\n([\s\S]*?)(?=^##\s+(?:0[1-5]\s+|Opening Signal|Editor|Empty Sections|Closing Signal|Source List|Issue Summary)|(?![\s\S]))/gim)]
    .map((match) => ({ number: match[1], heading: match[2], block: match[3] }))
    .filter(({ block }) => fieldAny(block, "Chinese Headline", "中文标题"));
  const stories = (legacyBlocks.length ? legacyBlocks : sectionBlocks).map(({ number, heading, block }) => ({
    number,
    category: fieldAny(block, "Category", "类别", "Section") || clean(heading),
    title: fieldAny(block, "Chinese Headline", "中文标题"),
    englishTitle: fieldAny(block, "English Headline", "英文标题", "English Title"),
    summary: fieldAny(block, "Chinese Summary", "中文摘要"),
    englishSummary: fieldAny(block, "English Summary", "英文摘要"),
    why: fieldAny(block, "Why it matters", "为什么重要", "为什么 Muki 会关心"),
    signal: fieldAny(block, "Editorial Signal", "编辑信号"),
    source: fieldAny(block, "Source", "来源", "Source Name"),
    url: sourceUrl(block, references),
    image: fieldAny(block, "Image URL", "图片链接").match(/https?:\/\/[^\s)]+/)?.[0] || ""
  }));
  const why = source.match(/## (?:Why these stories today\?|为什么是这些故事？)\s*([\s\S]*?)(?=\n---|\n## (?:Intro|导言))/i)?.[1] || "";
  const opening = source.match(/## (?:Opening Signal|开场信号)\s*([\s\S]*?)(?=\n---|\n# Page)/i)?.[1] || "";
  const closing = source.match(/^#{1,6}\s+(?:Closing Signal|结尾信号)\s*([\s\S]*?)(?=\n---|\n#{1,6}\s+(?:Footer|Source List|Issue Summary))/im)?.[1] || "";
  return {
    filename,
    date: parseDate(dateLabel),
    dateLabel,
    issue: (fieldAny(source, "Issue No\\.", "期号") || yaml("issue")).padStart(3, "0"),
    readingTime: fieldAny(source, "Estimated Reading Time", "预计阅读时间") || yaml("reading_time"),
    topics: fieldAny(source, "Topics", "主题") || "Images · tools · archives · culture",
    intro: clean(why),
    opening: clean(opening),
    closing: clean(closing),
    stories
  };
}

function parseStructuredDigest(source, filename) {
  const digest = JSON.parse(source);
  return {
    filename,
    date: digest.date,
    dateLabel: digest.date,
    issue: String(digest.issue_number || "").padStart(3, "0"),
    readingTime: digest.reading_time || "",
    topics: (digest.topics || []).join(" · "),
    intro: digest.why_today || digest.intro || "",
    opening: digest.opening_signal || "",
    closing: digest.closing_signal || "",
    stories: (digest.stories || []).map((story, index) => ({
      number: String(index + 1).padStart(2, "0"),
      category: `${story.section || ""}${story.continuity ? ` · ${story.continuity}` : ""}`,
      title: story.title_zh || "",
      englishTitle: story.title_en || "",
      summary: story.summary_zh || "",
      englishSummary: story.summary_en || "",
      why: story.why_muki_cares || "",
      signal: story.editorial_signal || "",
      source: story.source_name || "",
      url: story.source_url || "",
      image: story.image_url || ""
    }))
  };
}

const formatDate = (value) => {
  const date = parseDate(value || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : value;
};

const footerMarkup = `<footer>Daily Digest for Muki · <a href="https://mukipan.com" target="_blank" rel="noreferrer">© Muki Pan</a></footer>`;

const storyMarkup = (story, index, issueDate) => {
  const visual = story.image
    ? `<img src="${escapeHtml(story.image)}" alt="" loading="lazy">`
    : `<div class="visual-placeholder"><span>${String(index + 1).padStart(2, "0")}</span><small>${escapeHtml(story.category)}</small></div>`;
  const storyId = `${issueDate}:${String(index + 1).padStart(2, "0")}`;
  return `<article class="story ${index === 0 ? "story-lead" : ""}" data-story-id="${escapeHtml(storyId)}" data-issue-date="${escapeHtml(issueDate)}">
    <div class="story-number">${escapeHtml(story.number)}</div>
    <div class="story-copy">
      <p class="eyebrow">${escapeHtml(story.category)}</p>
      <h2>${escapeHtml(story.title)}</h2>
      <h3>${escapeHtml(story.englishTitle)}</h3>
      <p>${escapeHtml(story.summary)}</p>
      ${story.why ? `<aside><b>Why it matters</b>${escapeHtml(story.why)}</aside>` : ""}
      ${story.url ? `<a class="source" href="${escapeHtml(story.url)}" target="_blank" rel="noreferrer">↗ ${escapeHtml(story.source)}</a>` : ""}
    </div>
    <figure>${visual}</figure>
    <section class="comments" aria-label="Comments for this story">
      <button class="comments-toggle" type="button" aria-expanded="false">Comments <span class="comments-count"></span></button>
      <div class="comments-panel" hidden>
        <div class="comments-list" aria-live="polite"></div>
        <form class="comment-form">
          <label><span>Anonymous comment</span><textarea name="body" maxlength="1200" rows="3" required placeholder="写下你的想法…"></textarea></label>
          <input class="comment-trap" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
          <input name="started_at" type="hidden">
          <div><small>匿名发布 · 最多 1200 字</small><button type="submit">Post</button></div>
          <p class="comment-status" role="status"></p>
        </form>
      </div>
    </section>
  </article>`;
};

function issuePage(digest, older, newer) {
  const dateLabel = formatDate(digest.date);
  const title = `${dateLabel} · Issue ${digest.issue}`;
  const issueNav = `<nav class="issue-nav" aria-label="Issue navigation">
    ${older ? `<a class="nav-prev" href="${older.date}.html" aria-label="Previous issue"></a>` : `<span class="nav-space" aria-hidden="true"></span>`}
    <strong>ISSUE ${digest.issue}</strong>
    ${newer ? `<a class="nav-next" href="${newer.date}.html" aria-label="Next issue"></a>` : `<span class="nav-space" aria-hidden="true"></span>`}
  </nav>`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><link rel="icon" href="../favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="../styles.css"><link rel="stylesheet" href="../comments.css"><script src="../comments.js" defer></script></head>
  <body><header class="sitebar"><a href="../index.html">MUKI'S DAILY DIGEST</a>${issueNav}<span>${escapeHtml(dateLabel)}</span></header>
  <main class="issue-shell">
    <section class="cover">
      <div class="cover-copy"><p class="kicker">Daily Digest for Muki</p><h1>DAILY<br>DIGEST</h1><p class="topics">${escapeHtml(digest.topics)}</p><div class="cover-meta"><time datetime="${escapeHtml(digest.date)}">${escapeHtml(dateLabel)}</time><strong>ISSUE NO.<br><em>${digest.issue}</em></strong><span>◷ ${escapeHtml(digest.readingTime)}</span></div></div>
      <div class="cover-art"><div class="moon"></div><div class="veil veil-one"></div><div class="veil veil-two"></div><p>Images · tools · archives · culture</p></div>
    </section>
    <section class="editorial"><span>Editor’s note</span><p>${escapeHtml(digest.intro)}</p></section>
    <section class="stories">${digest.stories.map((story, index) => storyMarkup(story, index, digest.date)).join("")}</section>
    <blockquote>${escapeHtml(digest.closing || digest.opening)}</blockquote>
  </main>${footerMarkup}</body></html>`;
}

function indexPage(digests) {
  const cards = digests.map((digest) => `<a class="issue-card" href="issues/${digest.date}.html"><span class="issue-card-no">${digest.issue}</span><div><p>${escapeHtml(formatDate(digest.date))}</p><h2>${escapeHtml(digest.stories[0]?.title || "Daily Digest")}</h2><small>${digest.stories.length} stories · ${escapeHtml(digest.readingTime)}</small></div><i>↗</i></a>`).join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Muki's Daily Digest</title><link rel="icon" href="favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="styles.css"><link rel="stylesheet" href="comments.css"></head><body class="index"><header class="sitebar"><a href="index.html">MUKI'S DAILY DIGEST</a><span>THE ARCHIVE</span><span>${digests.length} ISSUES</span></header><main class="archive-shell"><section class="archive-hero"><p>Daily reading archive · 2026</p><h1>A quiet index of<br>images, ideas & tools.</h1><div class="archive-orbit"><div class="moon"></div></div></section><section class="archive-list"><div class="archive-heading"><span>All issues</span><span>Latest first</span></div>${cards || "<p class=empty>把 ChatGPT 输出的 Markdown 放入 chatgpt_output，然后运行 npm run build。</p>"}</section></main>${footerMarkup}</body></html>`;
}

await mkdir(inputDir, { recursive: true });
await mkdir(publicDir, { recursive: true });
await rm(issueDir, { recursive: true, force: true });
await mkdir(issueDir, { recursive: true });
await mkdir(path.join(publicDir, "data"), { recursive: true });
const files = (await readdir(inputDir)).filter((name) => name.endsWith(".md") || name.endsWith(".txt"));
let structuredFiles = [];
try { structuredFiles = (await readdir(structuredDir)).filter((name) => name.endsWith(".json")); } catch {}
const structured = await Promise.all(structuredFiles.map(async (filename) => parseStructuredDigest(await readFile(path.join(structuredDir, filename), "utf8"), filename)));
const structuredDates = new Set(structured.map((digest) => digest.date));
const legacy = await Promise.all(files.map(async (filename) => parseDigest(await readFile(path.join(inputDir, filename), "utf8"), filename)));
const parsed = [...structured, ...legacy.filter((digest) => !structuredDates.has(digest.date))];
for (const digest of parsed) {
  const missing = [!digest.date && "date", !digest.stories.length && "stories"].filter(Boolean);
  if (missing.length) console.warn(`Skipped ${digest.filename}: missing ${missing.join(" and ")}`);
}
const digests = parsed
  .filter((digest) => digest.date && digest.stories.length)
  .sort((a, b) => b.date.localeCompare(a.date));

const imageCachePath = path.join(publicDir, "data", "image-cache.json");
let imageCache = {};
try { imageCache = JSON.parse(await readFile(imageCachePath, "utf8")); } catch {}

const decodeEntities = (value) => value
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&amp;/g, "&")
  .replace(/&quot;/g, "\"");

const normalizeImageUrl = (value, pageUrl) => value ? new URL(decodeEntities(value), pageUrl).href : "";

async function pageImage(url) {
  if (!url) return "";
  if (url in imageCache) {
    imageCache[url] = normalizeImageUrl(imageCache[url], url);
    return imageCache[url];
  }
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; MukiDailyDigest/1.0)" },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const tags = html.match(/<meta\b[^>]*>/gi) || [];
    const tag = tags.find((value) => /(?:property|name)=["'](?:og:image|twitter:image)["']/i.test(value));
    const image = tag?.match(/content=["']([^"']+)["']/i)?.[1] || "";
    imageCache[url] = normalizeImageUrl(image, url);
  } catch (error) {
    console.warn(`Could not fetch image for ${url}: ${error.message}`);
  }
  return imageCache[url] || "";
}

await Promise.all(digests.flatMap((digest) => digest.stories.map(async (story) => {
  if (!story.image) story.image = await pageImage(story.url);
})));
await writeFile(imageCachePath, JSON.stringify(imageCache, null, 2));

for (const [index, digest] of digests.entries()) {
  await writeFile(path.join(issueDir, `${digest.date}.html`), issuePage(digest, digests[index + 1], digests[index - 1]));
}
await writeFile(path.join(publicDir, "index.html"), indexPage(digests));
await writeFile(path.join(publicDir, "data", "issues.json"), JSON.stringify(digests, null, 2));
console.log(`Built ${digests.length} issue(s) in public/`);
