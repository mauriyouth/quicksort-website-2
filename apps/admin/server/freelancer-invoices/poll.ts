// One pass over the mailbox: list PDF mails from known freelancers, skip the
// ones already filed, and ingest each PDF as an email invoice. Pure
// orchestration: Gmail and the intake are injected.
import { buildQuery, type MailMessage, type MailMeta } from "./gmail.ts";
import type { IngestInput } from "./intake.ts";

export type PollDeps = {
  senders: { employeeId: string; email: string }[];
  mailbox: string;
  /** YYYY-MM-DD, inclusive. */
  after: string;
  /** Messages done (freelancer_mailbox_messages.status = 'done'): never read again. */
  seenMessageIds: Set<string>;
  /** Attempts so far of messages that failed before. */
  failedAttempts?: Map<string, number>;
  /** Persists the outcome of a message: filed, failed, or skipped for its sender. */
  record?: (entry: MessageOutcome) => Promise<void>;
  gmail: {
    list: (query: string) => Promise<string[]>;
    /** Headers only (From, date): decides whether the message is opened. */
    meta: (id: string) => Promise<MailMeta>;
    /** The full message with its PDFs, for a known sender only. */
    get: (id: string) => Promise<MailMessage>;
  };
  ingest: (input: IngestInput) => Promise<{ invoiceId: string; duplicate: boolean }>;
  /** Epoch ms; once passed, the remaining messages are left for the next run. */
  stopAt?: number;
  now?: () => number;
};

/** A failed message is retried until this many attempts, then marked done with its error kept. */
export const MAX_MESSAGE_ATTEMPTS = 5;
/** Intake runs as this actor: the sender's address would credit the upload to the freelancer's profile. */
export const MAILBOX_ACTOR = "mailbox-sync";

export type MessageOutcome = { id: string; status: "done" | "failed"; attempts: number; error: string | null; internalDate: string | null };

export type PollResult = {
  /** New messages read. */
  messages: number;
  /** Invoices created. */
  invoices: number;
  duplicates: number;
  /** Messages not read: already done, or from an unknown or ambiguous sender (recorded done, not opened). */
  skipped: number;
  /** PDFs that could not be filed, messages Gmail would not return, and outcomes that could not be recorded; retried next run. */
  failed: number;
  lastFailure?: string;
  /** Messages that failed MAX_MESSAGE_ATTEMPTS times and are no longer retried. */
  abandoned: number;
  lastAbandoned?: string;
  /** True when the time budget ran out before every message was read. */
  partial: boolean;
};

/** The bare, lowercased address of a From header ("Karim <KARIM@ex.fr>" -> "karim@ex.fr"). */
export function senderAddress(from: string): string {
  const angle = /<([^<>]+)>\s*$/.exec(from);
  return (angle ? angle[1] : from).trim().toLowerCase();
}

export async function pollMailbox(deps: PollDeps): Promise<PollResult> {
  const result: PollResult = { messages: 0, invoices: 0, duplicates: 0, skipped: 0, failed: 0, abandoned: 0, partial: false };
  // One address can belong to a single freelancer only; a shared one is ambiguous.
  const byAddress = new Map<string, string | null>();
  for (const s of deps.senders) {
    const email = s.email.trim().toLowerCase();
    if (!email) continue;
    const known = byAddress.get(email);
    byAddress.set(email, known === undefined || known === s.employeeId ? s.employeeId : null);
  }
  if (byAddress.size === 0) return result;

  const now = deps.now ?? Date.now;
  const describe = (failure: unknown) => (failure instanceof Error ? failure.message : String(failure));

  // Duplicates count as filed. A failure is retried on later runs, up to the cap.
  const finish = async (id: string, error: string | null, internalDate: string | null) => {
    const attempts = (deps.failedAttempts?.get(id) ?? 0) + 1;
    const gaveUp = error != null && attempts >= MAX_MESSAGE_ATTEMPTS;
    try {
      await deps.record?.({ id, status: error == null || gaveUp ? "done" : "failed", attempts, error, internalDate });
    } catch (failure) {
      // Not recorded: the message is read again next run.
      result.failed++;
      result.lastFailure = `${id}: could not record the outcome: ${describe(failure)}`;
      return;
    }
    if (gaveUp) {
      result.abandoned++;
      result.lastAbandoned = `${id}: ${error}`;
    }
    if (error == null || gaveUp) deps.seenMessageIds.add(id);
  };

  const ids = await deps.gmail.list(buildQuery([...byAddress.keys()], deps.after));
  for (const id of ids) {
    if (deps.seenMessageIds.has(id)) {
      result.skipped++;
      continue;
    }
    if (deps.stopAt != null && now() >= deps.stopAt) {
      result.partial = true;
      break;
    }
    let meta: MailMeta;
    try {
      meta = await deps.gmail.meta(id);
    } catch (failure) {
      // Deleted message, Gmail 5xx: recorded as failed so the attempt cap can release it.
      result.failed++;
      result.lastFailure = `${id}: ${describe(failure)}`;
      await finish(id, result.lastFailure, null);
      continue;
    }
    const address = senderAddress(meta.from);
    const employeeId = byAddress.get(address);
    if (!employeeId) {
      // Never opened. Recorded done with the reason, so it is not looked at every hour.
      result.skipped++;
      const reason = employeeId === null
        ? `Not read: ${address} belongs to several freelancers.`
        : `Not read: ${address || "the sender"} is not a known freelancer address.`;
      try {
        await deps.record?.({ id, status: "done", attempts: 1, error: reason, internalDate: meta.internalDate });
        deps.seenMessageIds.add(id);
      } catch (failure) {
        result.failed++;
        result.lastFailure = `${id}: could not record the outcome: ${describe(failure)}`;
      }
      continue;
    }
    let message: MailMessage;
    try {
      message = await deps.gmail.get(id);
    } catch (failure) {
      result.failed++;
      result.lastFailure = `${id}: ${describe(failure)}`;
      await finish(id, result.lastFailure, meta.internalDate);
      continue;
    }
    result.messages++;
    let error: string | null = null;
    for (const pdf of message.pdfs) {
      try {
        const { duplicate } = await deps.ingest({
          employeeId,
          bytes: pdf.bytes,
          fileName: pdf.fileName,
          source: "email",
          gmailMessageId: id,
          actorEmail: MAILBOX_ACTOR,
        });
        if (duplicate) result.duplicates++;
        else result.invoices++;
      } catch (failure) {
        result.failed++;
        error = `${pdf.fileName}: ${describe(failure)}`;
        result.lastFailure = error;
      }
    }
    await finish(id, error, message.internalDate);
  }
  return result;
}
