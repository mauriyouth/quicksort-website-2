import type { SupabaseClient } from "@supabase/supabase-js";
import type { BankStore, SyncState } from "./sync.ts";
import type { FixedChargeLine } from "../../src/ops/business-plan/model.ts";

const STATE_ID = "qonto";

function check(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`Bank store: ${what} failed: ${error.message}`);
}

function iso(v: string | null): string | null {
  return v ? new Date(v).toISOString() : null;
}

const STATE_COLUMNS: Record<keyof SyncState, string> = {
  cursor: "cursor",
  coverageStart: "coverage_start",
  backfillDone: "backfill_done",
  lockedUntil: "locked_until",
  lastRunAt: "last_run_at",
  lastError: "last_error",
};

export function createSupabaseBankStore(client: SupabaseClient): BankStore {
  return {
    async state() {
      const { data, error } = await client
        .from("bank_sync_state")
        .select("cursor,coverage_start,backfill_done,locked_until,last_run_at,last_error")
        .eq("id", STATE_ID)
        .maybeSingle();
      check(error, "read sync state");
      return {
        cursor: iso(data?.cursor ?? null),
        coverageStart: data?.coverage_start ?? null,
        backfillDone: data?.backfill_done ?? false,
        lockedUntil: iso(data?.locked_until ?? null),
        lastRunAt: iso(data?.last_run_at ?? null),
        lastError: data?.last_error ?? null,
      };
    },

    async tryLock(untilIso, nowIso) {
      const seed = await client
        .from("bank_sync_state")
        .upsert({ id: STATE_ID }, { onConflict: "id", ignoreDuplicates: true });
      check(seed.error, "create sync state");
      const { data, error } = await client
        .from("bank_sync_state")
        .update({ locked_until: untilIso })
        .eq("id", STATE_ID)
        .or(`locked_until.is.null,locked_until.lt."${nowIso}"`)
        .select("id");
      check(error, "acquire sync lock");
      return (data?.length ?? 0) > 0;
    },

    async release(patch) {
      const row: Record<string, unknown> = { locked_until: null };
      for (const [key, value] of Object.entries(patch)) {
        const column = STATE_COLUMNS[key as keyof SyncState];
        if (column) row[column] = value;
      }
      const { error } = await client.from("bank_sync_state").update(row).eq("id", STATE_ID);
      check(error, "release sync lock");
    },

    async saveCursor(cursor, coverageStart) {
      const { error } = await client
        .from("bank_sync_state")
        .update({ cursor, coverage_start: coverageStart })
        .eq("id", STATE_ID);
      check(error, "save sync cursor");
    },

    async upsertQonto(rows) {
      if (rows.length === 0) return;
      // Only Qonto columns: ai_* and manual_* are never part of the payload,
      // so an upsert on conflict leaves the classification untouched.
      const payload = rows.map((t) => ({
        id: t.id,
        settled_at: t.settledAt,
        emitted_at: t.emittedAt,
        month: t.month,
        amount_cents: t.amountCents,
        vat_cents: t.vatCents,
        amount_ht_cents: t.amountHtCents,
        currency: t.currency,
        label: t.label,
        counterparty: t.counterparty,
        operation_type: t.operationType,
        qonto_category: t.qontoCategory,
        note: t.note,
        reference: t.reference,
        status: t.status,
        qonto_updated_at: t.qontoUpdatedAt,
        raw: t.raw,
      }));
      const { error } = await client.from("bank_transactions").upsert(payload, { onConflict: "id" });
      check(error, "upsert transactions");
    },

    async unclassified(limit) {
      const { data, error } = await client
        .from("bank_transactions")
        .select("id,label,counterparty,amount_cents,operation_type,qonto_category,note")
        .eq("status", "completed")
        .is("ai_line", null)
        .is("manual_line", null)
        // Newest first: the current year's figures fill in before old history.
        .order("emitted_at", { ascending: false, nullsFirst: false })
        .order("id", { ascending: true })
        .limit(limit);
      check(error, "list unclassified transactions");
      return (data ?? []).map((r) => ({
        id: r.id,
        label: r.label,
        counterparty: r.counterparty,
        // TTC, as on the bank statement; the classifier only needs magnitude.
        amountEur: Number(r.amount_cents) / 100,
        operationType: r.operation_type,
        qontoCategory: r.qonto_category,
        note: r.note,
      }));
    },

    async saveAi(results, model, atIso) {
      // `ai_line is null` guard: an existing AI classification is never overwritten.
      const outcomes = await Promise.all(
        results.map((r) =>
          client
            .from("bank_transactions")
            .update({ ai_line: r.line, ai_confidence: r.confidence, ai_model: model, ai_classified_at: atIso })
            .eq("id", r.id)
            .is("ai_line", null),
        ),
      );
      for (const { error } of outcomes) check(error, "save classification");
    },

    async corrections(limit) {
      // Newest first: the classifier keeps the first 30.
      const { data, error } = await client
        .from("bank_transactions")
        .select("counterparty,label,manual_line")
        .not("manual_line", "is", null)
        .order("manual_at", { ascending: false, nullsFirst: false })
        .limit(limit);
      check(error, "list manual corrections");
      return (data ?? []).map((r) => ({
        counterparty: r.counterparty,
        label: r.label,
        line: r.manual_line as FixedChargeLine,
      }));
    },

    async firstPlanYear() {
      const { data, error } = await client
        .from("business_plans")
        .select("year")
        .order("year", { ascending: true })
        .limit(1)
        .maybeSingle();
      check(error, "read first business plan year");
      return data ? Number(data.year) : null;
    },
  };
}
