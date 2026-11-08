import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSession } from "@clerk/react";
import { db, type Job, type Row } from "@quicksort/hr-db";
import { ArrowLeft, ArrowUpRight, ChevronRight, Download, FileText, Info, Upload, X } from "lucide-react";
import { cn } from "cn";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Field,
  FieldDescription,
  FieldLabel,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  NativeSelect,
  NativeSelectOption,
  Progress,
  Spinner,
  Stat,
  StatGroup,
  StatLabel,
  StatUnit,
  StatValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
} from "@quicksort-sas/ui";
import { PageAlerts, PageHeading, linkButton } from "./ui";
import { MAX_BATCH_FILES, MAX_CV_BYTES, evaluationSchema, matchMetrics, topProfiles, type AnalysisRequest, type CandidateResult } from "./analysis";

/**
 * HR → CV analyzer (on @quicksort-sas/ui): the setup card (mode, job, CVs)
 * beside the ranked shortlist, and the candidate detail with its stats,
 * scorecards, interview questions and findings. Request logic is unchanged.
 */
const MAX_PARALLEL_CVS = 5;
type Item = { id: string; requestId?: string; name: string; file?: File; cv?: AnalysisRequest["cv"]; status: "queued" | "analyzing" | "done" | "failed"; error?: string };
export function CvAnalyzer({ jobs, documents, people }: { jobs: Job[]; documents: Row<"candidate_documents">[]; people: Row<"profiles">[] }) {
  const { session } = useSession();
  const [mode, setMode] = useState<"bulk" | "single">("bulk");
  const [runMode, setRunMode] = useState<"bulk" | "single">("bulk");
  const [jobId, setJobId] = useState("");
  const [source, setSource] = useState("upload");
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  async function downloadShortlist() {
    setPdfBusy(true); setError("");
    try { const { downloadEvaluationPdf } = await import("./report-pdf"); await downloadEvaluationPdf(shortlist, true); }
    catch { setError("The PDF could not be created. Please try downloading again."); }
    finally { setPdfBusy(false); }
  }
  const [items, setItems] = useState<Item[]>([]);
  const [shortlist, setShortlist] = useState<CandidateResult[]>([]);
  const [selected, setSelected] = useState<CandidateResult | null>(null);
  const [finished, setFinished] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [unassessable, setUnassessable] = useState(0);
  const [runJob, setRunJob] = useState<Job | null>(null);
  const controller = useRef<AbortController | null>(null);
  const successes = useRef<CandidateResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);
  function addFiles(incoming: File[]) {
    const next = mode === "single" ? incoming.slice(0, 1) : [...files, ...incoming];
    const unique = next.filter((f, i, all) => all.findIndex(other => other.name === f.name && other.size === f.size && other.lastModified === f.lastModified) === i);
    if (unique.length > MAX_BATCH_FILES) { setError(`Choose up to ${MAX_BATCH_FILES} PDFs per batch.`); return; }
    const invalid = unique.find(f => !f.name.toLowerCase().endsWith(".pdf") || !f.size || f.size > MAX_CV_BYTES);
    if (invalid) { setError(`${invalid.name}: choose a non-empty PDF up to 10 MB. No files from this selection were added.`); return; }
    setFiles(unique); setError("");
  }
  function updateItem(id: string, change: Partial<Item>) { setItems(current => current.map(item => item.id === id ? { ...item, ...change } : item)); }
  async function analyze(item: Item, job: Job, signal: AbortSignal) {
    let cv = item.cv;
    // Upload straight to Supabase Storage so the 10 MB PDF never passes through
    // the API body (Vercel caps it at 4.5 MB). The API reads it back from the bucket.
    let uploadedPath = "";
    if (item.file) {
      if (!session?.user.id) throw Object.assign(new Error("Sign in again before continuing."), { status: 401 });
      uploadedPath = `${session.user.id}/${crypto.randomUUID()}.pdf`;
      const uploaded = await db().storage.from("candidate-documents").upload(uploadedPath, item.file, { upsert: false, contentType: "application/pdf" });
      if (uploaded.error) throw new Error("This PDF could not be uploaded. Please try again.");
      cv = { kind: "storage", path: uploadedPath, name: item.name };
    }
    try {
      const token = await session?.getToken({ template: "supabase" });
      if (!token) throw Object.assign(new Error("Sign in again before continuing."), { status: 401 });
      const response = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ jobId: job.id, requestId: item.requestId, expectedUpdatedAt: job.updated_at, cv }), signal: AbortSignal.any([signal, AbortSignal.timeout(115000)]) });
      if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("The analyzer is unavailable. Please retry.");
      const result = await response.json();
      if (!response.ok) throw Object.assign(new Error(result.error || "Analysis failed."), { status: response.status });
      result.evaluation = evaluationSchema.parse(result.evaluation);
      if (result.job.id !== job.id || result.job.updated_at !== job.updated_at) throw Object.assign(new Error("The job changed. Start a new batch."), { status: 409 });
      return { id: item.id, fileName: item.name, report: result } as CandidateResult;
    } finally {
      // Throwaway transfer copy — the evaluation keeps its own source_cv snapshot.
      if (uploadedPath) void db().storage.from("candidate-documents").remove([uploadedPath]).then(({ error }) => { if (error) console.error("Temporary CV upload was not removed:", error.message); });
    }
  }
  async function run(retry = false) {
    if (controller.current) return;
    const job = retry ? runJob : jobs.find(j => j.id === jobId);
    const activeMode = retry ? runMode : mode;
    if (!job) { setError("Select a job to evaluate against."); return; }
    let queue: Item[] = [];
    if (retry) queue = items.filter(i => i.status === "failed" || i.status === "queued").map(i => ({ ...i, status: "queued", error: undefined }));
    else if (mode === "bulk" || source === "upload") queue = files.map((file, i) => ({ id: `${String(i).padStart(4, "0")}-${crypto.randomUUID()}`, name: file.name, file, status: "queued" }));
    else if (source === "text" && text.trim().length >= 50) queue = [{ id: crypto.randomUUID(), name: "Pasted CV", cv: { kind: "text", text }, status: "queued" }];
    else if (source === "document" && documentId) queue = [{ id: crypto.randomUUID(), name: documents.find(d => d.id === documentId)?.name || "Candidate CV", cv: { kind: "document", id: documentId }, status: "queued" }];
    if (!queue.length) { setError("Add a CV before starting. Pasted text must contain at least 50 characters."); return; }
    queue = queue.map(item => ({ ...item, requestId: item.requestId || crypto.randomUUID() }));
    const control = new AbortController(); controller.current = control;
    setBusy(true); setFinished(false); setStopped(false); setError(""); setSelected(null); setRunJob(job);
    setRunMode(activeMode);
    if (!retry) { successes.current = []; setShortlist([]); setUnassessable(0); setItems(queue); }
    else setItems(current => current.map(i => queue.find(q => q.id === i.id) || i));
    let position = 0;
    async function worker() {
      while (!control.signal.aborted && position < queue.length) {
        const item = queue[position++]; updateItem(item.id, { status: "analyzing" });
        try {
          const result = await analyze(item, job!, control.signal);
          if (control.signal.aborted) { updateItem(item.id, { status: "queued" }); break; }
          if (!matchMetrics(result.report.evaluation).assessable) setUnassessable(n => n + 1);
          successes.current = activeMode === "single" ? [result] : topProfiles([...successes.current, result]);
          updateItem(item.id, { status: "done" });
        } catch (e) {
          if (control.signal.aborted) { updateItem(item.id, { status: "queued" }); break; }
          const message = e instanceof Error ? e.message : "Analysis failed. Please retry.";
          updateItem(item.id, { status: "failed", error: message });
          if ([401, 403, 409, 503].includes((e as { status?: number }).status || 0)) { setError(message); control.abort(); }
        }
      }
    }
    try { await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL_CVS, queue.length) }, () => worker())); }
    finally {
      setShortlist([...successes.current]); setStopped(control.signal.aborted); setBusy(false); setFinished(true); controller.current = null;
    }
  }
  const completed = items.filter(i => i.status === "done").length;
  const failed = items.filter(i => i.status === "failed");
  const pending = items.filter(i => i.status === "queued").length;
  if (selected) return <CandidateDetail candidate={selected} onBack={() => setSelected(null)} />;
  const resetInput = () => { if (inputRef.current) inputRef.current.value = ""; };
  return <div className="@container flex flex-col gap-6">
    <PageAlerts error={error} />
    <div className="grid items-start gap-6 @3xl:grid-cols-[20rem_minmax(0,1fr)]">
      <Card role="region" aria-label="Analysis setup">
        <CardHeader>
          <StepTitle step="01">Build your shortlist</StepTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <fieldset disabled={busy} className="m-0 flex min-w-0 flex-col gap-5 border-0 p-0">
            <ToggleGroup
              aria-label="Upload mode"
              className="w-full"
              value={[mode]}
              onValueChange={(v) => { const next = v[0] as "bulk" | "single" | undefined; if (next) { setMode(next); setFiles([]); resetInput(); } }}
            >
              {(["bulk", "single"] as const).map(value => <ToggleGroupItem key={value} value={value} className="flex-1">{value === "bulk" ? "Bulk upload" : "Single CV test"}</ToggleGroupItem>)}
            </ToggleGroup>
            <Field>
              <FieldLabel htmlFor="cv-job">Job to evaluate against</FieldLabel>
              <NativeSelect id="cv-job" className="w-full" value={jobId} onChange={e => setJobId(e.target.value)}>
                <NativeSelectOption value="">Select a job</NativeSelectOption>
                {jobs.map(j => <NativeSelectOption key={j.id} value={j.id}>{j.title}{j.published ? "" : " · unpublished"}</NativeSelectOption>)}
              </NativeSelect>
              {!jobs.length && <FieldDescription>Create a job post to get started.</FieldDescription>}
            </Field>
            {mode === "single" && <Field>
              <FieldLabel htmlFor="cv-source">Candidate CV</FieldLabel>
              <NativeSelect id="cv-source" className="w-full" value={source} onChange={e => setSource(e.target.value)}>
                <NativeSelectOption value="upload">Upload PDF</NativeSelectOption>
                <NativeSelectOption value="text">Paste CV text</NativeSelectOption>
                <NativeSelectOption value="document">Existing candidate document</NativeSelectOption>
              </NativeSelect>
            </Field>}
            {(mode === "bulk" || source === "upload") && <>
              <div
                className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border bg-muted/40 px-4 py-6 text-center has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background"
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); if (!busy) addFiles(Array.from(e.dataTransfer.files)); }}
              >
                <Upload className="size-6 text-muted-foreground" aria-hidden="true" />
                <div className="flex flex-col gap-1">
                  <strong className="text-sm font-medium">{mode === "bulk" ? "Drop your CVs here" : "Drop one CV here"}</strong>
                  <span className="text-xs text-muted-foreground">PDF · up to 10 MB each{mode === "bulk" ? ` · ${MAX_BATCH_FILES} files per batch` : ""}</span>
                </div>
                <label htmlFor="cv-file" className={cn(linkButton({ variant: "outline", size: "sm" }), "cursor-pointer", busy && "pointer-events-none opacity-50")}>{mode === "bulk" ? "Choose PDFs" : "Choose PDF"}</label>
                <input ref={inputRef} id="cv-file" className="sr-only" aria-label={mode === "bulk" ? "Upload CV PDFs" : "Upload one CV PDF"} type="file" accept=".pdf,application/pdf" multiple={mode === "bulk"} onChange={e => { addFiles(Array.from(e.target.files || [])); e.target.value = ""; }} />
              </div>
              {files.length > 0 && <div className="flex flex-col gap-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <strong className="font-medium">{files.length} {files.length === 1 ? "CV" : "CVs"} ready</strong>
                  <Button type="button" variant="ghost" size="xs" onClick={() => setFiles([])}>Clear</Button>
                </div>
                <ul className="m-0 flex max-h-48 list-none flex-col divide-y divide-border overflow-auto p-0">
                  {files.map((file, i) => <li className="flex items-center gap-2 py-1.5 text-muted-foreground" key={`${file.name}-${i}`}>
                    <FileText className="size-4 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{file.name}</span>
                    <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove ${file.name}`} onClick={() => setFiles(current => current.filter((_, n) => n !== i))}><X /></Button>
                  </li>)}
                </ul>
              </div>}
            </>}
            {mode === "single" && source === "text" && <Field>
              <FieldLabel htmlFor="cv-text">CV text</FieldLabel>
              <Textarea id="cv-text" className="min-h-36" maxLength={60000} value={text} onChange={e => setText(e.target.value)} placeholder="Paste experience, skills and qualifications…" />
            </Field>}
            {mode === "single" && source === "document" && <Field>
              <FieldLabel htmlFor="cv-document">Available PDFs</FieldLabel>
              <NativeSelect id="cv-document" className="w-full" value={documentId} onChange={e => setDocumentId(e.target.value)}>
                <NativeSelectOption value="">Select a CV</NativeSelectOption>
                {documents.filter(d => d.name.toLowerCase().endsWith(".pdf")).map(d => <NativeSelectOption key={d.id} value={d.id}>{people.find(p => p.id === d.candidate_id)?.full_name || "Candidate"} · {d.name}</NativeSelectOption>)}
              </NativeSelect>
            </Field>}
            <Button variant="pivot" size="lg" className="w-full" type="button" disabled={!jobs.length} onClick={() => void run()}>
              {busy ? "Evaluating…" : mode === "bulk" ? "Analyze batch" : "Analyze candidate"}<ArrowUpRight data-icon="inline-end" aria-hidden="true" />
            </Button>
          </fieldset>
          <p className="m-0 text-xs text-muted-foreground">The top 10 profiles appear here. Every completed evaluation is saved in Analysis history for all admins. Keep this page open until the scan finishes.</p>
          {busy && <Button variant="outline" onClick={() => controller.current?.abort()}>Stop analysis</Button>}
        </CardContent>
      </Card>
      <section className="flex min-w-0 flex-col gap-4" aria-label="Selected profiles">
        <div className="flex items-center gap-3">
          <StepTitle step="02">Selected profiles</StepTitle>
          <Badge variant="outline" className="ml-auto">Top {Math.min(10, shortlist.length) || 10}</Badge>
        </div>
        {items.length > 0 && <Card size="sm" role="status" aria-live="polite">
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <strong className="text-sm font-medium">{busy ? `Evaluating ${completed + failed.length} of ${items.length}` : stopped || failed.length ? "Partial evaluation" : "Evaluation complete"}</strong>
              <span className="num text-xs text-muted-foreground">{completed} analyzed{failed.length ? ` · ${failed.length} failed` : ""}</span>
            </div>
            <Progress value={completed + failed.length} max={items.length} aria-label="Evaluation progress" />
            <p className="m-0 text-xs text-muted-foreground">{runJob?.title}{busy ? " · Preparing the shortlist after all files are evaluated." : unassessable ? ` · ${unassessable} CV(s) had insufficient evidence to rank.` : ""}</p>
          </CardContent>
        </Card>}
        {busy ? <Empty className="min-h-64 border border-border">
          <EmptyHeader>
            <EmptyMedia><Spinner className="size-6" /></EmptyMedia>
            <EmptyTitle>Reading the evidence.</EmptyTitle>
            <EmptyDescription>Checking skills, experience and job requirements across your CVs.</EmptyDescription>
          </EmptyHeader>
        </Empty> : shortlist.length ? <>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <p className="m-0 text-sm text-muted-foreground">{shortlist.length} profiles{stopped || failed.length ? " from completed evaluations" : " selected"} · Click a profile to review</p>
            <Button variant="outline" size="sm" disabled={pdfBusy} onClick={() => void downloadShortlist()}><Download data-icon="inline-start" aria-hidden="true" />{pdfBusy ? "Creating PDF…" : "Download shortlist"}</Button>
          </div>
          <p className="m-0 flex gap-2 text-xs text-muted-foreground"><Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /><span>Documented match = points evidenced across six equal categories. Unknowns earn no evidence points; they are not proven weaknesses. Equal scores retain upload order. Human review decides next steps.</span></p>
          <ItemGroup className="gap-2">{shortlist.map((candidate, index) => {
            const metrics = matchMetrics(candidate.report.evaluation);
            return <Item key={candidate.id} variant="outline" className="cursor-pointer text-left hover:bg-muted/50" render={<button type="button" onClick={() => { setSelected(candidate); window.scrollTo({ top: 0 }); }} />}>
              <ItemMedia className="num w-6 text-sm text-muted-foreground">{String(index + 1).padStart(2, "0")}</ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle className="text-base">{candidate.report.evaluation.candidateName === "Unnamed candidate" ? candidate.fileName : candidate.report.evaluation.candidateName}</ItemTitle>
                <ItemDescription>{candidate.report.evaluation.headline}</ItemDescription>
                <span className="truncate text-xs text-muted-foreground">{candidate.fileName}</span>
              </ItemContent>
              <ItemActions className="flex-col items-end gap-0.5 text-right">
                <strong className="num text-2xl font-medium">{metrics.assessable ? `${metrics.score}%` : "—"}</strong>
                <small className="text-[10px] text-muted-foreground">documented match</small>
              </ItemActions>
              <ArrowUpRight className="hidden size-4 text-muted-foreground @md:block" aria-hidden="true" />
            </Item>;
          })}</ItemGroup>
        </> : <Empty className="min-h-64 border border-border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><FileText /></EmptyMedia>
            <EmptyTitle>{finished ? "No profiles ready to shortlist" : "Your next shortlist starts here"}</EmptyTitle>
            <EmptyDescription>{finished ? "Retry incomplete files, or provide more readable CVs with relevant experience." : "Choose a job and upload your CVs. We’ll surface up to 10 profiles with the strongest documented match."}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row flex-wrap justify-center gap-2">
            <Badge variant="outline">Evidence-based scores</Badge>
            <Badge variant="outline">Interview preparation</Badge>
          </EmptyContent>
        </Empty>}
        {!busy && (failed.length > 0 || pending > 0) && <Card size="sm" role="region" aria-label="Files needing attention">
          <CardHeader><CardTitle>Files needing attention</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3">
            {failed.length > 0 && <ul className="m-0 flex list-none flex-col divide-y divide-border p-0 text-sm">
              {failed.map(item => <li className="flex flex-col gap-0.5 py-2" key={item.id}><strong className="font-medium">{item.name}</strong><span className="text-destructive">{item.error}</span></li>)}
            </ul>}
            {pending > 0 && <p className="m-0 text-sm text-muted-foreground">{pending} files were not completed.</p>}
            <div><Button variant="outline" onClick={() => void run(true)}>Retry incomplete files</Button></div>
          </CardContent>
        </Card>}
      </section>
    </div>
  </div>;
}

/** Section title led by its mono step number ("01", "02"). */
function StepTitle({ step, children }: { step: string; children: ReactNode }) {
  return <h2 className="m-0 flex items-center gap-2.5 font-heading text-lg font-medium tracking-tight">
    <span className="num inline-flex size-6 items-center justify-center rounded-sm border border-border text-xs text-muted-foreground" aria-hidden="true">{step}</span>
    {children}
  </h2>;
}

/** Native details/summary styled as a disclosure row. */
const DISCLOSURE = "group/disclosure [&>summary]:flex [&>summary]:cursor-pointer [&>summary]:list-none [&>summary]:items-center [&>summary]:gap-1.5 [&>summary::-webkit-details-marker]:hidden";
const QUOTE = "m-0 border-l-2 border-border pl-3 text-xs leading-relaxed text-muted-foreground";

export function CandidateDetail({ candidate, onBack, backLabel = "Selected profiles" }: { candidate: CandidateResult; onBack: () => void; backLabel?: string }) {
  const [tab, setTab] = useState("overview");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState("");
  async function downloadReport() {
    setPdfBusy(true); setPdfError("");
    try { const { downloadEvaluationPdf } = await import("./report-pdf"); await downloadEvaluationPdf([candidate]); }
    catch { setPdfError("The PDF could not be created. Please try downloading again."); }
    finally { setPdfBusy(false); }
  }
  const [score, setScore] = useState<number | null>(null);
  const e = candidate.report.evaluation, metrics = matchMetrics(e);
  return <div className="@container flex max-w-6xl flex-col gap-6">
    <Button variant="ghost" size="sm" className="-ml-2 self-start" onClick={onBack}><ArrowLeft data-icon="inline-start" aria-hidden="true" />{backLabel}</Button>
    <PageHeading
      eyebrow={candidate.report.job.title}
      title={e.candidateName === "Unnamed candidate" ? candidate.fileName : e.candidateName}
      action={<Button variant="outline" disabled={pdfBusy} onClick={() => void downloadReport()}><Download data-icon="inline-start" aria-hidden="true" />{pdfBusy ? "Creating PDF…" : "Download report"}</Button>}
    >
      {e.headline}
    </PageHeading>
    <PageAlerts error={pdfError} />
    <Card size="sm">
      <CardContent>
        <StatGroup>
          <Stat size="sm" pivot><StatValue>{metrics.assessable ? <>{metrics.score}<StatUnit>%</StatUnit></> : "Unknown"}</StatValue><StatLabel>Documented match</StatLabel></Stat>
          <Stat size="sm"><StatValue>{metrics.coverage}<StatUnit>%</StatUnit></StatValue><StatLabel>Evidence coverage</StatLabel></Stat>
          <Stat size="sm"><StatValue className="capitalize">{e.confidence}</StatValue><StatLabel>Evidence confidence</StatLabel></Stat>
        </StatGroup>
      </CardContent>
    </Card>
    <Tabs value={tab} onValueChange={(next) => setTab(String(next))} className="gap-6">
      <TabsList variant="line" aria-label="Candidate details" className="h-10 w-full justify-start gap-5 overflow-x-auto border-b border-border">
        {[["overview", "Overview"], ["interview", "Interview questions"], ["assessment", "Strengths & concerns"]].map(([id, label]) => <TabsTrigger key={id} value={id} className="flex-none group-data-horizontal/tabs:after:bottom-0">{label}</TabsTrigger>)}
      </TabsList>
      <TabsContent value="overview" className="grid items-start gap-4 @3xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Evaluation summary</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="m-0 leading-relaxed">{e.summary}</p>
            <p className="m-0 text-xs text-muted-foreground">{candidate.fileName} · {new Date(candidate.report.analyzedAt).toLocaleDateString()} · Human review required</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Scorecards</CardTitle><CardDescription>Click for evidence</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-4">
            {e.scorecards.map((s, i) => <div key={s.criterion} className="flex flex-col gap-2">
              <button
                type="button"
                className="grid w-full cursor-pointer grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1.5 rounded-sm text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                aria-expanded={score === i}
                aria-controls={`cv-evidence-${i}`}
                aria-label={`${s.criterion}: ${s.score === null ? "Unknown" : `${s.score} out of 5`}. Show evidence`}
                onClick={() => setScore(score === i ? null : i)}
              >
                <span className="flex items-center gap-1.5">{s.criterion}<Info className="size-3.5 text-muted-foreground" aria-hidden="true" /></span>
                <strong className="num text-xs font-medium">{s.score === null ? "Unknown" : `${s.score}/5`}</strong>
                <span className="col-span-full h-1 overflow-hidden rounded-[1px] bg-border dark:bg-input/70"><span className="block h-full bg-primary" style={{ width: `${(s.score || 0) * 20}%` }} /></span>
              </button>
              {score === i && <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs leading-relaxed" id={`cv-evidence-${i}`} role="note">
                <strong className="font-medium">{s.requirement}</strong>
                <blockquote className={QUOTE}>{s.evidence}</blockquote>
                <p className="m-0">{s.rationale}</p>
              </div>}
            </div>)}
            <p className="m-0 text-xs text-muted-foreground">0 mismatch · 3 meets · 5 exceptional. Unknown means not assessable.</p>
          </CardContent>
        </Card>
      </TabsContent>
      <TabsContent value="interview" className="grid items-start gap-4 @3xl:grid-cols-2">
        {[["Validate claimed experience", "Questions about experience the candidate mentions in the CV.", e.experienceQuestions], ["Explore gaps against the job", "Requirements that are missing or unproven in the CV.", e.gapQuestions]].map(([title, subtitle, questions]) => <Card key={String(title)}>
          <CardHeader><CardTitle>{String(title)}</CardTitle><CardDescription>{String(subtitle)}</CardDescription></CardHeader>
          <CardContent className="flex flex-col divide-y divide-border">
            {(questions as typeof e.experienceQuestions).length === 0 && <p className="m-0 text-sm">No supported questions identified in this category.</p>}
            {(questions as typeof e.experienceQuestions).map((q, i) => <div className="flex gap-3 py-4 first:pt-0 last:pb-0" key={i}>
              <span className="num inline-flex size-6 shrink-0 items-center justify-center rounded-sm border border-border text-xs text-muted-foreground" aria-hidden="true">{i + 1}</span>
              <div className="flex min-w-0 flex-col gap-2">
                <h3 className="m-0 text-sm font-medium leading-snug">{q.question}</h3>
                <p className="m-0 text-sm text-muted-foreground">{q.context}</p>
                <details className={DISCLOSURE}>
                  <summary className="text-xs font-medium underline-offset-4 hover:underline"><ChevronRight className="size-3.5 transition-transform group-open/disclosure:rotate-90" aria-hidden="true" />What to listen for</summary>
                  <p className="m-0 mt-2 text-sm">{q.listenFor}</p>
                </details>
                <ReviewedCheckbox id={`cv-reviewed-${String(title).split(" ")[0]}-${i}`} />
              </div>
            </div>)}
          </CardContent>
        </Card>)}
      </TabsContent>
      <TabsContent value="assessment" className="grid items-start gap-4 @3xl:grid-cols-2">
        {([["Advantages", e.advantages], ["Gaps & disadvantages", e.disadvantages], ["Risks to verify", e.risks], ["Other observations", e.aspectCritiques]] as const).map(([title, findings]) => <Card key={title}>
          <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
          <CardContent className="flex flex-col divide-y divide-border">
            {!findings.length && <p className="m-0 text-sm text-muted-foreground">No supported findings identified.</p>}
            {findings.map((f, i) => <details className={cn(DISCLOSURE, "py-3 first:pt-0 last:pb-0")} key={i}>
              <summary className="text-sm font-medium"><ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open/disclosure:rotate-90" aria-hidden="true" />{f.aspect}</summary>
              <div className="mt-2 flex flex-col gap-2 pl-5.5 text-sm">
                <p className="m-0">{f.assessment}</p>
                <blockquote className={QUOTE}>{f.evidence}</blockquote>
                <p className="m-0 text-muted-foreground">Verify: {f.followUp}</p>
              </div>
            </details>)}
          </CardContent>
        </Card>)}
      </TabsContent>
    </Tabs>
  </div>;
}

/** Interviewer's own tick, kept only on screen. */
function ReviewedCheckbox({ id }: { id: string }) {
  return <Field orientation="horizontal" className="mt-1 w-auto gap-2">
    <Checkbox id={id} />
    <FieldLabel htmlFor={id} className="text-xs font-normal text-muted-foreground">Reviewed in interview</FieldLabel>
  </Field>;
}
