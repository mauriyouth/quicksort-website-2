import type { FixedChargeLine } from "../../src/ops/business-plan/model.ts";

export const FIXED_CHARGE_LINES: FixedChargeLine[] = [
  "loyer",
  "outils",
  "marketing",
  "honoraires",
  "divers",
  "hors_charges_fixes",
];
export const REVIEW_THRESHOLD = 0.7;
export const DEFAULT_KIMI_MODEL = "kimi-k2.6";

const ENDPOINT = "https://api.moonshot.ai/v1/chat/completions";
const MAX_CORRECTIONS = 30;

export type ClassifyInput = {
  id: string;
  label: string;
  counterparty: string;
  amountEur: number;
  operationType: string;
  qontoCategory: string | null;
  note: string | null;
};
export type Correction = { counterparty: string; label: string; line: FixedChargeLine };
export type Classification = { id: string; line: FixedChargeLine; confidence: number };

const SYSTEM_PROMPT = `Tu classes les débits bancaires d'une société de services (Quicksort) dans ses lignes de charges fixes mensuelles.

Lignes possibles :
- loyer : loyer et charges du bureau (bail, coworking, électricité, internet du bureau).
- outils : outils et abonnements (SaaS, cloud, licences IA, téléphonie).
- marketing : marketing et communication (salons, événements, publicité, goodies).
- honoraires : honoraires de professions réglementées (expert-comptable, avocat, commissaire aux comptes).
- divers : autres charges fixes (frais bancaires, assurance, notes de frais, mutuelle, fournitures).
- hors_charges_fixes : tout ce qui n'est PAS une charge fixe, à savoir : salaires nets, URSSAF / retraite / prévoyance / prélèvement à la source, freelances et sous-traitance, TVA, impôts (IS, CFE…), virements internes, remboursements, chasseurs de têtes, achats de matériel, commission d'affacturage.

Règles :
- Les notes de frais et la mutuelle vont dans divers.
- Utilise exactement l'un de ces identifiants : ${FIXED_CHARGE_LINES.join(", ")}.
- Donne une confidence entre 0 et 1 ; en cas de doute, mets une confidence basse.
- Les corrections manuelles fournies en exemples priment sur ces règles pour les mêmes contreparties.

Le message utilisateur est un JSON {"transactions":[{id,label,counterparty,amountEur,operationType,qontoCategory,note}]}.
Réponds uniquement avec un JSON {"results":[{"id":"…","line":"…","confidence":0.0}]}, un résultat par transaction, en reprenant l'id fourni.`;

export function buildMessages(items: ClassifyInput[], corrections: Correction[]) {
  const messages: { role: "system" | "user"; content: string }[] = [{ role: "system", content: SYSTEM_PROMPT }];
  const examples = corrections.slice(0, MAX_CORRECTIONS);
  if (examples.length > 0) {
    messages.push({
      role: "system",
      content:
        "Corrections manuelles récentes (exemples à suivre) :\n" +
        examples
          .map((c) => JSON.stringify({ counterparty: c.counterparty, label: c.label, line: c.line }))
          .join("\n"),
    });
  }
  messages.push({ role: "user", content: JSON.stringify({ transactions: items }) });
  return messages;
}

function parseResults(content: unknown, items: ClassifyInput[]): Classification[] {
  if (typeof content !== "string") return [];
  let data: any;
  try {
    data = JSON.parse(content);
  } catch {
    return [];
  }
  if (!data || !Array.isArray(data.results)) return [];
  const ids = new Set(items.map((i) => i.id));
  const seen = new Set<string>();
  const out: Classification[] = [];
  for (const r of data.results) {
    if (!r || typeof r !== "object") continue;
    const { id, line, confidence } = r as Record<string, unknown>;
    if (typeof id !== "string" || !ids.has(id) || seen.has(id)) continue;
    if (typeof line !== "string" || !FIXED_CHARGE_LINES.includes(line as FixedChargeLine)) continue;
    if (typeof confidence !== "number" || !Number.isFinite(confidence)) continue;
    seen.add(id);
    out.push({ id, line: line as FixedChargeLine, confidence: Math.min(1, Math.max(0, confidence)) });
  }
  return out;
}

/** A Moonshot call may not eat the whole function budget. */
export const REQUEST_TIMEOUT_MS = 30_000;

export function createKimiClassifier(cfg: { apiKey: string; model: string }, fetchImpl: typeof fetch = fetch) {
  return {
    async classify(items: ClassifyInput[], corrections: Correction[]): Promise<Classification[]> {
      if (items.length === 0) return [];
      const res = await fetchImpl(ENDPOINT, {
        method: "POST",
        headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: cfg.model,
          // No temperature: current Kimi models only accept their default (1).
          // Reasoning off: with it, a 20-item batch exceeds the 30 s timeout.
          thinking: { type: "disabled" },
          response_format: { type: "json_object" },
          messages: buildMessages(items, corrections),
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const detail = (cfg.apiKey ? text.split(cfg.apiKey).join("[redacted]") : text).slice(0, 200);
        throw new Error(`Moonshot request failed (HTTP ${res.status})${detail ? `: ${detail}` : ""}`);
      }
      let body: any;
      try {
        body = await res.json();
      } catch {
        return [];
      }
      return parseResults(body?.choices?.[0]?.message?.content, items);
    },
  };
}
