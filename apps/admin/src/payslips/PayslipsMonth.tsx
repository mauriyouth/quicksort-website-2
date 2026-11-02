import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Download, ExternalLink, Upload } from "lucide-react";
import { Notice } from "@quicksort/hr-ui";
import { errorMessage } from "@quicksort/hr-db";
import { downloadDocument, fetchDocumentFile, previewDocument } from "../documents/client";
import { loadPayroll } from "./client";
import { latestPeriod, payrollMonth, shiftPeriod, type FiledPayslipDoc, type StaffEmployment } from "./month";
import "../documents/documents.css";
import "../hr/workspace.css";
import "./payslips.css";

/**
 * HR → Payslips: one month of payroll. Everyone employed that month is listed,
 * filed or missing; clicking a payslip previews it alongside. Import lives on its own route.
 */
const MONTHS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const thisMonth = () => new Date().toISOString().slice(0, 7);

export function PayslipsMonth() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<{ staff: StaffEmployment[]; payslips: FiledPayslipDoc[] } | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<{ doc: FiledPayslipDoc; name: string } | null>(null);

  useEffect(() => {
    let live = true;
    loadPayroll().then((d) => live && setData(d), (e) => live && setError(errorMessage(e)));
    return () => { live = false; };
  }, []);

  const asked = params.get("month") ?? "";
  const period = PERIOD.test(asked) ? asked : (data && latestPeriod(data.payslips)) || thisMonth();
  const setPeriod = (next: string) => { setSelected(null); setParams({ month: next }, { replace: true }); };

  const rows = useMemo(() => (data ? payrollMonth(period, data.staff, data.payslips) : []), [data, period]);
  const shown = rows.filter((r) => !filter.trim() || `${r.name} ${r.matricule}`.toLowerCase().includes(filter.trim().toLowerCase()));
  const filed = rows.filter((r) => r.payslips.length > 0).length;
  const missing = rows.filter((r) => r.employed && r.payslips.length === 0).length;

  const years = useMemo(() => {
    const first = data?.payslips.reduce((min, p) => Math.min(min, Number(p.valid_from.slice(0, 4))), Number(period.slice(0, 4))) ?? Number(period.slice(0, 4));
    const last = Math.max(Number(thisMonth().slice(0, 4)), Number(period.slice(0, 4)));
    return Array.from({ length: last - first + 1 }, (_, i) => last - i);
  }, [data, period]);
  const [year, month] = period.split("-");

  return (
    <div className="docs-page payslips-page">
      <header className="docs-head payslips-head">
        <div>
          <h1>Payslips</h1>
          <p className="projects-lede">Each month's payroll: who was paid, who is missing, and every payslip at a glance.</p>
        </div>
        <Link to="/hr/payslips/import" className="btn secondary"><Upload size={15} aria-hidden="true" /> Import</Link>
      </header>
      <Notice error>{error}</Notice>

      <div className="payslips-toolbar">
        <div className="payslips-period">
          <button type="button" className="doc-icon-button" aria-label="Previous month" onClick={() => setPeriod(shiftPeriod(period, -1))}><ChevronLeft size={16} /></button>
          <select aria-label="Month" value={month} onChange={(e) => setPeriod(`${year}-${e.target.value}`)}>
            {MONTHS.map((m, i) => <option key={m} value={String(i + 1).padStart(2, "0")}>{m}</option>)}
          </select>
          <select aria-label="Year" value={year} onChange={(e) => setPeriod(`${e.target.value}-${month}`)}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <button type="button" className="doc-icon-button" aria-label="Next month" onClick={() => setPeriod(shiftPeriod(period, 1))}><ChevronRight size={16} /></button>
        </div>
        <input type="search" className="payslips-filter" placeholder="Filter by name or matricule" aria-label="Filter by name or matricule"
          value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>

      {data && (
        <p className="payslips-summary" role="status">
          {rows.filter((r) => r.employed).length} employed · <strong>{filed} filed</strong>
          {missing > 0 && <> · <span className="payslips-missing">{missing} missing</span></>}
        </p>
      )}

      <div className={`payslips-month${selected ? " has-preview" : ""}`}>
        <ul className="payslips-month-list" aria-label={`Payslips ${MONTHS[Number(month) - 1]} ${year}`}>
          {!data && !error && <li className="payslips-empty">Loading payslips…</li>}
          {data && shown.length === 0 && <li className="payslips-empty">{rows.length ? "Nobody matches this filter." : "Nobody was employed this month."}</li>}
          {shown.map((r) => (
            <li key={r.personId} className={r.payslips.length === 0 && r.employed ? "is-missing" : ""}>
              <Link to={`/hr/people/${r.personId}/employments`} className="payslips-month-person">{r.name}</Link>
              <span className="payslips-month-matricule">{r.matricule && !r.matricule.startsWith("QS-") ? r.matricule : "—"}</span>
              <span className="payslips-month-docs">
                {r.payslips.length === 0
                  ? <span className={`hr-tag${r.employed ? " urgent" : ""}`}>Missing</span>
                  : r.payslips.map((doc, i) => (
                    <button key={doc.id} type="button" aria-pressed={selected?.doc.id === doc.id}
                      className={`payslips-month-open${selected?.doc.id === doc.id ? " on" : ""}`}
                      onClick={() => setSelected({ doc, name: r.name })}>
                      {r.payslips.length > 1 ? `View (${i + 1})` : "View"}
                    </button>
                  ))}
              </span>
            </li>
          ))}
        </ul>
        {selected && <PayslipPreview doc={selected.doc} name={selected.name} onClose={() => setSelected(null)} />}
      </div>
    </div>
  );
}

function PayslipPreview({ doc, name, onClose }: { doc: FiledPayslipDoc; name: string; onClose: () => void }) {
  const [file, setFile] = useState<{ url: string } | { link: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const panel = useRef<HTMLElement>(null);

  // On narrow screens the preview stacks under the list; bring it into view.
  useEffect(() => { panel.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }); }, [doc.id]);

  useEffect(() => {
    let live = true;
    let objectUrl: string | null = null;
    setLoading(true); setFile(null); setError("");
    fetchDocumentFile(doc)
      .then((result) => {
        if (!live) return;
        if (result instanceof Blob) { objectUrl = URL.createObjectURL(result); setFile({ url: objectUrl }); }
        else setFile({ link: result.link });
      })
      .catch((e) => live && setError(errorMessage(e)))
      .finally(() => live && setLoading(false));
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [doc.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section ref={panel} className="payslips-preview" aria-label={`Preview of ${doc.title} for ${name}`}>
      <div className="payslips-preview-bar">
        <div>
          <strong>{name}</strong>
          <span>{doc.title}</span>
        </div>
        <span className="payslips-preview-tools">
          <button type="button" className="doc-icon-button" aria-label="Download" onClick={() => void downloadDocument(doc).catch((e) => setError(errorMessage(e)))}><Download size={15} /></button>
          <button type="button" className="doc-icon-button" aria-label="Open in a new tab" onClick={() => void previewDocument(doc).catch((e) => setError(errorMessage(e)))}><ExternalLink size={15} /></button>
          <button type="button" className="hr-emp-ghost" onClick={onClose}>Close</button>
        </span>
      </div>
      <div className="payslips-preview-stage">
        {loading && <p className="payslips-empty">Loading the payslip…</p>}
        {error && <p role="alert" className="payslips-error">{error}</p>}
        {file && "url" in file && <iframe title={`${doc.title} — ${name}`} src={file.url} />}
        {file && "link" in file && <p className="payslips-empty">This file is too large to preview inline. <a href={file.link} target="_blank" rel="noopener noreferrer">Open it</a>.</p>}
      </div>
    </section>
  );
}
