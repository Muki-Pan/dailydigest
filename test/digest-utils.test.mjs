import test from "node:test";
import assert from "node:assert/strict";
import { digestToMarkdown, validateDigest } from "../scripts/digest-utils.mjs";

const digest = {
  date: "2026-07-17",
  search_window: "24h",
  reading_time: "约 5 分钟",
  topics: ["Photography", "Archives"],
  why_today: "这些故事共同关注图像如何被保存。",
  intro: "本期从档案出发。",
  opening_signal: "保存也是一种编辑。",
  closing_signal: "档案让关系继续生长。",
  stories: [{
    section: "Visual Culture Signal",
    continuity: "New",
    title_zh: "测试标题",
    title_en: "Test title",
    summary_zh: "测试摘要。",
    summary_en: "Test summary.",
    why_muki_cares: "与图像研究相关。",
    editorial_signal: "从保存到关系",
    theme_tags: ["档案"],
    source_name: "Example Institution",
    source_url: "https://example.com/exhibition",
    publication_date: "2026-07-17",
    image_url: null,
    image_caption: null
  }],
  editors_pick: {
    type: "Exhibition",
    title: "测试标题",
    why_muki_may_care: "值得进一步阅读。",
    link: "https://example.com/exhibition"
  },
  empty_sections: [],
  excluded_topics: [],
  covered_entities: ["Example Institution"],
  repetition_notes: "无重复。"
};

test("validates a complete digest", () => {
  assert.deepEqual(validateDigest(digest, digest.date).errors, []);
});

test("rejects an editor pick outside selected sources", () => {
  const changed = structuredClone(digest);
  changed.editors_pick.link = "https://example.com/other";
  assert.match(validateDigest(changed, changed.date).errors.join(" "), /editors_pick/);
});

test("rejects duplicate source URLs across stories", () => {
  const changed = structuredClone(digest);
  changed.stories.push({
    ...changed.stories[0],
    section: "Archive / Long Read / Opportunity",
    title_zh: "另一条测试标题",
    title_en: "Another test title"
  });
  assert.match(validateDigest(changed, changed.date).errors.join(" "), /source_url is duplicated/);
});

test("renders build-compatible Markdown", () => {
  const markdown = digestToMarkdown(digest, 9);
  assert.match(markdown, /# Story 01/);
  assert.match(markdown, /\* \*\*Chinese Headline:\*\* 测试标题/);
  assert.match(markdown, /\* \*\*Issue No\.:\*\* 009/);
});
