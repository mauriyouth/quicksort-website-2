import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { Aggregate, SalaryLine } from "./actuals";
import { fmt, MONTH_NAMES, pct, type Hypotheses, type PlanResult } from "./model";

/**
 * Drill-down panel for the P&L rows "Salaires consultants chargés" and
 * "Freelances". Closed months list the named people behind the figure;
 * forecast months show the formula plus today's named team, the base the
 * forecast projects from.
 */
export type DetailKind = "sal" | "free";

const TITLES: Record<DetailKind, string> = {
  sal: "Salaires consultants chargés",
  free: "Freelances",
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

        {kind === "sal" ? <SalaryBody {...body} /> : <FreelanceBody {...body} />}
      </div>
    </div>
  );
}

const monthStartOf = (year: number, month: number) => `${year}-${String(month + 1).padStart(2, "0")}-01`;

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
            Salaire mensuel brut en vigueur sur le mois × multiplicateur CJM ({mult}, réglage RH) pour estimer le coût employeur.
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
              </td>
              <td className="num">{l.salary === null ? <span className="bp-sub">non renseigné</span> : eur(l.salary)}</td>
              <td className="num">{eur(l.cost)}</td>
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

