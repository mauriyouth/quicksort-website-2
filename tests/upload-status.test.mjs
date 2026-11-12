import assert from "node:assert/strict";
import test from "node:test";
import { uploadStatus } from "../apps/admin/src/documents/expiry.ts";

const row = (patch = {}) => ({ status: "active", needs_review: false, expires_on: null, warn_days: [60, 30], ...patch });
const today = "2026-11-07";

test("an upload not yet in the registry reads as received (a CV stays with the application)", () => {
  assert.deepEqual(uploadStatus(undefined, "identity", today), { label: "Received", tone: "missing" });
  assert.deepEqual(uploadStatus(undefined, "resume", today), { label: "With your application", tone: "missing" });
});

test("a registered upload awaiting HR shows the admin's to-classify pill", () => {
  assert.deepEqual(uploadStatus(row({ needs_review: true }), "identity", today), { label: "To classify", tone: "missing" });
});

test("a classified upload is verified, or carries the admin expiry label", () => {
  assert.deepEqual(uploadStatus(row(), "identity", today), { label: "Verified", tone: "filed" });
  assert.deepEqual(uploadStatus(row({ expires_on: "2027-06-01" }), "identity", today), { label: "Verified", tone: "filed" });
  assert.deepEqual(uploadStatus(row({ expires_on: "2026-11-27" }), "identity", today), { label: "Expires in 20 days", tone: "expiring" });
  assert.deepEqual(uploadStatus(row({ expires_on: "2026-11-01" }), "identity", today), { label: "Expired 6 days ago", tone: "expired" });
});

test("a replaced or archived upload says so", () => {
  assert.equal(uploadStatus(row({ status: "superseded" }), "identity", today).label, "Replaced");
  assert.equal(uploadStatus(row({ status: "archived" }), "identity", today).label, "Archived");
});
