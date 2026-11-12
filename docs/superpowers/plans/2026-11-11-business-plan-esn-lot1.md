# Business plan ESN — lot 1 (indicateurs et calendrier) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer `jours`/`occ` par un calendrier de jours ouvrés et un TACI modulé par les congés, et ajouter la section « Indicateurs ESN » (TACI, TACE, intercontrat, TJM réalisé, CJM, marge/jour, taux de structure, CA/consultant), mesurée sur le réel et projetée sur le prévisionnel.

**Architecture:** Un nouveau module pur `calendar.ts` calcule les jours ouvrés (hors fériés) et le TACI mensuel. `computePlan` prend l'année, en déduit le calendrier, et produit les nouvelles séries. `aggregateActuals` mesure jours ouvrés, jours facturés et absences des salariés depuis le CRA (tous statuts). L'UI remplace les deux hypothèses, la ligne « Jours ouvrés », et ajoute deux tuiles KPI.

**Tech Stack:** TypeScript, React, `node --test` avec `--experimental-strip-types`, Supabase.

**Spec:** `docs/superpowers/specs/2026-11-11-business-plan-esn-design.md` (section « Lot 1 »).

## Global Constraints

- TACI = jours facturés / jours ouvrés ; les congés et RTT restent au dénominateur. C'est l'hypothèse qui pilote le prévisionnel.
- TACE = jours facturés / (jours ouvrés − congés) ; indicateur seulement, plafonné à 100 %.
- Jours ouvrés = lundi–vendredi moins `frenchHolidays(year)` (`apps/admin/src/cra/domain.ts`).
- Les jours `internal` et les jours ouvrés sans saisie CRA comptent comme de l'intercontrat.
- Défauts : `taci: 75` (TACE ≈ 87 %), `congesAn: 25`, `rttAn: 10`. 50 % des CP en août ; le reste des CP et les RTT répartis sur les 11 autres mois au prorata de leurs jours ouvrés.
- Moyenne annuelle du TACI modulé, pondérée par les jours ouvrés = TACI saisi, tant que le TACE ne dépasse pas 100 %.
- Les mois clôturés gardent leurs chiffres réels : CA, coûts, trésorerie inchangés par ce lot.
- `model.ts` reste sans dépendance framework ; libellés UI en français, comme l'existant.

## Review Focus

- Plan sauvegardé avant ce lot (`hypotheses` avec `occ`/`jours`, sans `taci`) : il s'ouvre avec `taci = occ`, sans NaN. → test Task 2.
- TACI saisi au-dessus du maximum (≈ 86 % avec 35 j de congés) : TACE plafonné à 100 %, intercontrat à 0, jamais négatif. → test Task 1 et Task 2.
- Mois clôturé avec un CRA à moitié rempli : indicateurs affichés avec la mention « CRA incomplet », pas un TACI à 40 % présenté comme fiable. → test Task 3.
- Mois sans salarié ou sans CA (début d'année, plan vide) : indicateurs à 0, pas de division par zéro ni `NaN`/`Infinity` dans la grille et l'export. → test Task 2.
- Salarié arrivé ou parti en cours de mois, ou membre de la structure en mission : ses jours ouvrés sont limités à sa période et à sa part consultant. → test Task 3.

---

### Task 1: Calendrier de jours ouvrés et TACI mensuel

**Files:**
- Create: `apps/admin/src/ops/business-plan/calendar.ts`
- Test: `tests/business-plan-model.test.mjs` (ajouter à la fin)

**Interfaces:**
- Consumes: `frenchHolidays(year: number): Record<string, string>` de `apps/admin/src/cra/domain.ts`.
- Produces:
  - `workingDaysBetween(start: string, end: string, holidays?: Set<string>): number` — jours lun–ven de `[start, end]` (ISO, bornes incluses) hors fériés des années couvertes ; 0 si `end < start` ou date invalide.
  - `monthWorkingDays(year: number): number[]` — 12 valeurs.
  - `type WorkingCalendar = { jo: number[]; abs: number[]; taci: number[]; tace: number[]; taciMax: number }` — `abs` : jours d'absence prévus par salarié ; `taci`, `tace` : fractions (0–1) ; `taciMax` : TACI annuel maximum, `Σ (jo − abs) / Σ jo`.
  - `workingCalendar(year: number, h: Pick<Hypotheses, "taci" | "congesAn" | "rttAn">): WorkingCalendar`.

- [ ] **Step 1: Write the failing tests**

```js
import { monthWorkingDays, workingCalendar, workingDaysBetween } from "../apps/admin/src/ops/business-plan/calendar.ts";

test("calendar: working days exclude weekends and French holidays", () => {
  const jo = monthWorkingDays(2026);
  // Mai 2026 : 21 jours lun–ven, moins 1er mai (ven), 8 mai (ven), Ascension 14 mai (jeu), Pentecôte 25 mai (lun).
  assert.equal(jo[4], 17);
  // Août 2026 : 21 jours lun–ven ; le 15 août tombe un samedi.
  assert.equal(jo[7], 21);
  assert.equal(jo.reduce((a, b) => a + b, 0), 252);
  assert.equal(workingDaysBetween("2026-05-01", "2026-05-08"), 4);
  assert.equal(workingDaysBetween("2026-05-08", "2026-05-01"), 0);
});

test("calendar: leave lowers August and keeps the yearly TACI", () => {
  const cal = workingCalendar(2026, { taci: 75, congesAn: 25, rttAn: 10 });
  assert.equal(cal.abs[7], 12.5);
  assert.ok(Math.abs(cal.abs.reduce((a, b) => a + b, 0) - 35) < 1e-9);
  assert.ok(cal.taci[7] < cal.taci[2]);
  const billed = cal.taci.reduce((s, t, m) => s + t * cal.jo[m], 0);
  assert.ok(Math.abs(billed / cal.jo.reduce((a, b) => a + b, 0) - 0.75) < 1e-9);
});

test("calendar: TACE is flat over the year and follows from the TACI", () => {
  const cal = workingCalendar(2026, { taci: 75, congesAn: 25, rttAn: 10 });
  assert.ok(Math.abs(cal.taciMax - 217 / 252) < 1e-9);
  cal.tace.forEach((t, m) => {
    assert.ok(Math.abs(t - 0.75 * 252 / 217) < 1e-9);
    assert.ok(Math.abs(cal.taci[m] - t * (cal.jo[m] - cal.abs[m]) / cal.jo[m]) < 1e-9);
  });
});

test("calendar: a TACI above the maximum caps the TACE at 100 %", () => {
  const cal = workingCalendar(2026, { taci: 95, congesAn: 25, rttAn: 10 });
  cal.tace.forEach((t) => assert.equal(t, 1));
  cal.taci.forEach((t, m) => assert.ok(Math.abs(t - (cal.jo[m] - cal.abs[m]) / cal.jo[m]) < 1e-9));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --experimental-strip-types --test tests/business-plan-model.test.mjs`
Expected: FAIL, module `calendar.ts` introuvable.

- [ ] **Step 3: Implement `calendar.ts`**

`workingDaysBetween` itère jour par jour (midi local, comme `openDaysBetween` dans `sales/pricing-lines.ts`) et exclut les fériés de `frenchHolidays(y)` pour chaque année traversée. Calcul du TACI :

```
abs[7] = 0.5 × congesAn
abs[m≠7] = (0.5 × congesAn + rttAn) × jo[m] / Σ_{k≠7} jo[k]
taciMax = Σ (jo − abs) / Σ jo
tace[m] = min(1, (taci/100) / taciMax)          // identique tous les mois
taci[m] = tace[m] × (jo[m] − abs[m]) / jo[m]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --experimental-strip-types --test tests/business-plan-model.test.mjs`
Expected: PASS (les nouveaux tests et les anciens).

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/ops/business-plan/calendar.ts tests/business-plan-model.test.mjs
git commit -m "feat(business-plan): working-day calendar and monthly TACI"
```

---

### Task 2: Modèle — hypothèses TACI, prévisionnel calendaire, indicateurs ESN

**Files:**
- Modify: `apps/admin/src/ops/business-plan/model.ts` (`Hypotheses`, `DEFAULT_HYPOTHESES`, `ActualMonth`, `Series`, `PlanResult`, `computePlan`, `planRows`)
- Test: `tests/business-plan-model.test.mjs`

**Interfaces:**
- Consumes: `workingCalendar` (Task 1).
- Produces:
  - `Hypotheses` : retire `jours` et `occ`, ajoute `taci` (%), `congesAn` (j/an), `rttAn` (j/an).
  - `migrateHypotheses(saved: Record<string, unknown> | null | undefined): Partial<Hypotheses>` — copie les clés connues ; si `taci` absent et `occ` présent, `taci = occ` ; ignore `jours`.
  - `ActualMonth` gagne : `jo: number` (jours ouvrés des salariés consultants), `jfs: number` (jours facturés des salariés), `jf: number` (jours facturés, salariés + freelances), `abs: number` (jours de congés des salariés), `craComplete: boolean`.
  - `computePlan(h: Hypotheses, months: MonthInput[], consStart: number, year: number): PlanResult`.
  - `Series` gagne : `jo, jfs, jf, abs, taci, tace, itc, tjmR, cjm, mj, ts, cac` (`number[]`) ; la série des primes IC `ic` est renommée `pic`.
  - `PlanResult` gagne `calendar: WorkingCalendar` et `craIncomplete: boolean[]` ; `totals` gagne `taci, tace, itc, cjm` (ratios annuels).

- [ ] **Step 1: Update the existing tests and write the failing ones**

Adapter l'oracle `mockup()` : `P.jours` → `cal.jo[i]`, `occ` → `cal.taci[i]` avec `const cal = workingCalendar(2026, P)`. Passer `2026` en 4e argument à chaque `computePlan(…)` (avec `START` ou `0` en 3e). Ajouter `jo, jfs, jf, abs, craComplete` aux `ActualMonth` des tests existants. `planRows(r).length` passe de 41 à 50.

```js
test("forecast: revenue follows the calendar and the monthly TACI", () => {
  const h = { ...DEFAULT_HYPOTHESES, pctFree: 0 };
  const r = computePlan(h, VENTES.map((_, i) => ({ ...forecast(i), ventes: 0, departs: 0 })), 10, 2026);
  const cal = workingCalendar(2026, h);
  assert.ok(Math.abs(r.series.ca[7] - 10 * cal.jo[7] * cal.taci[7] * h.tjm) < 1e-6);
  assert.ok(r.series.ca[7] < r.series.ca[2]);
  assert.ok(Math.abs(r.totals.taci - h.taci / 100) < 1e-9);
  // Intercontrat = 1 − TACI − absences / jours ouvrés, jamais négatif.
  r.series.itc.forEach((v, m) => assert.ok(Math.abs(v - Math.max(0, 1 - cal.taci[m] - cal.abs[m] / cal.jo[m])) < 1e-9));
  assert.ok(Math.abs(r.series.inter[7] - r.series.sal[7] * r.series.itc[7]) < 1e-6);
});

test("indicators on a closed month come from measured days", () => {
  const actual = { cons: 3, ca: 30000, free: 4000, sal: 9000, inter: 0, ventes: 0, departs: 0, enc: 0,
    jo: 40, jfs: 30, jf: 40, abs: 4, craComplete: true };
  const r = computePlan(DEFAULT_HYPOTHESES, [{ actual, ventes: 0, departs: 0, structure: 0 }], 0, 2026);
  const S = r.series;
  assert.equal(S.taci[0], 0.75);
  assert.equal(S.tace[0], 30 / 36);
  assert.equal(S.itc[0], 0.15);
  assert.equal(S.tjmR[0], 750);
  assert.equal(S.cjm[0], (S.sal[0] + S.cotc[0]) / 40);
  assert.equal(S.mj[0], (S.ca[0] - S.prod[0]) / 40);
  assert.equal(S.ts[0], S.fix[0] / 30000);
  assert.equal(S.cac[0], 10000);
});

test("indicators are 0, never NaN, on an empty month", () => {
  const r = computePlan(DEFAULT_HYPOTHESES, [{ actual: null, ventes: 0, departs: 0, structure: 0 }], 0, 2026);
  for (const k of ["taci", "tace", "itc", "tjmR", "cjm", "mj", "ts", "cac"]) assert.equal(r.series[k][0], 0, k);
  for (const k of ["taci", "tace", "itc", "cjm"]) assert.ok(Number.isFinite(r.totals[k]), k);
});

test("a saved plan from before the TACI keeps its occupancy rate", () => {
  assert.deepEqual(migrateHypotheses({ tjm: 700, jours: 18, occ: 88 }), { tjm: 700, taci: 88 });
  assert.deepEqual(migrateHypotheses({ occ: 88, taci: 80 }), { taci: 80 });
  assert.deepEqual(migrateHypotheses(null), {});
});

test("planRows: ESN indicators section after the operating margin", () => {
  const r = computePlan(DEFAULT_HYPOTHESES, VENTES.map((_, i) => forecast(i)), START, 2026);
  const labels = planRows(r).map((row) => row.label);
  const at = labels.indexOf("Indicateurs ESN");
  assert.equal(labels[at - 1], "Marge d’exploitation (EBIT / CA)");
  assert.deepEqual(labels.slice(at + 1, at + 9), [
    "TACI (taux d’activité congés inclus)", "TACE (taux d’activité congés exclus)", "Taux d’intercontrat", "TJM moyen réalisé",
    "CJM (coût journalier moyen)", "Marge par jour facturé", "Taux de structure", "CA par consultant",
  ]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --experimental-strip-types --test tests/business-plan-model.test.mjs`
Expected: FAIL (`migrateHypotheses` non exporté, séries absentes).

- [ ] **Step 3: Implement the model changes**

Prévisionnel, pour le mois `m` avec `cal = workingCalendar(year, h)` :
- `ca = nf × jo × tjm + ns × jo × taci × tjm` ; `free = nf × jo × coutFree` ;
- `itc = max(0, 1 − taci − abs/jo)` ; `inter = sal × itc` ;
- `jo` (série) `= ns × cal.jo[m]` ; `jfs = ns × cal.jo[m] × cal.taci[m]` ; `jf = jfs + nf × cal.jo[m]` ; `abs = ns × cal.abs[m]`.

Indicateurs (tous les mois, réels comme prévisionnels ; 0 si le dénominateur est 0) :
`taci = jfs/jo`, `tace = jfs/(jo − abs)`, `itc = max(0, jo − jfs − abs)/jo`, `tjmR = ca/jf`, `cjm = (sal + cotc)/jo`, `mj = (ca − prod)/jf`, `ts = fix/ca`, `cac = ca/cons`.
Totaux : mêmes ratios sur les sommes annuelles. `craIncomplete[m] = !!actual && !actual.craComplete`.

`planRows` : section `"Indicateurs ESN"` après « Marge d’exploitation (EBIT / CA) », libellés du test ci-dessus. `kind: "pct"` pour TACI, TACE, intercontrat, taux de structure (totaux = ratios annuels) ; `kind: "line"` pour les montants en € (total = ratio annuel, pas la somme). Défauts : `taci: 75, congesAn: 25, rttAn: 10`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --experimental-strip-types --test tests/business-plan-model.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/ops/business-plan/model.ts tests/business-plan-model.test.mjs
git commit -m "feat(business-plan): TACI forecast and ESN indicators in the P&L"
```

---

### Task 3: Réel — jours ouvrés, facturés et absences depuis le CRA

**Files:**
- Modify: `apps/admin/src/ops/business-plan/actuals.ts` (`CraRow`, `loadCra`, boucle des mois clôturés de `aggregateActuals`)
- Test: `tests/business-plan-model.test.mjs`

**Interfaces:**
- Consumes: `workingDaysBetween` (Task 1) ; `ActualMonth` étendu (Task 2).
- Produces: `CraRow = { employee_id: string; day: string; part?: string | null; status?: string | null }`. `loadCra` charge tous les statuts (`employee_id, day, part, status`, repli sans `part` comme aujourd'hui). Une ligne sans `status` compte comme `client_project`.

- [ ] **Step 1: Write the failing tests**

Construire les sources avec le même helper que les tests `aggregateActuals` existants (« aggregates real data into monthly actuals »). Mois testé : mars 2026 (22 jours ouvrés).

```js
test("actuals: salaried working, billed and leave days from every CRA status", () => {
  // Un salarié consultant employé tout mars, staffé ; CRA : 15 j client, 3 j CP, 1 j RTT, 2 j internal, 1 demi-journée client.
  const agg = aggregateActuals(src, 2026, 3, new Date("2026-04-15"));
  const mar = agg.months[2];
  assert.equal(mar.jo, 22);
  assert.equal(mar.jfs, 15.5);
  assert.equal(mar.abs, 4);
  assert.equal(mar.craComplete, false); // 21,5 j saisis sur 22
});

test("actuals: freelance days stay client days only", () => {
  // Un freelance avec 10 j client et 2 j unpaid_leave : free = 10 × taux, jf compte 10 j.
});

test("actuals: arrival mid-month limits the salaried working days", () => {
  // Salarié embauché le 2026-03-16 : jo = workingDaysBetween("2026-03-16", "2026-03-31") = 12.
});

test("actuals: structure staff on a mission count only their consultant share", () => {
  // Reprendre le cas de « structure staff on a mission » : jo = jours en mission (days[0]).
});
```

Écrire le corps des trois derniers tests sur le modèle du premier, avec les valeurs en commentaire comme assertions.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --experimental-strip-types --test tests/business-plan-model.test.mjs`
Expected: FAIL (`mar.jo` indéfini).

- [ ] **Step 3: Implement the measurement**

- `craDays` (coût des freelances) ne compte que `client_project` (ou `status` absent).
- Nouvelle map par mois et employé : `{ client, leave, filled }` (demi-journée = 0,5). `leave` = `paid_leave`, `rtt`, `unpaid_leave`. `filled` = toutes les saisies.
- Pour chaque ligne de salarié consultant de la boucle existante : `joLine = workingDaysBetween(max(start, from), min(exit, to))`, multiplié par `days[0]/days[1]` quand la ligne est partielle (part structure). `jo += joLine` ; `jfs += client × ratio` ; `abs += leave × ratio` ; complet si `filled ≥ joLine × ratio` pour chaque ligne.
- `jf = jfs + Σ jours des lignes freelances` (y compris estimés).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --experimental-strip-types --test tests/business-plan-model.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/ops/business-plan/actuals.ts tests/business-plan-model.test.mjs
git commit -m "feat(business-plan): measure TACI and inter-contract days from the CRA"
```

---

### Task 4: Interface — hypothèses, ligne jours ouvrés, KPI, panneaux, export

**Files:**
- Modify: `apps/admin/src/ops/business-plan/BusinessPlan.tsx` (`GROUPS` l.107–140, hydratation l.223 et l.505, appels `computePlan` l.226 et l.532, ligne « Jours ouvrés facturables » l.963–970, tuiles KPI l.749–820, cellules de la grille)
- Modify: `apps/admin/src/ops/business-plan/DetailPanel.tsx` (formules l.275, 277, 677, 893, 999, 1058)
- Modify: `apps/admin/src/ops/business-plan/export-xlsx.ts` (seulement si la section ne sort pas déjà via `planRows`)
- Test: `tests/business-plan-model.test.mjs` (export)

**Interfaces:**
- Consumes: `computePlan(…, year)`, `migrateHypotheses`, `PlanResult.calendar`, `PlanResult.craIncomplete`, `totals.taci`, `totals.cjm` (Task 2).

- [ ] **Step 1: Write the failing export test**

Dans le test d'export existant (l.657), vérifier que la feuille contient « Indicateurs ESN » et qu'aucune cellule ne vaut `NaN` ou `Infinity` pour un plan à 0 consultant.

- [ ] **Step 2: Run it to verify it fails, then fix the export if needed**

Run: `node --experimental-strip-types --test tests/business-plan-model.test.mjs`
Expected après correction : PASS.

- [ ] **Step 3: Update the UI**

- Groupe « Activité et prix » : remplacer `jours` et `occ` par `taci` (« TACI cible (congés inclus) », `%`, avec sous ce champ « TACE équivalent {pct(calendar.tace[0])} · max {pct(calendar.taciMax)} »), `congesAn` (« Congés payés par salarié / an », `j`), `rttAn` (« RTT par salarié / an », `j`).
- Hydratation (l.223, l.505) : `migrateHypotheses(saved?.hypotheses)[k]` à la place de `saved?.hypotheses?.[k]`.
- `computePlan(…, year)` aux deux appels.
- Ligne « Activité » : renommer en « Jours ouvrés », valeurs `plan.calendar.jo[m]`, total = somme.
- Tuiles : « TACI » (`pct(plan.totals.taci)`, hint « TACE {pct(totals.tace)} · intercontrat {pct(totals.itc)} ») et « CJM moyen » (`fmt(totals.cjm)` €), avec formules en tooltip comme les autres `Kpi`.
- Cellules des lignes de la section « Indicateurs ESN » d'un mois où `plan.craIncomplete[m]` : badge ou `title` « CRA incomplet ».
- `DetailPanel` : `H.jours` → `plan.calendar.jo[m]`, `H.occ / 100` → `plan.calendar.taci[m]`, et « 1 − occupation » → « intercontrat » (`series.itc[m]`).
- Texte d'aide l.759 : « consultants × jours ouvrés × TJM (salariés × TACI du mois) ».

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm --filter @quicksort/admin build && pnpm test`
Expected: aucune erreur, tous les tests passent.
Puis vérifier la page à l'écran (harness Playwright décrit dans la mémoire `admin-visual-harness`, ~1155 px) : la section « Indicateurs ESN » s'affiche, août a un CA plus bas, les deux tuiles apparaissent, un plan 2026 sauvegardé s'ouvre avec son ancien taux d'occupation en TACI.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/ops/business-plan/ tests/business-plan-model.test.mjs
git commit -m "feat(business-plan): TACI hypotheses, ESN KPIs and working-day row in the UI"
```
