// Youtrust webhook verification and status rules (pure functions).
//
// Signature scheme (see the header comment in youtrust.ts): header `X-Yousign-Signature-256` =
// "sha256=" + hex(HMAC-SHA256(secret, raw body bytes)).
//
// Payload source: https://developers.youtrust.com/reference/signer-done.md. A `signer.done` event
// carries the acting signer at `data.signer.info.email` (`info` can be null for recipient groups;
// `data.signature_request.signers[]` has no email).
import { createHmac, timingSafeEqual } from "node:crypto";
import type { YoutrustStatus } from "./youtrust.ts";

export type RequestStatus =
  "draft" | "sending" | "sent" | "signed_by_person" | "completed" | "declined" | "expired" | "cancelled" | "error";

export function verifyWebhook(rawBody: string, header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const expected = Buffer.from("sha256=" + createHmac("sha256", secret).update(rawBody, "utf8").digest("hex"));
  const given = Buffer.from(header);
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}

const sameEmail = (a: unknown, b: string) =>
  typeof a === "string" && a.trim().toLowerCase() === b.trim().toLowerCase();

export function statusFromEvent(event: { event_name: string; data: unknown }, personEmail: string): RequestStatus | null {
  switch (event.event_name) {
    case "signature_request.done": return "completed";
    case "signature_request.declined": return "declined";
    case "signature_request.expired": return "expired";
    case "signature_request.canceled": return "cancelled";
    case "signature_request.activated": return "sent";
    case "signer.done": {
      const data = event.data as { signer?: { info?: { email?: unknown } | null } } | null | undefined;
      return sameEmail(data?.signer?.info?.email, personEmail) ? "signed_by_person" : null;
    }
    default: return null;
  }
}

// Used by Refresh. Statuses that do not map (draft, approval, paused, ...) return `current`.
export function statusFromYoutrust(
  s: YoutrustStatus,
  signers: { email: string; status: string }[],
  personEmail: string,
  current: RequestStatus,
): RequestStatus {
  switch (s) {
    case "ongoing":
      return signers.some((x) => sameEmail(x.email, personEmail) && x.status === "signed") ? "signed_by_person" : "sent";
    case "done": return "completed";
    case "declined":
    case "rejected": return "declined";
    case "expired": return "expired";
    case "canceled":
    case "deleted": return "cancelled";
    default: return current;
  }
}

const TERMINAL: RequestStatus[] = ["completed", "declined", "expired", "cancelled"];

// Terminal states never change; signed_by_person only advances to a terminal state.
// A transition to the same status is not a move (false).
export function canMoveTo(from: RequestStatus, to: RequestStatus): boolean {
  if (from === to) return false;
  if (TERMINAL.includes(from)) return false;
  if (from === "signed_by_person") return TERMINAL.includes(to);
  return true;
}
