import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  BriefcaseBusiness,
  Users,
  FileText,
  KeyRound,
  LayoutDashboard,
  Plus,
  Search,
  ArrowUpRight,
  Settings,
  RefreshCw,
} from "lucide-react";
import {
  db,
  downloadFile,
  sha256,
  errorMessage,
  type Job,
  type Row,
} from "@quicksort/db";
import { isLinkedInUrl, slugify, validateFile } from "@quicksort/db/validation";
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
const nav = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "jobs", label: "Job posts", icon: BriefcaseBusiness },
  { id: "people", label: "Candidates", icon: Users },
  { id: "contracts", label: "Contracts", icon: FileText },
  { id: "requests", label: "Tool requests", icon: KeyRound },
  { id: "account", label: "Account", icon: Settings },
];
export default function App() {
  const auth = useAuth();
  return (
    <AuthGate auth={auth} admin>
      {auth.session && <Admin email={auth.session.user.email || ""} />}
    </AuthGate>
  );
}
function Admin({ email }: { email: string }) {
  const [tab, setTab] = useState("overview"),
    [jobs, setJobs] = useState<Job[]>([]),
    [people, setPeople] = useState<Row<"profiles">[]>([]),
    [contracts, setContracts] = useState<Row<"contracts">[]>([]),
    [documents, setDocuments] = useState<Row<"candidate_documents">[]>([]),
    [requests, setRequests] = useState<Row<"tool_requests">[]>([]),
    [signatures, setSignatures] = useState<Row<"contract_signatures">[]>([]);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState<Job | null | undefined>(undefined),
    [search, setSearch] = useState(""),
    [person, setPerson] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const results = await Promise.all([
        db().from("jobs").select("*").order("created_at", { ascending: false }),
        db()
          .from("profiles")
          .select("*")
          .order("created_at", { ascending: false }),
        db()
          .from("contracts")
          .select("*")
          .order("created_at", { ascending: false }),
        db()
          .from("candidate_documents")
          .select("*")
          .order("created_at", { ascending: false }),
        db()
          .from("tool_requests")
          .select("*")
          .order("created_at", { ascending: false }),
        db().from("contract_signatures").select("*"),
      ]);
      for (const r of results) if (r.error) throw r.error;
      setJobs(results[0].data || []);
      setPeople(results[1].data || []);
      setContracts(results[2].data || []);
      setDocuments(results[3].data || []);
      setRequests(results[4].data || []);
      setSignatures(results[5].data || []);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    document.title = "Quicksort Admin";
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
  const name = (id: string) =>
    people.find((p) => p.id === id)?.full_name ||
    people.find((p) => p.id === id)?.email ||
    "Candidate";
  const pending = requests.filter((r) => r.status === "pending");
  function navigate(id: string) {
    setTab(id);
    setEditing(undefined);
    setError("");
    setMessage("");
    setSearch("");
  }
  async function saveJob(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const linkedin_url = String(f.get("linkedin_url")).trim();
    if (!isLinkedInUrl(linkedin_url)) {
      setError("Enter an HTTPS linkedin.com application link.");
      return;
    }
    const values = {
      title: String(f.get("title")).trim(),
      slug: slugify(String(f.get("slug"))),
      department: String(f.get("department")).trim(),
      location: String(f.get("location")).trim(),
      employment_type: String(f.get("employment_type")),
      description: String(f.get("description")).trim(),
      linkedin_url,
      published: f.get("published") === "on",
      updated_at: new Date().toISOString(),
    };
    await action(async () => {
      const result = editing
        ? await db()
            .from("jobs")
            .update(values)
            .eq("id", editing.id)
            .select("id")
            .single()
        : await db().from("jobs").insert(values).select("id").single();
      if (result.error) throw result.error;
      setEditing(undefined);
    }, "Job saved. Published jobs are available on the website.");
  }
  async function uploadContract(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    await action(async () => {
      const file = f.get("file") as File;
      validateFile(file, true);
      const candidate = String(f.get("candidate"));
      const path = `${candidate}/${crypto.randomUUID()}.pdf`;
      const hash = await sha256(file);
      const upload = await db()
        .storage.from("contracts")
        .upload(path, file, { upsert: false, contentType: "application/pdf" });
      if (upload.error) throw upload.error;
      const result = await db()
        .from("contracts")
        .insert({
          candidate_id: candidate,
          title: String(f.get("title")).trim(),
          storage_path: path,
          document_sha256: hash,
        });
      if (result.error) {
        await db().storage.from("contracts").remove([path]);
        throw result.error;
      }
      form.reset();
    }, "Contract shared with the candidate.");
  }
  return (
    <Shell
      portal="Admin"
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
            eyebrow="Your team, in focus"
            title="Good people. Great work."
            action={
              <button
                className="btn"
                onClick={() => {
                  setTab("jobs");
                  setEditing(null);
                }}
              >
                <Plus size={16} />
                Create a job
              </button>
            }
          >
            A clear view of hiring, onboarding and everything that comes next.
          </Heading>
          <div className="stats">
            <Stat
              label="Published jobs"
              value={jobs.filter((j) => j.published).length}
              detail="Open to your next great hire"
              icon={BriefcaseBusiness}
            />
            <Stat
              label="Contracts to sign"
              value={
                contracts.filter(
                  (c) => !signatures.some((s) => s.contract_id === c.id),
                ).length
              }
              detail="Awaiting candidate signatures"
              icon={FileText}
            />
            <Stat
              label="Access requests"
              value={pending.length}
              detail="Ready for your review"
              icon={KeyRound}
            />
          </div>
          <div className="hero">
            <div className="eyebrow">Build what comes next</div>
            <h2>Make their next opportunity a great one.</h2>
            <p>
              Publish a role, welcome a new teammate and give them a thoughtful
              start.
            </p>
            <button className="btn lime" onClick={() => navigate("people")}>
              View candidates
              <ArrowUpRight size={16} />
            </button>
          </div>
          <div className="grid-two">
            <section className="panel">
              <div className="panel-head">
                <h2>Latest opportunities</h2>
                <button
                  className="link-button"
                  onClick={() => navigate("jobs")}
                >
                  View all
                </button>
              </div>
              {jobs.length ? (
                jobs.slice(0, 4).map((j) => (
                  <div className="list-row" key={j.id}>
                    <div>
                      <h3>{j.title}</h3>
                      <p className="muted small-text">
                        {j.location} · {j.employment_type}
                      </p>
                    </div>
                    <Pill status={j.published ? "published" : "draft"} />
                  </div>
                ))
              ) : (
                <Empty title="Your next hire starts here">
                  Create your first job post and share it on the website.
                </Empty>
              )}
            </section>
            <section className="panel">
              <h2>Onboarding at a glance</h2>
              {[
                {
                  title: "Welcome your candidates",
                  text: "Candidates create an account with their email and password.",
                },
                {
                  title: "Share the essentials",
                  text: "Review uploads and send each person their contract.",
                },
                {
                  title: "Help them get started",
                  text: "Approve requests for the tools they need.",
                },
              ].map((s, i) => (
                <div className="step" key={s.title}>
                  <span className="step-num">{i + 1}</span>
                  <div>
                    <h3>{s.title}</h3>
                    <p>{s.text}</p>
                  </div>
                </div>
              ))}
            </section>
          </div>
        </>
      )}
      {tab === "jobs" && (
        <>
          <Heading
            eyebrow="Hiring"
            title="Job posts"
            action={
              <button className="btn" onClick={() => setEditing(null)}>
                <Plus size={16} />
                Create a job
              </button>
            }
          >
            Create opportunities and send applicants directly to LinkedIn.
          </Heading>
          {editing !== undefined && (
            <section className="panel">
              <h2>{editing ? "Edit job post" : "Create a job post"}</h2>
              <form
                className="form"
                key={editing?.id || "new"}
                onSubmit={saveJob}
              >
                <div className="form-columns">
                  <label>
                    Job title
                    <input
                      name="title"
                      defaultValue={editing?.title}
                      required
                      maxLength={200}
                    />
                  </label>
                  <label>
                    URL slug
                    <input
                      name="slug"
                      defaultValue={editing?.slug}
                      required
                      pattern="[a-z0-9]+(-[a-z0-9]+)*"
                      placeholder="senior-ai-engineer"
                    />
                  </label>
                  <label>
                    Department
                    <input
                      name="department"
                      defaultValue={editing?.department || "Engineering"}
                      required
                    />
                  </label>
                  <label>
                    Location
                    <input
                      name="location"
                      defaultValue={editing?.location || "Paris, France"}
                      required
                    />
                  </label>
                </div>
                <label>
                  Contract type
                  <select
                    name="employment_type"
                    defaultValue={editing?.employment_type || "Permanent (CDI)"}
                  >
                    {[
                      "Permanent (CDI)",
                      "Fixed-term (CDD)",
                      "Contract",
                      "Internship",
                      "Apprenticeship",
                    ].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Job description
                  <textarea
                    name="description"
                    defaultValue={editing?.description}
                    rows={8}
                    maxLength={20000}
                    required
                    placeholder="The role, responsibilities and what you’re looking for…"
                  />
                </label>
                <label>
                  LinkedIn application URL
                  <input
                    type="url"
                    name="linkedin_url"
                    defaultValue={editing?.linkedin_url}
                    placeholder="https://www.linkedin.com/jobs/view/…"
                    required
                  />
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    name="published"
                    defaultChecked={editing?.published}
                  />
                  Publish on the website
                </label>
                <div className="actions">
                  <button className="btn" disabled={busy}>
                    Save job
                  </button>
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => setEditing(undefined)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </section>
          )}
          <section className="panel">
            <div className="toolbar">
              <Search size={18} />
              <input
                aria-label="Search jobs"
                placeholder="Search job posts…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button
                className="btn secondary small"
                disabled={loading}
                onClick={() => void load()}
              >
                <RefreshCw size={14} />
                Refresh
              </button>
            </div>
            {!jobs.length && !loading && (
              <Empty title="No job posts yet">
                Your published opportunities will appear on the careers page.
              </Empty>
            )}
            {jobs
              .filter((j) =>
                j.title.toLowerCase().includes(search.toLowerCase()),
              )
              .map((j) => (
                <div className="list-row" key={j.id}>
                  <div>
                    <h3>{j.title}</h3>
                    <p className="muted">
                      {j.department} · {j.location}
                    </p>
                    <Pill status={j.published ? "published" : "draft"} />
                  </div>
                  <div className="actions">
                    <a
                      className="btn secondary small"
                      href={j.linkedin_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      LinkedIn
                      <ArrowUpRight size={14} />
                    </a>
                    <button
                      className="btn secondary small"
                      onClick={() => setEditing(j)}
                    >
                      Edit
                    </button>
                    <button
                      className="btn secondary small"
                      disabled={busy}
                      onClick={() =>
                        void action(
                          async () => {
                            const r = await db()
                              .from("jobs")
                              .update({
                                published: !j.published,
                                updated_at: new Date().toISOString(),
                              })
                              .eq("id", j.id)
                              .select("id")
                              .single();
                            if (r.error) throw r.error;
                          },
                          j.published ? "Job unpublished." : "Job published.",
                        )
                      }
                    >
                      {j.published ? "Unpublish" : "Publish"}
                    </button>
                    <button
                      className="btn danger small"
                      disabled={busy}
                      onClick={() => {
                        if (
                          confirm(
                            `Delete “${j.title}”? This removes it from the website.`,
                          )
                        )
                          void action(async () => {
                            const r = await db()
                              .from("jobs")
                              .delete()
                              .eq("id", j.id)
                              .select("id")
                              .single();
                            if (r.error) throw r.error;
                          }, "Job deleted.");
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
          </section>
        </>
      )}
      {tab === "people" && (
        <>
          <Heading eyebrow="People" title="Candidates">
            Review onboarding documents and help each person get ready.
          </Heading>
          <section className="panel">
            <label className="form">
              Select a candidate
              <select
                value={person}
                onChange={(e) => setPerson(e.target.value)}
              >
                <option value="">All accounts</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name || p.email}
                  </option>
                ))}
              </select>
            </label>
            {people
              .filter((p) => !person || p.id === person)
              .map((p) => (
                <div className="list-row" key={p.id}>
                  <div>
                    <h3>{p.full_name || "New account"}</h3>
                    <p className="muted">{p.email}</p>
                  </div>
                  <span className="muted small-text">
                    Joined {formatDate(p.created_at)}
                  </span>
                </div>
              ))}
          </section>
          <section className="panel">
            <h2>Onboarding documents</h2>
            {documents.filter((d) => !person || d.candidate_id === person)
              .length ? (
              documents
                .filter((d) => !person || d.candidate_id === person)
                .map((d) => (
                  <div className="list-row" key={d.id}>
                    <div>
                      <h3 className="document-name">{d.name}</h3>
                      <p className="muted">
                        {name(d.candidate_id)} · {d.category} ·{" "}
                        {formatDate(d.created_at)}
                      </p>
                    </div>
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
                      Download
                    </button>
                  </div>
                ))
            ) : (
              <Empty title="No documents yet">
                Candidate uploads will appear here, ready for review.
              </Empty>
            )}
          </section>
        </>
      )}
      {tab === "contracts" && (
        <>
          <Heading eyebrow="Onboarding" title="Contracts">
            Share a PDF with a candidate and track their signature.
          </Heading>
          <section className="panel">
            <h2>Share a contract</h2>
            <form className="form" onSubmit={uploadContract}>
              <div className="form-columns">
                <label>
                  Candidate
                  <select name="candidate" required defaultValue="">
                    <option value="" disabled>
                      Select an account
                    </option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name || p.email}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Contract title
                  <input
                    name="title"
                    required
                    maxLength={200}
                    placeholder="Employment agreement"
                  />
                </label>
              </div>
              <label>
                PDF document
                <input
                  name="file"
                  type="file"
                  accept="application/pdf"
                  required
                />
                <span className="muted">
                  Up to 10 MB. Shared contracts are retained as an exact
                  version.
                </span>
              </label>
              <div>
                <button className="btn" disabled={busy || !people.length}>
                  Share contract
                </button>
              </div>
            </form>
          </section>
          <section className="panel">
            <h2>Shared contracts</h2>
            {!contracts.length && (
              <Empty title="No contracts shared">
                Select a candidate above to send their first contract.
              </Empty>
            )}
            {contracts.map((c) => {
              const signed = signatures.find((s) => s.contract_id === c.id);
              return (
                <div className="list-row" key={c.id}>
                  <div>
                    <h3>{c.title}</h3>
                    <p className="muted">
                      {name(c.candidate_id)} · {formatDate(c.created_at)}
                    </p>
                    <Pill status={signed ? "signed" : "pending"} />
                    {signed && (
                      <p className="small-text muted">
                        Signed by {signed.signer_name} on{" "}
                        {formatDate(signed.signed_at)}
                      </p>
                    )}
                  </div>
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
                </div>
              );
            })}
          </section>
        </>
      )}
      {tab === "requests" && (
        <>
          <Heading eyebrow="Team enablement" title="Tool requests">
            Review what candidates need to do their best work.
          </Heading>
          <section className="panel">
            {!requests.length && (
              <Empty title="All clear">
                New access requests will appear here for review.
              </Empty>
            )}
            {requests.map((r) => (
              <div className="list-row" key={r.id}>
                <div>
                  <h3>{r.tool_name}</h3>
                  <p className="muted">
                    {name(r.candidate_id)} · {formatDate(r.created_at)}
                  </p>
                  <p className="wrap">{r.reason}</p>
                  <Pill status={r.status} />
                  {r.admin_note && (
                    <p className="small-text">Your response: {r.admin_note}</p>
                  )}
                </div>
                <form
                  className="form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void action(async () => {
                      const result = await db()
                        .from("tool_requests")
                        .update({
                          status: String(f.get("status")),
                          admin_note: String(f.get("note")),
                        })
                        .eq("id", r.id)
                        .select("id")
                        .single();
                      if (result.error) throw result.error;
                    }, "Request updated.");
                  }}
                >
                  <label>
                    Decision
                    <select name="status" defaultValue={r.status}>
                      <option value="pending">Pending</option>
                      <option value="approved">Approved</option>
                      <option value="declined">Declined</option>
                    </select>
                  </label>
                  <label>
                    Response to candidate
                    <input
                      name="note"
                      defaultValue={r.admin_note}
                      maxLength={1000}
                      placeholder="Next steps or a short explanation"
                    />
                  </label>
                  <button className="btn secondary small" disabled={busy}>
                    Save response
                  </button>
                </form>
              </div>
            ))}
          </section>
        </>
      )}
      {tab === "account" && (
        <>
          <Heading eyebrow="Your workspace" title="Account">
            Manage your password and access.
          </Heading>
          <section className="panel" style={{ maxWidth: 550 }}>
            <p className="muted">Signed in as {email}</p>
            <PasswordForm />
          </section>
        </>
      )}
      {loading && (
        <p className="muted" role="status">
          Refreshing workspace…
        </p>
      )}
    </Shell>
  );
}
