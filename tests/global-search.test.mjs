import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { filterWorkspaceSearch } from "../apps/intelligence/src/workspaceSearch.ts";

test("workspace search matches every query word and prioritizes title matches", () => {
  const entries = [
    { id: "view-accounts", label: "Accounts", detail: "Workspace", keywords: "companies customers" },
    { id: "account-foundever", label: "Foundever", detail: "Customer experience account", keywords: "discovery jermiah" },
    { id: "lead-franca", label: "Franca", detail: "Lead at Foundever", keywords: "customer experience" },
  ];

  assert.deepEqual(filterWorkspaceSearch(entries, "foundever").map((entry) => entry.id), ["account-foundever", "lead-franca"]);
  assert.deepEqual(filterWorkspaceSearch(entries, "customer experience").map((entry) => entry.id), ["account-foundever", "lead-franca"]);
  assert.deepEqual(filterWorkspaceSearch(entries, "missing"), []);
});

test("the topbar search button opens an accessible global search dialog", () => {
  const app = readFileSync(new URL("../apps/intelligence/src/App.tsx", import.meta.url), "utf8");

  assert.match(app, /aria-label="Search workspace"/);
  assert.match(app, /onClick=\{openWorkspaceSearch\}/);
  assert.match(app, /role="dialog" aria-modal="true" aria-labelledby="workspace-search-title"/);
  assert.match(app, /placeholder="Search pages, accounts, people, events…"/);
});
