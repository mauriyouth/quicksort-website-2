import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Plus, RefreshCw, Search, UserPlus, X } from "lucide-react";
import { db, errorMessage, type Job, type Row } from "@quicksort/hr-db";
import { Notice, Empty, Pill, formatDate } from "@quicksort/hr-ui";

/**
 * Opportunities — prd-hr.md FR-4.1, now owned by Sales (§3 commercial
 * funnel). Two origins (client need / speculative profile), mandatory
 * hiring-mode tag (§3.3) and an approval workflow with a logged rationale
 * (FR-4.1.2). Sur profil offers stay blocked until the
 * pipeline-justification gate is passed. Candidates and employees (the
 * canonical pipeline record, any person_status) can be linked to an
 * opportunity for staffing or follow-up.
 */
export function Opportunities({ actorEmail }: { actorEmail: string }) {
  const [opportunities, setOpportunities] = useState<
    RowOpportunity[]
  >([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [people, setPeople] = useState<RowPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<RowOpportunity | null | undefined>(undefined);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const results = await Promise.all([
        db().from("opportunities").select("*").order("created_at", { ascending: false }),
        db().from("jobs").select("*").order("created_at", { ascending: false }),
        db()
          .from("pipeline_candidates")
          .select("*")
          .order("created_at", { ascending: false }),
      ]);
      for (const r of results) if (r.error) throw r.error;
      setOpportunities(results[0].data || []);
      setJobs(results[1].data || []);
      setPeople(results[2].data || []);
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
      updated_at: new Date().toISOString(),
    };
    void action(async () => {
      const result = editing
        ? await db().from("opportunities").update(values).eq("id", editing.id).select("id").single()
        : await db().from("opportunities").insert(values).select("id").single();
      if (result.error) throw result.error;
    }, "Opportunity saved.");
  }

  function decide(r: RowOpportunity, decision: "approved" | "rejected") {
    const rationale = window.prompt(
      `${decision === "approved" ? "Approve" : "Reject"} “${r.title}” — rationale (required):`,
      "",
    );
    if (rationale === null) return;
    if (!rationale.trim()) {
      setError("A decision rationale is required for the audit log.");
      return;
    }
    void action(async () => {
      const result = await db()
        .from("opportunities")
        .update({
          status: decision,
          decided_by: actorEmail,
          decided_at: new Date().toISOString(),
          decision_rationale: rationale.trim(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", r.id)
        .select("id")
        .single();
      if (result.error) throw result.error;
    }, `Opportunity ${decision}. Logged with rationale.`);
  }

  function submitForApproval(r: RowOpportunity) {
    if (r.hiring_mode === "sur_profil" && !r.justification.trim()) {
      setError(
        "Pipeline-justification gate: a sur profil opportunity needs a written justification before approval (prd-hr.md §3.3).",
      );
      return;
    }
    void action(async () => {
      const result = await db()
        .from("opportunities")
        .update({ status: "pending_approval", updated_at: new Date().toISOString() })
        .eq("id", r.id)
        .select("id")
        .single();
      if (result.error) throw result.error;
    }, "Opportunity submitted for approval.");
  }

  function linkPerson(e: FormEvent<HTMLFormElement>, r: RowOpportunity) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const personId = String(f.get("person_id"));
    if (!personId) return;
    void action(async () => {
      const result = await db()
        .from("pipeline_candidates")
        .update({ opportunity_id: r.id, updated_at: new Date().toISOString() })
        .eq("id", personId)
        .select("id")
        .single();
      if (result.error) throw result.error;
    }, "Person linked to the opportunity.");
  }

  function unlinkPerson(p: RowPerson) {
    void action(async () => {
      const result = await db()
        .from("pipeline_candidates")
        .update({ opportunity_id: null, updated_at: new Date().toISOString() })
        .eq("id", p.id)
        .select("id")
        .single();
      if (result.error) throw result.error;
    }, `${p.full_name} unlinked from the opportunity.`);
  }

  const linkable = people.filter((p) => !p.opportunity_id && p.person_status !== "alumni");

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
        <section className="panel">
          <h2>{editing ? "Edit opportunity" : "Create an opportunity"}</h2>
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
          const linked = people.filter((p) => p.opportunity_id === r.id);
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
                    {linked.map((p) => (
                      <span className={`pill ${p.person_status}`} key={p.id}>
                        {p.full_name}
                        <button
                          type="button"
                          className="link-button"
                          aria-label={`Unlink ${p.full_name}`}
                          title={`Unlink ${p.full_name}`}
                          disabled={busy}
                          onClick={() => unlinkPerson(p)}
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <form className="inline-form" style={{ marginTop: 8, maxWidth: 420 }} onSubmit={(e) => linkPerson(e, r)}>
                  <label style={{ flex: 1 }}>
                    <span className="muted small-text">Link a candidate or employee</span>
                    <select name="person_id" defaultValue="" required>
                      <option value="" disabled>
                        Select a person…
                      </option>
                      {linkable.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.full_name} ({p.person_status})
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="btn secondary small" disabled={busy || !linkable.length}>
                    <UserPlus size={14} />
                    Link
                  </button>
                </form>
                {!linkable.length && (
                  <p className="small-text muted">
                    No unlinked candidates or employees — add people from the HR pipeline first.
                  </p>
                )}
                {r.decided_by && (
                  <p className="small-text muted">
                    {r.decided_by} on {formatDate(r.decided_at || r.updated_at)}: {r.decision_rationale}
                  </p>
                )}
              </div>
              <div className="actions">
                {(r.status === "draft" || r.status === "rejected") && (
                  <>
                    <button className="btn secondary small" disabled={busy} onClick={() => setEditing(r)}>
                      Edit
                    </button>
                    <button className="btn small" disabled={busy} onClick={() => submitForApproval(r)}>
                      Submit for approval
                    </button>
                  </>
                )}
                {r.status === "pending_approval" && (
                  <>
                    <button className="btn small" disabled={busy} onClick={() => decide(r, "approved")}>
                      Approve
                    </button>
                    <button className="btn danger small" disabled={busy} onClick={() => decide(r, "rejected")}>
                      Reject
                    </button>
                  </>
                )}
                {r.status === "approved" && (
                  <button
                    className="btn small"
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        const result = await db()
                          .from("opportunities")
                          .update({ status: "published", updated_at: new Date().toISOString() })
                          .eq("id", r.id)
                          .select("id")
                          .single();
                        if (result.error) throw result.error;
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

type RowOpportunity = import("@quicksort/hr-db").Row<"opportunities">;
type RowPerson = Row<"pipeline_candidates">;
