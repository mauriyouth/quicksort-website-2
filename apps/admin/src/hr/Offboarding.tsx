import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { db, errorMessage } from "@quicksort/hr-db";
import { Notice, Empty, Pill, formatDate } from "@quicksort/hr-ui";
import type { Candidate, OffboardingItem, OffboardingRecord } from "./data";

const KINDS = [
  { key: "resignation", label: "Resignation" },
  { key: "rupture_conventionnelle", label: "Rupture conventionnelle" },
  { key: "dismissal", label: "Dismissal" },
  { key: "probation_end", label: "End of probation" },
  { key: "cdd_end", label: "End of CDD" },
] as const;

const DEFAULT_CHECKLIST = [
  "Internal announcement sequenced (after exit date fixed)",
  "Client notification plan executed",
  "Knowledge transfer documentation complete",
  "Successor identified & introduced to client",
  "Access & credentials revoked / transferred",
  "Equipment returned",
  "Exit interview held",
  "Legal documents generated: certificat de travail, solde de tout compte, attestation France Travail",
];

/**
 * Offboarding — prd-hr.md §6.3. A managed, date-bound workflow per separation
 * type: préavis tracking, a mandatory mission handover plan (completion gate),
 * legal document tracking, exit-interview notes and alumni conversion with a
 * rehire flag. The record returns to the CVthèque with history intact
 * (FR-6.3.5).
 */
export function Offboarding({ actorEmail }: { actorEmail: string }) {
  const [records, setRecords] = useState<OffboardingRecord[]>([]);
  const [items, setItems] = useState<OffboardingItem[]>([]);
  const [people, setPeople] = useState<Candidate[]>([]);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const results = await Promise.all([
        db().from("offboarding_records").select("*").order("exit_date", { ascending: false }),
        db().from("offboarding_items").select("*").order("created_at"),
        db().from("pipeline_candidates").select("*").neq("person_status", "alumni"),
      ]);
      for (const r of results) if (r.error) throw r.error;
      setRecords(results[0].data || []);
      setItems(results[1].data || []);
      setPeople(results[2].data || []);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = "Offboarding · Quicksort Admin";
    void load();
  }, [load]);

  async function action(work: () => Promise<void>, success: string) {
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

  function start(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void action(async () => {
      const result = await db()
        .from("offboarding_records")
        .insert({
          candidate_id: String(f.get("candidate_id")),
          kind: String(f.get("kind")),
          exit_date: String(f.get("exit_date")),
          notice_end: String(f.get("notice_end") || "") || null,
        })
        .select("id")
        .single();
      if (result.error) throw result.error;
      const checklist = DEFAULT_CHECKLIST.map((title) => ({
        offboarding_id: result.data.id,
        title,
      }));
      const itemRows = await db().from("offboarding_items").insert(checklist);
      if (itemRows.error) throw itemRows.error;
      setAdding(false);
      setSelected(result.data.id);
    }, "Offboarding workflow opened with its checklist.");
  }

  const current = records.find((r) => r.id === selected) || null;
  const name = (id: string) => people.find((p) => p.id === id)?.full_name || "Consultant";
  const open = records.filter((r) => r.status === "open");
  const done = records.filter((r) => r.status === "completed");

  return (
    <>
      <div className="hr-actions">
        <button className="btn" onClick={() => setAdding(true)}>
          <Plus size={16} />
          Open an exit
        </button>
      </div>
      <Notice error>{error}</Notice>
      <Notice>{message}</Notice>
      {adding && (
        <section className="panel">
          <h2>Open an offboarding</h2>
          <form className="form" onSubmit={start}>
            <div className="form-columns">
              <label>
                Consultant
                <select name="candidate_id" required defaultValue="">
                  <option value="" disabled>
                    Select a person
                  </option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Separation type
                <select name="kind" defaultValue="resignation">
                  {KINDS.map((k) => (
                    <option key={k.key} value={k.key}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Exit date
                <input name="exit_date" type="date" required />
              </label>
              <label>
                Préavis end (notice period)
                <input name="notice_end" type="date" />
              </label>
            </div>
            <div className="actions">
              <button className="btn" disabled={busy || !people.length}>
                Open workflow
              </button>
              <button type="button" className="btn secondary" onClick={() => setAdding(false)}>
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}
      <section className="panel">
        <div className="panel-head">
          <h2>In progress ({open.length})</h2>
          <button className="btn secondary small" disabled={loading} onClick={() => void load()}>
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
        {!open.length && !loading && (
          <Empty title="No departures in flight">
            Offboarding workflows will appear here when an exit is opened.
          </Empty>
        )}
        {open.map((r) => {
          const checklist = items.filter((i) => i.offboarding_id === r.id);
          const doneCount = checklist.filter((i) => i.done).length;
          return (
            <div className="list-row" key={r.id}>
              <div>
                <h3>{name(r.candidate_id)}</h3>
                <p className="muted small-text">
                  {KINDS.find((k) => k.key === r.kind)?.label} · exit {formatDate(r.exit_date)}
                  {r.notice_end ? ` · préavis until ${formatDate(r.notice_end)}` : ""} · checklist{" "}
                  {doneCount}/{checklist.length}
                </p>
                <Pill status={r.status} />
              </div>
              <button className="btn secondary small" onClick={() => setSelected(r.id)}>
                Manage
              </button>
            </div>
          );
        })}
      </section>
      {current && (
        <section className="panel">
          <div className="panel-head">
            <h2>Exit — {name(current.candidate_id)}</h2>
            <button className="btn secondary small" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
          <p className="muted small-text">
            {KINDS.find((k) => k.key === current.kind)?.label} · exit {formatDate(current.exit_date)}
            {current.notice_end
              ? ` · préavis until ${formatDate(current.notice_end)} (${Math.max(
                  0,
                  Math.ceil((new Date(current.notice_end).getTime() - Date.now()) / 86400000),
                )} days left)`
              : ""}
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={current.prerequis_waived}
              disabled={busy}
              onChange={(e) =>
                void action(async () => {
                  const result = await db()
                    .from("offboarding_records")
                    .update({ prerequis_waived: e.target.checked })
                    .eq("id", current.id)
                    .select("id")
                    .single();
                  if (result.error) throw result.error;
                }, e.target.checked ? "Préavis waived by mutual agreement." : "Préavis reinstated.")
              }
            />
            Préavis waived / reduced by mutual agreement (FR-6.3.2)
          </label>

          <h3 className="subsection-title">Checklist</h3>
          {items
            .filter((i) => i.offboarding_id === current.id)
            .map((item) => (
              <div className="check-row" key={item.id}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={item.done}
                    disabled={busy}
                    onChange={(e) =>
                      void action(async () => {
                        const result = await db()
                          .from("offboarding_items")
                          .update({
                            done: e.target.checked,
                            done_at: e.target.checked ? new Date().toISOString() : null,
                          })
                          .eq("id", item.id)
                          .select("id")
                          .single();
                        if (result.error) throw result.error;
                      }, e.target.checked ? "Checklist item done." : "Checklist item reopened.")
                    }
                  />
                  <span className={item.done ? "done-text" : ""}>{item.title}</span>
                </label>
              </div>
            ))}
          <form
            className="form"
            style={{ marginTop: 10 }}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void action(async () => {
                const result = await db()
                  .from("offboarding_items")
                  .insert({ offboarding_id: current.id, title: String(f.get("title")).trim() })
                  .select("id")
                  .single();
                if (result.error) throw result.error;
                e.currentTarget.reset();
              }, "Checklist item added.");
            }}
          >
            <div className="actions">
              <input name="title" required maxLength={300} placeholder="Add a checklist item" style={{ maxWidth: 340 }} />
              <button className="btn secondary small" disabled={busy}>
                <Plus size={14} />
                Add
              </button>
            </div>
          </form>

          <h3 className="subsection-title">Mission handover plan (completion gate)</h3>
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void action(async () => {
                const result = await db()
                  .from("offboarding_records")
                  .update({
                    handover_plan: String(f.get("handover_plan")).trim(),
                    successor: String(f.get("successor")).trim(),
                  })
                  .eq("id", current.id)
                  .select("id")
                  .single();
                if (result.error) throw result.error;
              }, "Handover plan saved (FR-6.3.3).");
            }}
          >
            <label>
              Handover plan — documentation, successor, client introduction, credential transfer
              <textarea
                name="handover_plan"
                rows={4}
                maxLength={5000}
                defaultValue={current.handover_plan}
                placeholder="Where knowledge lives, who picks it up, when the client meets the successor…"
              />
            </label>
            <label>
              Successor
              <input name="successor" maxLength={200} defaultValue={current.successor} />
            </label>
            <button className="btn secondary small" disabled={busy}>
              Save handover plan
            </button>
          </form>

          <h3 className="subsection-title">Exit interview & alumni</h3>
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void action(async () => {
                const result = await db()
                  .from("offboarding_records")
                  .update({
                    exit_interview: String(f.get("exit_interview")).trim(),
                    rehire_eligible: f.get("rehire_eligible") === "on",
                    rehire_rationale: String(f.get("rehire_rationale")).trim(),
                    legal_docs_done: f.get("legal_docs_done") === "on",
                  })
                  .eq("id", current.id)
                  .select("id")
                  .single();
                if (result.error) throw result.error;
              }, "Exit record saved.");
            }}
          >
            <label>
              Exit interview notes (motives, management, mission, compensation, tools)
              <textarea name="exit_interview" rows={3} maxLength={5000} defaultValue={current.exit_interview} />
            </label>
            <label>
              Rehire rationale
              <input name="rehire_rationale" maxLength={2000} defaultValue={current.rehire_rationale} />
            </label>
            <label className="check">
              <input type="checkbox" name="rehire_eligible" defaultChecked={current.rehire_eligible === true} />
              Rehire-eligible (surfaces in CVthèque rediscovery)
            </label>
            <label className="check">
              <input type="checkbox" name="legal_docs_done" defaultChecked={current.legal_docs_done} />
              Legal documents delivered & receipted (certificat de travail, solde de tout compte,
              attestation France Travail — FR-6.3.6)
            </label>
            <button className="btn secondary small" disabled={busy}>
              Save exit record
            </button>
          </form>

          <div className="actions" style={{ marginTop: 14 }}>
            <button
              className="btn"
              disabled={busy}
              onClick={() => {
                const checklist = items.filter((i) => i.offboarding_id === current.id);
                const openItems = checklist.filter((i) => !i.done);
                if (openItems.length) {
                  alert(
                    `Checklist gate: ${openItems.length} item(s) still open, including the handover plan. Close them first (FR-6.3.3).`,
                  );
                  return;
                }
                if (!current.legal_docs_done) {
                  alert("Legal documents must be delivered and receipted before closing (FR-6.3.6).");
                  return;
                }
                if (!confirm(`Complete offboarding for ${name(current.candidate_id)}? The record becomes alumni.`)) return;
                void action(async () => {
                  const now = new Date().toISOString();
                  const closed = await db()
                    .from("offboarding_records")
                    .update({ status: "completed", completed_at: now })
                    .eq("id", current.id)
                    .select("id")
                    .single();
                  if (closed.error) throw closed.error;
                  const updated = await db()
                    .from("pipeline_candidates")
                    .update({
                      person_status: "alumni",
                      stage: "offboarding",
                      disposition: null,
                      updated_at: now,
                    })
                    .eq("id", current.candidate_id)
                    .select("id")
                    .single();
                  if (updated.error) throw updated.error;
                  const event = await db()
                    .from("pipeline_events")
                    .insert({
                      candidate_id: current.candidate_id,
                      from_stage: "offboarding",
                      to_stage: "alumni",
                      actor_email: actorEmail,
                      rationale: "Employee → alumni conversion. Skills snapshot and history preserved for rediscovery (FR-6.3.5).",
                    })
                    .select("id")
                    .single();
                  if (event.error) throw event.error;
                }, "Offboarding complete — the alum is back in the talent pool.");
              }}
            >
              Complete offboarding
            </button>
            <span className="muted small-text">
              The checklist and legal documents are hard gates; closing converts the record to
              alumni with history intact.
            </span>
          </div>
        </section>
      )}
      <section className="panel">
        <h2>Completed — alumni ({done.length})</h2>
        {done.slice(0, 10).map((r) => (
          <div className="list-row" key={r.id}>
            <div>
              <h3>{name(r.candidate_id)}</h3>
              <p className="muted small-text">
                Exited {formatDate(r.exit_date)} · rehire{" "}
                {r.rehire_eligible === true ? "eligible" : r.rehire_eligible === false ? "not eligible" : "undecided"}
              </p>
              <Pill status="signed" />
            </div>
          </div>
        ))}
      </section>
    </>
  );
}
