import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  LayoutDashboard,
  Upload,
  KeyRound,
  Settings,
  ArrowUpRight,
  Check,
  Download,
  UserRound,
} from "lucide-react";
import {
  db,
  downloadFile,
  errorMessage,
  type Row,
} from "@quicksort/candidate-db";
import { validateFile } from "@quicksort/candidate-db/validation";
import { useAuth } from "@quicksort/candidate-db/auth";
import {
  usePortalRoute,
  AuthGate,
  AccountSecurity,
  Shell,
  Heading,
  Stat,
  Notice,
  Empty,
  Pill,
  formatDate,
} from "@quicksort/candidate-ui";
import { CandidateCapabilityProfile } from "./CandidateCapabilityProfile";
const nav = [
  { id: "overview", href: "/onboarding", label: "My onboarding", icon: LayoutDashboard },
  { id: "profile", href: "/profile", label: "My profile", icon: UserRound },
  { id: "documents", href: "/documents", label: "My documents", icon: Upload },
  { id: "requests", href: "/tool-access", label: "Tool access", icon: KeyRound },
  { id: "account", href: "/account", label: "Account", icon: Settings },
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
  const [tab, setTab] = usePortalRoute(nav);
  const
    [profile, setProfile] = useState<Row<"profiles"> | null>(null),
    [capabilityProfile, setCapabilityProfile] = useState<Row<"candidate_profiles"> | null>(null),
    [skills, setSkills] = useState<Row<"candidate_skills">[]>([]),
    [projects, setProjects] = useState<Row<"candidate_projects">[]>([]),
    [documents, setDocuments] = useState<Row<"candidate_documents">[]>([]),
    [requests, setRequests] = useState<Row<"tool_requests">[]>([]);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const results = await Promise.all([
        db().from("profiles").select("*").eq("id", userId).single(),
        db().from("candidate_profiles").select("*").eq("candidate_id", userId).maybeSingle(),
        db().from("candidate_skills").select("*").eq("candidate_id", userId).order("updated_at", { ascending: false }),
        db().from("candidate_projects").select("*").eq("candidate_id", userId).order("updated_at", { ascending: false }),
        db()
          .from("candidate_documents")
          .select("*")
          .eq("candidate_id", userId)
          .order("created_at", { ascending: false }),
        db()
          .from("tool_requests")
          .select("*")
          .eq("candidate_id", userId)
          .order("created_at", { ascending: false }),
      ]);
      for (const r of results) if (r.error) throw r.error;
      setProfile(results[0].data);
      setCapabilityProfile(results[1].data);
      setSkills(results[2].data || []);
      setProjects(results[3].data || []);
      setDocuments(results[4].data || []);
      setRequests(results[5].data || []);
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
  useEffect(() => { setError(""); setMessage(""); }, [tab]);
  function navigate(id: string) {
    setTab(id);
    setError("");
    setMessage("");
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
                  text: "Add your professional profile, skills and projects.",
                  done: capabilityProfile?.review_status === "approved",
                  target: "profile",
                },
                {
                  title: "Share your documents",
                  text: "Upload the documents requested by your team.",
                  done: documents.length > 0,
                  target: "documents",
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

          </div>
        </>
      )}
      {tab === "profile" && (
        <>
          <Heading eyebrow="Your experience" title="My capability profile">
            Your skills and projects help QuickSort understand what the team can deliver. Admins review every update before it appears in Business.
          </Heading>
          <CandidateCapabilityProfile userId={userId} profile={capabilityProfile} skills={skills} projects={projects} busy={busy} action={action}/>
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
