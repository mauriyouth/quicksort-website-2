# Transactions Qonto → charges fixes : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Synchroniser les débits Qonto, les classer avec Kimi dans les lignes de charges fixes, et les utiliser comme réel (HT) des mois clôturés du business plan, avec un panneau de détail pour reclasser.

**Architecture:** Un module serveur `apps/admin/server/bank/` (client Qonto transactions, classifieur Kimi, orchestrateur de synchro testable via une interface `BankStore`, implémentation Supabase). Un endpoint Vercel `api/bank-transactions.ts` (admin : statut, synchro, reclassement, réglages Kimi) + `api/bank-transactions-cron.ts` (cron quotidien, `CRON_SECRET`, client service role). Côté front, une agrégation pure dans `actuals.ts`, consommée par `computePlan` pour les mois clôturés couverts, et de nouveaux `DetailKind` dans `DetailPanel`.

**Tech Stack:** TypeScript, React, Supabase (Postgres + RLS), handlers Vercel, `node --test` (`--experimental-strip-types`), zod, API Qonto `thirdparty.qonto.com/v2/transactions`, API Moonshot compatible OpenAI (`https://api.moonshot.ai/v1/chat/completions`).

**Spec:** `docs/superpowers/specs/2026-11-04-qonto-transactions-fixed-charges-design.md`

## Global Constraints

- Lignes (enum `fixed_charge_line`) : `loyer`, `outils`, `marketing`, `honoraires`, `divers`, `hors_charges_fixes`.
- Ligne effective = `coalesce(manual_line, ai_line)` ; une synchro ou Kimi ne modifie **jamais** `manual_line`, et ne reclasse jamais une transaction dont `ai_line` est déjà posé.
- Seuil « à vérifier » : `ai_confidence < 0.7` et `manual_line is null` (constante `REVIEW_THRESHOLD = 0.7`).
- Montants : tous les totaux en **HT** (`amount_ht_cents = amount_cents − vat_cents`, sans TVA connue HT = TTC). Seuls les débits (`side=debit`) sont synchronisés ; seuls les `status = 'completed'` comptent.
- Synchro incrémentale : `updated_at_from = cursor`, tri `updated_at:asc` ; le curseur n'avance qu'après l'upsert réussi d'une page. Premier run : 1er janvier de la plus ancienne année de `business_plans`, sinon `2025-01-01`.
- Mois clôturé ≥ `coverage_start` (mois de départ de la première synchro complète) → réel (0 reste 0) ; avant, ou sans synchro complète → hypothèse.
- « Salaires structure chargés » n'est pas touchée.
- Exclusions du prompt (`hors_charges_fixes`) : salaires nets, URSSAF / retraite / prévoyance / PAS, freelances et sous-traitance, TVA, impôts (IS, CFE…), virements internes, remboursements, chasseurs de têtes, achats de matériel, commission d'affacturage. Notes de frais et mutuelle → `divers`.
- Clé Kimi : ligne `ai_settings` id `bank-classifier` (chiffrée, AAD `quicksort/bank-classifier/v1`), repli `MOONSHOT_API_KEY`. Modèle par défaut `DEFAULT_KIMI_MODEL` (vérifier le nom du modèle courant via `GET https://api.moonshot.ai/v1/models` avant de le figer).
- Cron : `CRON_SECRET` (déjà dans `apps/admin/.env` et sur Vercel) ; client Supabase service role `SUPABASE_SERVICE_ROLE_KEY` (comme `apps/admin/server/treg.ts`).
- Textes UI en français, style existant du `DetailPanel` / `business-plan.css`.
- Fonctions bornées en temps : chaque run s'arrête après `budgetMs` (défaut 45 000) et reprend au run suivant.

## Review Focus

1. Une transaction déjà classée qui passe en `reversed`/`declined` dans une synchro suivante → elle sort des totaux, sa classification est conservée (test Task 4).
2. Plusieurs transactions avec le même `updated_at` à cheval sur deux pages → aucune perdue : requête avec `updated_at_from` inclusif + upsert idempotent (test Task 4).
3. Réponse Kimi invalide (JSON cassé, id inconnu, id manquant, ligne hors liste) → les transactions concernées restent non classées, le reste du lot est enregistré, pas d'exception (test Task 3).
4. Correction manuelle puis mise à jour Qonto de la même transaction (libellé/statut) → `manual_line` intact (test Task 4).
5. Mois clôturé couvert sans aucune transaction → 0, pas l'hypothèse ; mois avant `coverage_start` → hypothèse (test Task 6).

---

### Task 1: Migration Supabase

**Files:**
- Create: `supabase/migrations/20261207090000_bank_transactions.sql`

**Interfaces:**
- Produces: type `public.fixed_charge_line`, tables `public.bank_transactions`, `public.bank_sync_state` (ligne unique `id = 'qonto'`), vue `public.bank_transactions_effective` (ajoute `line = coalesce(manual_line, ai_line)` et `needs_review`).

- [ ] **Step 1: Écrire la migration**

`bank_transactions` : `id text primary key`, `settled_at timestamptz`, `emitted_at timestamptz`, `month date not null`, `amount_cents bigint not null`, `vat_cents bigint not null default 0`, `amount_ht_cents bigint not null`, `currency text not null default 'EUR'`, `label text not null default ''`, `counterparty text not null default ''`, `operation_type text not null default ''`, `qonto_category text`, `note text`, `reference text`, `status text not null`, `qonto_updated_at timestamptz not null`, `raw jsonb not null`, `ai_line fixed_charge_line`, `ai_confidence numeric(4,3)`, `ai_model text`, `ai_classified_at timestamptz`, `manual_line fixed_charge_line`, `manual_by text`, `manual_at timestamptz`. Index sur `(month)` et partiel sur `(id) where ai_line is null and manual_line is null`.

`bank_sync_state` : `id text primary key`, `cursor timestamptz`, `coverage_start date`, `backfill_done boolean not null default false`, `locked_until timestamptz`, `last_run_at timestamptz`, `last_error text`.

Vue `bank_transactions_effective` en `security_invoker = true`, `needs_review = manual_line is null and ai_confidence < 0.7`.

RLS et grants : copier le pattern de `20261203090000_business_plan_structure.sql` (`private.is_admin()`, revoke anon, grant authenticated) pour les deux tables ; `select` sur la vue.

- [ ] **Step 2: Appliquer et vérifier**

Run: `supabase db reset` (ou `supabase migration up` sur la base locale) puis `psql … -c "\d public.bank_transactions"`.
Expected: table, vue et policies présentes, sans erreur.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20261207090000_bank_transactions.sql
git commit -m "feat(bank): tables for Qonto transactions and sync state"
```

### Task 2: Client Qonto transactions

**Files:**
- Create: `apps/admin/server/bank/qonto-transactions.ts`
- Test: `tests/bank-qonto-transactions.test.mjs`

**Interfaces:**
- Consumes: `QontoConfig` de `apps/admin/server/invoicing/qonto.ts`, `ProviderError` de `provider.ts`.
- Produces:
  - `type BankTransaction = { id: string; settledAt: string | null; emittedAt: string | null; month: string /* YYYY-MM-01 */; amountCents: number; vatCents: number; amountHtCents: number; currency: string; label: string; counterparty: string; operationType: string; qontoCategory: string | null; note: string | null; reference: string | null; status: string; qontoUpdatedAt: string; raw: unknown }`
  - `type TransactionPage = { transactions: BankTransaction[]; nextPage: number | null }`
  - `createQontoTransactions(config: QontoConfig, fetchImpl?: typeof fetch): { listDebitsSince(since: string, page: number): Promise<TransactionPage> }`
  - `mapTransaction(t: unknown): BankTransaction`

- [ ] **Step 1: Tests qui échouent**

Reprendre `fakeFetch`/`json` de `tests/invoicing-qonto.test.mjs`.
- `listDebitsSince sends iban, side, updated_at_from, sort and paging` : URL contient `/v2/transactions`, `iban=FR76…`, `side=debit`, `updated_at_from=2025-01-01T00%3A00%3A00.000Z`, `sort_by=updated_at%3Aasc`, `per_page=100`, `current_page=2` ; header `authorization` = `acme-1234:sk-SECRET-XYZ` ; `nextPage` = `meta.next_page`.
- `mapTransaction computes HT from vat_amount_cents` : `{amount_cents: 12000, vat_amount_cents: 2000, settled_at: "2026-03-31T22:30:00Z"}` → `amountHtCents 10000`, `month "2026-04-01"` (mois calculé en heure de Paris : 22:30 UTC le 31/03 = 00:30 le 01/04).
- `mapTransaction without VAT keeps TTC` : pas de `vat_amount_cents` ni `vat_amount` → `vatCents 0`, `amountHtCents === amountCents`.
- `mapTransaction falls back to emitted_at when not settled` et `clean_counterparty_name` → `counterparty`.
- `non-ok response throws ProviderError` (401).

- [ ] **Step 2: Lancer** — `node --experimental-strip-types --test tests/bank-qonto-transactions.test.mjs` → FAIL (module introuvable).

- [ ] **Step 3: Implémenter** dans `qonto-transactions.ts`. Réutiliser la logique d'en-têtes/erreurs de `request()` de `qonto.ts` : l'extraire en `export function qontoRequest(config, fetchImpl)` dans `qonto.ts` plutôt que la dupliquer. `amount_cents` est en devise du compte (EUR), toujours positif ; TVA : `vat_amount_cents` sinon `Math.round(vat_amount*100)` sinon 0. Mois calculé en `Europe/Paris` via `Intl.DateTimeFormat`.

- [ ] **Step 4: Lancer** — même commande + `tests/invoicing-qonto.test.mjs` → PASS.

- [ ] **Step 5: Commit** — `feat(bank): Qonto debit transactions client`.

### Task 3: Classifieur Kimi

**Files:**
- Create: `apps/admin/server/bank/classifier.ts`
- Modify: `apps/admin/src/ops/business-plan/model.ts` (ajouter uniquement `export type FixedLineKey = "loyer" | "outils" | "marketing" | "honoraires" | "divers"` et `export type FixedChargeLine = FixedLineKey | "hors_charges_fixes"`)
- Test: `tests/bank-classifier.test.mjs`

**Interfaces:**
- Produces:
  - `FIXED_CHARGE_LINES: FixedChargeLine[]`, `REVIEW_THRESHOLD = 0.7`, `DEFAULT_KIMI_MODEL` (le type `FixedChargeLine` est importé, type-only, de `apps/admin/src/ops/business-plan/model.ts` — défini en Task 3 dans ce fichier, réutilisé en Task 6)
  - `type ClassifyInput = { id: string; label: string; counterparty: string; amountEur: number; operationType: string; qontoCategory: string | null; note: string | null }`
  - `type Correction = { counterparty: string; label: string; line: FixedChargeLine }`
  - `type Classification = { id: string; line: FixedChargeLine; confidence: number }`
  - `createKimiClassifier(cfg: { apiKey: string; model: string }, fetchImpl?: typeof fetch): { classify(items: ClassifyInput[], corrections: Correction[]): Promise<Classification[]> }`
  - `buildMessages(items, corrections)` (exporté pour test)

- [ ] **Step 1: Tests qui échouent**
- `classify posts to Moonshot chat completions` : URL `https://api.moonshot.ai/v1/chat/completions`, `authorization: Bearer k`, body `model`, `temperature: 0`, `response_format: {type: "json_object"}`.
- `system prompt lists every line and the exclusions` : contient chacune des 6 lignes et `URSSAF`, `chasseurs de têtes`, `affacturage`, `matériel`, `mutuelle`.
- `corrections are injected as examples` : une correction `{counterparty: "OVH", line: "outils"}` apparaît dans les messages.
- `parses {"results":[{id,line,confidence}]}` → `Classification[]`, `confidence` bornée à [0,1].
- Review Focus 3 : `invalid JSON returns []`, `unknown id and out-of-list line are dropped, valid ones kept`, `missing ids are simply absent`.
- `HTTP 401 throws` (erreur avec message lisible, pas la clé).

- [ ] **Step 2: Lancer** → FAIL.
- [ ] **Step 3: Implémenter.** Le prompt système (français) décrit chaque ligne avec 3–4 exemples typiques (loyer : bail, coworking, électricité/internet du bureau ; outils : SaaS, cloud, licences IA, téléphonie ; marketing : salons, événements, pub, goodies ; honoraires : expert-comptable, avocat, CAC ; divers : banque, assurance, notes de frais, mutuelle, fournitures) et la liste d'exclusions des Global Constraints. Le message utilisateur est le JSON `{transactions:[…]}` ; réponse attendue `{results:[{id,line,confidence}]}`. Max 30 dernières corrections.
- [ ] **Step 4: Lancer** → PASS.
- [ ] **Step 5: Commit** — `feat(bank): Kimi classifier for fixed charges`.

### Task 4: Orchestrateur de synchro + store Supabase

**Files:**
- Create: `apps/admin/server/bank/sync.ts`, `apps/admin/server/bank/store.ts`
- Test: `tests/bank-sync.test.mjs`

**Interfaces:**
- Consumes: Task 2 (`listDebitsSince`, `BankTransaction`), Task 3 (`classify`, `Correction`, `ClassifyInput`).
- Produces:
  - `interface BankStore { state(): Promise<SyncState>; tryLock(untilIso: string, nowIso: string): Promise<boolean>; release(patch: Partial<SyncState>): Promise<void>; saveCursor(cursor: string, coverageStart: string | null): Promise<void>; upsertQonto(rows: BankTransaction[]): Promise<void>; unclassified(limit: number): Promise<ClassifyInput[]>; saveAi(results: Classification[], model: string, atIso: string): Promise<void>; corrections(limit: number): Promise<Correction[]>; firstPlanYear(): Promise<number | null> }`
  - `type SyncState = { cursor: string | null; coverageStart: string | null; backfillDone: boolean; lockedUntil: string | null; lastRunAt: string | null; lastError: string | null }`
  - `runBankSync(deps: { store: BankStore; qonto: { listDebitsSince } ; classifier: { classify } | null; model: string; now: () => Date; budgetMs?: number }): Promise<{ status: "ok" | "locked" | "partial"; fetched: number; classified: number; remaining: number }>`
  - `createSupabaseBankStore(client: SupabaseClient): BankStore` — `upsertQonto` n'écrit **que** les colonnes Qonto (jamais `ai_*`/`manual_*`) ; `unclassified` = `ai_line is null and manual_line is null`, plus anciennes d'abord ; `tryLock` = `update … set locked_until = $until where id='qonto' and (locked_until is null or locked_until < $now)` (insère la ligne si absente) ; `corrections` = dernières `manual_line` non nulles.

- [ ] **Step 1: Tests qui échouent** (store en mémoire dans le fichier de test, Qonto et classifieur factices)
- `first run starts at Jan 1 of first plan year, else 2025` (`firstPlanYear` 2024 → `2024-01-01T00:00:00.000Z` ; `null` → `2025-01-01…`) et pose `coverageStart` = ce 1er janvier.
- `paginates and advances the cursor to the max qontoUpdatedAt after each page`.
- `error on page 2 keeps the cursor of page 1, records lastError, releases the lock`.
- Review Focus 2 : `same updated_at across pages: nothing lost, re-fetch is idempotent`.
- Review Focus 4 : `re-sync of a manually classified transaction keeps manual_line and ai_line`.
- Review Focus 1 : `status change to reversed is stored, classification kept`.
- `classifies unclassified in batches of 20 using corrections`; `classifier null → fetched ok, classified 0`; `classifier throws → sync still ok, lastError set`.
- `locked → status "locked", nothing fetched`; `lock expires after 5 minutes`.
- `budget exceeded → status "partial", remaining > 0`; `backfillDone` passe à `true` quand une page renvoie `nextPage null`.

- [ ] **Step 2: Lancer** → FAIL.
- [ ] **Step 3: Implémenter `runBankSync`** : lock (5 min) → boucle pages tant que budget → classement par lots de 20 tant que budget → `release({ lastRunAt, lastError })`.
- [ ] **Step 4: Implémenter `createSupabaseBankStore`** (pas de test unitaire dédié ; couvert en Task 5 via le fake client et en vérification manuelle).
- [ ] **Step 5: Lancer** → PASS.
- [ ] **Step 6: Commit** — `feat(bank): incremental Qonto sync with resumable classification`.

### Task 5: Endpoints API, cron et réglages Kimi

**Files:**
- Create: `apps/admin/api/bank-transactions.ts`, `apps/admin/api/bank-transactions-cron.ts`, `apps/admin/server/bank/settings.ts`
- Modify: `apps/admin/vercel.json` (ajouter `"crons": [{ "path": "/api/bank-transactions-cron", "schedule": "0 5 * * *" }]`), `apps/admin/vite.config.ts` (routes dev `/api/bank-transactions`, `/api/bank-transactions-cron`)
- Test: `tests/bank-transactions-api.test.mjs`

**Interfaces:**
- Consumes: Tasks 2–4, `loadInvoicingSettings`/`QontoConfig`, `encryptSecret`/`decryptSecret`.
- Produces:
  - `loadClassifierSettings(client): Promise<{ apiKey: string; model: string; source: "settings" | "environment" | "none" }>` ; `saveClassifierSettings(client, { apiKey?: string; model: string })`.
  - `createBankHandler(deps)` — auth identique à `createInvoicingHandler` (Bearer Clerk → `sync_clerk_profile` → `user_roles.role === "admin"`).
    - `GET ?resource=status` → `{ state: SyncState, classifier: { configured, model, source }, reviewCount }`
    - `GET ?resource=transactions&year=YYYY` → lignes de `bank_transactions_effective` de l'année (`id, month, settled_at, emitted_at, label, counterparty, amount_cents, amount_ht_cents, status, line, ai_line, ai_confidence, manual_line, needs_review`)
    - `POST {action:"sync"}` → résultat de `runBankSync`
    - `POST {action:"classify", id, line: FixedChargeLine}` → écrit `manual_line`, `manual_by`, `manual_at` (valider = reposer la ligne IA en manuel)
    - `POST {action:"save_classifier", apiKey?, model}` → teste la clé via `GET /v1/models` puis enregistre
  - `createBankCronHandler(deps)` : refuse (401) si `authorization !== "Bearer " + CRON_SECRET` ou `CRON_SECRET` vide ; client `createClient(url, SUPABASE_SERVICE_ROLE_KEY)` ; lance `runBankSync`.

- [ ] **Step 1: Tests qui échouent** (pattern et fake client de `tests/invoicing-api.test.mjs`)
- `rejects non-admin (403) and missing token (401)`.
- `cron: wrong or missing CRON_SECRET → 401; correct → runs sync` ; `cron with empty CRON_SECRET env → 401`.
- `classify writes manual_line only` ; `classify rejects unknown line (400)`.
- `status never leaks the Kimi key` ; `save_classifier with invalid key → 400`.
- `sync when Qonto not configured → 409 "Connectez Qonto dans les réglages de facturation."`.
- [ ] **Step 2: Lancer** → FAIL.
- [ ] **Step 3: Implémenter** les trois fichiers + `vercel.json` + `vite.config.ts`.
- [ ] **Step 4: Lancer** → PASS, puis `pnpm test` complet → PASS.
- [ ] **Step 5: Commit** — `feat(bank): admin API, daily cron and Kimi settings`.

### Task 6: Agrégation et modèle du business plan

**Files:**
- Modify: `apps/admin/src/ops/business-plan/actuals.ts`, `apps/admin/src/ops/business-plan/model.ts`
- Test: `tests/business-plan-model.test.mjs`

**Interfaces:**
- Consumes: forme des lignes de `GET ?resource=transactions` (Task 5).
- Produces:
  - `model.ts` (`FixedLineKey`/`FixedChargeLine` existent depuis Task 3) : `type FixedActuals = Record<FixedLineKey, number>` (€ HT) ; `MonthInput.fixed?: FixedActuals` ; `PlanRow.key` élargi à `FixedLineKey`.
  - `actuals.ts` : `type BankRow = { id: string; month: string; line: FixedChargeLine | null; amount_ht_cents: number; status: string; needs_review: boolean; label: string; counterparty: string; settled_at: string | null; emitted_at: string | null; amount_cents: number; ai_line: string | null; manual_line: string | null; ai_confidence: number | null }` ; `aggregateFixedCharges(rows: BankRow[], year: number, openFrom: number, coverageStart: string | null): { fixed: (FixedActuals | null)[]; lines: (BankRow[] | null)[]; review: number[]; unclassified: (BankRow[] | null)[] }` — `null` pour les mois ouverts ou avant `coverageStart` ; `lines[m]` = transactions `completed` du mois (toutes lignes, pour le panneau) ; `review[m]` = nb `needs_review` du mois.
  - `computePlan` : si `m.actual && m.fixed`, `fl/fo/fm/fh/fd` = `m.fixed.*` ; sinon hypothèses. `fixMonth`, EBITDA, EBIT et trésorerie suivent.
  - `planRows` : `key` `loyer|outils|marketing|honoraires|divers` sur les cinq lignes.

- [ ] **Step 1: Tests qui échouent**
- `aggregateFixedCharges sums HT completed debits per month and line` (deux loyers mars → somme HT ; une `declined` ignorée ; `hors_charges_fixes` et non classées hors totaux).
- Review Focus 5 : `covered closed month with no transaction is all zeros` ; `month before coverageStart is null` ; `coverageStart null → all null` ; `open month → null`.
- `review counts needs_review per month`.
- `computePlan uses fixed actuals on closed months and hypotheses on open months` (vérifier `fl`, `fix`, `eb`, `treso`).
- `planRows tags the five fixed lines with drill keys`.
- [ ] **Step 2: Lancer** — `node --experimental-strip-types --test tests/business-plan-model.test.mjs` → FAIL.
- [ ] **Step 3: Implémenter.** Mettre à jour le commentaire d'en-tête de `model.ts` (« there is no ledger » n'est plus vrai pour les charges fixes).
- [ ] **Step 4: Lancer** → PASS.
- [ ] **Step 5: Commit** — `feat(business-plan): fixed charges from Qonto on closed months`.

### Task 7: UI business plan — chargement, bouton Actualiser, panneau de détail

**Files:**
- Create: `apps/admin/src/ops/business-plan/bank.ts` (client API : `useBankApi()` sur le modèle de `apps/admin/src/sales/invoicing/api.ts`)
- Modify: `apps/admin/src/ops/business-plan/BusinessPlan.tsx`, `apps/admin/src/ops/business-plan/DetailPanel.tsx`, `apps/admin/src/ops/business-plan/business-plan.css`

**Interfaces:**
- Consumes: Task 5 (endpoints), Task 6 (`aggregateFixedCharges`, `FixedLineKey`, `MonthInput.fixed`).
- Produces: `DetailKind` élargi à `FixedLineKey` ; prop `bank: { lines, review, onClassify(id: string, line: FixedChargeLine): Promise<void> }` sur `DetailPanel`.

- [ ] **Step 1: Chargement.** Au chargement de l'année : `GET status` puis `GET transactions&year`. À l'ouverture de la page, déclencher `POST sync` en arrière-plan si `lastRunAt` a plus de 12 h ; à la fin, recharger les transactions. Erreurs (Qonto/Kimi indisponible, table absente) → message discret, le plan reste affiché avec les dernières données. Passer `fixed` dans les `MonthInput` des mois clôturés.
- [ ] **Step 2: Bouton « Actualiser Qonto »** dans l'en-tête du tableau : état « Synchronisation… », puis « Synchronisé il y a X · N à vérifier » ; si `status === "partial"`, « Rattrapage en cours » et relance automatique tant que `remaining > 0` (max 10 relances).
- [ ] **Step 3: Lignes du tableau.** Les cinq lignes deviennent cliquables (`title="Voir le détail des transactions"`). Pastille sur la cellule d'un mois avec `review[m] > 0`.
- [ ] **Step 4: Panneau.** Mois clôturé : total HT, liste triée par date (date, contrepartie, libellé, montant HT, TTC en secondaire, badges « à vérifier » / « corrigé »), sélecteur de ligne (6 options, libellés du tableau + « Hors charges fixes ») et bouton « Valider » sur les « à vérifier » ; reclasser met à jour localement puis recalcule. Lien « Voir les transactions hors charges fixes et non classées » qui bascule la liste sur ces transactions du mois. Mois avant la couverture : « Pas de données Qonto pour ce mois : hypothèse affichée. » Mois prévisionnel : hypothèse + moyenne réelle des 3 derniers mois clôturés couverts.
- [ ] **Step 5: Pied de page.** Remplacer « Autres charges variables et fixes : hypothèses. » par « Charges fixes (hors salaires structure) : transactions Qonto HT classées, mois clôturés ; hypothèses sinon. Autres charges variables : hypothèses. »
- [ ] **Step 6: Vérifier.** `pnpm --filter admin build` (ou `tsc --noEmit` du projet admin) → OK ; captures via le harnais Playwright admin (voir mémoire `admin-visual-harness`, ~1155 px) : ligne Loyer cliquable, panneau avec transactions, reclassement qui change le total.
- [ ] **Step 7: Commit** — `feat(business-plan): Qonto transactions drill-down and refresh`.

### Task 8: Réglages Kimi dans Paramètres

**Files:**
- Modify: `apps/admin/src/AdminSettings.tsx` (nouvelle carte « Classement des transactions (Kimi) »)

**Interfaces:**
- Consumes: Task 5 (`GET status`, `POST save_classifier`).

- [ ] **Step 1: Implémenter** la carte : statut (configuré / source / modèle), champ clé (masqué, jamais réaffiché), champ modèle prérempli, bouton Enregistrer, erreur 400 affichée. Mention : « Les libellés, contreparties et montants des dépenses sont envoyés à Moonshot (Kimi) pour le classement. »
- [ ] **Step 2: Vérifier** — build OK + capture de la carte.
- [ ] **Step 3: Commit** — `feat(settings): Kimi classifier settings`.

### Task 9: Vérification de bout en bout

- [ ] **Step 1:** `pnpm test` → tout PASS.
- [ ] **Step 2:** Avec la base locale + vraies clés : `POST sync` depuis l'UI, vérifier que le rattrapage avance, que des transactions sont classées, qu'un mois clôturé affiche le réel et qu'un reclassement modifie le total et survit à une nouvelle synchro.
- [ ] **Step 3:** `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:5173/api/bank-transactions-cron` → 200 ; sans header → 401.
- [ ] **Step 4:** Mettre à jour `ARCHITECTURE.md` (section variables d'env : `CRON_SECRET`, `MOONSHOT_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` requis pour le cron) et commit `docs: bank transactions sync`.
