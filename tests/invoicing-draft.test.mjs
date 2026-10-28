import { test } from "node:test";
import assert from "node:assert/strict";
import {
  projectDayAmounts,
  buildDraftLines,
} from "../apps/admin/server/invoicing/draft.ts";

const P = "p1";
const project = {
  id: P,
  currency: "EUR",
  tjm_profiles: [{ name: "Data Engineer", tjm: 650, end_date: null }],
};
const assignment = {
  project_id: P,
  employee_id: "e1",
  pricing_line: "Data Engineer",
  start_date: "2026-01-01",
  end_date: null,
  status: "active",
};
const product = {
  title: "Prestation de conseil",
  description: "Assistance technique",
  unit: "jour",
  vat_rate: 0.2,
};
const days = (list) =>
  list.map((day) => ({ day, part: "full", status: "client_project", project_id: P }));
const base = (over = {}) => ({
  month: "2026-11",
  consultantName: "Jane Doe",
  projectId: P,
  entries: days([
    "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06",
    "2026-11-09", "2026-11-10", "2026-11-12", "2026-11-13",
    "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20",
    "2026-11-23", "2026-11-24", "2026-11-25", "2026-11-30",
  ]),
  assignments: [assignment],
  project,
  extensions: [],
  products: { "Data Engineer": product },
  ...over,
});

test("half days count 0.5", () => {
  const entries = [
    { day: "2026-11-02", part: "full", status: "client_project", project_id: P },
    { day: "2026-11-03", part: "am", status: "client_project", project_id: P },
    { day: "2026-11-03", part: "pm", status: "internal", project_id: null },
  ];
  assert.deepEqual(projectDayAmounts(entries, P), [
    { day: "2026-11-02", amount: 1 },
    { day: "2026-11-03", amount: 0.5 },
  ]);
});

test("single line from CRA", () => {
  const r = buildDraftLines(base());
  assert.equal(r.ok, true);
  assert.equal(r.lines.length, 1);
  const { pricingLine, computedQuantity, computedUnitPrice, ...line } = r.lines[0];
  assert.deepEqual(line, {
    title: "Prestation de conseil",
    quantity: "18",
    unitPrice: "650.00",
    unit: "jour",
    vatRate: "0.2",
    description: "Assistance technique\nConsultant : Jane Doe — novembre 2026",
  });
  assert.deepEqual(r.totals, { ht: "11700.00", vat: "2340.00", ttc: "14040.00" });
});

test("title truncated to 40 chars", () => {
  const r = buildDraftLines(
    base({ products: { "Data Engineer": { ...product, title: "x".repeat(60) } } }),
  );
  assert.equal(r.lines[0].title.length, 40);
});

test("extension mid-month splits rate", () => {
  const r = buildDraftLines(
    base({
      extensions: [
        {
          start_date: "2026-11-16",
          status: "signed",
          tjm_profiles: [{ name: "Data Engineer", tjm: 700, end_date: null }],
        },
      ],
    }),
  );
  assert.equal(r.ok, true);
  assert.deepEqual(r.lines.map((l) => l.unitPrice), ["650.00", "700.00"]);
  assert.ok(r.lines[0].description.endsWith("(du 02/11 au 13/11)"));
  assert.ok(r.lines[1].description.endsWith("(du 16/11 au 30/11)"));
});

test("blocked without pricing line", () => {
  const r = buildDraftLines(
    base({
      assignments: [{ ...assignment, pricing_line: "" }],
      project: {
        ...project,
        tjm_profiles: [
          { name: "Data Engineer", tjm: 650 },
          { name: "Lead", tjm: 800 },
        ],
      },
    }),
  );
  assert.deepEqual(r, { ok: false, blocker: "no_pricing_line" });
});

test("blocked without product", () => {
  const r = buildDraftLines(base({ products: {} }));
  assert.deepEqual(r, { ok: false, blocker: "product_not_linked", pricingLine: "Data Engineer" });
});

test("no days", () => {
  const entries = [
    { day: "2026-11-02", part: "full", status: "client_project", project_id: "other" },
  ];
  assert.deepEqual(buildDraftLines(base({ entries })), { ok: false, blocker: "no_days" });
});
