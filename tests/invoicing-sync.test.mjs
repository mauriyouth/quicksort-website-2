import { test } from "node:test";
import assert from "node:assert/strict";
import { autoLinkProject, reconcile } from "../apps/admin/server/invoicing/sync.ts";

const proj = (id, over = {}) => ({ id, pricing_model: "regie", client_id: "c1", intermediary_client_id: null, start_date: "2026-01-01", end_date: null, extension_end_dates: [], ...over });
const remote = (over = {}) => ({
  id: "r1", number: "F-1", status: "finalized", clientId: "q1", clientEmails: [],
  issueDate: "2026-11-05", dueDate: "2026-12-05", periodStart: "2026-11-01", periodEnd: "2026-11-30",
  currency: "EUR", totalHt: "100.00", totalVat: "20.00", totalTtc: "120.00",
  paidAt: null, finalizedAt: null, invoiceUrl: null, purchaseOrder: "", lines: [], ...over,
});
const links = [{ client_id: "c1", provider_client_id: "q1" }];

test("auto-links when exactly one active project", () => {
  assert.equal(autoLinkProject(remote(), { clientLinks: links, projects: [proj("p1")] }), "p1");
});

test("leaves unassigned when two active projects", () => {
  assert.equal(autoLinkProject(remote(), { clientLinks: links, projects: [proj("p1"), proj("p2")] }), null);
  const ctx = { clientLinks: links, projects: [proj("p1"), proj("p2")] };
  const { inserts } = reconcile([], [remote()], ctx);
  assert.equal(inserts[0].project_id, null);
});

test("update keeps manual assignment", () => {
  const ctx = { clientLinks: links, projects: [proj("p1")] };
  const { updates, inserts } = reconcile([{ id: "x", provider_invoice_id: "r1", status: "finalized", project_id: "p2" }], [remote({ status: "paid" })], ctx);
  assert.equal(inserts.length, 0);
  assert.equal(updates[0].patch.status, "paid");
  assert.ok(!("project_id" in updates[0].patch));
});

test("draft deleted remotely is removed", () => {
  const ctx = { clientLinks: links, projects: [] };
  const r = reconcile([
    { id: "d1", provider_invoice_id: "gone", status: "draft", project_id: null },
    { id: "f1", provider_invoice_id: "gone2", status: "finalized", project_id: null },
  ], [], ctx);
  assert.deepEqual(r.removedDraftIds, ["d1"]);
});
