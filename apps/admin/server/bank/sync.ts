import type { BankTransaction, TransactionPage } from "./qonto-transactions.ts";
import type { Classification, ClassifyInput, Correction } from "./classifier.ts";

export type SyncState = {
  cursor: string | null;
  coverageStart: string | null; // YYYY-MM-DD
  backfillDone: boolean;
  lockedUntil: string | null;
  lastRunAt: string | null;
  lastError: string | null;
};

export interface BankStore {
  state(): Promise<SyncState>;
  tryLock(untilIso: string, nowIso: string): Promise<boolean>;
  release(patch: Partial<SyncState>): Promise<void>;
  saveCursor(cursor: string, coverageStart: string | null): Promise<void>;
  upsertQonto(rows: BankTransaction[]): Promise<void>;
  unclassified(limit: number): Promise<ClassifyInput[]>;
  saveAi(results: Classification[], model: string, atIso: string): Promise<void>;
  corrections(limit: number): Promise<Correction[]>;
  firstPlanYear(): Promise<number | null>;
}

export type BankSyncDeps = {
  store: BankStore;
  qonto: { listDebitsSince(sinceIso: string, page: number): Promise<TransactionPage> };
  classifier: { classify(items: ClassifyInput[], corrections: Correction[]): Promise<Classification[]> } | null;
  model: string;
  now: () => Date;
  budgetMs?: number;
};

export type BankSyncResult = {
  status: "ok" | "locked" | "partial";
  fetched: number;
  classified: number;
  remaining: number;
};

export const LOCK_MS = 5 * 60_000;
export const DEFAULT_BUDGET_MS = 45_000;
const BATCH_SIZE = 20;
const CORRECTIONS_LIMIT = 30;
const REMAINING_CAP = 1000;
const DEFAULT_START_YEAR = 2025;

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function runBankSync(deps: BankSyncDeps): Promise<BankSyncResult> {
  const { store, qonto, classifier, model, now } = deps;
  const startedAt = now();
  const deadline = startedAt.getTime() + (deps.budgetMs ?? DEFAULT_BUDGET_MS);
  const overBudget = () => now().getTime() >= deadline;

  const locked = await store.tryLock(
    new Date(startedAt.getTime() + LOCK_MS).toISOString(),
    startedAt.toISOString(),
  );
  if (!locked) return { status: "locked", fetched: 0, classified: 0, remaining: 0 };

  let status: BankSyncResult["status"] = "ok";
  let lastError: string | null = null;
  let fetched = 0;
  let classified = 0;
  let remaining = 0;
  let backfillDone: boolean | undefined; // left untouched if state() fails

  try {
    const state = await store.state();
    backfillDone = state.backfillDone;
    let coverageStart = state.coverageStart;
    let cursor: string;
    if (state.cursor) {
      cursor = state.cursor;
    } else {
      const start = `${(await store.firstPlanYear()) ?? DEFAULT_START_YEAR}-01-01`;
      cursor = `${start}T00:00:00.000Z`;
      coverageStart ??= start;
      await store.saveCursor(cursor, coverageStart);
    }

    // Fetch: updated_at_from is inclusive and upserts are idempotent, so after
    // each page we restart at page 1 from the newest updated_at seen. A page
    // that does not move the cursor (all rows share one updated_at) moves on
    // to the next page with the same cursor instead.
    try {
      let page = 1;
      while (true) {
        if (overBudget()) {
          status = "partial";
          break;
        }
        const res = await qonto.listDebitsSince(cursor, page);
        if (res.transactions.length > 0) await store.upsertQonto(res.transactions);
        fetched += res.transactions.length;
        let max: string = cursor;
        for (const t of res.transactions) {
          if (Date.parse(t.qontoUpdatedAt) > Date.parse(max)) max = t.qontoUpdatedAt;
        }
        const advanced = max !== cursor;
        if (advanced) {
          cursor = max;
          await store.saveCursor(cursor, coverageStart);
        }
        if (res.nextPage == null) {
          backfillDone = true;
          break;
        }
        page = advanced ? 1 : page + 1;
      }
    } catch (e) {
      status = "partial";
      lastError = message(e);
    }

    // Classify: batches of 20, newest first. Items the model skipped stay
    // unclassified for the next run but are not retried within this one.
    if (classifier) {
      try {
        const corrections = await store.corrections(CORRECTIONS_LIMIT);
        const attempted = new Set<string>();
        while (true) {
          const batch = (await store.unclassified(BATCH_SIZE + attempted.size))
            .filter((i) => !attempted.has(i.id))
            .slice(0, BATCH_SIZE);
          if (batch.length === 0) break;
          if (overBudget()) {
            status = "partial";
            break;
          }
          for (const i of batch) attempted.add(i.id);
          const results = await classifier.classify(batch, corrections);
          if (results.length > 0) await store.saveAi(results, model, now().toISOString());
          classified += results.length;
        }
      } catch (e) {
        lastError ??= message(e);
      }
    }

    remaining = (await store.unclassified(REMAINING_CAP)).length;
  } catch (e) {
    lastError = message(e);
    throw e;
  } finally {
    const patch: Partial<SyncState> = { lockedUntil: null, lastRunAt: startedAt.toISOString(), lastError };
    if (backfillDone !== undefined) patch.backfillDone = backfillDone;
    await store.release(patch);
  }

  return { status, fetched, classified, remaining };
}
