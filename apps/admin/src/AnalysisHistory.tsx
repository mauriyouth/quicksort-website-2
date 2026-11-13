import { useEffect, useState } from "react";
import { useSession } from "@clerk/react";
import { RefreshCw, Search } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  Field,
  FieldLabel,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@quicksort-sas/ui";
import { EmptyState, PageAlerts } from "./ui";
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
    const token = await session?.getToken({ template: "supabase" });
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
  const pages = Math.max(1, Math.ceil(total / 25));
  return <div className="flex flex-col gap-4">
    <PageAlerts error={error} />
    <Card size="sm">
      <CardContent>
        <form className="flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); setPage(0); setFilter(search); setVersion(v => v + 1); }}>
          <Field className="min-w-48 flex-1">
            <FieldLabel htmlFor="history-search">Search candidate, job or file</FieldLabel>
            <InputGroup>
              <InputGroupAddon><Search /></InputGroupAddon>
              <InputGroupInput id="history-search" value={search} maxLength={120} onChange={e => setSearch(e.target.value)} />
            </InputGroup>
          </Field>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>Search</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setVersion(v => v + 1)}><RefreshCw data-icon="inline-start" aria-hidden="true" />Refresh history</Button>
          </div>
        </form>
      </CardContent>
    </Card>
    <p className="m-0 text-sm text-muted-foreground" role="status">{busy ? "Loading…" : `${total} saved evaluations`}</p>
    {!busy && !error && !rows.length && <EmptyState title="No saved evaluations found">Completed scans will appear here, including profiles outside the shortlist.</EmptyState>}
    {rows.length > 0 && <ItemGroup className="gap-2">
      {rows.map(row => <Item variant="outline" key={row.id} render={<article />} className="flex-wrap">
        <ItemContent className="min-w-48">
          <ItemTitle><h2 className="m-0 text-base font-medium">{row.candidate_name}</h2></ItemTitle>
          <ItemDescription>{row.job_title} · {row.file_name} · {new Date(row.created_at).toLocaleString()}</ItemDescription>
        </ItemContent>
        <ItemActions className="flex-wrap">
          <Button size="sm" disabled={busy} onClick={() => void open(row.id)}>Open evaluation</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void downloadSource(row.id)}>Download source CV</Button>
        </ItemActions>
      </Item>)}
    </ItemGroup>}
    <nav className="flex items-center justify-between gap-3" aria-label="History pages">
      <Button variant="outline" size="sm" disabled={busy || page === 0} onClick={() => setPage(p => p - 1)}>Previous</Button>
      <span className="num text-sm text-muted-foreground">Page {page + 1} of {pages}</span>
      <Button variant="outline" size="sm" disabled={busy || (page + 1) * 25 >= total} onClick={() => setPage(p => p + 1)}>Next</Button>
    </nav>
  </div>;
}
