import { z } from "zod";
import { loadTregSettings } from "./treg.ts";
const amount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const ledgerSchema = z.object({ key: z.literal("admin"), days: z.literal(30), rows: z.array(z.object({ value: z.string(), charged_micro: amount, calls: amount })), attributed_micro: amount, unattributed_micro: amount, total_micro: amount });
export function validateLedger(input: unknown) {
  const ledger = ledgerSchema.parse(input);
  const total = ledger.rows.reduce((sum, row) => sum + BigInt(row.charged_micro), 0n);
  if (total !== BigInt(ledger.attributed_micro) || BigInt(ledger.attributed_micro) + BigInt(ledger.unattributed_micro) !== BigInt(ledger.total_micro) || new Set(ledger.rows.map(row => row.value)).size !== ledger.rows.length) {
    throw new Error("Research usage does not reconcile.");
  }
  return ledger;
}
export async function loadTregReport() {
  const { token, org } = loadTregSettings();
  const orgId = process.env.TREG_ORG_ID;
  if (!token || !orgId) throw new Error("Research reporting is not configured.");
  const response = await fetch(`https://treg.to/orgs/${encodeURIComponent(orgId)}/usage/by-tag?key=admin&days=30`, {
    headers: { "X-Treg-Token": process.env.TREG_REPORT_TOKEN || token, ...(org ? { "X-Treg-Org": org } : {}) },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error("Research usage is unavailable.");
  return validateLedger(await response.json());
}
