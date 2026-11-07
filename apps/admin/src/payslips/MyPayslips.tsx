import { useState } from "react";
import { ArrowUpRight, Download } from "lucide-react";
import { PREFIX, SHORT_MONTHS } from "./PersonPayslips";
import "./payslips.css";

export type OwnPayslip = { id: string; title: string; valid_from: string | null; file_name: string; created_at: string };

/** Period the slip covers, falling back to its filing date. */
const slipDate = (row: OwnPayslip) => row.valid_from ?? row.created_at;
const slipLabel = (row: OwnPayslip) => (row.title.startsWith(PREFIX) ? row.title.slice(PREFIX.length) : row.title);
const slipYear = (row: OwnPayslip) => slipDate(row).slice(0, 4);
const slipShort = (row: OwnPayslip) => SHORT_MONTHS[Number(slipDate(row).slice(5, 7)) - 1] ?? "—";
const periodName = (row: OwnPayslip) => slipLabel(row).replace(/ \(\d+\)$/, "");

/** Employee's own payslips, in the same layout as the HR person page (minus the HR-only re-filing menu). */
export function MyPayslips({ rows, busy, onOpen, onDownload, onDownloadAll }: {
  rows: OwnPayslip[];
  busy: boolean;
  onOpen: (row: OwnPayslip) => void;
  onDownload: (row: OwnPayslip) => void;
  onDownloadAll: (rows: OwnPayslip[]) => void;
}) {
  const [year, setYear] = useState("all");
  const years = [...new Set(rows.map(slipYear))].sort((a, b) => b.localeCompare(a));
  const active = year === "all" || years.includes(year) ? year : "all";
  const visible = rows.filter((row) => active === "all" || slipYear(row) === active);
  const groups = years.filter((y) => active === "all" || y === active).map((y) => ({ year: y, items: visible.filter((row) => slipYear(row) === y) }));
  const summary = active === "all"
    ? `${rows.length} payslip${rows.length === 1 ? "" : "s"}${rows.length > 1 ? ` · ${periodName(rows[rows.length - 1])} → ${periodName(rows[0])}` : ""}`
    : `${visible.length} payslip${visible.length === 1 ? "" : "s"} in ${active}`;

  if (!rows.length) return null;
  return <div className="payslips-person">
    <div className="payslips-person-toolbar">
      <div className="payslips-person-filters">
        {years.length > 1 && <div role="group" aria-label="Filter by year" className="payslips-person-years">
          {[{ id: "all", label: "All", count: rows.length }, ...years.map((y) => ({ id: y, label: y, count: rows.filter((row) => slipYear(row) === y).length }))].map((option) =>
            <button key={option.id} type="button" aria-pressed={active === option.id} onClick={() => setYear(option.id)}>
              {option.label}<span>{option.count}</span>
            </button>)}
        </div>}
        <span className="payslips-person-summary">{summary}</span>
      </div>
      <button type="button" className="payslips-person-all" disabled={busy} onClick={() => onDownloadAll(visible)}>
        <Download size={18} strokeWidth={1.5} aria-hidden="true" /> Download all
      </button>
    </div>
    {groups.map((group) => <div key={group.year} className="payslips-person-group">
      {active === "all" && years.length > 1 && <h3>{group.year}</h3>}
      <ul className="payslips-person-list">
        {group.items.map((row) => <li key={row.id}>
          <span className="payslips-person-badge" aria-hidden="true">{slipShort(row)}</span>
          <span className="payslips-person-main">
            <span className="payslips-person-name">
              <span className="payslips-person-title">{slipLabel(row)}</span>
              {row.id === rows[0].id && <span className="payslips-person-latest">Latest</span>}
            </span>
            <span className="payslips-person-meta">Bulletin de paie · PDF</span>
          </span>
          <span className="payslips-person-actions">
            <button type="button" className="payslips-person-btn" disabled={busy} onClick={() => onOpen(row)}>
              Open <ArrowUpRight size={16} strokeWidth={1.5} aria-hidden="true" />
            </button>
            <button type="button" className="payslips-person-btn icon" disabled={busy} aria-label={`Download ${row.title}`} title="Download" onClick={() => onDownload(row)}>
              <Download size={20} strokeWidth={1.5} aria-hidden="true" />
            </button>
          </span>
        </li>)}
      </ul>
    </div>)}
  </div>;
}
