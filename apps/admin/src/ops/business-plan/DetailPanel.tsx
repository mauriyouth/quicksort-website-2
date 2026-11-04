import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { Aggregate, SalaryLine, StructureEntry } from "./actuals";
import { fmt, MONTH_NAMES, pct, type FixedLineKey, type Hypotheses, type PlanResult } from "./model";

/**
 * Drill-down panel for the P&L rows "Chiffre d’affaires", "Salaires
 * consultants chargés", "Freelances", "Salaires structure chargés",
 * "Inter-contrats" and "Encaissements clients". Closed months list the invoices or
 * named people behind the figure;
 * forecast months show the formula plus today's named team, the base the
 * forecast projects from.
 */
export type DetailKind = "ca" | "sal" | "free" | "fs" | "inter" | "enc" | FixedLineKey;

const TITLES: Record<DetailKind, string> = {
  ca: "Chiffre d’affaires",
  sal: "Salaires consultants chargés",
  free: "Freelances",
  fs: "Salaires structure chargés",
  inter: "Inter-contrats",
  enc: "Encaissements clients",
  loyer: "Loyer et locaux",
  outils: "Outils, cloud et licences IA",
  marketing: "Marketing et événements",
  honoraires: "Honoraires (comptable, juridique)",
  divers: "Divers",
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
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const actual = plan.actual[month];

  return (
    <div className="bp-drawer-backdrop" onClick={onClose}>
      <div
        ref={panel}
        className="bp-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bp-detail-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bp-drawer-head">
          <div>
            <div className="bp-meta">{TITLES[kind]}</div>
            <h2 id="bp-detail-title">
              {MONTH_NAMES[month]} {year}{" "}
              <span className={`bp-chip${actual ? "" : " is-muted"}`}>{actual ? "Réel" : "Prévisionnel"}</span>
            </h2>
          </div>
          <button type="button" className="bp-icon" onClick={onClose} aria-label="Fermer">
            <X size={18} />
          </button>
        </div>

        <div className="bp-months" role="tablist" aria-label="Mois">
          {MONTH_NAMES.map((name, m) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={m === month}
              className={`bp-month${m === month ? " is-on" : ""}${plan.actual[m] ? " is-actual" : ""}`}
              onClick={() => onMonth(m)}
            >
              {name}
            </button>
          ))}
        </div>

        {kind === "ca" ? <RevenueBody {...body} />
          : kind === "sal" ? <SalaryBody {...body} />
          : kind === "fs" ? <StructureBody {...body} />
          : kind === "inter" ? <InterBody {...body} />
          : kind === "enc" ? <CollectionBody {...body} />
          : <FreelanceBody {...body} />}
      </div>
    </div>
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
      <div className="bp-drawer-stats">
        <div><span>CA HT</span><strong>{eur(total)}</strong></div>
        {actual ? (
          <>
            <div><span>Factures</span><strong>{rows?.length ?? 0}</strong></div>
            <div><span>dont payées</span><strong>{eur(paid)}</strong></div>
          </>
        ) : (
          <>
            <div><span>Consultants staffés</span><strong>{fmt(S.cons[month])}</strong></div>
            <div><span>TJM moyen (hypothèse)</span><strong>{eur(H.tjm)}</strong></div>
          </>
        )}
      </div>

      {actual && rows ? (
        <>
          {rows.length === 0 ? (
            <p className="bp-meta">Aucune facture émise ou payée pour ce mois.</p>
          ) : (
            <table className="bp-table">
              <thead>
                <tr>
                  <th scope="col">Facture</th>
                  <th scope="col">Statut</th>
                  <th scope="col" className="num">Montant HT</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <span className="bp-name">
                        {l.url ? <a href={l.url} target="_blank" rel="noreferrer">{l.number || "Sans numéro"}</a> : l.number || "Sans numéro"}
                      </span>
                      {l.client && <span className="bp-sub"> · {l.client}</span>}
                      {(l.project || l.consultant) && (
                        <div className="bp-sub">{[l.project, l.consultant].filter(Boolean).join(" · ")}</div>
                      )}
                      {l.byIssueDate && l.issueDate && <div className="bp-sub">Sans mois de prestation : émise le {frDate(l.issueDate)}</div>}
                    </td>
                    <td>
                      <span className={`bp-tag${l.status === "paid" ? " is-on" : ""}`}>{STATUS[l.status] ?? l.status}</span>
                      {l.status === "paid" && l.paidAt && <div className="bp-sub">le {frDate(l.paidAt)}</div>}
                    </td>
                    <td className="num">{eur(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={2}>Total</th>
                  <td className="num">{eur(total)}</td>
                </tr>
              </tfoot>
            </table>
          )}
          <p className="bp-note">
            Factures finalisées ou payées (hors factures ignorées), rattachées à leur mois de prestation
            {byIssue > 0 && ` ; sans mois de prestation, à leur mois d’émission (${plural(byIssue, "facture")})`}. Montants hors taxes.
          </p>
        </>
      ) : (
        <div className="bp-formula">
          <div><span>Freelances staffés ({pct(H.pctFree / 100)})</span><strong>{dec(nf)}</strong></div>
          <div><span>× jours facturables × TJM</span><strong>{eur(nf * H.jours * H.tjm)}</strong></div>
          <div><span>Salariés staffés</span><strong>{dec(ns)}</strong></div>
          <div><span>× jours × occupation {pct(H.occ / 100)} × TJM</span><strong>{eur(ns * H.jours * (H.occ / 100) * H.tjm)}</strong></div>
          <div className="is-total"><span>= Chiffre d’affaires</span><strong>{eur(total)}</strong></div>
          <p className="bp-note">
            Mois prévisionnel : calculé depuis les hypothèses. Modifiez « TJM moyen facturé », « Jours ouvrés facturables », « Taux d’occupation des salariés »
            ou les ventes / départs pour ajuster.
          </p>
        </div>
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
      <div className="bp-drawer-stats">
        <div><span>Encaissé HT</span><strong>{eur(total)}</strong></div>
        {actual ? (
          <>
            <div><span>Factures payées</span><strong>{rows?.length ?? 0}</strong></div>
            <div><span>Délai moyen de paiement</span><strong>{avgDelay === null ? "—" : `${avgDelay} j`}</strong></div>
          </>
        ) : (
          <>
            <div><span>Délai client (hypothèse)</span><strong>{fmt(H.dso)} j</strong></div>
            <div><span>Décalage</span><strong>{`${lag} mois`}</strong></div>
          </>
        )}
      </div>

      {actual && rows ? (
        <>
          {rows.length === 0 ? (
            <p className="bp-meta">Aucune facture payée ce mois-ci.</p>
          ) : (
            <table className="bp-table">
              <thead>
                <tr>
                  <th scope="col">Facture</th>
                  <th scope="col">Payée le</th>
                  <th scope="col" className="num">Montant HT</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <span className="bp-name">
                        {l.url ? <a href={l.url} target="_blank" rel="noreferrer">{l.number || "Sans numéro"}</a> : l.number || "Sans numéro"}
                      </span>
                      {l.client && <span className="bp-sub"> · {l.client}</span>}
                      {(l.project || l.consultant) && (
                        <div className="bp-sub">{[l.project, l.consultant].filter(Boolean).join(" · ")}</div>
                      )}
                      <div className="bp-sub">
                        {[
                          l.periodMonth && `Prestation ${monthLabel(l.periodMonth)}`,
                          l.issueDate && `émise le ${frDate(l.issueDate)}`,
                        ].filter(Boolean).join(" · ")}
                      </div>
                    </td>
                    <td>
                      {l.paidAt ? frDate(l.paidAt) : "—"}
                      {l.paidAt && l.issueDate && Date.parse(l.paidAt) >= Date.parse(l.issueDate) && (
                        <div className="bp-sub">{Math.round((Date.parse(l.paidAt) - Date.parse(l.issueDate)) / 86400000)} j</div>
                      )}
                    </td>
                    <td className="num">{eur(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={2}>Total</th>
                  <td className="num">{eur(total)}</td>
                </tr>
              </tfoot>
            </table>
          )}
          <p className="bp-note">
            Factures payées (hors factures ignorées), rattachées à leur mois de paiement quel que soit le mois de prestation. Montants hors taxes.
          </p>
        </>
      ) : (
        <div className="bp-formula">
          {source >= 0 ? (
            <div><span>CA de {MONTH_NAMES[source]} {year} ({plan.actual[source] ? "réel" : "prévisionnel"})</span><strong>{eur(S.ca[source])}</strong></div>
          ) : (
            <div><span>CA de {MONTH_NAMES[0]} {year} (mois source antérieur à l’année)</span><strong>{eur(S.ca[0] ?? 0)}</strong></div>
          )}
          <div className="is-total"><span>= Encaissements</span><strong>{eur(total)}</strong></div>
          <p className="bp-note">
            Mois prévisionnel : le CA est encaissé {`${lag} mois`} après le mois de prestation (délai client {fmt(H.dso)} j ÷ 30, arrondi).
            {source < 0 && " Le mois source tombant l’année précédente, on reprend le CA de janvier."} Modifiez « Délai de paiement clients » pour ajuster.
          </p>
        </div>
      )}
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
  const mult = String(multiplier).replace(".", ",");
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
      <div className="bp-drawer-stats">
        <div><span>Total chargé</span><strong>{eur(total)}</strong></div>
        <div><span>Personnes</span><strong>{counted.length}</strong></div>
        {onMission > 0 && <div><span>En mission</span><strong>{onMission}</strong></div>}
        <div><span>Multiplicateur de charges</span><strong>×{mult}</strong></div>
      </div>
      {missing > 0 && (
        <p className="bp-warn">
          {plural(missing, "personne")} sans salaire renseigné pour ce mois : compté{missing > 1 ? "s" : ""} à 0 €.
        </p>
      )}
      {rows.length === 0 ? (
        <p className="bp-meta">Aucune personne de structure en poste ce mois-ci.</p>
      ) : (
        <table className="bp-table">
          <thead>
            <tr>
              <th scope="col">Personne</th>
              <th scope="col" className="num">Brut / mois</th>
              <th scope="col" className="num">Chargé ×{mult}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.employeeId} className={l.staffed ? "is-gone" : undefined}>
                <td>
                  <span className="bp-name">{l.name}</span>
                  {l.contractType && <span className="bp-sub"> · {l.contractType}</span>}
                  {l.missionDays && (
                    <div>
                      <span className="bp-tag is-on">En mission</span>{" "}
                      <span className="bp-sub">{dec(l.missionDays)} j ouvrés en salaires consultants</span>
                    </div>
                  )}
                  {l.exitDate && <div className="bp-sub">{l.exitDate < monthStartOf(year, month) ? "Sorti le " : "Sortie le "}{frDate(l.exitDate)}</div>}
                </td>
                <td className="num">{l.salary === null ? <span className="bp-sub">non renseigné</span> : eur(l.salary)}</td>
                <td className="num">
                  {eur(l.cost)}
                  {l.days && <div className="bp-sub">prorata {dec(l.days[0])}/{l.days[1]} j ouvrés</div>}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={2}>Total</th>
              <td className="num">{eur(total)}</td>
            </tr>
          </tfoot>
        </table>
      )}
      <p className="bp-note">
        {actual
          ? "Mois réel : salaire mensuel brut en vigueur sur le mois × multiplicateur de charges, pour chaque personne de structure en poste."
          : "Mois prévisionnel : dernier salaire connu × multiplicateur de charges, pour chaque personne de structure en poste ce mois-ci (jusqu’à sa sortie)."}{" "}
        Période commençant ou finissant en cours de mois : au prorata des jours ouvrés. Stagiaires : coût = salaire × 1,4 (charges patronales très faibles).{" "}
        Les jours ouvrés en mission (confirmée, active ou terminée, au prorata de l’allocation) basculent en salaires consultants.
        Hors période, et pour les autres salariés : consultant (inter-contrat sans mission).
      </p>

      <h3 className="bp-drawer-sub">Personnes de structure</h3>
      {members.length === 0 ? (
        <p className="bp-meta">Personne n’est listé en structure.</p>
      ) : (
        <table className="bp-table">
          <tbody>
            {members.map((e) => (
              <StructureMember key={e.id} employee={e} entry={listed.get(e.id)!} busy={busy} onSave={(entry) => save(e.id, entry)} />
            ))}
          </tbody>
        </table>
      )}
      <div className="bp-structure-add">
        <label className="bp-meta" htmlFor="bp-structure-pick">Ajouter en structure</label>
        <select id="bp-structure-pick" className="bp-hin" value={pick} onChange={(e) => setPick(e.target.value)} disabled={busy}>
          <option value="">Choisir un salarié…</option>
          {others.map((e) => (
            <option key={e.id} value={e.id}>{e.name}{e.detail ? ` — ${e.detail}` : ""}</option>
          ))}
        </select>
        <button type="button" className="btn small" disabled={busy || !pick} onClick={() => save(pick, { employee_id: pick })}>
          Ajouter
        </button>
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
    <tr>
      <td>
        <span className="bp-name">{e.name}</span>
        {e.detail && <div className="bp-sub">{e.detail}</div>}
        <div className="bp-structure-period">
          <label>
            <span className="bp-sub">Du</span>
            <input type="date" className="bp-hin" value={start} min={e.hired} onChange={(ev) => setStart(ev.target.value)} disabled={busy} />
          </label>
          <label>
            <span className="bp-sub">au</span>
            <input type="date" className="bp-hin" value={end} min={start || e.hired} onChange={(ev) => setEnd(ev.target.value)} disabled={busy} />
          </label>
        </div>
        <div className="bp-sub">
          {invalid
            ? "La fin doit suivre le début."
            : `${start ? `Du ${frDate(start)}` : `Depuis l’embauche (${frDate(e.hired)})`} ${end ? `au ${frDate(end)}` : e.exit ? `jusqu’à la sortie (${frDate(e.exit)})` : "sans fin"}`}
        </div>
      </td>
      <td className="num">
        {changed && (
          <button
            type="button"
            className="btn small"
            disabled={busy || invalid}
            onClick={() => onSave({ employee_id: entry.employee_id, start_date: start || null, end_date: end || null })}
          >
            Enregistrer
          </button>
        )}{" "}
        <button type="button" className="btn secondary small" disabled={busy} onClick={() => onSave(null)}>
          Retirer
        </button>
      </td>
    </tr>
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
  const mult = String(multiplier).replace(".", ",");

  return (
    <>
      <div className="bp-drawer-stats">
        <div><span>Total chargé</span><strong>{eur(total)}</strong></div>
        <div><span>dont inter-contrats</span><strong>{eur(inter)}</strong></div>
        <div><span>{actual ? "Consultants salariés" : "Salariés staffés (est.)"}</span>
          <strong>{actual ? rows?.length ?? 0 : salariedCount}</strong>
        </div>
      </div>

      {actual && rows ? (
        <>
          {missing > 0 && (
            <p className="bp-warn">
              {plural(missing, "consultant")} sans salaire renseigné pour ce mois : compté{missing > 1 ? "s" : ""} à 0 €.
            </p>
          )}
          {rows.length === 0 ? (
            <p className="bp-meta">Aucun consultant salarié actif ce mois-ci.</p>
          ) : (
            <SalaryRoster rows={rows} multiplier={multiplier} total={total} />
          )}
          <p className="bp-note">
            Salaire mensuel brut en vigueur sur le mois × multiplicateur de charges ({mult}, scénario choisi) pour estimer le coût employeur ; stagiaires × 1,4.
            Inter-contrat = salarié sans mission confirmée, active ou terminée sur le mois. Les freelances sont comptés dans la ligne
            « Freelances », les salariés sans aucune mission dans les charges de structure.
          </p>
        </>
      ) : (
        <div className="bp-formula">
          <div><span>Consultants staffés</span><strong>{fmt(S.cons[month])}</strong></div>
          <div><span>× part de salariés (1 − {pct(H.pctFree / 100)})</span><strong>{salariedCount}</strong></div>
          <div><span>× salaire chargé / mois (hypothèse)</span><strong>{eur(H.salaire)}</strong></div>
          <div className="is-total"><span>= Salaires consultants chargés</span><strong>{eur(total)}</strong></div>
          <div><span>dont inter-contrats (1 − occupation {pct(H.occ / 100)})</span><strong>{eur(inter)}</strong></div>
          <p className="bp-note">
            Mois prévisionnel : calculé depuis les hypothèses. Modifiez « Salaire chargé consultant / mois », « Part de freelances » ou
            « Taux d’occupation » pour ajuster.
          </p>
          <h3 className="bp-drawer-sub">Équipe salariée actuelle</h3>
          {current.length === 0 ? (
            <p className="bp-meta">Aucun consultant salarié en poste aujourd’hui.</p>
          ) : (
            <>
              <p className="bp-note">
                {plural(current.length, "consultant")} salarié{current.length > 1 ? "s" : ""} en poste aujourd’hui · coût chargé réel{" "}
                {eur(currentTotal)} / mois
                {currentWithSalary > 0 && <> · moyenne {eur(currentTotal / currentWithSalary)} (hypothèse : {eur(H.salaire)})</>}
              </p>
              <SalaryRoster rows={current} multiplier={multiplier} total={currentTotal} monthStart={monthStartOf(year, month)} />
            </>
          )}
        </div>
      )}
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
      <div className="bp-drawer-stats">
        <div><span>Coût inter-contrats</span><strong>{eur(total)}</strong></div>
        <div><span>{actual ? "Salariés sans mission" : "Salariés sans mission (auj.)"}</span>
          <strong>{actual ? rows?.length ?? 0 : benched.length}</strong>
        </div>
        <div><span>Part des salaires consultants</span><strong>{pct(share)}</strong></div>
      </div>

      {actual && rows ? (
        <>
          {missing > 0 && (
            <p className="bp-warn">
              {plural(missing, "consultant")} sans salaire renseigné pour ce mois : compté{missing > 1 ? "s" : ""} à 0 €.
            </p>
          )}
          {rows.length === 0 ? (
            <p className="bp-meta">Aucun consultant salarié en inter-contrat ce mois-ci.</p>
          ) : (
            <SalaryRoster rows={rows} multiplier={multiplier} total={total} />
          )}
          <p className="bp-note">
            Inter-contrat = consultant salarié sans mission confirmée, active ou terminée sur le mois. Coût = salaire mensuel brut × multiplicateur
            de charges. Les personnes de structure n’y figurent jamais.
          </p>
        </>
      ) : (
        <div className="bp-formula">
          <div><span>Salaires consultants chargés</span><strong>{eur(S.sal[month])}</strong></div>
          <div><span>× (1 − occupation {pct(H.occ / 100)})</span><strong>{pct(1 - H.occ / 100)}</strong></div>
          <div className="is-total"><span>= Inter-contrats</span><strong>{eur(total)}</strong></div>
          <p className="bp-note">
            Mois prévisionnel : part non occupée des salariés, d’après l’hypothèse « Taux d’occupation des salariés ».
          </p>
          <h3 className="bp-drawer-sub">Salariés sans mission aujourd’hui</h3>
          {benched.length === 0 ? (
            <p className="bp-meta">Aucun consultant salarié sans mission aujourd’hui.</p>
          ) : (
            <>
              <p className="bp-note">
                {plural(benched.length, "consultant")} sans mission aujourd’hui · coût chargé réel {eur(benchedTotal)} / mois
              </p>
              <SalaryRoster rows={benched} multiplier={multiplier} total={benchedTotal} monthStart={monthStartOf(year, month)} />
            </>
          )}
        </div>
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
      <div className="bp-drawer-stats">
        <div><span>Coût total</span><strong>{eur(total)}</strong></div>
        <div><span>{actual ? "Jours facturés" : "Jours (est.)"}</span><strong>{dec(actual ? days : nf * H.jours)}</strong></div>
        <div><span>{actual ? "Freelances staffés" : "Freelances (est.)"}</span><strong>{actual ? rows?.length ?? 0 : dec(nf)}</strong></div>
      </div>

      {actual && rows ? (
        <>
          {missing > 0 && (
            <p className="bp-warn">
              {plural(missing, "freelance")} sans taux journalier renseigné : compté{missing > 1 ? "s" : ""} à 0 €.
            </p>
          )}
          {rows.length === 0 ? (
            <p className="bp-meta">Aucun freelance staffé ce mois-ci.</p>
          ) : (
            <table className="bp-table">
              <thead>
                <tr>
                  <th scope="col">Freelance</th>
                  <th scope="col" className="num">Jours</th>
                  <th scope="col" className="num">Taux / jour</th>
                  <th scope="col" className="num">Coût</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.employeeId}>
                    <td>
                      <span className="bp-name">{l.name}</span>
                      {l.exitDate && <div className="bp-sub">Fin le {frDate(l.exitDate)}</div>}
                    </td>
                    <td className="num">
                      {dec(l.days)}
                      <div className="bp-sub">{l.estimated ? "estimé, sans CRA" : "CRA"}</div>
                    </td>
                    <td className="num">{l.rate === null ? <span className="bp-sub">non renseigné</span> : eur(l.rate)}</td>
                    <td className="num">{eur(l.cost)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Total</th>
                  <td className="num">{dec(days)}</td>
                  <td />
                  <td className="num">{eur(total)}</td>
                </tr>
              </tfoot>
            </table>
          )}
          <p className="bp-note">
            Jours = jours « Client Project » saisis dans le CRA (demi-journée = 0,5)
            {estimated > 0 && ` ; sans CRA ce mois-ci, jours ouvrés de la mission × allocation (${plural(estimated, "freelance")})`}.
            Coût = jours × taux journalier en vigueur.
          </p>
        </>
      ) : (
        <div className="bp-formula">
          <div><span>Consultants staffés</span><strong>{fmt(S.cons[month])}</strong></div>
          <div><span>× part de freelances ({pct(H.pctFree / 100)})</span><strong>{dec(nf)}</strong></div>
          <div><span>× jours facturables / mois</span><strong>{fmt(H.jours)}</strong></div>
          <div><span>× coût journalier freelance (hypothèse)</span><strong>{eur(H.coutFree)}</strong></div>
          <div className="is-total"><span>= Freelances</span><strong>{eur(total)}</strong></div>
          <p className="bp-note">
            Mois prévisionnel : calculé depuis les hypothèses. Modifiez « Coût journalier freelance », « Part de freelances » ou
            « Jours ouvrés facturables » pour ajuster.
          </p>
          <h3 className="bp-drawer-sub">Freelances actuels</h3>
          {current.length === 0 ? (
            <p className="bp-meta">Aucun freelance en poste aujourd’hui.</p>
          ) : (
            <>
              <p className="bp-note">
                {plural(current.length, "freelance")} aujourd’hui
                {avgRate !== null && <> · taux moyen réel {eur(avgRate)} / jour (hypothèse : {eur(H.coutFree)})</>}
              </p>
              <table className="bp-table">
                <thead>
                  <tr>
                    <th scope="col">Freelance</th>
                    <th scope="col">Statut</th>
                    <th scope="col" className="num">Taux / jour</th>
                  </tr>
                </thead>
                <tbody>
                  {current.map((l) => {
                    const gone = !!l.exitDate && l.exitDate < monthStartOf(year, month);
                    return (
                      <tr key={l.employeeId} className={gone ? "is-gone" : undefined}>
                        <td>
                          <span className="bp-name">{l.name}</span>
                          {l.exitDate && <div className="bp-sub">{gone ? "Sorti le " : "Fin prévue le "}{frDate(l.exitDate)}</div>}
                        </td>
                        <td>
                          <span className={`bp-tag${l.staffed ? " is-on" : ""}`}>{l.staffed ? "Staffé" : "Sans mission"}</span>
                        </td>
                        <td className="num">{l.rate === null ? <span className="bp-sub">non renseigné</span> : eur(l.rate)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
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
    <table className="bp-table">
      <thead>
        <tr>
          <th scope="col">Consultant</th>
          <th scope="col">Statut</th>
          <th scope="col" className="num">Brut / mois</th>
          <th scope="col" className="num">Chargé ×{String(multiplier).replace(".", ",")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((l) => {
          const gone = !!monthStart && !!l.exitDate && l.exitDate < monthStart;
          return (
            <tr key={l.employeeId} className={gone ? "is-gone" : undefined}>
              <td>
                <span className="bp-name">{l.name}</span>
                {l.contractType && <span className="bp-sub"> · {l.contractType}</span>}
                {l.exitDate && <div className="bp-sub">{gone ? "Sorti le " : "Départ prévu le "}{frDate(l.exitDate)}</div>}
              </td>
              <td>
                <span className={`bp-tag${l.staffed ? " is-on" : ""}`}>{l.staffed ? "Staffé" : "Inter-contrat"}</span>
                {l.missionDays && <div className="bp-sub">structure, {dec(l.missionDays)} j en mission</div>}
              </td>
              <td className="num">{l.salary === null ? <span className="bp-sub">non renseigné</span> : eur(l.salary)}</td>
              <td className="num">
                {eur(l.cost)}
                {l.contractType === "Internship" && <span className="bp-sub"> ×1,4</span>}
                {l.days && <div className="bp-sub">prorata {dec(l.days[0])}/{dec(l.days[1])} j ouvrés hors structure</div>}
              </td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row" colSpan={3}>Total</th>
          <td className="num">{eur(total)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

