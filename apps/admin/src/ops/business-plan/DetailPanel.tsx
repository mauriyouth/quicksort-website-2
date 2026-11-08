import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { cn } from "cn";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Input,
  NativeSelect,
  NativeSelectOption,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Stat,
  StatLabel,
  StatUnit,
  StatValue,
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  ToggleGroup,
  ToggleGroupItem,
} from "@quicksort-sas/ui";
import { socialChargesOf, type Aggregate, type BankRow, type SalaryLine, type StructureEntry } from "./actuals";
import { chargesTotal, fmt, MONTH_NAMES, pct, type FixedActuals, type FixedChargeLine, type FixedLineKey, type Hypotheses, type PlanResult, type VatActual, VAT_RATE } from "./model";

/**
 * Drill-down panel for the P&L rows "Chiffre d’affaires", "Salaires
 * consultants (brut)", "Freelances", "Salaires structure (brut)",
 * "Inter-contrats", "Encaissements clients", "TVA (effet trésorerie)" and the
 * five fixed-charge lines.
 * Closed months list the invoices, named people or Qonto transactions behind
 * the figure;
 * forecast months show the formula plus today's named team, the base the
 * forecast projects from.
 */
export type DetailKind = "ca" | "sal" | "free" | "fs" | "inter" | "enc" | "tva" | "cotc" | "cots" | FixedLineKey;

const TITLES: Record<DetailKind, string> = {
  ca: "Chiffre d'affaires",
  sal: "Salaires consultants (brut)",
  free: "Freelances",
  fs: "Salaires structure (brut)",
  inter: "Inter-contrats",
  enc: "Encaissements clients",
  tva: "TVA (effet trésorerie)",
  cotc: "Cotisations sociales consultants",
  cots: "Cotisations sociales structure",
  loyer: "Loyer et locaux",
  outils: "Outils, cloud et licences IA",
  marketing: "Marketing et événements",
  honoraires: "Honoraires (comptable, juridique)",
  deplacements: "Frais de déplacement",
  divers: "Divers",
};

/** Classified Qonto debits per month (null = month not covered) and how to reclassify one. */
export type BankControl = {
  lines: (BankRow[] | null)[];
  unclassified: (BankRow[] | null)[];
  fixed: (FixedActuals | null)[];
  /** Saves a manual line; rejects with a displayable message (the change is then undone). */
  onClassify: (id: string, line: FixedChargeLine) => Promise<void>;
};

/** Who can be listed as structure staff, their periods, and how to change them. */
export type StructureControl = {
  employees: { id: string; name: string; detail: string; hired: string; exit: string | null }[];
  entries: StructureEntry[];
  /** Adds or updates a listing (entry) or removes it (null). */
  onSave: (employeeId: string, entry: StructureEntry | null) => Promise<void>;
};

const eur = (v: number) => `${fmt(v)} €`;
const frDate = (iso: string) => iso.split("-").reverse().join("/");
const dec = (v: number) => v.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`;

type BodyProps = {
  year: number;
  month: number;
  plan: PlanResult;
  agg: Aggregate;
  hypotheses: Hypotheses;
  multiplier: number;
  structure: StructureControl;
  bank: BankControl;
  /** Real VAT flows and the VAT payments behind them, per covered closed month. */
  vat: { vat: (VatActual | null)[]; remittances: (BankRow[] | null)[] };
};

export function DetailPanel({
  kind,
  onMonth,
  onClose,
  ...body
}: BodyProps & {
  kind: DetailKind;
  onMonth: (m: number) => void;
  onClose: () => void;
}) {
  const { year, month, plan } = body;
  const actual = plan.actual[month];

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="gap-0 data-[side=right]:sm:max-w-[640px]">
        <SheetHeader className="gap-2">
          <span className="label-mono">{TITLES[kind]}</span>
          <SheetTitle className="flex flex-wrap items-center gap-3 text-2xl">
            {MONTH_NAMES[month]} {year}{" "}
            <Badge variant={actual ? "secondary" : "outline"}>{actual ? "Réel" : "Prévisionnel"}</Badge>
          </SheetTitle>
          <SheetDescription className="sr-only">Détail du mois et des données derrière le chiffre.</SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6 *:shrink-0">
          <ToggleGroup
            spacing={1}
            variant="outline"
            size="sm"
            aria-label="Mois"
            className="w-full flex-wrap"
            value={[String(month)]}
            onValueChange={(v) => { if (v[0] !== undefined) onMonth(Number(v[0])); }}
          >
            {MONTH_NAMES.map((name, m) => (
              <ToggleGroupItem
                key={name}
                value={String(m)}
                className={cn("px-2.5 text-xs", !plan.actual[m] && "text-muted-foreground")}
                title={plan.actual[m] ? "Mois réel" : "Mois prévisionnel"}
              >
                {name}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          {kind === "ca" ? <RevenueBody {...body} />
          : kind === "sal" ? <SalaryBody {...body} />
          : kind === "fs" ? <StructureBody {...body} />
          : kind === "inter" ? <InterBody {...body} />
          : kind === "enc" ? <CollectionBody {...body} />
          : kind === "tva" ? <VatBody {...body} />
          : kind === "cotc" || kind === "cots" ? <ChargesBody {...body} forStructure={kind === "cots"} />
          : kind === "free" ? <FreelanceBody {...body} />
          : <FixedBody key={kind} line={kind} {...body} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}

const monthStartOf = (year: number, month: number) => `${year}-${String(month + 1).padStart(2, "0")}-01`;

/* ── Revenue ────────────────────────────────────────────────────────── */

const STATUS: Record<string, string> = { paid: "Payée", finalized: "Émise" };

function RevenueBody({ month, plan, agg, hypotheses: H }: BodyProps) {
  const S = plan.series;
  const actual = plan.actual[month];
  const rows = agg.invoiceLines[month];
  const total = S.ca[month];
  const paid = rows?.filter((l) => l.status === "paid").reduce((t, l) => t + l.amount, 0) ?? 0;
  const byIssue = rows?.filter((l) => l.byIssueDate).length ?? 0;
  const nf = S.cons[month] * (H.pctFree / 100);
  const ns = S.cons[month] - nf;

  return (
    <>
      <PanelStats>
        <PanelStat label={<>CA HT</>}>{eur(total)}</PanelStat>
        {actual ? (
          <>
            <PanelStat label={<>Factures</>}>{rows?.length ?? 0}</PanelStat>
            <PanelStat label={<>dont payées</>}>{eur(paid)}</PanelStat>
          </>
        ) : (
          <>
            <PanelStat label={<>Consultants staffés</>}>{fmt(S.cons[month])}</PanelStat>
            <PanelStat label={<>TJM moyen (hypothèse)</>}>{eur(H.tjm)}</PanelStat>
          </>
        )}
      </PanelStats>

      {actual && rows ? (
        <>
          {rows.length === 0 ? (
            <p className="m-0 text-sm text-muted-foreground">Aucune facture émise ou payée pour ce mois.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Facture</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead numeric>Montant HT</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="whitespace-normal">
                      <span className="font-medium">
                        {l.url ? <a href={l.url} target="_blank" rel="noreferrer">{l.number || "Sans numéro"}</a> : l.number || "Sans numéro"}
                      </span>
                      {l.client && <span className="text-xs text-muted-foreground"> · {l.client}</span>}
                      {(l.project || l.consultant) && (
                        <div className="text-xs text-muted-foreground">{[l.project, l.consultant].filter(Boolean).join(" · ")}</div>
                      )}
                      {l.byIssueDate && l.issueDate && <div className="text-xs text-muted-foreground">Sans mois de prestation : émise le {frDate(l.issueDate)}</div>}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <Badge variant={l.status === "paid" ? "success" : "secondary"}>{STATUS[l.status] ?? l.status}</Badge>
                      {l.status === "paid" && l.paidAt && <div className="text-xs text-muted-foreground">le {frDate(l.paidAt)}</div>}
                    </TableCell>
                    <TableCell numeric>{eur(l.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableHead scope="row" className="text-foreground" colSpan={2}>Total</TableHead>
                  <TableCell numeric>{eur(total)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          )}
          <p className="m-0 text-xs leading-relaxed text-muted-foreground">
            Factures finalisées ou payées (hors factures ignorées), rattachées à leur{" "}
            {agg.revenueBasis === "issue" ? "mois d'émission" : "mois de prestation"}
            {byIssue > 0 && ` ; sans mois de prestation, à leur mois d'émission (${plural(byIssue, "facture")})`}. Montants hors taxes.
          </p>
        </>
      ) : (
        <Formula>
          <FormulaRow label={<>Freelances staffés ({pct(H.pctFree / 100)})</>}>{dec(nf)}</FormulaRow>
          <FormulaRow label={<>× jours facturables × TJM</>}>{eur(nf * H.jours * H.tjm)}</FormulaRow>
          <FormulaRow label={<>Salariés staffés</>}>{dec(ns)}</FormulaRow>
          <FormulaRow label={<>× jours × occupation {pct(H.occ / 100)} × TJM</>}>{eur(ns * H.jours * (H.occ / 100) * H.tjm)}</FormulaRow>
          <FormulaRow total label={<>= Chiffre d'affaires</>}>{eur(total)}</FormulaRow>
          <p className="m-0 text-xs leading-relaxed text-muted-foreground">
            Mois prévisionnel : calculé depuis les hypothèses. Modifiez « TJM moyen facturé », « Jours ouvrés facturables », « Taux d'occupation des salariés »
            ou les ventes / départs pour ajuster.
          </p>
        </Formula>
      )}
    </>
  );
}

/* ── Collections ────────────────────────────────────────────────────── */

const monthLabel = (iso: string) => {
  const [y, m] = iso.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
};

function CollectionBody({ year, month, plan, agg, hypotheses: H }: BodyProps) {
  const S = plan.series;
  const actual = plan.actual[month];
  const rows = agg.encLines[month];
  const total = S.enc[month];
  const delays = (rows ?? [])
    .filter((l) => l.paidAt && l.issueDate)
    .map((l) => (Date.parse(l.paidAt!) - Date.parse(l.issueDate!)) / 86400000)
    .filter((d) => d >= 0);
  const avgDelay = delays.length ? Math.round(delays.reduce((a, b) => a + b, 0) / delays.length) : null;
  const lag = Math.max(0, Math.round(H.dso / 30));
  const source = month - lag;

  return (
    <>
      <PanelStats>
        <PanelStat label={<>Encaissé HT</>}>{eur(total)}</PanelStat>
        {actual ? (
          <>
            <PanelStat label={<>Factures payées</>}>{rows?.length ?? 0}</PanelStat>
            <PanelStat label={<>Délai moyen de paiement</>}>{avgDelay === null ? "—" : `${avgDelay} j`}</PanelStat>
          </>
        ) : (
          <>
            <PanelStat label={<>Délai client (hypothèse)</>}>{fmt(H.dso)} j</PanelStat>
            <PanelStat label={<>Décalage</>}>{`${lag} mois`}</PanelStat>
          </>
        )}
      </PanelStats>

      {actual && rows ? (
        <>
          {rows.length === 0 ? (
            <p className="m-0 text-sm text-muted-foreground">Aucune facture payée ce mois-ci.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Facture</TableHead>
                  <TableHead>Payée le</TableHead>
                  <TableHead numeric>Montant HT</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="whitespace-normal">
                      <span className="font-medium">
                        {l.url ? <a href={l.url} target="_blank" rel="noreferrer">{l.number || "Sans numéro"}</a> : l.number || "Sans numéro"}
                      </span>
                      {l.client && <span className="text-xs text-muted-foreground"> · {l.client}</span>}
                      {(l.project || l.consultant) && (
                        <div className="text-xs text-muted-foreground">{[l.project, l.consultant].filter(Boolean).join(" · ")}</div>
                      )}
                      <div className="text-xs text-muted-foreground">
                        {[
                          l.periodMonth && `Prestation ${monthLabel(l.periodMonth)}`,
                          l.issueDate && `émise le ${frDate(l.issueDate)}`,
                        ].filter(Boolean).join(" · ")}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {l.paidAt ? frDate(l.paidAt) : "—"}
                      {l.paidAt && l.issueDate && Date.parse(l.paidAt) >= Date.parse(l.issueDate) && (
                        <div className="text-xs text-muted-foreground">{Math.round((Date.parse(l.paidAt) - Date.parse(l.issueDate)) / 86400000)} j</div>
                      )}
                    </TableCell>
                    <TableCell numeric>{eur(l.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableHead scope="row" className="text-foreground" colSpan={2}>Total</TableHead>
                  <TableCell numeric>{eur(total)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          )}
          <p className="m-0 text-xs leading-relaxed text-muted-foreground">
            Factures payées (hors factures ignorées), rattachées à leur mois de paiement quel que soit le mois de prestation. Montants hors taxes.
          </p>
        </>
      ) : (
        <Formula>
          {source >= 0 ? (
            <FormulaRow label={<>CA de {MONTH_NAMES[source]} {year} ({plan.actual[source] ? "réel" : "prévisionnel"})</>}>{eur(S.ca[source])}</FormulaRow>
          ) : (
            <FormulaRow label={<>CA de {MONTH_NAMES[0]} {year} (mois source antérieur à l'année)</>}>{eur(S.ca[0] ?? 0)}</FormulaRow>
          )}
          <FormulaRow total label={<>= Encaissements</>}>{eur(total)}</FormulaRow>
          <p className="m-0 text-xs leading-relaxed text-muted-foreground">
            Mois prévisionnel : le CA est encaissé {`${lag} mois`} après le mois de prestation (délai client {fmt(H.dso)} j ÷ 30, arrondi).
            {source < 0 && " Le mois source tombant l'année précédente, on reprend le CA de janvier."} Modifiez « Délai de paiement clients » pour ajuster.
          </p>
        </Formula>
      )}
    </>
  );
}

/* ── VAT cash effect ────────────────────────────────────────────────── */

const signed = (v: number) => `${v < 0 ? "−" : "+"} ${eur(Math.abs(v))}`;

function VatBody({ month, plan, vat }: BodyProps) {
  const S = plan.series;
  const real = vat.vat[month];
  const paid = vat.remittances[month];
  const rate = `${fmt(VAT_RATE * 100)} %`;
  return (
    <>
      <PanelStats>
        <PanelStat label={<>Effet sur la trésorerie</>}>{signed(S.tva[month])}</PanelStat>
        <PanelStat label={<>TVA encaissée</>}>{eur(S.tvaCol[month])}</PanelStat>
        <PanelStat label={<>TVA reversée à l'État</>}>{eur(S.tvaRem[month])}</PanelStat>
      </PanelStats>

      <Formula>
        <FormulaRow label={<>TVA encaissée{real ? " (factures payées ce mois)" : ` (${rate} des encaissements)`}</>}>{signed(S.tvaCol[month])}</FormulaRow>
        <FormulaRow label={<>TVA payée aux fournisseurs{real ? " (dépenses Qonto du mois)" : ` (${rate} des freelances et charges fixes hors salaires)`}</>}>{signed(-S.tvaDed[month])}</FormulaRow>
        <FormulaRow label={<>TVA reversée à l'État{real ? " (paiements DGFIP du mois)" : " (solde du mois précédent)"}</>}>{signed(-S.tvaRem[month])}</FormulaRow>
        <FormulaRow total label={<>= Effet TVA sur la trésorerie</>}>{signed(S.tva[month])}</FormulaRow>
      </Formula>

      {real && paid ? (
        paid.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">Aucun paiement de TVA à l'État ce mois-ci.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Paiement DGFIP</TableHead>
                <TableHead>Date</TableHead>
                <TableHead numeric>Montant</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paid.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-normal"><span className="font-medium">{r.label || r.counterparty || "DGFIP"}</span><div className="text-xs text-muted-foreground">{r.reference}</div></TableCell>
                  <TableCell className="whitespace-normal">{frDate((r.settled_at ?? r.emitted_at ?? "").slice(0, 10))}</TableCell>
                  <TableCell numeric>{eur(r.amount_cents / 100)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )
      ) : null}

      <p className="m-0 text-xs leading-relaxed text-muted-foreground">
        {real
          ? "Mois réel : TVA des factures clients payées ce mois, TVA indiquée par Qonto sur les dépenses du mois, et paiements de TVA à la DGFIP (référence « TVA-… CA3 »)."
          : `Estimation : ${rate} sur les encaissements et sur les achats soumis à TVA (freelances et charges fixes hors salaires) ; le solde est reversé le mois suivant, jamais négatif (un crédit de TVA n'est pas remboursé ici).`}
        {" "}Le compte de résultat reste hors taxes : seule la trésorerie est concernée.
      </p>
    </>
  );
}

/* ── Structure salaries ─────────────────────────────────────────────── */

function StructureBody({ year, month, plan, agg, multiplier, structure }: BodyProps) {
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState("");
  const actual = plan.actual[month];
  const rows = agg.structureLines[month];
  const counted = rows.filter((l) => !l.staffed);
  const onMission = rows.filter((l) => l.missionDays).length;
  const total = plan.series.fs[month];
  const missing = counted.filter((l) => l.salary === null).length;
  const listed = new Map(structure.entries.map((s) => [s.employee_id, s]));
  const members = structure.employees.filter((e) => listed.has(e.id));
  const others = structure.employees.filter((e) => !listed.has(e.id));
  const save = async (id: string, entry: StructureEntry | null) => {
    setBusy(true);
    try {
      await structure.onSave(id, entry);
      setPick("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PanelStats>
        <PanelStat label={<>Total brut</>}>{eur(total)}</PanelStat>
        <PanelStat label={<>Personnes</>}>{counted.length}</PanelStat>
        {onMission > 0 && <PanelStat label={<>En mission</>}>{onMission}</PanelStat>}
      </PanelStats>
      {missing > 0 && (
        <Alert variant="warning"><AlertDescription>
          {plural(missing, "personne")} sans salaire renseigné pour ce mois : compté{missing > 1 ? "s" : ""} à 0 €.
        </AlertDescription></Alert>
      )}
      {rows.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">Aucune personne de structure en poste ce mois-ci.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Personne</TableHead>
              <TableHead numeric>Brut / mois</TableHead>
              <TableHead numeric>Brut du mois</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((l) => (
              <TableRow key={l.employeeId} className={l.staffed ? "opacity-50" : undefined}>
                <TableCell className="whitespace-normal">
                  <span className="font-medium">{l.name}</span>
                  {l.contractType && <span className="text-xs text-muted-foreground"> · {l.contractType}</span>}
                  {l.missionDays && (
                    <div>
                      <Badge variant="success">En mission</Badge>{" "}
                      <span className="text-xs text-muted-foreground">{dec(l.missionDays)} j ouvrés en salaires consultants</span>
                    </div>
                  )}
                  {l.exitDate && <div className="text-xs text-muted-foreground">{l.exitDate < monthStartOf(year, month) ? "Sorti le " : "Sortie le "}{frDate(l.exitDate)}</div>}
                </TableCell>
                <TableCell numeric>{l.salary === null ? <span className="text-xs text-muted-foreground">non renseigné</span> : eur(l.salary)}</TableCell>
                <TableCell numeric>
                  {eur(l.cost)}
                  {l.days && <div className="text-xs text-muted-foreground">prorata {dec(l.days[0])}/{l.days[1]} j ouvrés</div>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableHead scope="row" className="text-foreground" colSpan={2}>Total</TableHead>
              <TableCell numeric>{eur(total)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      )}
      <p className="m-0 text-xs leading-relaxed text-muted-foreground">
        {actual
          ? "Mois réel : salaire mensuel brut en vigueur sur le mois, pour chaque personne de structure en poste."
          : "Mois prévisionnel : dernier salaire brut connu, pour chaque personne de structure en poste ce mois-ci (jusqu'à sa sortie)."}{" "}
        Période commençant ou finissant en cours de mois : au prorata des jours ouvrés. Stagiaires : gratification seule. Les cotisations sociales sont sur la ligne « Cotisations sociales structure ».{" "}
        Les jours ouvrés en mission (confirmée, active ou terminée, au prorata de l'allocation) basculent en salaires consultants.
        Hors période, et pour les autres salariés : consultant (inter-contrat sans mission).
      </p>

      <h3 className="m-0 mt-2 text-base font-medium">Personnes de structure</h3>
      {members.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">Personne n'est listé en structure.</p>
      ) : (
        <Table>
          <TableBody>
            {members.map((e) => (
              <StructureMember key={e.id} employee={e} entry={listed.get(e.id)!} busy={busy} onSave={(entry) => save(e.id, entry)} />
            ))}
          </TableBody>
        </Table>
      )}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium" htmlFor="bp-structure-pick">Ajouter en structure</label>
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect id="bp-structure-pick" className="min-w-56 flex-1" value={pick} onChange={(e) => setPick(e.target.value)} disabled={busy}>
            <NativeSelectOption value="">Choisir un salarié…</NativeSelectOption>
            {others.map((e) => (
              <NativeSelectOption key={e.id} value={e.id}>{e.name}{e.detail ? `, ${e.detail}` : ""}</NativeSelectOption>
            ))}
          </NativeSelect>
          <Button disabled={busy || !pick} onClick={() => save(pick, { employee_id: pick })}>
            Ajouter
          </Button>
        </div>
      </div>
    </>
  );
}

/** One structure member: period (empty = hire date / exit date) and removal. */
function StructureMember({
  employee: e,
  entry,
  busy,
  onSave,
}: {
  employee: StructureControl["employees"][number];
  entry: StructureEntry;
  busy: boolean;
  onSave: (entry: StructureEntry | null) => Promise<void>;
}) {
  const [start, setStart] = useState(entry.start_date ?? "");
  const [end, setEnd] = useState(entry.end_date ?? "");
  useEffect(() => {
    setStart(entry.start_date ?? "");
    setEnd(entry.end_date ?? "");
  }, [entry.start_date, entry.end_date]);
  const changed = start !== (entry.start_date ?? "") || end !== (entry.end_date ?? "");
  const invalid = !!start && !!end && end < start;
  return (
    <TableRow>
      <TableCell className="whitespace-normal">
        <span className="font-medium">{e.name}</span>
        {e.detail && <div className="text-xs text-muted-foreground">{e.detail}</div>}
        <div className="my-1.5 flex flex-wrap gap-2">
          <label className="inline-flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Du</span>
            <Input type="date" className="h-8 w-auto text-sm md:text-sm" value={start} min={e.hired} onChange={(ev) => setStart(ev.target.value)} disabled={busy} />
          </label>
          <label className="inline-flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">au</span>
            <Input type="date" className="h-8 w-auto text-sm md:text-sm" value={end} min={start || e.hired} onChange={(ev) => setEnd(ev.target.value)} disabled={busy} />
          </label>
        </div>
        <div className={cn("text-xs", invalid ? "text-destructive" : "text-muted-foreground")}>
          {invalid
            ? "La fin doit suivre le début."
            : `${start ? `Du ${frDate(start)}` : `Depuis l'embauche (${frDate(e.hired)})`} ${end ? `au ${frDate(end)}` : e.exit ? `jusqu'à la sortie (${frDate(e.exit)})` : "sans fin"}`}
        </div>
      </TableCell>
      <TableCell className="text-right align-top">
        {changed && (
          <Button
            size="sm"
            disabled={busy || invalid}
            onClick={() => onSave({ employee_id: entry.employee_id, start_date: start || null, end_date: end || null })}
          >
            Enregistrer
          </Button>
        )}{" "}
        <Button variant="outline" size="sm" disabled={busy} onClick={() => onSave(null)}>
          Retirer
        </Button>
      </TableCell>
    </TableRow>
  );
}

/* ── Salaries ───────────────────────────────────────────────────────── */

function SalaryBody({ year, month, plan, agg, hypotheses: H, multiplier }: BodyProps) {
  const S = plan.series;
  const actual = plan.actual[month];
  const rows = agg.salaryLines[month];
  const total = S.sal[month];
  const inter = S.inter[month];
  const missing = rows?.filter((l) => l.salary === null).length ?? 0;
  const current = agg.currentSalaried;
  const currentTotal = current.reduce((t, l) => t + l.cost, 0);
  const currentWithSalary = current.filter((l) => l.salary !== null).length;
  const salariedCount = dec(S.cons[month] * (1 - H.pctFree / 100));

  return (
    <>
      <PanelStats>
        <PanelStat label={<>Total brut</>}>{eur(total)}</PanelStat>
        <PanelStat label={<>dont inter-contrats</>}>{eur(inter)}</PanelStat>
        <PanelStat label={<>{actual ? "Consultants salariés" : "Salariés staffés (est.)"}</>}>{actual ? rows?.length ?? 0 : salariedCount}</PanelStat>
      </PanelStats>

      {actual && rows ? (
        <>
          {missing > 0 && (
            <Alert variant="warning"><AlertDescription>
              {plural(missing, "consultant")} sans salaire renseigné pour ce mois : compté{missing > 1 ? "s" : ""} à 0 €.
            </AlertDescription></Alert>
          )}
          {rows.length === 0 ? (
            <p className="m-0 text-sm text-muted-foreground">Aucun consultant salarié actif ce mois-ci.</p>
          ) : (
            <SalaryRoster rows={rows} multiplier={multiplier} total={total} />
          )}
          <p className="m-0 text-xs leading-relaxed text-muted-foreground">
            Salaire mensuel brut en vigueur sur le mois (stagiaires : gratification). Les cotisations patronales sont sur la ligne « Cotisations sociales consultants ».
            Inter-contrat = salarié sans mission confirmée, active ou terminée sur le mois. Les freelances sont comptés dans la ligne
            « Freelances », les salariés sans aucune mission dans les charges de structure.
          </p>
        </>
      ) : (
        <Formula>
          <FormulaRow label={<>Consultants staffés</>}>{fmt(S.cons[month])}</FormulaRow>
          <FormulaRow label={<>× part de salariés (1 − {pct(H.pctFree / 100)})</>}>{salariedCount}</FormulaRow>
          <FormulaRow label={<>× salaire brut / mois (hypothèse)</>}>{eur(H.salaire)}</FormulaRow>
          <FormulaRow total label={<>= Salaires consultants (brut)</>}>{eur(total)}</FormulaRow>
          <FormulaRow label={<>dont inter-contrats (1 − occupation {pct(H.occ / 100)})</>}>{eur(inter)}</FormulaRow>
          <p className="m-0 text-xs leading-relaxed text-muted-foreground">
            Mois prévisionnel : calculé depuis les hypothèses. Modifiez « Salaire brut consultant / mois », « Part de freelances » ou
            « Taux d'occupation » pour ajuster.
          </p>
          <h3 className="m-0 mt-2 text-base font-medium">Équipe salariée actuelle</h3>
          {current.length === 0 ? (
            <p className="m-0 text-sm text-muted-foreground">Aucun consultant salarié en poste aujourd'hui.</p>
          ) : (
            <>
              <p className="m-0 text-xs leading-relaxed text-muted-foreground">
                {plural(current.length, "consultant")} salarié{current.length > 1 ? "s" : ""} en poste aujourd'hui · salaire brut réel{" "}
                {eur(currentTotal)} / mois
                {currentWithSalary > 0 && <> · moyenne {eur(currentTotal / currentWithSalary)} (hypothèse : {eur(H.salaire)})</>}
              </p>
              <SalaryRoster rows={current} multiplier={multiplier} total={currentTotal} monthStart={monthStartOf(year, month)} />
            </>
          )}
        </Formula>
      )}
    </>
  );
}

/* ── Social charges ─────────────────────────────────────────────────── */

function ChargesBody({ month, plan, agg, hypotheses: H, forStructure: structure }: BodyProps & { forStructure: boolean }) {
  const S = plan.series;
  const actual = plan.actual[month];
  // Structure lines exist for every month (measured or projected); consultant lines only for closed months.
  const rows = structure ? agg.structureLines[month] : actual ? agg.salaryLines[month] : null;
  const total = structure ? S.cots[month] : S.cotc[month];
  const people = (rows ?? []).map((l) => ({ l, c: socialChargesOf(l, H) }));
  const heads = (rows ?? []).reduce((t, l) => t + (l.contractType !== "Internship" && l.salary ? l.cost / l.salary : 0), 0);
  const salaried = S.cons[month] * (1 - H.pctFree / 100);
  const gross = structure ? S.fs[month] : S.sal[month];
  const perHead = H.mutuelle + H.ticketsResto + H.medecine / 12;

  return (
    <>
      <PanelStats>
        <PanelStat label={<>Total cotisations</>}>{eur(total)}</PanelStat>
        <PanelStat label={<>soit</>}>{gross ? pct(total / gross) : "—"} du brut</PanelStat>
        <PanelStat label={<>{rows ? "Salariés (équivalent mois)" : "Salariés (est.)"}</>}>{dec(rows ? heads : salaried)}</PanelStat>
      </PanelStats>

      {rows ? (
        rows.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">Aucun salarié {structure ? "de structure" : "consultant"} ce mois-ci.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{structure ? "Personne" : "Consultant"}</TableHead>
                <TableHead numeric>Brut du mois</TableHead>
                <TableHead numeric>URSSAF et retraite</TableHead>
                <TableHead numeric>Mutuelle, tickets, médecine</TableHead>
                <TableHead numeric>Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {people.map(({ l, c }) => (
                <TableRow key={l.employeeId}>
                  <TableCell className="whitespace-normal">
                    <span className="font-medium">{l.name}</span>
                    {l.contractType === "Internship" && <div className="text-xs text-muted-foreground">stage : pas de cotisations</div>}
                    {l.salary === null && <div className="text-xs text-muted-foreground">salaire non renseigné</div>}
                    {l.salary !== null && l.cost < l.salary && <div className="text-xs text-muted-foreground">au prorata du mois ({pct(l.cost / l.salary)})</div>}
                  </TableCell>
                  <TableCell numeric>{eur(l.cost)}</TableCell>
                  <TableCell numeric>{eur(c.urssaf)}</TableCell>
                  <TableCell numeric>{eur(c.mutuelle + c.tickets + c.medecine)}</TableCell>
                  <TableCell numeric>{eur(chargesTotal(c))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>Total</TableCell>
                <TableCell numeric>{eur(people.reduce((t, p) => t + p.l.cost, 0))}</TableCell>
                <TableCell numeric>{eur(people.reduce((t, p) => t + p.c.urssaf, 0))}</TableCell>
                <TableCell numeric>{eur(people.reduce((t, p) => t + p.c.mutuelle + p.c.tickets + p.c.medecine, 0))}</TableCell>
                <TableCell numeric>{eur(total)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        )
      ) : (
        <Formula>
          <FormulaRow label={<>Salaires consultants (brut)</>}>{eur(gross)}</FormulaRow>
          <FormulaRow label={<>× URSSAF et retraite ({fmt(H.tauxCharges)} %)</>}>{eur((gross * H.tauxCharges) / 100)}</FormulaRow>
          <FormulaRow label={<>+ salariés staffés (est. {dec(salaried)}) × {eur(perHead)} / mois</>}>{eur(salaried * perHead)}</FormulaRow>
          <FormulaRow total label={<>= Cotisations sociales consultants</>}>{eur(total)}</FormulaRow>
        </Formula>
      )}

      <p className="m-0 text-xs leading-relaxed text-muted-foreground">
        URSSAF et retraite = {fmt(H.tauxCharges)} % du brut ; par salarié et par mois : mutuelle {eur(H.mutuelle)}, tickets restaurant{" "}
        {eur(H.ticketsResto)}, médecine du travail {eur(H.medecine / 12)} ({eur(H.medecine)} / an), au prorata de la part du mois comptée.
        Stagiaires exclus. Hypothèses calées sur l'arrêté comptable de janvier–juillet 2026, modifiables dans « Hypothèses » → Cotisations sociales.
      </p>
    </>
  );
}

/* ── Inter-contracts ────────────────────────────────────────────────── */

function InterBody({ year, month, plan, agg, hypotheses: H, multiplier }: BodyProps) {
  const S = plan.series;
  const actual = plan.actual[month];
  const rows = agg.salaryLines[month]?.filter((l) => !l.staffed) ?? null;
  const total = S.inter[month];
  const missing = rows?.filter((l) => l.salary === null).length ?? 0;
  const benched = agg.currentSalaried.filter((l) => !l.staffed);
  const benchedTotal = benched.reduce((t, l) => t + l.cost, 0);
  const share = S.sal[month] ? total / S.sal[month] : 0;

  return (
    <>
      <PanelStats>
        <PanelStat label={<>Coût inter-contrats</>}>{eur(total)}</PanelStat>
        <PanelStat label={<>{actual ? "Salariés sans mission" : "Salariés sans mission (auj.)"}</>}>{actual ? rows?.length ?? 0 : benched.length}</PanelStat>
        <PanelStat label={<>Part des salaires consultants</>}>{pct(share)}</PanelStat>
      </PanelStats>

      {actual && rows ? (
        <>
          {missing > 0 && (
            <Alert variant="warning"><AlertDescription>
              {plural(missing, "consultant")} sans salaire renseigné pour ce mois : compté{missing > 1 ? "s" : ""} à 0 €.
            </AlertDescription></Alert>
          )}
          {rows.length === 0 ? (
            <p className="m-0 text-sm text-muted-foreground">Aucun consultant salarié en inter-contrat ce mois-ci.</p>
          ) : (
            <SalaryRoster rows={rows} multiplier={multiplier} total={total} />
          )}
          <p className="m-0 text-xs leading-relaxed text-muted-foreground">
            Inter-contrat = consultant salarié sans mission confirmée, active ou terminée sur le mois. Coût = salaire mensuel brut (cotisations à part). Les personnes de structure n'y figurent jamais.
          </p>
        </>
      ) : (
        <Formula>
          <FormulaRow label={<>Salaires consultants (brut)</>}>{eur(S.sal[month])}</FormulaRow>
          <FormulaRow label={<>× (1 − occupation {pct(H.occ / 100)})</>}>{pct(1 - H.occ / 100)}</FormulaRow>
          <FormulaRow total label={<>= Inter-contrats</>}>{eur(total)}</FormulaRow>
          <p className="m-0 text-xs leading-relaxed text-muted-foreground">
            Mois prévisionnel : part non occupée des salariés, d'après l'hypothèse « Taux d'occupation des salariés ».
          </p>
          <h3 className="m-0 mt-2 text-base font-medium">Salariés sans mission aujourd'hui</h3>
          {benched.length === 0 ? (
            <p className="m-0 text-sm text-muted-foreground">Aucun consultant salarié sans mission aujourd'hui.</p>
          ) : (
            <>
              <p className="m-0 text-xs leading-relaxed text-muted-foreground">
                {plural(benched.length, "consultant")} sans mission aujourd'hui · salaire brut réel {eur(benchedTotal)} / mois
              </p>
              <SalaryRoster rows={benched} multiplier={multiplier} total={benchedTotal} monthStart={monthStartOf(year, month)} />
            </>
          )}
        </Formula>
      )}
    </>
  );
}

/* ── Freelances ─────────────────────────────────────────────────────── */

function FreelanceBody({ year, month, plan, agg, hypotheses: H }: BodyProps) {
  const S = plan.series;
  const actual = plan.actual[month];
  const rows = agg.freelanceLines[month];
  const total = S.free[month];
  const days = rows?.reduce((t, l) => t + l.days, 0) ?? 0;
  const missing = rows?.filter((l) => l.rate === null).length ?? 0;
  const estimated = rows?.filter((l) => l.estimated).length ?? 0;
  const current = agg.currentFreelancers;
  const rated = current.filter((l) => l.rate !== null);
  const avgRate = rated.length ? rated.reduce((t, l) => t + (l.rate ?? 0), 0) / rated.length : null;
  const nf = S.cons[month] * (H.pctFree / 100);

  return (
    <>
      <PanelStats>
        <PanelStat label={<>Coût total</>}>{eur(total)}</PanelStat>
        <PanelStat label={<>{actual ? "Jours facturés" : "Jours (est.)"}</>}>{dec(actual ? days : nf * H.jours)}</PanelStat>
        <PanelStat label={<>{actual ? "Freelances staffés" : "Freelances (est.)"}</>}>{actual ? rows?.length ?? 0 : dec(nf)}</PanelStat>
      </PanelStats>

      {actual && rows ? (
        <>
          {missing > 0 && (
            <Alert variant="warning"><AlertDescription>
              {plural(missing, "freelance")} sans taux journalier renseigné : compté{missing > 1 ? "s" : ""} à 0 €.
            </AlertDescription></Alert>
          )}
          {rows.length === 0 ? (
            <p className="m-0 text-sm text-muted-foreground">Aucun freelance staffé ce mois-ci.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Freelance</TableHead>
                  <TableHead numeric>Jours</TableHead>
                  <TableHead numeric>Taux / jour</TableHead>
                  <TableHead numeric>Coût</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((l) => (
                  <TableRow key={l.employeeId}>
                    <TableCell className="whitespace-normal">
                      <span className="font-medium">{l.name}</span>
                      {l.exitDate && <div className="text-xs text-muted-foreground">Fin le {frDate(l.exitDate)}</div>}
                    </TableCell>
                    <TableCell numeric>
                      {dec(l.days)}
                      <div className="text-xs text-muted-foreground">{l.estimated ? "estimé, sans CRA" : "CRA"}</div>
                    </TableCell>
                    <TableCell numeric>{l.rate === null ? <span className="text-xs text-muted-foreground">non renseigné</span> : eur(l.rate)}</TableCell>
                    <TableCell numeric>{eur(l.cost)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableHead scope="row" className="text-foreground">Total</TableHead>
                  <TableCell numeric>{dec(days)}</TableCell>
                  <TableCell />
                  <TableCell numeric>{eur(total)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          )}
          <p className="m-0 text-xs leading-relaxed text-muted-foreground">
            Jours = jours « Client Project » saisis dans le CRA (demi-journée = 0,5)
            {estimated > 0 && ` ; sans CRA ce mois-ci, jours ouvrés de la mission × allocation (${plural(estimated, "freelance")})`}.
            Coût = jours × taux journalier en vigueur.
          </p>
        </>
      ) : (
        <Formula>
          <FormulaRow label={<>Consultants staffés</>}>{fmt(S.cons[month])}</FormulaRow>
          <FormulaRow label={<>× part de freelances ({pct(H.pctFree / 100)})</>}>{dec(nf)}</FormulaRow>
          <FormulaRow label={<>× jours facturables / mois</>}>{fmt(H.jours)}</FormulaRow>
          <FormulaRow label={<>× coût journalier freelance (hypothèse)</>}>{eur(H.coutFree)}</FormulaRow>
          <FormulaRow total label={<>= Freelances</>}>{eur(total)}</FormulaRow>
          <p className="m-0 text-xs leading-relaxed text-muted-foreground">
            Mois prévisionnel : calculé depuis les hypothèses. Modifiez « Coût journalier freelance », « Part de freelances » ou
            « Jours ouvrés facturables » pour ajuster.
          </p>
          <h3 className="m-0 mt-2 text-base font-medium">Freelances actuels</h3>
          {current.length === 0 ? (
            <p className="m-0 text-sm text-muted-foreground">Aucun freelance en poste aujourd'hui.</p>
          ) : (
            <>
              <p className="m-0 text-xs leading-relaxed text-muted-foreground">
                {plural(current.length, "freelance")} aujourd'hui
                {avgRate !== null && <> · taux moyen réel {eur(avgRate)} / jour (hypothèse : {eur(H.coutFree)})</>}
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Freelance</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead numeric>Taux / jour</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {current.map((l) => {
                    const gone = !!l.exitDate && l.exitDate < monthStartOf(year, month);
                    return (
                      <TableRow key={l.employeeId} className={gone ? "opacity-50" : undefined}>
                        <TableCell className="whitespace-normal">
                          <span className="font-medium">{l.name}</span>
                          {l.exitDate && <div className="text-xs text-muted-foreground">{gone ? "Sorti le " : "Fin prévue le "}{frDate(l.exitDate)}</div>}
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          <Badge variant={l.staffed ? "success" : "secondary"}>{l.staffed ? "Staffé" : "Sans mission"}</Badge>
                        </TableCell>
                        <TableCell numeric>{l.rate === null ? <span className="text-xs text-muted-foreground">non renseigné</span> : eur(l.rate)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </>
          )}
        </Formula>
      )}
    </>
  );
}

/* ── Fixed charges (Qonto) ─────────────────────────────────────────── */

const LINE_OPTIONS: { value: FixedChargeLine; label: string }[] = [
  ...(["loyer", "outils", "marketing", "honoraires", "deplacements", "divers"] as const).map((k) => ({ value: k, label: TITLES[k] })),
  { value: "hors_charges_fixes", label: "Hors charges fixes" },
];
const HYPOTHESIS_OF: Record<FixedLineKey, keyof Hypotheses> = {
  loyer: "fLoyer", outils: "fOutils", marketing: "fMarketing", honoraires: "fHonoraires", deplacements: "fDeplacements", divers: "fDivers",
};
const SERIES_OF: Record<FixedLineKey, "fl" | "fo" | "fm" | "fh" | "fdp" | "fd"> = {
  loyer: "fl", outils: "fo", marketing: "fm", honoraires: "fh", deplacements: "fdp", divers: "fd",
};
const cents = (c: number) => eur(c / 100);
const bankDay = (r: BankRow) => (r.settled_at ?? r.emitted_at ?? "").slice(0, 10);

function FixedBody({ line, month, plan, hypotheses: H, bank }: BodyProps & { line: FixedLineKey }) {
  const [others, setOthers] = useState(false);
  const [error, setError] = useState("");
  const actual = plan.actual[month];
  const total = plan.series[SERIES_OF[line]][month];
  const hypothesis = H[HYPOTHESIS_OF[line]];
  const monthRows = bank.lines[month];
  const covered = actual && monthRows !== null;
  useEffect(() => {
    setOthers(false);
    setError("");
  }, [month]);

  if (!covered) {
    // Mean of the last three covered closed months of the year, if any.
    const recent = bank.fixed.filter((f): f is FixedActuals => f !== null).slice(-3);
    const mean = recent.length ? recent.reduce((t, f) => t + f[line], 0) / recent.length : null;
    const months = recent.length > 1 ? `${recent.length} derniers mois clôturés` : "dernier mois clôturé";
    return (
      <>
        <PanelStats>
          <PanelStat label={<>Montant HT (hypothèse)</>}>{eur(total)}</PanelStat>
          <PanelStat label={<>{mean === null ? "Moyenne réelle" : `Moyenne réelle (${months})`}</>}>{mean === null ? "—" : eur(mean)}</PanelStat>
        </PanelStats>
        <p className="m-0 text-xs leading-relaxed text-muted-foreground">
          {actual
            ? "Pas de données Qonto pour ce mois : hypothèse affichée."
            : `Mois prévisionnel : hypothèse « ${TITLES[line]} » (${eur(hypothesis)} / mois), modifiable dans l'onglet Hypothèses.`}{" "}
          {mean === null
            ? "Aucun mois clôturé de l'année n'est encore couvert par Qonto."
            : `Moyenne réelle : transactions Qonto HT classées sur ${recent.length > 1 ? `les ${recent.length} derniers mois clôturés couverts` : "le dernier mois clôturé couvert"}.`}
        </p>
      </>
    );
  }

  const mine = monthRows.filter((r) => r.status === "completed" && r.line === line);
  const rows = others ? bank.unclassified[month] ?? [] : mine;
  const toReview = mine.filter((r) => r.needs_review).length;
  const classify = async (id: string, next: FixedChargeLine) => {
    setError("");
    try {
      await bank.onClassify(id, next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Le reclassement a échoué.");
    }
  };

  return (
    <>
      <PanelStats>
        <PanelStat label={<>Total HT</>}>{eur(total)}</PanelStat>
        <PanelStat label={<>Transactions</>}>{mine.length}</PanelStat>
        <PanelStat label={<>À vérifier</>}>{toReview}</PanelStat>
      </PanelStats>
      {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="m-0 text-base font-medium">{others ? "Hors charges fixes et non classées" : TITLES[line]}</h3>
        <Button variant="link" size="sm" className="h-auto px-0 text-left whitespace-normal" onClick={() => setOthers(!others)}>
          {others ? `Revenir à « ${TITLES[line]} »` : "Voir les transactions hors charges fixes et non classées"}
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">{others ? "Aucune transaction hors charges fixes ce mois-ci." : "Aucune transaction classée sur cette ligne ce mois-ci."}</p>
      ) : (
        <Table className="[&_td]:align-top">
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Transaction</TableHead>
              <TableHead numeric>Montant HT</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="num text-[13px] text-muted-foreground">{bankDay(r) ? frDate(bankDay(r)) : "—"}</TableCell>
                <TableCell className="whitespace-normal">
                  <span className="font-medium">{r.counterparty || "Sans contrepartie"}</span>
                  {r.needs_review && <> <Badge variant="warning">à vérifier</Badge></>}
                  {r.manual_line && <> <Badge variant="outline">corrigé</Badge></>}
                  {r.label && r.label !== r.counterparty && <div className="text-xs text-muted-foreground">{r.label}</div>}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <NativeSelect
                      size="sm"
                      className="max-w-full"
                      aria-label={`Ligne de ${r.counterparty || "la transaction"}`}
                      value={r.line ?? ""}
                      onChange={(e) => e.target.value && void classify(r.id, e.target.value as FixedChargeLine)}
                    >
                      {r.line === null && <NativeSelectOption value="">Non classée</NativeSelectOption>}
                      {LINE_OPTIONS.map((o) => (
                        <NativeSelectOption key={o.value} value={o.value}>{o.label}</NativeSelectOption>
                      ))}
                    </NativeSelect>
                    {r.needs_review && r.line && (
                      <Button variant="outline" size="sm" onClick={() => void classify(r.id, r.line!)}>
                        Valider
                      </Button>
                    )}
                  </div>
                </TableCell>
                <TableCell numeric>
                  {cents(r.amount_ht_cents)}
                  {r.amount_cents !== r.amount_ht_cents && <div className="text-xs text-muted-foreground">{cents(r.amount_cents)} TTC</div>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          {!others && (
            <TableFooter>
              <TableRow>
                <TableHead scope="row" className="text-foreground" colSpan={2}>Total</TableHead>
                <TableCell numeric>{eur(total)}</TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>
      )}
      <p className="m-0 text-xs leading-relaxed text-muted-foreground">
        Débits Qonto réglés, classés par l'IA (Kimi) ou corrigés à la main, montants hors taxes (TTC − TVA ; sans TVA connue, HT = TTC).
        Changer la ligne d'une transaction recalcule le plan ; la correction sert d'exemple aux prochains classements.
      </p>
    </>
  );
}

/* ── Shared ─────────────────────────────────────────────────────────── */

/** Named salaried consultants. With `monthStart` (forecast), people whose
 *  exit falls before that month are greyed out. */
function SalaryRoster({
  rows,
  multiplier,
  total,
  monthStart,
}: {
  rows: SalaryLine[];
  multiplier: number;
  total: number;
  monthStart?: string;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Consultant</TableHead>
          <TableHead>Statut</TableHead>
          <TableHead numeric>Brut / mois</TableHead>
          <TableHead numeric>Brut du mois</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((l) => {
          const gone = !!monthStart && !!l.exitDate && l.exitDate < monthStart;
          return (
            <TableRow key={l.employeeId} className={gone ? "opacity-50" : undefined}>
              <TableCell className="whitespace-normal">
                <span className="font-medium">{l.name}</span>
                {l.contractType && <span className="text-xs text-muted-foreground"> · {l.contractType}</span>}
                {l.exitDate && <div className="text-xs text-muted-foreground">{gone ? "Sorti le " : "Départ prévu le "}{frDate(l.exitDate)}</div>}
              </TableCell>
              <TableCell className="whitespace-normal">
                <Badge variant={l.staffed ? "success" : "secondary"}>{l.staffed ? "Staffé" : "Inter-contrat"}</Badge>
                {l.missionDays && <div className="text-xs text-muted-foreground">structure, {dec(l.missionDays)} j en mission</div>}
              </TableCell>
              <TableCell numeric>{l.salary === null ? <span className="text-xs text-muted-foreground">non renseigné</span> : eur(l.salary)}</TableCell>
              <TableCell numeric>
                {eur(l.cost)}
                {l.contractType === "Internship" && <span className="text-xs text-muted-foreground"> stage</span>}
                {l.days && <div className="text-xs text-muted-foreground">prorata {dec(l.days[0])}/{dec(l.days[1])} j ouvrés hors structure</div>}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableHead scope="row" className="text-foreground" colSpan={3}>Total</TableHead>
          <TableCell numeric>{eur(total)}</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}

/** Key figures at the top of the panel (one row of stats). */
function PanelStats({ children }: { children: ReactNode }) {
  return (
    <div className="@container/stats rounded-lg border border-border bg-card p-4">
      <div className="grid grid-cols-1 divide-y divide-border *:py-3 *:first:pt-0 *:last:pb-0 @md/stats:auto-cols-fr @md/stats:grid-flow-col @md/stats:divide-x @md/stats:divide-y-0 @md/stats:*:px-4 @md/stats:*:py-0 @md/stats:*:first:pl-0 @md/stats:*:last:pr-0">
        {children}
      </div>
    </div>
  );
}

function PanelStat({ label, children }: { label: ReactNode; children: ReactNode }) {
  const m = typeof children === "string" ? children.match(/^(.*\S)\s*€$/) : null;
  return (
    <Stat size="sm">
      <StatValue className="group-data-[size=sm]/stat:text-[20px]">{m ? <>{m[1]}<StatUnit>€</StatUnit></> : children}</StatValue>
      <StatLabel>{label}</StatLabel>
    </Stat>
  );
}

/** Forecast formula: one operand per line, the result in bold. */
function Formula({ children }: { children: ReactNode }) {
  return <div className="flex flex-col [&>p]:mt-3">{children}</div>;
}

function FormulaRow({ label, total, children }: { label: ReactNode; total?: boolean; children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-4 border-b py-2.5 text-sm",
        total ? "border-foreground/30 font-medium text-foreground" : "border-border text-muted-foreground",
      )}
    >
      <span>{label}</span>
      <strong className="num font-medium whitespace-nowrap text-foreground">{children}</strong>
    </div>
  );
}
