import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Plus, RefreshCw, Search, UserPlus, X } from "lucide-react";
import { db, errorMessage, type Job } from "@quicksort/hr-db";
import { Notice, Empty, Pill, formatDate } from "@quicksort/hr-ui";
import { loadWorkspace, executeCommand } from "../hr/data";
import type { Person, Application, Opportunity } from "../hr/domain";

export function Opportunities({ actorEmail }: { actorEmail: string }) {
  const [opportunities, setOpportunities] = useState<
    RowOpportunity[]
  >([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<RowOpportunity | null | undefined>(undefined);

  /** Close the opportunity modal with Escape, like the backdrop click. */
  useEffect(() => {
    if (editing === undefined) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setEditing(undefined);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [editing]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [workspace, jobResult] = await Promise.all([
        loadWorkspace(), db().from("jobs").select("*").order("created_at", { ascending: false }),
      ]);
      if (jobResult.error) throw jobResult.error;
      setOpportunities(workspace.opportunities);
      setJobs(jobResult.data || []);
      setPeople(workspace.people);
      setApplications(workspace.applications);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = "Opportunities · Quicksort Admin";
    void load();
  }, [load]);

  async function action(work: () => Promise<void>, success: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
      setMessage(success);
      setEditing(undefined);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const values = {
      title: String(f.get("title")).trim(),
      hiring_mode: String(f.get("hiring_mode")),
      job_id: String(f.get("job_id") || "") || null,
      client_need: String(f.get("client_need")).trim(),
      skill_family: String(f.get("skill_family")).trim(),
      owner_email: String(f.get("owner_email")).trim() || actorEmail,
      target_tjm: f.get("target_tjm") ? Number(f.get("target_tjm")) : null,
      justification: String(f.get("justification")).trim(),
    };
    void action(async () => {
      await executeCommand(editing
        ? { kind: "update_requisition", opportunity_id: editing.id, expected_version: editing.version, ...values }
        : { kind: "create_requisition", ...values });
    }, "Opportunity saved.");
  }

  function linkPerson(e: FormEvent<HTMLFormElement>, r: RowOpportunity) {
    e.preventDefault();
    const personId = String(new FormData(e.currentTarget).get("person_id") || "");
    if (!personId) return;
    void action(async () => {
      await executeCommand({ kind: "create_application", person_id: personId, opportunity_id: r.id });
    }, "Application created. Existing applications remain linked to their own opportunities.");
  }

  const query = search.toLowerCase();
  const visible = opportunities.filter(
    (r) =>
      !query ||
      r.title.toLowerCase().includes(query) ||
      r.skill_family.toLowerCase().includes(query),
  );

  return (
    <>
      <div className="sales-actions">
        <button className="btn" onClick={() => setEditing(null)}>
          <Plus size={16} />
          New opportunity
        </button>
      </div>
      <Notice error>{error}</Notice>
      <Notice>{message}</Notice>
      {editing !== undefined && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditing(undefined);
          }}
        >
          <section className="modal" role="dialog" aria-modal="true">
            <div className="modal-head">
              <h2>{editing ? "Edit opportunity" : "Create an opportunity"}</h2>
              <button
                type="button"
                className="btn secondary small"
                aria-label="Close"
                onClick={() => setEditing(undefined)}
              >
                <X size={16} />
              </button>
            </div>
            <form className="form" key={editing?.id || "new"} onSubmit={save}>
            <div className="form-columns">
              <label>
                Role title
                <input name="title" defaultValue={editing?.title} required maxLength={200} />
              </label>
              <label>
                Hiring mode
                <select name="hiring_mode" defaultValue={editing?.hiring_mode || "sur_mission"}>
                  <option value="sur_mission">Sur mission (client need)</option>
                  <option value="sur_profil">Sur profil (speculative)</option>
                </select>
              </label>
              <label>
                Skill family
                <input name="skill_family" defaultValue={editing?.skill_family} maxLength={200} placeholder="e.g. Data engineering" />
              </label>
              <label>
                Owner (Business Manager)
                <input name="owner_email" type="email" defaultValue={editing?.owner_email || actorEmail} maxLength={200} />
              </label>
              <label>
                Career-site job post (optional)
                <select name="job_id" defaultValue={editing?.job_id || ""}>
                  <option value="">Not linked</option>
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.title}
                      {j.published ? "" : " (draft)"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Target TJM (€ / day)
                <input name="target_tjm" type="number" min="0" step="10" defaultValue={editing?.target_tjm ?? ""} />
              </label>
            </div>
            <label>
              Client need / fiche de besoin
              <textarea
                name="client_need"
                defaultValue={editing?.client_need}
                rows={4}
                maxLength={5000}
                placeholder="Mandatory vs nice-to-have skills, seniority, location, duration, billing mode, start date…"
              />
            </label>
            <label>
              Pipeline justification (sur profil only)
              <textarea
                name="justification"
                defaultValue={editing?.justification}
                rows={3}
                maxLength={5000}
                placeholder="Expected utilization from probability-weighted pipeline demand, bench count, time-to-staff history…"
              />
            </label>
            <div className="actions">
              <button className="btn" disabled={busy}>
                Save opportunity
              </button>
              <button type="button" className="btn secondary" onClick={() => setEditing(undefined)}>
                Cancel
              </button>
            </div>
            </form>
          </section>
        </div>
      )}
      <section className="panel">
        <div className="toolbar">
          <Search size={18} />
          <input
            aria-label="Search opportunities"
            placeholder="Search opportunities…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn secondary small" disabled={loading} onClick={() => void load()}>
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
        {!opportunities.length && !loading && (
          <Empty title="No opportunities yet">
            Create the first opportunity to open the funnel.
          </Empty>
        )}
        {visible.map((r) => {
          const job = jobs.find((j) => j.id === r.job_id);
          const linked = applications.filter(a => a.opportunity_id === r.id);
          const linkable = people.filter(p => !linked.some(a => a.person_id === p.id && a.status === "active"));
          return (
            <div className="list-row" key={r.id}>
              <div>
                <h3>{r.title}</h3>
                <p className="muted">
                  {r.hiring_mode === "sur_mission" ? "Sur mission" : "Sur profil"}
                  {r.skill_family ? ` · ${r.skill_family}` : ""}
                  {r.target_tjm ? ` · target ${r.target_tjm} €/day` : ""}
                  {job ? ` · ${job.title}` : ""}
                </p>
                <Pill status={r.status} />
                {!!linked.length && (
                  <div className="people-chips" style={{ marginTop: 8 }}>
                    {linked.map((a) => (
                      <span className={`pill ${a.status}`} key={a.id}>
                        {people.find(p => p.id === a.person_id)?.full_name || "Person"} · {a.status}
                      </span>
                    ))}
                  </div>
                )}
                <form className="inline-form" style={{ marginTop: 8, maxWidth: 420 }} onSubmit={(e) => linkPerson(e, r)}>
                  <label style={{ flex: 1 }}>
                    <span className="muted small-text">Create an application</span>
                    <select name="person_id" defaultValue="" required>
                      <option value="" disabled>
                        Select a person…
                      </option>
                      {linkable.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.full_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="btn secondary small" disabled={busy || !linkable.length}>
                    <UserPlus size={14} />
                    Apply
                  </button>
                </form>
                {!linkable.length && (
                  <p className="small-text muted">
                    No available people — add a person in HR first.
                  </p>
                )}
                {r.decided_by && (
                  <p className="small-text muted">
                    {r.decided_by} on {formatDate(r.decided_at || r.updated_at)}: {r.decision_rationale}
                  </p>
                )}
              </div>
              <div className="actions">
                {r.status === "draft" && (
                  <button className="btn secondary small" disabled={busy} onClick={() => setEditing(r)}>Edit</button>
                )}
                {r.status === "approved" && (
                  <button
                    className="btn small"
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        if (!r.job_id) throw new Error("Link a career-site job post before publishing.");
                        await executeCommand({ kind: "publish_requisition", opportunity_id: r.id, expected_version: r.version, job_id: r.job_id });
                      }, "Opportunity published — sourcing can start.")
                    }
                  >
                    Publish
                  </button>
                )}
                {r.status === "published" && <Pill status="live" />}
                {r.status === "filled" && <Pill status="signed" />}
              </div>
            </div>
          );
        })}
      </section>
    </>
  );
}

type RowOpportunity = Opportunity;
