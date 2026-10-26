import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("accounts can be categorized and filtered by industry", () => {
  const app = readFileSync(new URL("../apps/intelligence/src/App.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../apps/intelligence/src/styles.css", import.meta.url), "utf8");

  assert.match(app, /primaryIndustries = \["Luxury", "BPO", "Banking", "Insurance"\]/);
  assert.match(app, /normalizeIndustry/);
  assert.match(app, /aria-label="Filter accounts by industry"/);
  assert.match(app, /aria-pressed=\{industry === item\}/);
  assert.match(app, /<label>Industry<select name="sector"/);
  assert.match(app, /aria-label="Industry"/);
  assert.match(styles, /\.industry-filter/);
  assert.match(styles, /\.account-filter-empty/);
});
