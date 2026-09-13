import { useEffect, useRef, useState } from "react";
import { useSession } from "@clerk/react";
import { type Job, type Row } from "@quicksort/candidate-db";
import { Heading, Notice } from "@quicksort/candidate-ui";
import { ArrowLeft, ArrowUpRight, Check, FileText, Info, Upload, X } from "lucide-react";
import { MAX_BATCH_FILES, MAX_CV_BYTES, evaluationSchema, matchMetrics, topProfiles, type AnalysisRequest, type CandidateResult } from "./analysis";
import "./analyzer.css";

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
    if (invalid) { setError(`${invalid.name}: choose a non-empty PDF up to 3 MB. No files from this selection were added.`); return; }
    setFiles(unique); setError("");
  }
  function updateItem(id: string, change: Partial<Item>) { setItems(current => current.map(item => item.id === id ? { ...item, ...change } : item)); }
  async function analyze(item: Item, job: Job, signal: AbortSignal) {
    let cv = item.cv;
    if (item.file) {
      const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = () => reject(new Error("This PDF could not be read.")); reader.readAsDataURL(item.file!); });
      cv = { kind: "pdf", data, name: item.name };
    }
    const token = await session?.getToken();
    if (!token) throw Object.assign(new Error("Sign in again before continuing."), { status: 401 });
    const response = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ jobId: job.id, requestId: item.requestId, expectedUpdatedAt: job.updated_at, cv }), signal: AbortSignal.any([signal, AbortSignal.timeout(115000)]) });
    if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("The analyzer is unavailable. Please retry.");
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error || "Analysis failed."), { status: response.status });
    result.evaluation = evaluationSchema.parse(result.evaluation);
    if (result.job.id !== job.id || result.job.updated_at !== job.updated_at) throw Object.assign(new Error("The job changed. Start a new batch."), { status: 409 });
    return { id: item.id, fileName: item.name, report: result } as CandidateResult;
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
  return <div className="cv-workspace">
    <Heading eyebrow="Recruiting workspace" title="CV analyzer">From a stack of CVs to a focused shortlist.</Heading>
    <Notice error>{error}</Notice>
    <div className="cv-workbench">
      <section className="cv-card cv-setup" aria-label="Analysis setup">
        <div className="cv-section-heading"><span className="cv-step">01</span><h2>Build your shortlist</h2></div>
        <fieldset disabled={busy}>
          <div className="cv-mode" aria-label="Upload mode">{(["bulk", "single"] as const).map(value => <button type="button" key={value} aria-pressed={mode === value} onClick={() => { setMode(value); setFiles([]); if (inputRef.current) inputRef.current.value = ""; }}>{value === "bulk" ? "Bulk upload" : "Single CV test"}</button>)}</div>
          <label htmlFor="cv-job">Job to evaluate against</label><select id="cv-job" value={jobId} onChange={e => setJobId(e.target.value)}><option value="">Select a job</option>{jobs.map(j => <option key={j.id} value={j.id}>{j.title}{j.published ? "" : " · unpublished"}</option>)}</select>
          {!jobs.length && <p className="cv-muted">Create a job post to get started.</p>}
          {mode === "single" && <><label htmlFor="cv-source">Candidate CV</label><select id="cv-source" value={source} onChange={e => setSource(e.target.value)}><option value="upload">Upload PDF</option><option value="text">Paste CV text</option><option value="document">Existing candidate document</option></select></>}
          {(mode === "bulk" || source === "upload") && <>
            <div className="cv-dropzone" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!busy) addFiles(Array.from(e.dataTransfer.files)); }}>
              <Upload size={24} /><strong>{mode === "bulk" ? "Drop your CVs here" : "Drop one CV here"}</strong><span className="cv-muted">PDF · up to 3 MB each{mode === "bulk" ? ` · ${MAX_BATCH_FILES} files per batch` : ""}</span>
              <label className="cv-file-button" htmlFor="cv-file">{mode === "bulk" ? "Choose PDFs" : "Choose PDF"}</label><input ref={inputRef} id="cv-file" aria-label={mode === "bulk" ? "Upload CV PDFs" : "Upload one CV PDF"} type="file" accept=".pdf,application/pdf" multiple={mode === "bulk"} onChange={e => { addFiles(Array.from(e.target.files || [])); e.target.value = ""; }} />
            </div>
            {files.length > 0 && <div className="cv-files"><div className="cv-inline"><strong>{files.length} {files.length === 1 ? "CV" : "CVs"} ready</strong><button type="button" className="cv-text-button" onClick={() => setFiles([])}>Clear</button></div><div className="cv-file-list">{files.map((file, i) => <div className="cv-file-row" key={`${file.name}-${i}`}><FileText size={15} /><span>{file.name}</span><button type="button" aria-label={`Remove ${file.name}`} onClick={() => setFiles(current => current.filter((_, n) => n !== i))}><X size={14} /></button></div>)}</div></div>}
          </>}
          {mode === "single" && source === "text" && <><label htmlFor="cv-text">CV text</label><textarea id="cv-text" rows={6} maxLength={60000} value={text} onChange={e => setText(e.target.value)} placeholder="Paste experience, skills and qualifications…" /></>}
          {mode === "single" && source === "document" && <><label htmlFor="cv-document">Available PDFs</label><select id="cv-document" value={documentId} onChange={e => setDocumentId(e.target.value)}><option value="">Select a CV</option>{documents.filter(d => d.name.toLowerCase().endsWith(".pdf")).map(d => <option key={d.id} value={d.id}>{people.find(p => p.id === d.candidate_id)?.full_name || "Candidate"} · {d.name}</option>)}</select></>}
          <button className="cv-primary cv-start" type="button" disabled={!jobs.length} onClick={() => void run()}>{busy ? "Evaluating…" : mode === "bulk" ? "Analyze batch" : "Analyze candidate"}<ArrowUpRight size={17} /></button>
        </fieldset>
        <p className="cv-footnote">The top 10 profiles appear here. Every completed evaluation is saved in Analysis history for all admins. Keep this page open until the scan finishes.</p>
        {busy && <button className="cv-secondary" onClick={() => controller.current?.abort()}>Stop analysis</button>}
      </section>
      <section className="cv-results" aria-label="Selected profiles">
        <div className="cv-section-heading"><span className="cv-step">02</span><h2>Selected profiles</h2><span className="cv-badge">Top {Math.min(10, shortlist.length) || 10}</span></div>
        {items.length > 0 && <div className="cv-card cv-progress" role="status" aria-live="polite"><div className="cv-inline"><strong>{busy ? `Evaluating ${completed + failed.length} of ${items.length}` : stopped || failed.length ? "Partial evaluation" : "Evaluation complete"}</strong><span className="cv-muted">{completed} analyzed{failed.length ? ` · ${failed.length} failed` : ""}</span></div><progress max={items.length} value={completed + failed.length} /><p className="cv-muted">{runJob?.title}{busy ? " · Preparing the shortlist after all files are evaluated." : unassessable ? ` · ${unassessable} CV(s) had insufficient evidence to rank.` : ""}</p></div>}
        {busy ? <div className="cv-card cv-empty"><div className="cv-orbit" /><h3>Reading the evidence.</h3><p>Checking skills, experience and job requirements across your CVs.</p></div> : shortlist.length ? <>
          <div className="cv-shortlist-toolbar"><p className="cv-muted">{shortlist.length} profiles{stopped || failed.length ? " from completed evaluations" : " selected"} · Click a profile to review</p><button className="cv-text-button" disabled={pdfBusy} onClick={() => void downloadShortlist()}>{pdfBusy ? "Creating PDF…" : "Download shortlist"}</button></div>
          <div className="cv-ranking-help"><Info size={14} /><span>Documented match = points evidenced across six equal categories. Unknowns earn no evidence points; they are not proven weaknesses. Equal scores retain upload order. Human review decides next steps.</span></div>
          <div className="cv-shortlist">{shortlist.map((candidate, index) => { const metrics = matchMetrics(candidate.report.evaluation); return <button className="cv-profile" key={candidate.id} onClick={() => { setSelected(candidate); window.scrollTo({ top: 0 }); }}><span className="cv-rank">{String(index + 1).padStart(2, "0")}</span><span className="cv-profile-copy"><strong>{candidate.report.evaluation.candidateName === "Unnamed candidate" ? candidate.fileName : candidate.report.evaluation.candidateName}</strong><span>{candidate.report.evaluation.headline}</span><small>{candidate.fileName}</small></span><span className="cv-match"><strong>{metrics.assessable ? `${metrics.score}%` : "—"}</strong><small>documented match</small></span><ArrowUpRight size={18} /></button>; })}</div>
        </> : <div className="cv-card cv-empty"><FileText size={32} /><h3>{finished ? "No profiles ready to shortlist" : "Your next shortlist starts here"}</h3><p>{finished ? "Retry incomplete files, or provide more readable CVs with relevant experience." : "Choose a job and upload your CVs. We’ll surface up to 10 profiles with the strongest documented match."}</p><div className="cv-empty-tags"><span>Evidence-based scores</span><span>Interview preparation</span></div></div>}
        {!busy && (failed.length > 0 || pending > 0) && <div className="cv-card"><h3>Files needing attention</h3>{failed.map(item => <p className="cv-file-error" key={item.id}><strong>{item.name}</strong><span>{item.error}</span></p>)}{pending > 0 && <p className="cv-muted">{pending} files were not completed.</p>}<button className="cv-secondary" onClick={() => void run(true)}>Retry incomplete files</button></div>}
      </section>
    </div>
  </div>;
}
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
  return <div className="cv-workspace cv-detail">
    <button className="cv-back" onClick={onBack}><ArrowLeft size={16} />{backLabel}</button>
    <div className="cv-detail-heading"><div><p className="cv-eyebrow">{candidate.report.job.title}</p><h1>{e.candidateName === "Unnamed candidate" ? candidate.fileName : e.candidateName}</h1><p className="cv-muted">{e.headline}</p></div><button className="cv-secondary" disabled={pdfBusy} onClick={() => void downloadReport()}>{pdfBusy ? "Creating PDF…" : "Download report"}</button></div>
    <Notice error>{pdfError}</Notice>
    <div className="cv-detail-stats"><div><strong>{metrics.assessable ? `${metrics.score}%` : "Unknown"}</strong><span>Documented match</span></div><div><strong>{metrics.coverage}%</strong><span>Evidence coverage</span></div><div><strong>{e.confidence}</strong><span>Evidence confidence</span></div></div>
    <div className="cv-tabs" role="tablist" aria-label="Candidate details">{[["overview", "Overview"], ["interview", "Interview questions"], ["assessment", "Strengths & concerns"]].map(([id, label]) => <button key={id} id={`cv-tab-${id}`} role="tab" aria-selected={tab === id} aria-controls={`cv-content-${id}`} onClick={() => setTab(id)}>{label}</button>)}</div>
    <section role="tabpanel" id={`cv-content-${tab}`} aria-labelledby={`cv-tab-${tab}`}>
      {tab === "overview" && <div className="cv-detail-grid"><section className="cv-card"><h2>Evaluation summary</h2><p className="cv-summary">{e.summary}</p><p className="cv-footnote">{candidate.fileName} · {new Date(candidate.report.analyzedAt).toLocaleDateString()} · Human review required</p></section><section className="cv-card"><div className="cv-inline"><h2>Scorecards</h2><span className="cv-muted">Click for evidence</span></div><div className="cv-scores">{e.scorecards.map((s, i) => <div className="cv-score" key={s.criterion}><button aria-expanded={score === i} aria-controls={`cv-evidence-${i}`} aria-label={`${s.criterion}: ${s.score === null ? "Unknown" : `${s.score} out of 5`}. Show evidence`} onClick={() => setScore(score === i ? null : i)}><span>{s.criterion}<Info size={13} /></span><strong>{s.score === null ? "Unknown" : `${s.score}/5`}</strong><span className="cv-score-bar"><span style={{ width: `${(s.score || 0) * 20}%` }} /></span></button>{score === i && <div className="cv-score-explanation" id={`cv-evidence-${i}`} role="note"><strong>{s.requirement}</strong><blockquote>{s.evidence}</blockquote><p>{s.rationale}</p></div>}</div>)}</div><p className="cv-footnote">0 mismatch · 3 meets · 5 exceptional. Unknown means not assessable.</p></section></div>}
      {tab === "interview" && <div className="cv-detail-grid">{[["Validate claimed experience", "Questions about experience the candidate mentions in the CV.", e.experienceQuestions], ["Explore gaps against the job", "Requirements that are missing or unproven in the CV.", e.gapQuestions]].map(([title, subtitle, questions]) => <section className="cv-card" key={String(title)}><h2>{String(title)}</h2><p className="cv-muted">{String(subtitle)}</p>{(questions as typeof e.experienceQuestions).length === 0 && <p>No supported questions identified in this category.</p>}{(questions as typeof e.experienceQuestions).map((q, i) => <div className="cv-question" key={i}><span className="cv-step">{i + 1}</span><div><h3>{q.question}</h3><p className="cv-muted">{q.context}</p><details><summary>What to listen for</summary><p>{q.listenFor}</p></details><label className="cv-reviewed"><input type="checkbox" /><Check size={13} /> Reviewed in interview</label></div></div>)}</section>)}</div>}
      {tab === "assessment" && <div className="cv-detail-grid">{([["Advantages", e.advantages], ["Gaps & disadvantages", e.disadvantages], ["Risks to verify", e.risks], ["Other observations", e.aspectCritiques]] as const).map(([title, findings]) => <section className="cv-card" key={title}><h2>{title}</h2>{!findings.length && <p className="cv-muted">No supported findings identified.</p>}{findings.map((f, i) => <details className="cv-finding" key={i}><summary>{f.aspect}</summary><p>{f.assessment}</p><blockquote>{f.evidence}</blockquote><p className="cv-muted">Verify: {f.followUp}</p></details>)}</section>)}</div>}
    </section>
  </div>;
}

