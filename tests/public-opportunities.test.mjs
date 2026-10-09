import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("public opportunities has a sidebar route and renders its qualification workspace", () => {
  const app = readFileSync(new URL("../apps/intelligence/src/App.tsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("../apps/intelligence/src/PublicOpportunities.tsx", import.meta.url), "utf8");

  assert.match(app, /"opportunities"/);
  assert.match(app, /path: "\/public-opportunities"/);
  assert.match(app, /sidebarLabel: "Public opportunities"/);
  assert.match(app, /view === "opportunities" && <PublicOpportunities notify=\{notify\}\/>/);
  assert.match(page, /AI tenders and RFPs/);
  assert.match(page, /Dynamic purchasing system/);
  assert.match(page, /quicksort-public-opportunity-shortlist-v1/);
  assert.match(page, /Search buyer, scope, region or CPV/);
});
