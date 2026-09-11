import { useCallback, useEffect, useState, type FormEvent } from "react";
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
  type Row,
} from "@quicksort/db";
import { validateFile } from "@quicksort/db/validation";
import { useAuth } from "@quicksort/db/auth";
import {
  AuthGate,
  Shell,
  Heading,
  Stat,
  Notice,
  Empty,
  Pill,
  PasswordForm,
  formatDate,
} from "@quicksort/ui";
import { TeamPhotos } from './TeamPhotos';
const nav = [
  { id: "overview", label: "My onboarding", icon: LayoutDashboard },
  { id: "documents", label: "My documents", icon: Upload },
  { id: "contracts", label: "My contracts", icon: FileText },
  { id: "requests", label: "Tool access", icon: KeyRound },
  { id: "photos", label: "Team photos", icon: Images },
  { id: "account", label: "Account", icon: Settings },
];
export default function App() {
  const auth = useAuth();
  return (
    <AuthGate auth={auth}>
      {auth.session && (
        <Candidate
          userId={auth.session.user.id}
          email={auth.session.user.email || ""}
        />
      )}
    </AuthGate>
  );
}
function Candidate({ userId, email }: { userId: string; email: string }) {
  const [tab, setTab] = useState("overview"),
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
    document.title = "Quicksort Candidate";
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
      portal="Candidate"
      email={email}
      nav={nav}
      current={tab}
      onNavigate={navigate}
    >
      <Notice error>{error}</Notice>
      <Notice>{message}</Notice>
      {tab === "photos" && <TeamPhotos />}
      {tab === "overview" && (
        <>
          <Heading
            eyebrow="Your next chapter"
            title={`Welcome${profile?.full_name ? ", " + profile.full_name.split(" ")[0] : ""}.`}
          >
            A place for the essentials, so you can focus on what comes next.
          </Heading>
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
          <Heading eyebrow="Onboarding" title="My documents">
            Upload the documents requested by your team. Only you and Quicksort
            admins can access them.
          </Heading>
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
          <Heading eyebrow="Your agreements" title="My contracts">
            Read each agreement, add your signature and keep a copy for your
            records.
          </Heading>
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
      {tab === "requests" && (
        <>
          <Heading eyebrow="Ready to work" title="Tool access">
            Tell us what you need. Your team will review your request and share
            the next steps.
          </Heading>
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
          <Heading eyebrow="Your workspace" title="Account">
            Keep your profile and password up to date.
          </Heading>
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
              <PasswordForm />
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
