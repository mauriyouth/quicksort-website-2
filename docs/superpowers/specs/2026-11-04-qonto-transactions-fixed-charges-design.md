# Transactions Qonto → charges fixes du business plan

Date : 2026-11-04 · Statut : en attente de validation par Mohamed

## Intention

Aujourd'hui, les charges fixes du business plan (Loyer et locaux, Outils/cloud/IA,
Marketing et événements, Honoraires, Divers) sont des hypothèses : un montant
constant saisi à la main, identique chaque mois. Rien ne les relie à la réalité.

Mohamed veut cliquer sur une ligne de charge fixe et voir **le détail des
transactions réelles de son compte bancaire Qonto** qui composent ce chiffre,
comme il le fait déjà pour le CA, les salaires ou les inter-contrats. Pour les
mois clôturés, le chiffre de la ligne doit **être** le réel, pas l'hypothèse.

## Objectifs

1. Synchroniser les transactions sortantes (débits) du compte Qonto dans la base,
   de façon **incrémentale** : seules les transactions nouvelles ou modifiées
   depuis la dernière synchro sont téléchargées, jamais tout l'historique à
   chaque fois.
2. Synchro **automatique une fois par jour** + bouton **« Actualiser Qonto »**
   sur la page business plan.
3. Classer chaque nouvelle transaction dans une des lignes de charges fixes (ou
   « hors charges fixes ») avec un modèle **Kimi (Moonshot AI)**.
4. Mois clôturés : chaque ligne de charge fixe (sauf Salaires structure) =
   somme des transactions Qonto classées dans cette ligne, ce mois-là.
   Mois à venir : l'hypothèse, comme aujourd'hui.
5. Clic sur une ligne de charge fixe → panneau de détail (le `DetailPanel`
   existant) listant les transactions du mois, avec possibilité de
   **reclasser** une transaction en un clic.
6. Transactions où Kimi hésite : **comptées** dans la ligne proposée, mais
   marquées d'un badge **« à vérifier »** ; un clic valide ou corrige.

## Non-objectifs

- Pas de remplacement de « Salaires structure chargés » : elle reste calculée
  (salaire × multiplicateur × part structure), les transactions de salaires ne
  la remplacent pas.
- Pas d'encaissements depuis Qonto : les crédits sont ignorés (les encaissements
  viennent déjà des factures).
- Pas de rapprochement facture fournisseur / justificatif, pas de comptabilité.
- Pas de reclassement automatique d'une transaction déjà classée.

## Anti-objectifs (échec même si « ça marche »)

- Une correction manuelle écrasée par une synchro ou par Kimi.
- Des charges comptées deux fois (ex. URSSAF à la fois dans les salaires chargés
  ×1,4 et dans « Divers »).
- Retélécharger tout l'historique Qonto à chaque synchro.
- Un business plan qui casse ou devient vide si Qonto ou Kimi est indisponible :
  on affiche les dernières données connues + une erreur discrète.

## Contraintes / existant

- Connexion Qonto existante : `invoicing_settings` (login + clé secrète chiffrée,
  IBAN, staging) — `apps/admin/server/invoicing/settings.ts`, client HTTP dans
  `apps/admin/server/invoicing/qonto.ts` (`thirdparty.qonto.com`). On réutilise
  ces identifiants ; pas de nouvelle saisie Qonto.
- Chiffrement des secrets : `encryptSecret`/`decryptSecret` de
  `apps/admin/server/ai-settings.ts` (AES-256-GCM, `AI_SETTINGS_ENCRYPTION_KEY`).
- Business plan : `apps/admin/src/ops/business-plan/` — `model.ts` (séries
  `fl/fo/fm/fh/fd`, notion de mois clôturé vs prévisionnel, `ActualMonth`),
  `actuals.ts` (agrégation pure + loaders), `DetailPanel.tsx`
  (`DetailKind`), `BusinessPlan.tsx`.
- API admin : handlers Vercel dans `apps/admin/api/*.ts` (pattern
  `apps/admin/api/invoicing.ts` : auth Supabase, schémas zod, actions).
- Aucun cron n'existe aujourd'hui dans le projet.
- L'IA existante de l'app passe par OpenAI (URL en dur, API « Responses ») ;
  Kimi est un **nouveau** fournisseur, utilisé uniquement pour ce classement.

## Décisions de Mohamed

- **Fournisseur de classement : Kimi (Moonshot).** Choix conscient : le libellé,
  la contrepartie et le montant des dépenses de Quicksort partent chez Moonshot.
- **Mois passés = réel Qonto**, mois à venir = hypothèse.
- **Synchro incrémentale, quotidienne + bouton Actualiser.**
- **Confiance faible** : comptée dans la ligne proposée + badge « à vérifier ».
- **Montants en HT** : `montant HT = montant − TVA` d'après la TVA fournie par
  Qonto (`vat_amount`, ou calcul via `vat_rate`) ; sans TVA connue, HT = TTC.
  Stocker `vat_cents` et `amount_ht_cents`. Le panneau affiche le HT (TTC en
  info secondaire).
- **Un seul compte Qonto** : l'IBAN de `invoicing_settings` suffit.
- **Exclusions anti double-comptage** (→ `hors_charges_fixes`) : chasseurs de
  têtes (déjà « Primes chasseurs »), achat de matériel (déjà amorti via
  « Dotations »), commission d'affacturage (déjà « Commission factor »),
  URSSAF / retraite / prévoyance / PAS (déjà dans le ×1,4).
  **Notes de frais** remboursées aux salariés → « Divers ».

## Conception

### 1. Données (migration Supabase)

`bank_transactions`
- `id` (uuid Qonto de la transaction, clé primaire, texte)
- `settled_at` / `emitted_at` (timestamptz), `month` (date, 1er du mois du
  `settled_at`, à défaut `emitted_at`) — sert au rattachement mensuel
- `amount_cents` (TTC, entier, positif pour une dépense), `vat_cents`,
  `amount_ht_cents` (base de tous les totaux), `currency`
- `label`, `counterparty` (`clean_counterparty_name`), `operation_type`,
  `qonto_category`, `note`, `reference`, `status` (`completed`, `declined`,
  `reversed`…), `qonto_updated_at`
- `raw` (jsonb, la réponse Qonto complète, pour pouvoir reclasser plus tard)
- Classement :
  - `ai_line` (enum ci-dessous), `ai_confidence` (numeric 0–1), `ai_model`,
    `ai_classified_at`
  - `manual_line` (enum, nullable), `manual_by`, `manual_at`
  - ligne effective = `coalesce(manual_line, ai_line)` (colonne générée ou vue)
  - `needs_review` = `manual_line is null and ai_confidence < seuil`

Enum `fixed_charge_line` : `loyer`, `outils`, `marketing`, `honoraires`,
`divers`, `hors_charges_fixes`.

`bank_sync_state` (une ligne) : `last_updated_at_cursor` (timestamptz),
`last_run_at`, `last_error`.

Réglages Kimi : clé API chiffrée + nom du modèle, dans une table de réglages
(même pattern que `ai_settings`/`invoicing_settings`), éditable dans
**Paramètres** (`AdminSettings.tsx`). Repli sur `MOONSHOT_API_KEY` en env.

RLS : mêmes règles que les tables business plan (admins uniquement).

### 2. Synchro Qonto incrémentale

- `GET /v2/transactions` avec l'IBAN des réglages, `side=debit`,
  `updated_at_from = curseur`, tri `updated_at:asc`, pagination 100.
- Upsert par `id`. Une transaction **déjà présente** met à jour ses champs Qonto
  (statut, montant, libellé…) mais **ne touche jamais** à `manual_line` ni à
  `ai_line`.
- Le curseur avance au plus grand `updated_at` reçu, seulement après succès
  complet de la page (pas de trou en cas d'erreur).
- Premier lancement (curseur vide) : on part du **1er janvier de la première
  année du business plan** (mon choix : 1er janvier 2025 si rien de plus ancien
  n'existe).
- Seules les transactions `completed` comptent dans le business plan ;
  `declined`/`reversed` sont gardées mais exclues.
- Verrou simple (ex. `pg_advisory_lock` ou ligne d'état) pour éviter deux
  synchros simultanées (cron + bouton).

### 3. Classement Kimi

- Après chaque synchro, classer les transactions où `ai_line is null`, par lots
  (ex. 20 par appel).
- API compatible OpenAI : `POST https://api.moonshot.ai/v1/chat/completions`,
  sortie JSON (`response_format: json_object`), température 0.
- Entrée par transaction : libellé, contrepartie, montant, type d'opération,
  catégorie Qonto, note. Sortie : `{ id, line, confidence }` avec `line` dans la
  liste fermée ; toute valeur hors liste est rejetée et retentée une fois, puis
  laissée non classée.
- Le prompt décrit chaque ligne avec des exemples, et liste explicitement ce qui
  va en `hors_charges_fixes` : salaires nets, **URSSAF / retraite / prévoyance /
  PAS** (déjà dans les salaires chargés ×1,4), freelances et sous-traitance, TVA, impôts (IS, CFE…), virements
  internes, remboursements, chasseurs de têtes, achats de matériel, commission
  d'affacturage. Notes de frais et mutuelle → « Divers ».
- Exemples **appris des corrections** : les dernières corrections manuelles
  (contrepartie → ligne) sont injectées dans le prompt comme exemples, pour que
  Kimi s'améliore sans règles écrites à la main.
- Seuil « à vérifier » : `confidence < 0.7` (mon choix, constante facile à changer).
- Si Kimi n'est pas configuré ou échoue : transactions laissées non classées
  (visibles dans « Non classées »), la synchro Qonto, elle, réussit.

### 4. Déclencheurs

- **Quotidien** : cron Vercel (`vercel.json` → `crons`) sur un nouvel endpoint
  `api/bank-transactions?action=sync`, protégé par `CRON_SECRET`. Exécution vers
  6h (heure de Paris).
- **Bouton « Actualiser Qonto »** sur la page business plan : même endpoint,
  authentifié admin. Affiche « Synchronisé il y a X » + nombre de nouvelles
  transactions / à vérifier.

### 5. Business plan

- `actuals.ts` : charger les transactions `completed` classées de l'année et
  agréger par mois × ligne (fonction pure, testée). Ajouter à `ActualMonth`
  `fLoyer/fOutils/fMarketing/fHonoraires/fDivers` réels.
- `model.ts` : pour un mois clôturé, utiliser ces réels à la place des
  hypothèses dans `S.fl/fo/fm/fh/fd`, et donc dans `fix`, EBITDA, EBIT,
  trésorerie. Mois prévisionnels inchangés.
- Une ligne réelle **à 0** pour un mois clôturé reste 0 (pas de repli sur
  l'hypothèse) — sinon on masque un oubli.
- `DetailPanel` : nouveaux `DetailKind` `loyer | outils | marketing | honoraires
  | divers`. Mois clôturé : liste des transactions (date, contrepartie, libellé,
  montant, badge « à vérifier », badge « corrigé »), total = valeur de la ligne,
  et un sélecteur pour reclasser chaque transaction (y compris vers « hors charges
  fixes ») + bouton « Valider » sur les « à vérifier ». Mois prévisionnel :
  rappel de l'hypothèse + moyenne réelle des 3 derniers mois clôturés pour
  comparaison.
- Accès « Hors charges fixes / non classées » : un lien en bas du panneau (ou
  une ligne discrète) pour vérifier ce qui a été exclu et reclasser.
- Indicateur sur la ligne du tableau quand le mois contient des transactions
  « à vérifier » (point ou compteur).

### 6. Tests

- Agrégation pure (mois × ligne, statuts exclus, manuel > IA) dans
  `tests/business-plan-model.test.mjs` ou un nouveau fichier.
- Synchro : curseur, upsert qui ne touche pas au classement, pagination, erreur
  au milieu ne fait pas avancer le curseur (fetch mocké, pattern
  `tests/invoicing-qonto.test.mjs`).
- Classement : parsing de la réponse Kimi, valeur hors liste, seuil.
- Endpoint : auth admin vs `CRON_SECRET`, reclassement.

## Choix de Claude (à relire)

- **Mutuelle → « Divers »** : absente du détail du ×1,4, donc vrai coût à garder.

- **Couverture** : un mois clôturé n'utilise le réel que s'il est ≥ au premier
  mois couvert par une synchro complète (enregistré dans `bank_sync_state`).
  Avant (ou si Qonto n'a jamais été configuré) → l'hypothèse reste affichée.
  Les transactions pas encore classées apparaissent dans « Non classées » et
  un badge sur la ligne le signale.
- **Synchro reprenable** : le rattrapage initial et le classement se font par
  tranches bornées en temps (limite des fonctions Vercel). Le curseur et la
  file « non classées » permettent de reprendre au run suivant (cron ou
  bouton). Le verrou expire tout seul (ex. 5 min) si un run est tué.
  Le bouton affiche « rattrapage en cours » tant qu'il reste du travail.
- Cron dans `apps/admin/vercel.json` (pas de `crons` existant).
- Date de départ : 1er janvier de la plus ancienne année de `business_plans`,
  sinon 2025-01-01.

## Laissé au builder

- Nommage exact des tables/colonnes/endpoints, forme précise du prompt.
- Modèle Kimi par défaut (le plus récent adapté au classement JSON), modifiable
  dans les réglages.
- Détails visuels du panneau, dans le style existant du `DetailPanel`.
