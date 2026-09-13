import { useEffect, useState } from "react";
import { useSession } from "@clerk/react";
import { Heading, Notice } from "@quicksort/candidate-ui";
import { CandidateDetail } from "./CvAnalyzer";
import { evaluationSchema, type CandidateResult } from "./analysis";

type HistoryRow = { id: string; created_at: string; candidate_name: string; job_title: string; file_name: string };
export function AnalysisHistory() {
  const { session } = useSession();
  const [rows, setRows] = useState<HistoryRow[]>([]), [total, setTotal] = useState(0);
  const [page, setPage] = useState(0), [search, setSearch] = useState(""), [filter, setFilter] = useState("");
  const [version, setVersion] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [selected, setSelected] = useState<CandidateResult | null>(null);
  async function request(query: string, signal?: AbortSignal) {
    const token = await session?.getToken();
    if (!token) throw new Error("Sign in again to view history.");
    const response = await fetch(`/api/analysis-history?${query}`, { headers: { Authorization: `Bearer ${token}` }, signal });
    if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("Analysis history is unavailable.");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load history.");
    return data;
  }
  useEffect(() => {
    const controller = new AbortController(); setBusy(true); setError(""); setRows([]);
    void request(`page=${page}&search=${encodeURIComponent(filter)}`, controller.signal).then(data => {
      if (!controller.signal.aborted) { setRows(data.rows); setTotal(data.total); }
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [page, filter, version, session]);
  async function open(id: string) {
    setBusy(true); setError("");
    try {
      const data = await request(`id=${id}`);
      data.report.evaluation = evaluationSchema.parse(data.report.evaluation);
      setSelected({ id: data.id, fileName: data.file_name, report: data.report });
    } catch (e) { setError(e instanceof Error ? e.message : "Could not open report."); }
    finally { setBusy(false); }
  }
  async function downloadSource(id: string) {
    setBusy(true); setError("");
    try {
      const data = await request(`id=${id}&source=1`), cv = data.source_cv;
      const blob = cv.kind === "pdf" ? new Blob([Uint8Array.from(atob(cv.data), c => c.charCodeAt(0))], { type: "application/pdf" }) : new Blob([cv.text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = cv.kind === "pdf" ? data.file_name : "candidate-cv.txt"; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not download CV."); }
    finally { setBusy(false); }
  }
  if (selected) return <CandidateDetail candidate={selected} backLabel="Analysis history" onBack={() => setSelected(null)} />;
  return <div className="cv-workspace">
    <Heading eyebrow="Recruiting workspace" title="Analysis history">Saved evaluations shared with all approved admins.</Heading>
    <Notice error>{error}</Notice>
    <form className="cv-card cv-history-search" onSubmit={e => { e.preventDefault(); setPage(0); setFilter(search); setVersion(v => v + 1); }}>
      <label htmlFor="history-search">Search candidate, job or file</label>
      <input id="history-search" value={search} maxLength={120} onChange={e => setSearch(e.target.value)} />
      <button className="cv-secondary" disabled={busy}>Search</button>
      <button type="button" className="cv-secondary" disabled={busy} onClick={() => setVersion(v => v + 1)}>Refresh history</button>
    </form>
    <p className="cv-muted" role="status">{busy ? "Loading…" : `${total} saved evaluations`}</p>
    {!busy && !error && !rows.length && <div className="cv-card">No saved evaluations found. Completed scans will appear here, including profiles outside the shortlist.</div>}
    {rows.map(row => <article className="cv-card" key={row.id}>
      <h2>{row.candidate_name}</h2><p className="cv-muted">{row.job_title} · {row.file_name} · {new Date(row.created_at).toLocaleString()}</p>
      <div className="cv-inline"><button className="cv-secondary" disabled={busy} onClick={() => void open(row.id)}>Open evaluation</button><button className="cv-secondary" disabled={busy} onClick={() => void downloadSource(row.id)}>Download source CV</button></div>
    </article>)}
    <div className="cv-inline"><button className="cv-secondary" disabled={busy || page === 0} onClick={() => setPage(p => p - 1)}>Previous</button><span>Page {page + 1} of {Math.max(1, Math.ceil(total / 25))}</span><button className="cv-secondary" disabled={busy || (page + 1) * 25 >= total} onClick={() => setPage(p => p + 1)}>Next</button></div>
  </div>;
}
