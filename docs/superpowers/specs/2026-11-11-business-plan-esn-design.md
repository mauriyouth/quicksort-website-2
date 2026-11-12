# Business plan au standard ESN

Date : 2026-11-11 · Statut : validée (lot 1 en cours)

## Intention

Le business plan (`/ops/business-plan`) produit déjà un compte de résultat
mensuel qui mélange le réel (factures, CRA, salaires, Qonto) et le
prévisionnel (hypothèses), avec les cotisations, la TVA et la trésorerie.
Mais il raisonne avec **un consultant moyen** : un TJM moyen, un salaire moyen,
18 jours facturables chaque mois, et des charges payées le mois où elles sont
engagées.

Un dirigeant d'ESN, un banquier ou Bpifrance lit un business plan d'ESN avec
d'autres repères : **TACI, intercontrat, CJM, marge par consultant, taux de
structure, BFR**. Il attend un CA saisonnier (jours fériés, août), une
trésorerie qui montre le décalage entre ce qu'on paie et ce qu'on encaisse, et
un plan qui tient sur plusieurs années.

L'objectif est de rendre le plan **lisible et crédible pour un lecteur ESN**
sans casser ce qui marche aujourd'hui : le réel des mois clôturés, les
panneaux de détail et l'export xlsx.

## Découpage en lots

Chaque lot est livrable seul, avec sa propre PR.

| Lot | Contenu | Effort | Valeur |
|---|---|---|---|
| 1 | Indicateurs ESN + calendrier de jours facturables | Faible | Forte |
| 2 | Trésorerie et BFR réalistes + fiscalité française | Moyen | Forte |
| 3 | Pyramide par niveau + embauches distinctes des missions | Élevé | Moyenne |
| 4 | Scénarios, sensibilité, vue pluriannuelle | Moyen | Moyenne |

Cette spec détaille les lots 1 et 2. Les lots 3 et 4 sont cadrés plus
sommairement : ils feront l'objet d'une spec dédiée une fois les deux premiers
livrés.

---

## Lot 1 — Indicateurs ESN et calendrier

### Objectifs

1. **Calendrier de jours ouvrés par mois.** L'hypothèse unique `jours: 18`
   est remplacée par les **jours ouvrés** du mois (lundi–vendredi) moins les
   jours fériés français. On réutilise `frenchHolidays(year)` de
   `apps/admin/src/cra/domain.ts`.
2. **TACI en hypothèse** à la place de `occ` : **jours facturés / jours
   ouvrés**. Les congés et RTT restent au dénominateur (décision de Mohamed).
   Le TACI s'applique aux salariés. Les freelances sont facturés sur les jours
   ouvrés, ce qui reprend l'hypothèse actuelle (un freelance ne coûte que s'il
   facture).
3. **Saisonnalité des congés.** Avec un TACI moyen, août serait facturé comme
   un mois normal. Deux nouvelles hypothèses, `congesAn` (25 j de CP) et
   `rttAn` (10 j), sont réparties selon un profil fixe : 50 % des CP en août,
   le reste des CP et les RTT lissés sur les autres mois. Cette répartition
   module le TACI mois par mois :
   `taci_m = TACI × f_m`, avec
   `f_m = (jo_m − abs_m) / jo_m` normalisé pour que la **moyenne annuelle
   pondérée par les jours ouvrés reste égale au TACI saisi**. Le TACI annuel
   reste donc exactement l'hypothèse, et août creuse le CA. Conséquence : le
   TACE prévisionnel est le même tous les mois,
   `TACE = TACI × Σ jo / Σ (jo − abs)`.
   Un salarié ne peut pas facturer plus que ses jours de présence : le TACE
   est plafonné à 100 %, ce qui plafonne le TACI à
   `Σ (jo − abs) / Σ jo` (environ 86 % avec 35 jours de congés). Le champ
   TACI affiche ce maximum.
4. **Section « Indicateurs ESN »** dans la grille du compte de résultat
   (`planRows()`), après l'EBIT :
   - **TACI** (%) : réel pour les mois clôturés, `taci_m` pour le prévisionnel ;
   - **TACE** (%) : jours facturés / (jours ouvrés − congés). Les deux taux
     sont affichés : le TACI pilote le prévisionnel, le TACE se déduit des
     mêmes jours ;
   - **Taux d'intercontrat** (%) : jours ouvrés des salariés ni facturés ni
     en congés / jours ouvrés. Les jours `Internal` comptent comme de
     l'intercontrat (décision de Mohamed) ;
   - **TJM moyen réalisé** (€) : CA / jours facturés ;
   - **CJM** (€) : coût salarié chargé / jours ouvrés ;
   - **Marge par jour facturé** (€) : (CA − coûts de production) / jours
     facturés ;
   - **Taux de structure** (%) : charges fixes / CA ;
   - **CA par consultant** (€) : CA / consultants staffés.
5. **Tuiles KPI.** La barre « Indicateurs clés » affiche en plus une tuile
   **TACI annuel** (avec le TACE en sous-titre) et le **CJM moyen**.
6. **Export xlsx** : la nouvelle section est exportée comme les autres
   (`export-xlsx.ts`).

### Mesure du réel

- `loadCra` ne charge aujourd'hui que les jours `client_project`. Pour
  l'intercontrat réel, il faut aussi les congés (CP, RTT, sans solde) et
  `Internal`. On ajoute `status` aux colonnes chargées et on retire le filtre ;
  l'agrégation filtre ensuite côté client.
- **TACI réel** = jours `client_project` des salariés / jours ouvrés des
  salariés présents (dans leur période d'emploi).
- **Intercontrat réel** = jours ouvrés − jours facturés − jours de congés, sur
  les jours ouvrés. Un jour ouvré sans saisie CRA compte comme intercontrat.
- Un mois clôturé dont le CRA est incomplet affiche ses indicateurs avec une
  mention « CRA incomplet » plutôt qu'un chiffre trompeur.

### Changements de modèle (`model.ts`)

- `Hypotheses` : `jours` et `occ` disparaissent au profit de `taci`,
  `congesAn` et `rttAn`. Les plans sauvegardés (`loadSavedPlan`) qui
  contiennent `jours` / `occ` sont migrés à la lecture : `taci = occ`, et
  `jours` est ignoré au profit du calendrier.
- Une fonction pure `workingCalendar(year, h)` renvoie, pour chaque mois,
  `jo` (jours ouvrés hors fériés) et `taci` (TACI modulé).
- Le CA prévu devient
  `nf × jo_m × TJM + ns × jo_m × taci_m × TJM`.
- `Series` gagne `jf` (jours facturés), `jo` (jours ouvrés salariés) et les
  séries d'indicateurs (`taci`, `tace`, `itc`, `tjmR`, `cjm`, `mj`, `ts`, `cac`).

### Non-objectifs

- Pas de congés par salarié nommé dans le prévisionnel : une moyenne par
  salarié suffit.
- Pas de saisie du profil saisonnier des congés dans l'UI pour ce lot.

### Tests

- `tests/business-plan-model.test.mjs` : calendrier 2026 (fériés, mai, août),
  TACI modulé dont la moyenne annuelle égale l'hypothèse, indicateurs sur un mois réel et un mois prévisionnel,
  migration d'un plan sauvegardé avec `jours` / `occ`.

---

## Lot 2 — Trésorerie, BFR et fiscalité

### Objectifs

1. **Décalages de paiement** dans le calcul de trésorerie. Aujourd'hui,
   `cash += enc − prod − varr − fix + tva` paie tout le mois même. Les
   nouvelles règles, chacune réglable par une hypothèse :
   - **freelances** payés à `dpoFree` jours (45 par défaut) ;
   - **salaires nets** payés le mois même ;
   - **cotisations URSSAF / retraite** payées le mois suivant ;
   - **fournisseurs** (charges fixes hors salaires) payés à `dpoFourn` jours
     (30 par défaut) ;
   - **IS** : acomptes trimestriels (15 mars, 15 juin, 15 sept., 15 déc.)
     calculés sur le résultat N−1, solde en mai N+1 ;
   - **CFE** payée en décembre (nouvelle hypothèse annuelle).
   Les mois clôturés couverts par Qonto gardent le réel, comme aujourd'hui.
2. **Section « BFR »** dans la grille : créances clients, dettes
   fournisseurs / freelances, dettes sociales et fiscales en fin de mois, et
   **BFR = créances − dettes**. Exprimé aussi en jours de CA.
3. **IS au taux réduit PME** : 15 % jusqu'à 42 500 € de bénéfice, puis le
   taux normal (`tauxIS`). Ce calcul s'applique si une nouvelle case
   `isPme` est cochée (par défaut : oui).
4. **CIR / CII** : nouvelle hypothèse « dépenses éligibles annuelles » et
   taux (30 % CIR, 20 % CII). Le crédit d'impôt est affiché comme produit sous
   l'EBIT et vient en déduction de l'IS. Le remboursement en trésorerie a
   lieu en N+1 ou plus tôt pour une JEI / PME en remboursement anticipé
   (hypothèse : mois de remboursement).
5. **Provision congés payés et prime de vacances Syntec** : la prime de
   vacances (10 % de l'indemnité de CP globale, convention Syntec) est ajoutée
   aux coûts des salariés, consultants comme structure, et versée en juin
   par défaut.

### Non-objectifs

- Pas de bilan prévisionnel complet : on se limite au BFR et à la
  trésorerie.
- Pas de modélisation d'emprunts ni de levées de fonds dans ce lot : cela
  relève du lot 4 (plan de financement).

### Anti-objectifs

- Une trésorerie des mois clôturés qui change : le réel reste le réel.
- Une charge comptée deux fois, par exemple l'URSSAF à la fois dans le mois
  d'engagement et dans le mois de paiement.

### Tests

- Modèle : décalage d'un mois sur l'URSSAF, d'un mois et demi sur les
  freelances, acomptes IS, IS PME, CIR ; le BFR de fin d'année est cohérent
  avec la somme des décalages.

---

## Lot 3 — Pyramide et cycle de vie des consultants (cadrage)

- **Grille par niveau** (junior, confirmé, senior, manager) : TJM, salaire
  brut et part de l'effectif pour chaque niveau. Une revalorisation annuelle
  (%) s'applique aux salaires et aux TJM au 1er janvier.
- **Embauches ≠ démarrages de mission** : une embauche coûte dès son arrivée.
  Le délai moyen avant le premier staffing génère de l'intercontrat.
  Les missions ont un taux de renouvellement, et les départs alimentent un
  taux de turnover.
- **Ratios de structure** : 1 ingénieur d'affaires pour N consultants,
  1 chargé de recrutement pour M embauches par an, et des paliers de coûts
  (loyer selon l'effectif).
- **Prérequis à trancher** : où stocker le niveau d'un salarié réel ? Aucun
  champ de niveau n'existe aujourd'hui dans `hr_people`.

## Lot 4 — Scénarios et pluriannuel (cadrage)

- Trois jeux d'hypothèses par année : **pessimiste, central, optimiste**,
  avec un sélecteur et une comparaison des résultats.
- Tableau de **sensibilité** : EBITDA et trésorerie minimale pour un TJM à
  ±50 € et un TACI à ±5 points.
- **Vue 3–5 ans** en annuel, qui enchaîne les plans d'une année sur l'autre
  (le report de trésorerie existe déjà), avec un **plan de financement** :
  apports, emprunts, remboursements.

---

## Décisions de Mohamed (2026-11-11)

1. **TACI** (taux d'activité congés inclus) comme hypothèse : les congés
   restent au dénominateur. Le **TACE** est aussi affiché, comme indicateur.
2. Les jours **`Internal`** comptent comme de l'**intercontrat**.
3. **CIR / CII** : Quicksort est éligible mais ne l'a pas encore mis en place.
   Le lot 2 prévoit l'hypothèse, à 0 par défaut.
4. On démarre par le **lot 1**.

## Constat sur la prime de vacances (2026-11-11)

Neuf bulletins Silae lus (septembre 2025 à octobre 2026, 7 salariés,
convention « Bureaux d'études techniques », c'est-à-dire Syntec) : **aucune
rubrique « prime de vacances » ni autre prime**. Seules apparaissent
l'indemnité de congés payés et une indemnité compensatrice de congés payés.
Aucun bulletin de mai à août n'était disponible, et ce sont les mois où la
prime est habituellement versée : à confirmer sur un bulletin de juin ou
auprès du comptable.

Conséquence pour le lot 2 : la prime n'est pas dans le réel. Si elle est due,
il faut l'ajouter au prévisionnel, et éventuellement provisionner l'arriéré.
