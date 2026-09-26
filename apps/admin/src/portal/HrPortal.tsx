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
} from "lucide-react";
import {
  db,
  downloadFile,
  saveBlob,
  errorMessage,
  isMissingRelationError,
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
import { TeamPhotos } from './TeamPhotos';

type MyApplication = {
  id: string;
  full_name: string;
  stage: string;
  start_date: string | null;
  created_at: string;
  updated_at: string;
};

type MyApplicationEvent = {
  id: number;
  candidate_id: string;
  to_stage: string;
  created_at: string;
};

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
  { id: "requests", href: "/tool-access", label: "Tool access", icon: KeyRound },
  { id: "photos", href: "/team-photos", label: "Team photos", icon: Images },
  { id: "account", href: "/account", label: "Account", icon: Settings },
];

// Recruiting stages (prd-hr.md §3.1): onboarding sections stay hidden until the
// offer is accepted (stage contract / pre-boarding onwards).
const PRE_ONBOARDING_STAGES = [
  "opportunity",
  "published",
  "application",
  "matching",
  "screening",
  "hr_interview",
  "technical_interview",
  "client_presentation",
  "decision",
  "offer",
];
const GATED_TABS = ["overview", "contracts", "requests", "photos"];

/**
 * Candidate/employee self-service portal ("HR portal"). Rendered by the app
 * root for every signed-in user who is not staff — see App.tsx.
 */
export function HrPortal({ userId, email }: { userId: string; email: string }) {
  const [applicationStage, setApplicationStage] = useState<string | null>(null);
  const onboardingOpen =
    applicationStage !== null &&
    !PRE_ONBOARDING_STAGES.includes(applicationStage);
  // Pre-hire, "My application" is the landing tab; onboarding sections unlock
  // once the offer is accepted.
  const routes = useMemo(
    () => (onboardingOpen ? nav : [nav[1], nav[0], ...nav.slice(2)]),
    [onboardingOpen],
  );
  const visibleNav = onboardingOpen
    ? nav
    : routes.filter((n) => !GATED_TABS.includes(n.id));
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
      // Stage-aware navigation: never let a stage lookup break the rest of the portal.
      try {
        const app = await db().from("my_application").select("*").maybeSingle();
        setApplicationStage(app.error ? null : app.data?.stage ?? null);
      } catch {
        setApplicationStage(null);
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
      const file = f.get("file") as File;
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
      {tab === "application" && <MyApplicationTab email={email} busy={busy} action={action} />}
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
              {[
                {
                  title: "Complete your profile",
                  text: "Make sure we know your full name.",
                  done: !!profile?.full_name,
                  target: "account",
                },
                {
                  title: "Share your documents",
                  text: "Upload the documents requested by your team.",
                  done: documents.length > 0,
                  target: "documents",
                },
                {
                  title: "Review your agreements",
                  text: "Read and sign the contracts shared with you.",
                  done: contracts.length > 0 && !unsigned.length,
                  target: "contracts",
                },
                {
                  title: "Get the right tools",
                  text: "Request access to the tools you need.",
                  done: requests.some((r) => r.status === "approved"),
                  target: "requests",
                },
              ].map((s, i) => (
                <div className="step" key={s.title}>
                  <span className="step-num">
                    {s.done ? <Check size={16} /> : i + 1}
                  </span>
                  <div>
                    <h3>
                      <button
                        className="link-button"
                        style={{ fontSize: 14, color: "var(--qs-ink)" }}
                        onClick={() => navigate(s.target)}
                      >
                        {s.title}
                      </button>
                    </h3>
                    <p>{s.text}</p>
                  </div>
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
      {tab === "contracts" && onboardingOpen && (
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

/**
 * My application — prd-hr.md §2.2 (Candidate row) and §8.2. The candidate sees
 * their own stage and timeline only: never a score, ranking or comparison.
 * AI assistance is disclosed, and a human re-review path plus GDPR rights are
 * one click away (AI Act Art. 86, GDPR Art. 22(3)).
 */
function MyApplicationTab({
  email,
  busy,
  action,
}: {
  email: string;
  busy: boolean;
  action: (work: () => Promise<void>, success?: string) => Promise<void>;
}) {
  const [application, setApplication] = useState<MyApplication | null>(null);
  const [events, setEvents] = useState<MyApplicationEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [requestError, setRequestError] = useState("");
  const [setupPending, setSetupPending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setRequestError("");
    setSetupPending(false);
    try {
      const appResult = await db().from("my_application").select("*").maybeSingle();
      if (appResult.error) throw appResult.error;
      setApplication(appResult.data);
      if (appResult.data) {
        const eventResult = await db()
          .from("my_application_events")
          .select("*")
          .eq("candidate_id", appResult.data.id)
          .order("created_at");
        if (eventResult.error) throw eventResult.error;
        setEvents(eventResult.data || []);
      } else {
        setEvents([]);
      }
    } catch (e) {
      if (isMissingRelationError(e)) setSetupPending(true);
      else setRequestError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <Notice error>{requestError}</Notice>
      {loading ? (
        <p className="muted" role="status">Loading your application…</p>
      ) : setupPending ? (
        <section className="panel">
          <Empty title="Application tracking is being set up">
            This part of your HR workspace is not live yet. The rest of your
            portal — documents, contracts, tool access — works as usual.
          </Empty>
        </section>
      ) : !application ? (
        <section className="panel">
          <Empty title="No application on file yet">
            Once your application enters our pipeline, your status will appear
            here. You can already exercise your GDPR rights below.
          </Empty>
        </section>
      ) : (
        <>
          <section className="panel">
            <h2>Current status</h2>
            <p>
              <Pill status={application.stage} />
            </p>
            <h3 className="subsection-title" style={{ marginTop: 18 }}>
              Your journey so far
            </h3>
            <div className="timeline">
              {[{ id: 0, to_stage: application.stage, created_at: application.created_at } as MyApplicationEvent, ...events]
                .filter((e, i, arr) => arr.findIndex((x) => x.to_stage === e.to_stage) === i)
                .map((e) => (
                  <div className="timeline-item" key={e.id}>
                    <span className="timeline-dot" />
                    <div>
                      <p>
                        <strong>{STAGE_LABELS[e.to_stage] || e.to_stage}</strong>
                      </p>
                      <p className="muted small-text">{formatDate(e.created_at)}</p>
                    </div>
                  </div>
                ))}
            </div>
          </section>
          <section className="panel">
            <h2>About AI in our process</h2>
            <p className="muted">
              Quicksort uses AI assistance to parse CVs and prepare advisory
              summaries during recruitment. AI never makes the final decision —
              a named human reviews and decides every step, and your data is
              never scored on protected characteristics. You can always ask for
              a human to re-review any AI-assisted step.
            </p>
          </section>
        </>
      )}
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
            }, "Request sent. Our HR team will come back to you within one business day.");
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
