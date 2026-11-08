import { useState } from "react";
import { ArrowUpRight, Download } from "lucide-react";
import { Button } from "@quicksort-sas/ui";
import { PAYSLIP_LIST, PAYSLIP_TOOLBAR, PAYSLIP_YEAR_TITLE, PREFIX, SHORT_MONTHS, PayslipItem, PayslipYearFilter } from "./PersonPayslips";

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
  return <div className="flex min-w-0 flex-col gap-2">
    <div className={PAYSLIP_TOOLBAR}>
      <div className="flex flex-wrap items-center gap-4">
        {years.length > 1 && <PayslipYearFilter active={active} onPick={setYear}
          options={[{ id: "all", label: "All", count: rows.length }, ...years.map((y) => ({ id: y, label: y, count: rows.filter((row) => slipYear(row) === y).length }))]} />}
        <span className="text-[13px] text-muted-foreground">{summary}</span>
      </div>
      <Button variant="outline" disabled={busy} onClick={() => onDownloadAll(visible)}>
        <Download data-icon="inline-start" aria-hidden="true" /> Download all
      </Button>
    </div>
    {groups.map((group) => <div key={group.year}>
      {active === "all" && years.length > 1 && <h3 className={PAYSLIP_YEAR_TITLE}>{group.year}</h3>}
      <ul className={PAYSLIP_LIST}>
        {group.items.map((row) => <PayslipItem key={row.id} short={slipShort(row)} label={slipLabel(row)} latest={row.id === rows[0].id} latestVariant="pivot">
          <Button variant="ghost" disabled={busy} onClick={() => onOpen(row)}>
            Open <ArrowUpRight data-icon="inline-end" aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="icon" disabled={busy} aria-label={`Download ${row.title}`} title="Download" onClick={() => onDownload(row)}>
            <Download aria-hidden="true" />
          </Button>
        </PayslipItem>)}
      </ul>
    </div>)}
  </div>;
}
