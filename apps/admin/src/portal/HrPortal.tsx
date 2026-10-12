import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  LayoutDashboard,
  Upload,
  FileText,
  KeyRound,
  Settings,
  ArrowUpRight,
  Check,
  Download,
  Images,
  CalendarDays,
} from "lucide-react";
import {
  db,
  downloadFile,
  saveBlob,
  errorMessage,
  type Row,
} from "@quicksort/hr-db";
import { validateFile } from "@quicksort/hr-db/validation";
import {
  usePortalRoute,
  AccountSecurity,
  Shell,
  Stat,
  Notice,
  Empty,
  Pill,
  formatDate,
} from "@quicksort/hr-ui";
import { z } from "zod";
import { executeCommand } from "../hr/data";
import { TeamPhotos } from './TeamPhotos';
import { CraScreen } from '../cra/CraScreen';

const applicationSchema = z.object({ id: z.uuid(), person_id: z.uuid(), opportunity_id: z.uuid(), full_name: z.string(), title: z.string(), stage: z.string(), status: z.string(), created_at: z.string(), updated_at: z.string() });
const applicationEventSchema = z.object({ id: z.number(), application_id: z.uuid(), to_stage: z.string(), kind: z.string(), created_at: z.string() });
const employmentSchema = z.object({ id: z.uuid(), person_id: z.uuid(), role: z.string(), start_date: z.string(), end_date: z.string().nullable(), status: z.string(), onboarding_completed_at: z.string().nullable(), probation_status: z.string(), probation_end: z.string().nullable() });
const taskSchema = z.object({ id: z.uuid(), employee_id: z.uuid(), phase: z.string(), title: z.string(), assignee: z.string(), due_date: z.string().nullable(), required: z.boolean(), dependency_id: z.uuid().nullable(), evidence: z.string(), completed_at: z.string().nullable(), version: z.number().int() });
const offerSchema = z.object({ id: z.uuid(), application_id: z.uuid(), title: z.string(), contract_type: z.string(), salary_monthly: z.number(), status: z.string(), shared_at: z.string().nullable(), valid_until: z.string().nullable(), version: z.number().int() });
type MyApplication = z.infer<typeof applicationSchema>;
type MyApplicationEvent = z.infer<typeof applicationEventSchema>;
type MyEmployment = z.infer<typeof employmentSchema>;
type MyTask = z.infer<typeof taskSchema>;
type MyOffer = z.infer<typeof offerSchema>;

const STAGE_LABELS: Record<string, string> = {
  opportunity: "Job opportunity",
  published: "Published / sourcing",
  application: "Application received",
  matching: "Review",
  screening: "Pre-qualification",
  hr_interview: "HR interview",
  technical_interview: "Technical interview",
  client_presentation: "Client presentation",
  decision: "Decision",
  offer: "Offer",
  contract: "Contract signature",
  preboarding: "Pre-boarding",
  onboarding: "Onboarding",
  probation: "Probation",
  confirmed: "Confirmed",
  offboarding: "Alumni",
};
const nav = [
  { id: "overview", href: "/onboarding", label: "My onboarding", icon: LayoutDashboard },
  { id: "application", href: "/application", label: "My application", icon: FileText },
  { id: "documents", href: "/documents", label: "My documents", icon: Upload },
  { id: "contracts", href: "/contracts", label: "My contracts", icon: FileText },
  { id: "cra", href: "/cra", label: "My CRA", icon: CalendarDays },
  { id: "requests", href: "/tool-access", label: "Tool access", icon: KeyRound },
  { id: "photos", href: "/team-photos", label: "Team photos", icon: Images },
  { id: "account", href: "/account", label: "Account", icon: Settings },
];

const GATED_TABS = ["overview", "requests", "photos"];

/**
 * Candidate/employee self-service portal ("HR portal"). Rendered by the app
 * root for every signed-in user who is not staff — see App.tsx.
 */
export function HrPortal({ userId, email }: { userId: string; email: string }) {
  const [applications, setApplications] = useState<MyApplication[]>([]);
  const [applicationEvents, setApplicationEvents] = useState<MyApplicationEvent[]>([]);
  const [employments, setEmployments] = useState<MyEmployment[]>([]);
  const [tasks, setTasks] = useState<MyTask[]>([]);
  const [offers, setOffers] = useState<MyOffer[]>([]);
  const [journeyError, setJourneyError] = useState("");
  const onboardingOpen = employments.some(e => e.status !== "ended");
  // Employment unlocks the journey; agreements remain available before hiring.
  const routes = useMemo(
    () => (onboardingOpen ? nav : [nav[1], nav[0], ...nav.slice(2)]),
    [onboardingOpen],
  );
  const visibleNav = onboardingOpen
    ? nav
    : routes.filter((n) => !GATED_TABS.includes(n.id) && (n.id !== "cra" || employments.length > 0));
  const [tab, setTab] = usePortalRoute(routes);
  const
    [profile, setProfile] = useState<Row<"profiles"> | null>(null),
    [documents, setDocuments] = useState<Row<"candidate_documents">[]>([]),
    [contracts, setContracts] = useState<Row<"contracts">[]>([]),
    [signatures, setSignatures] = useState<Row<"contract_signatures">[]>([]),
    [requests, setRequests] = useState<Row<"tool_requests">[]>([]);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [review, setReview] = useState<Row<"contracts"> | null>(null),
    [preview, setPreview] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setJourneyError("");
      try {
        const journeys = await Promise.all([
          db().from("my_applications").select("*").order("created_at", { ascending: false }),
          db().from("my_application_events").select("*").order("created_at"),
          db().from("my_employment").select("*").order("start_date", { ascending: false }),
          db().from("my_onboarding_items").select("*"),
          db().from("my_offers").select("*"),
        ]);
        for (const result of journeys) if (result.error) throw result.error;
        setApplications(applicationSchema.array().parse(journeys[0].data));
        setApplicationEvents(applicationEventSchema.array().parse(journeys[1].data));
        setEmployments(employmentSchema.array().parse(journeys[2].data));
        setTasks(taskSchema.array().parse(journeys[3].data));
        setOffers(offerSchema.array().parse(journeys[4].data));
      } catch (e) {
        setApplications([]); setApplicationEvents([]); setEmployments([]); setTasks([]); setOffers([]);
        setJourneyError(errorMessage(e));
      }
      const results = await Promise.all([
        db().from("profiles").select("*").eq("id", userId).single(),
        db()
          .from("candidate_documents")
          .select("*")
          .eq("candidate_id", userId)
          .order("created_at", { ascending: false }),
        db()
          .from("contracts")
          .select("*")
          .eq("candidate_id", userId)
          .order("created_at", { ascending: false }),
        db().from("contract_signatures").select("*").eq("candidate_id", userId),
        db()
          .from("tool_requests")
          .select("*")
          .eq("candidate_id", userId)
          .order("created_at", { ascending: false }),
      ]);
      for (const r of results) if (r.error) throw r.error;
      setProfile(results[0].data);
      setDocuments(results[1].data || []);
      setContracts(results[2].data || []);
      setSignatures(results[3].data || []);
      setRequests(results[4].data || []);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [userId]);
  useEffect(() => {
    document.title = "Quicksort HR";
    void load();
  }, [load]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  async function action(work: () => Promise<void>, success = "Saved.") {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
      setMessage(success);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => { setError(""); setMessage(""); setReview(null); setPreview(""); }, [tab]);
  function navigate(id: string) {
    setTab(id);
    setError("");
    setMessage("");
    setReview(null);
    setPreview("");
  }
  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    await action(async () => {
      const file = f.get("file");
      if (!(file instanceof File)) throw new Error("Choose a document to upload.");
      validateFile(file);
      const extension =
        file.name
          .split(".")
          .pop()
          ?.replace(/[^a-zA-Z0-9]/g, "") || "bin";
      const path = `${userId}/${crypto.randomUUID()}.${extension}`;
      const result = await db()
        .storage.from("candidate-documents")
        .upload(path, file, { upsert: false, contentType: file.type });
      if (result.error) throw result.error;
      const saved = await db()
        .from("candidate_documents")
        .insert({
          candidate_id: userId,
          name: file.name,
          category: String(f.get("category")),
          storage_path: path,
          size_bytes: file.size,
        });
      if (saved.error) {
        await db().storage.from("candidate-documents").remove([path]);
        throw saved.error;
      }
      form.reset();
    }, "Document uploaded. Your Quicksort team can now review it.");
  }
  async function openReview(c: Row<"contracts">) {
    await action(async () => {
      const { data, error } = await db()
        .storage.from("contracts")
        .download(c.storage_path);
      if (error) throw error;
      setPreview(URL.createObjectURL(data));
      setReview(c);
    }, "Contract ready to review.");
  }
  async function sign(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!review) return;
    const f = new FormData(e.currentTarget);
    if (f.get("consent") !== "on") return;
    const contractId = review.id;
    await action(async () => {
      const { error } = await db()
        .from("contract_signatures")
        .insert({
          contract_id: contractId,
          signer_name: String(f.get("name")).trim(),
        });
      if (error) throw error;
      setReview(null);
      setPreview("");
    }, "Your signature has been recorded. You can download the contract and signature receipt below.");
  }
  const unsigned = contracts.filter(
    (c) => !signatures.some((s) => s.contract_id === c.id),
  );
  return (
    <Shell
      portal="HR"
      email={email}
      nav={visibleNav}
      current={tab}
      onNavigate={navigate}
    >
      <Notice error>{error}</Notice>
      <Notice>{message}</Notice>
      {!onboardingOpen && GATED_TABS.includes(tab) && (
        <section className="panel">
          <Empty title="Opens when you join">
            This section becomes available once your offer is accepted and your
            onboarding begins. Follow your progress in My application.
          </Empty>
        </section>
      )}
      {tab === "photos" && onboardingOpen && <TeamPhotos />}
      {tab === "cra" && <>
        <header className="cra-portal-head">
          <h1>Monthly CRA</h1>
          <p className="muted">Fill your month day by day — or paint whole ranges — then save. Mornings and afternoons can be filled separately.</p>
        </header>
        <CraScreen audience="employee" draftOwner={email} />
      </>}
      {tab === "application" && <MyApplicationTab email={email} busy={busy} action={action} applications={applications} events={applicationEvents} offers={offers} employments={employments} journeyError={journeyError} loading={loading} />}
      {tab === "overview" && onboardingOpen && (
        <>
          <div className="hero">
            <div className="eyebrow">Let’s get you ready</div>
            <h2>Great work starts with a thoughtful beginning.</h2>
            <p>
              Keep your documents, agreements and access requests together. Your
              Quicksort team is here to help along the way.
            </p>
            <button className="btn lime" onClick={() => navigate("documents")}>
              Upload your documents
              <ArrowUpRight size={16} />
            </button>
          </div>
          <div className="stats">
            <Stat
              label="Documents"
              value={documents.length}
              detail="Securely shared with your team"
              icon={Upload}
            />
            <Stat
              label="To sign"
              value={unsigned.length}
              detail="Contracts awaiting your review"
              icon={FileText}
            />
            <Stat
              label="Tool requests"
              value={requests.filter((r) => r.status === "pending").length}
              detail="Awaiting a team response"
              icon={KeyRound}
            />
          </div>
          <div className="grid-two">
            <section className="panel">
              <h2>Your onboarding checklist</h2>
              <Notice error>{journeyError}</Notice>
              {employments.filter(e => e.status !== "ended").map(employment => (
                <div key={employment.id}>
                  <h3>{employment.role}</h3>
                  <p className="muted">Starting {formatDate(employment.start_date)} · {employment.status}</p>
                  {tasks.filter(t => t.employee_id === employment.id).map(task => {
                    const dependency = task.dependency_id ? tasks.find(t => t.id === task.dependency_id) : null;
                    const waiting = Boolean(dependency && !dependency.completed_at);
                    return <div className="list-row" key={task.id}>
                      <div><h3>{task.title}</h3><p className="muted">{task.phase} · {task.required ? "Required" : "Optional"}{task.due_date ? ` · Due ${formatDate(task.due_date)}` : ""}</p>
                        {task.assignee && <p className="muted small-text">Owner: {task.assignee}</p>}
                        {waiting && <p className="muted small-text">Waiting for {dependency?.title}</p>}
                      </div>
                      {task.completed_at ? <Check size={16} /> : <form onSubmit={e => {
                        e.preventDefault(); const fields = new FormData(e.currentTarget);
                        void action(async () => { await executeCommand({ kind: "complete_task", task_id: task.id, expected_version: task.version, evidence: String(fields.get("evidence") || "").trim() }); }, "Task completed.");
                      }}><input name="evidence" placeholder="Completion evidence" required aria-label={`Evidence for ${task.title}`} /><button className="btn secondary small" disabled={busy || waiting || ![email.toLowerCase(), "employee", "candidate"].includes(task.assignee.toLowerCase())}>Complete</button></form>}
                    </div>;
                  })}
                  {!tasks.some(t => t.employee_id === employment.id) && <p className="muted">Your team is preparing your onboarding plan.</p>}
                </div>
              ))}

            </section>
            <section className="panel">
              <h2>Waiting for your signature</h2>
              {unsigned.length ? (
                unsigned.map((c) => (
                  <div className="list-row" key={c.id}>
                    <div>
                      <h3>{c.title}</h3>
                      <p className="muted small-text">
                        Shared {formatDate(c.created_at)}
                      </p>
                    </div>
                    <button
                      className="btn secondary small"
                      onClick={() => {
                        navigate("contracts");
                        void openReview(c);
                      }}
                    >
                      Review
                    </button>
                  </div>
                ))
              ) : (
                <Empty title="You’re all caught up">
                  New contracts will appear here when your team shares them.
                </Empty>
              )}
            </section>
          </div>
        </>
      )}
      {tab === "documents" && (
        <>
          <section className="panel">
            <h2>Upload a document</h2>
            <form className="form" onSubmit={upload}>
              <div className="form-columns">
                <label>
                  Document type
                  <select name="category">
                    <option value="identity">Identity document</option>
                    <option value="resume">CV / résumé</option>
                    <option value="qualification">Qualification</option>
                    <option value="other">Other document</option>
                  </select>
                </label>
                <label>
                  Choose a file
                  <input
                    name="file"
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.docx"
                    required
                  />
                  <span className="muted">
                    PDF, JPG, PNG or DOCX · up to 10 MB
                  </span>
                </label>
              </div>
              <div>
                <button className="btn" disabled={busy}>
                  <Upload size={16} />
                  Upload document
                </button>
              </div>
            </form>
          </section>
          <section className="panel">
            <h2>Uploaded documents</h2>
            {!documents.length && !loading && (
              <Empty title="Your documents belong here">
                Upload your first document using the form above.
              </Empty>
            )}
            {documents.map((d) => (
              <div className="list-row" key={d.id}>
                <div>
                  <h3 className="document-name">{d.name}</h3>
                  <p className="muted">
                    {d.category} · {(d.size_bytes / 1024 / 1024).toFixed(1)} MB
                    · {formatDate(d.created_at)}
                  </p>
                </div>
                <div className="actions">
                  <button
                    className="btn secondary small"
                    disabled={busy}
                    onClick={() =>
                      void action(
                        () =>
                          downloadFile(
                            "candidate-documents",
                            d.storage_path,
                            d.name,
                          ),
                        "Document downloaded.",
                      )
                    }
                  >
                    <Download size={14} />
                    Download
                  </button>
                  <button
                    className="btn danger small"
                    disabled={busy}
                    onClick={() => {
                      if (confirm(`Remove “${d.name}”?`))
                        void action(async () => {
                          const storage = await db()
                            .storage.from("candidate-documents")
                            .remove([d.storage_path]);
                          if (storage.error) throw storage.error;
                          const result = await db()
                            .from("candidate_documents")
                            .delete()
                            .eq("id", d.id)
                            .select("id")
                            .single();
                          if (result.error) throw result.error;
                        }, "Document removed.");
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </section>
        </>
      )}
      {tab === "contracts" && (
        <>
          {review && (
            <section className="panel">
              <div className="panel-head">
                <h2>Review: {review.title}</h2>
                <button
                  className="btn secondary small"
                  onClick={() => {
                    setReview(null);
                    setPreview("");
                  }}
                >
                  Close
                </button>
              </div>
              <p className="muted">
                Read the complete PDF before signing. If the preview does not
                load, download and open it.
              </p>
              <object
                className="contract-preview"
                data={preview}
                type="application/pdf"
              >
                <p>
                  PDF preview is unavailable. Use Download PDF to review your
                  contract.
                </p>
              </object>
              <button
                className="btn secondary small"
                disabled={busy}
                onClick={() =>
                  void action(
                    () =>
                      downloadFile(
                        "contracts",
                        review.storage_path,
                        review.title + ".pdf",
                      ),
                    "Contract downloaded.",
                  )
                }
              >
                Download PDF
              </button>
              <form className="form" style={{ marginTop: 22 }} onSubmit={sign}>
                <label>
                  Your full legal name
                  <input
                    name="name"
                    required
                    minLength={2}
                    maxLength={200}
                    autoComplete="name"
                    defaultValue={profile?.full_name}
                  />
                </label>
                <label className="check">
                  <input type="checkbox" name="consent" required />I have read
                  this contract and agree to sign it electronically.
                </label>
                <p className="muted small-text">
                  Your typed name, the document fingerprint and the signing time
                  will be recorded. The original PDF remains available with a
                  separate signature receipt.
                </p>
                <div>
                  <button className="btn" disabled={busy}>
                    Sign this contract
                  </button>
                </div>
              </form>
            </section>
          )}
          <section className="panel">
            {!contracts.length && !loading && (
              <Empty title="No contracts yet">
                Your team will share your agreements here when they’re ready.
              </Empty>
            )}
            {contracts.map((c) => {
              const signature = signatures.find((s) => s.contract_id === c.id);
              return (
                <div className="list-row" key={c.id}>
                  <div>
                    <h3>{c.title}</h3>
                    <p className="muted">Shared {formatDate(c.created_at)}</p>
                    <Pill status={signature ? "signed" : "pending"} />
                    {signature && (
                      <>
                        <p className="signature">{signature.signer_name}</p>
                        <p className="muted small-text">
                          Signed {formatDate(signature.signed_at)}
                        </p>
                      </>
                    )}
                  </div>
                  <div className="actions">
                    <button
                      className="btn secondary small"
                      disabled={busy}
                      onClick={() =>
                        void action(
                          () =>
                            downloadFile(
                              "contracts",
                              c.storage_path,
                              c.title + ".pdf",
                            ),
                          "Contract downloaded.",
                        )
                      }
                    >
                      Download PDF
                    </button>
                    {signature ? (
                      <button
                        className="btn secondary small"
                        onClick={() =>
                          saveBlob(
                            new Blob(
                              [
                                JSON.stringify(
                                  { contract_title: c.title, ...signature },
                                  null,
                                  2,
                                ),
                              ],
                              { type: "application/json" },
                            ),
                            `signature-${c.id}.json`,
                          )
                        }
                      >
                        Signature receipt
                      </button>
                    ) : (
                      <button
                        className="btn small"
                        disabled={busy}
                        onClick={() => void openReview(c)}
                      >
                        Review & sign
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </section>
        </>
      )}
      {tab === "requests" && onboardingOpen && (
        <>
          <section className="panel">
            <h2>Request a tool</h2>
            <form
              className="form"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const f = new FormData(form);
                void action(async () => {
                  const { error } = await db()
                    .from("tool_requests")
                    .insert({
                      tool_name: String(f.get("tool")).trim(),
                      reason: String(f.get("reason")).trim(),
                    });
                  if (error) throw error;
                  form.reset();
                }, "Request sent to your Quicksort team.");
              }}
            >
              <label>
                Tool or service
                <input
                  name="tool"
                  required
                  maxLength={100}
                  placeholder="e.g. GitHub, Notion, Figma"
                />
              </label>
              <label>
                What do you need it for?
                <textarea
                  name="reason"
                  required
                  maxLength={2000}
                  placeholder="Tell us about the project and access you need…"
                />
              </label>
              <div>
                <button className="btn" disabled={busy}>
                  Send request
                </button>
              </div>
            </form>
          </section>
          <section className="panel">
            <h2>Your requests</h2>
            {!requests.length && !loading && (
              <Empty title="No requests yet">
                Need a tool to get started? Let your team know above.
              </Empty>
            )}
            {requests.map((r) => (
              <div className="list-row" key={r.id}>
                <div>
                  <h3>{r.tool_name}</h3>
                  <p className="wrap muted">{r.reason}</p>
                  {r.admin_note && (
                    <p className="wrap">Team response: {r.admin_note}</p>
                  )}
                  <span className="muted small-text">
                    {formatDate(r.created_at)}
                  </span>
                </div>
                <Pill status={r.status} />
              </div>
            ))}
          </section>
        </>
      )}
      {tab === "account" && (
        <>
          <div className="grid-two">
            <section className="panel">
              <h2>Your profile</h2>
              <p className="muted">{email}</p>
              <form
                className="form"
                key={profile?.full_name}
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void action(async () => {
                    const { error } = await db()
                      .from("profiles")
                      .update({ full_name: String(f.get("name")).trim() })
                      .eq("id", userId)
                      .select("id")
                      .single();
                    if (error) throw error;
                  }, "Profile updated.");
                }}
              >
                <label>
                  Full name
                  <input
                    name="name"
                    defaultValue={profile?.full_name}
                    required
                    maxLength={200}
                  />
                </label>
                <div>
                  <button className="btn" disabled={busy}>
                    Save profile
                  </button>
                </div>
              </form>
            </section>
            <section className="panel">
              <AccountSecurity />
            </section>
          </div>
        </>
      )}
      {loading && (
        <p className="muted" role="status">
          Refreshing your workspace…
        </p>
      )}
    </Shell>
  );
}

function MyApplicationTab({
  email, busy, action, applications, events, offers, employments, journeyError, loading,
}: {
  email: string;
  busy: boolean;
  action: (work: () => Promise<void>, success?: string) => Promise<void>;
  applications: MyApplication[];
  events: MyApplicationEvent[];
  offers: MyOffer[];
  employments: MyEmployment[];
  journeyError: string;
  loading: boolean;
}) {
  const [selectedId, setSelectedId] = useState("");
  const application = applications.find(a => a.id === selectedId) || applications.find(a => a.status === "active") || applications[0];
  return (
    <>
      <Notice error>{journeyError}</Notice>
      {loading && <p className="muted" role="status">Loading your applications…</p>}
      {!loading && !journeyError && !application && <section className="panel"><Empty title="No application linked yet">Your HR team can link your account to your person record. Your documents and contracts are already available.</Empty></section>}
      {application && <>
        <section className="panel">
          <label>Application<select value={application.id} onChange={e => setSelectedId(e.target.value)}>{applications.map(a => <option value={a.id} key={a.id}>{a.title} · {a.status}</option>)}</select></label>
          <h2 style={{ marginTop: 20 }}>{application.title}</h2>
          <p><Pill status={application.status === "active" ? application.stage : application.status} /></p>
          <h3 className="subsection-title" style={{ marginTop: 18 }}>Your journey so far</h3>
          <div className="timeline">
            <div className="timeline-item"><span className="timeline-dot" /><div><p><strong>Application received</strong></p><p className="muted small-text">{formatDate(application.created_at)}</p></div></div>
            {events.filter(e => e.application_id === application.id).map(event => <div className="timeline-item" key={event.id}><span className="timeline-dot" /><div><p><strong>{STAGE_LABELS[event.to_stage] || event.to_stage || event.kind.replaceAll("_", " ")}</strong></p><p className="muted small-text">{formatDate(event.created_at)}</p></div></div>)}
          </div>
        </section>
        {offers.filter(o => o.application_id === application.id).map(offer => <section className="panel" key={offer.id}>
          <h2>{offer.title}</h2><p>{offer.contract_type} · {new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(offer.salary_monthly)} gross per month</p><Pill status={offer.status} />
          {offer.valid_until && <p className="muted">Valid until {formatDate(offer.valid_until)}</p>}
          {offer.status === "shared" && <form className="form" onSubmit={e => {
            e.preventDefault(); const fields = new FormData(e.currentTarget); const response = fields.get("response");
            if (response !== "accepted" && response !== "declined") return;
            void action(async () => { await executeCommand({ kind: "respond_offer", offer_id: offer.id, expected_version: offer.version, response, rationale: String(fields.get("rationale") || "Offer response recorded by recipient.").trim() }); }, "Your offer response has been recorded.");
          }}><label>Your response<select name="response" required defaultValue=""><option value="" disabled>Choose a response</option><option value="accepted">Accept offer</option><option value="declined">Decline offer</option></select></label><label>Message to HR<textarea name="rationale" maxLength={2000} /></label><button className="btn" disabled={busy}>Confirm response</button></form>}
        </section>)}
        <section className="panel"><h2>About AI in our process</h2><p className="muted">AI helps prepare profile summaries and interview questions. HR reviews suggestions and makes recruitment decisions. You can request human review below.</p></section>
      </>}
      {employments.length > 0 && <section className="panel"><h2>Your employment history</h2>{employments.map(period => <div className="list-row" key={period.id}><div><h3>{period.role}</h3><p className="muted">{formatDate(period.start_date)}{period.end_date ? ` to ${formatDate(period.end_date)}` : " onwards"}</p></div><Pill status={period.status} /></div>)}</section>}
      <section className="panel">
        <h2>Your rights</h2>
        <p className="muted">
          Request human re-review of any AI-assisted step, or exercise your
          GDPR rights: access, rectification, erasure, portability, and the
          right to express your point of view (Art. 22(3)). We respond without
          detriment to your application.
        </p>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const f = new FormData(form);
            void action(async () => {
              const { error } = await db()
                .from("candidate_requests")
                .insert({
                  email,
                  kind: String(f.get("kind")),
                  message: String(f.get("message")).trim(),
                });
              if (error) throw error;
              form.reset();
            }, "Request sent. Our HR team will review it.");
          }}
        >
          <div className="form-columns">
            <label>
              Request type
              <select name="kind" defaultValue="human_review">
                <option value="human_review">Human re-review of an AI-assisted step</option>
                <option value="viewpoint">Express my point of view</option>
                <option value="rectification">Rectify my data</option>
                <option value="portability">Portability of my data</option>
                <option value="erasure">Erase my data</option>
              </select>
            </label>
            <label>
              Message
              <textarea
                name="message"
                rows={3}
                maxLength={3000}
                placeholder="Tell us what you'd like reviewed or corrected…"
              />
            </label>
          </div>
          <div>
            <button className="btn" disabled={busy}>
              Send request to HR
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
