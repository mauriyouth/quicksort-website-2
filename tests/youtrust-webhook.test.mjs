import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyWebhook, statusFromEvent, statusFromYoutrust, canMoveTo } from "../apps/admin/server/signatures/webhook.ts";

const secret = "whsec";
const body = JSON.stringify({ event_name: "signer.done", data: {} });
const sign = (b) => "sha256=" + createHmac("sha256", secret).update(b).digest("hex");

test("verifyWebhook accepts a correctly signed body", () => {
  assert.equal(verifyWebhook(body, sign(body), secret), true);
});
test("verifyWebhook rejects tampering, wrong secret, missing, malformed header", () => {
  assert.equal(verifyWebhook(body.replace("done", "dona"), sign(body), secret), false);
  assert.equal(verifyWebhook(body, sign(body), "other"), false);
  assert.equal(verifyWebhook(body, undefined, secret), false);
  assert.equal(verifyWebhook(body, "", secret), false);
  assert.equal(verifyWebhook(body, "sha256=abcd", secret), false);
  assert.equal(verifyWebhook(body, sign(body).slice("sha256=".length), secret), false);
});

test("statusFromEvent maps event names", () => {
  const m = (n) => statusFromEvent({ event_name: n, data: {} }, "a@b.c");
  assert.equal(m("signature_request.done"), "completed");
  assert.equal(m("signature_request.declined"), "declined");
  assert.equal(m("signature_request.expired"), "expired");
  assert.equal(m("signature_request.canceled"), "cancelled");
  assert.equal(m("signature_request.activated"), "sent");
  assert.equal(m("signature_request.created"), null);
  assert.equal(m("signer.notified"), null);
});
test("signer.done maps only for the person's email (case-insensitive)", () => {
  const ev = (email) => ({ event_name: "signer.done", data: { signer: { info: { email } } } });
  assert.equal(statusFromEvent(ev("Ann@Example.com"), "ann@example.com"), "signed_by_person");
  assert.equal(statusFromEvent(ev("boss@example.com"), "ann@example.com"), null);
  assert.equal(statusFromEvent({ event_name: "signer.done", data: { signer: { info: null } } }, "a@b.c"), null);
  assert.equal(statusFromEvent({ event_name: "signer.done", data: null }, "a@b.c"), null);
});

test("statusFromYoutrust maps statuses and keeps current for unmapped ones", () => {
  const signers = [{ email: "Ann@example.com", status: "signed" }, { email: "boss@example.com", status: "notified" }];
  assert.equal(statusFromYoutrust("ongoing", signers, "ann@example.com", "sent"), "signed_by_person");
  assert.equal(statusFromYoutrust("ongoing", [{ email: "ann@example.com", status: "notified" }], "ann@example.com", "sending"), "sent");
  assert.equal(statusFromYoutrust("ongoing", [{ email: "boss@example.com", status: "signed" }], "ann@example.com", "sent"), "sent");
  assert.equal(statusFromYoutrust("done", [], "a@b.c", "sent"), "completed");
  assert.equal(statusFromYoutrust("declined", [], "a@b.c", "sent"), "declined");
  assert.equal(statusFromYoutrust("rejected", [], "a@b.c", "sent"), "declined");
  assert.equal(statusFromYoutrust("expired", [], "a@b.c", "sent"), "expired");
  assert.equal(statusFromYoutrust("canceled", [], "a@b.c", "sent"), "cancelled");
  assert.equal(statusFromYoutrust("deleted", [], "a@b.c", "sent"), "cancelled");
  for (const s of ["paused", "approval", "draft"]) {
    assert.equal(statusFromYoutrust(s, [], "a@b.c", "signed_by_person"), "signed_by_person");
  }
});

test("canMoveTo enforces terminal and no-regression rules", () => {
  assert.equal(canMoveTo("completed", "sent"), false);
  for (const t of ["completed", "declined", "expired", "cancelled"]) assert.equal(canMoveTo(t, "cancelled"), false);
  assert.equal(canMoveTo("sent", "signed_by_person"), true);
  assert.equal(canMoveTo("signed_by_person", "sent"), false);
  assert.equal(canMoveTo("signed_by_person", "completed"), true);
  assert.equal(canMoveTo("sending", "sent"), true);
  assert.equal(canMoveTo("sent", "sent"), false);
});
