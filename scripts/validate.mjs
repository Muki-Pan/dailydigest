import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { validateDigest } from "./digest-utils.mjs";

const root = process.cwd();
const issueDir = path.join(root, "data/issues");
let files = [];
try {
  files = (await readdir(issueDir)).filter((name) => name.endsWith(".json")).sort();
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

if (!files.length) {
  console.log("No structured issues found in data/issues; legacy Markdown issues remain valid.");
  process.exit(0);
}

let failures = 0;
for (const file of files) {
  try {
    const digest = JSON.parse(await readFile(path.join(issueDir, file), "utf8"));
    const result = validateDigest(digest, file.replace(/\.json$/, ""));
    for (const warning of result.warnings) console.warn(`${file}: ${warning}`);
    if (result.errors.length) {
      failures += 1;
      console.error(`${file}:\n${result.errors.map((error) => `  - ${error}`).join("\n")}`);
    } else {
      console.log(`${file}: valid (${digest.stories.length} stories)`);
    }
  } catch (error) {
    failures += 1;
    console.error(`${file}: ${error.message}`);
  }
}

if (failures) process.exit(1);
