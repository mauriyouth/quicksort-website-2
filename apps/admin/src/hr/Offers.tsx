import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { db, errorMessage } from "@quicksort/hr-db";
import { Notice, Empty, Pill } from "@quicksort/hr-ui";
import {
  MARGIN_CORRIDOR,
  inCorridor,
  marginPct,
} from "./stages";
import {
  type Candidate,
  type Offer,
  type Opportunity,
} from "./data";

/**
 * Offers — prd-hr.md FR-5.3.3. Unit economics are computed before issuance
 * (salary → CJM, target TJM, forecast gross margin vs the healthy 25-40%
 * corridor) and the approval chain routes HR → Direction for anything outside
 * the corridor. A declined offer is a first-class backward move: it stays on
 * the record with its reason.
 */
export function Offers({ actorEmail }: { actorEmail: string }) {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const results = await Promise.all([
        db().from("offers").select("*").order("created_at", { ascending: false }),
        db().from("pipeline_candidates").select("*"),
        db().from("opportunities").select("*"),
      ]);
      for (const r of results) if (r.error) throw r.error;
      setOffers(results[0].data || []);
      setCandidates(results[1].data || []);
      setOpportunities(results[2].data || []);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = "Offers · Quicksort Admin";
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

  function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const candidateId = String(f.get("candidate_id"));
    const candidate = candidates.find((c) => c.id === candidateId);
    const opportunityId = String(f.get("opportunity_id") || "") || candidate?.opportunity_id || null;
    const opportunity = opportunities.find((r) => r.id === opportunityId);
    const cjm = Number(f.get("cjm"));
    const targetTjm = Number(f.get("target_tjm"));
    const pct = marginPct(cjm, targetTjm);
    if (opportunity?.hiring_mode === "sur_profil" && !opportunity.justification.trim()) {
      setError("Pipeline-justification gate: this sur profil opportunity has no recorded justification (prd-hr.md §3.3).");
      return;
    }
    void action(async () => {
      const result = await db()
        .from("offers")
        .insert({
          candidate_id: candidateId,
          opportunity_id: opportunityId,
          title: String(f.get("title")).trim(),
          contract_type: String(f.get("contract_type")),
          salary_monthly: Number(f.get("salary_monthly")),
          cjm,
          target_tjm: targetTjm,
          margin_pct: pct,
          status: "pending_approval",
        })
        .select("id")
        .single();
      if (result.error) throw result.error;
      setAdding(false);
    }, `Offer created at ${pct}% margin and routed for approval.`);
  }

  function decide(offer: Offer, role: "hr" | "direction") {
    const note = window.prompt(
      `${role === "hr" ? "HR validation" : "Direction / CFO sign-off"} for “${offer.title}” — note (required):`,
      "",
    );
    if (note === null) return;
    if (!note.trim()) {
      setError("An approver note is required for the audit trail.");
      return;
    }
    void action(async () => {
      const within = inCorridor(offer.margin_pct);
      const status =
        role === "direction" || within ? "approved" : "pending_direction";
      const result = await db()
        .from("offers")
        .update({ status, approver_note: note.trim(), decided_by: actorEmail })
        .eq("id", offer.id)
        .select("id")
        .single();
      if (result.error) throw result.error;
    }, status === "pending_direction" ? "Outside corridor — routed to Direction/CFO." : "Offer approved.");
  }

  function setStatus(offer: Offer, status: string, success: string) {
    void action(async () => {
      const result = await db()
        .from("offers")
        .update({
          status,
          sent_at: status === "sent" ? new Date().toISOString() : offer.sent_at,
        })
        .eq("id", offer.id)
        .select("id")
        .single();
      if (result.error) throw result.error;
    }, success);
  }

  const name = (id: string) => candidates.find((c) => c.id === id)?.full_name || "Candidate";

  return (
    <>
      <div className="hr-actions">
        <button className="btn" onClick={() => setAdding(true)}>
          <Plus size={16} />
          New offer
        </button>
      </div>
      <Notice error>{error}</Notice>
      <Notice>{message}</Notice>
      {adding && (
        <section className="panel">
          <h2>Create an offer</h2>
          <form className="form" onSubmit={create}>
            <div className="form-columns">
              <label>
                Candidate
                <select name="candidate_id" required defaultValue="">
                  <option value="" disabled>
                    Select a candidate
                  </option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.full_name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Opportunity
                <select name="opportunity_id" defaultValue="">
                  <option value="">Candidate's opportunity</option>
                  {opportunities.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Offer title
                <input name="title" required maxLength={200} placeholder="CDI — Senior AI Engineer" />
              </label>
              <label>
                Contract type
                <select name="contract_type" defaultValue="CDI">
                  {["CDI", "CDD", "Freelance", "Internship", "Apprenticeship"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label>
                Gross salary (€ / month)
                <input name="salary_monthly" type="number" min="0" step="100" required />
              </label>
              <label>
                CJM — daily cost (€)
                <input name="cjm" type="number" min="0" step="1" required />
              </label>
              <label>
                Target TJM (€ / day)
                <input name="target_tjm" type="number" min="0" step="10" required />
              </label>
            </div>
            <MarginHint />
            <div className="actions">
              <button className="btn" disabled={busy || !candidates.length}>
                Route for approval
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
          <h2>Offers ({offers.length})</h2>
          <button className="btn secondary small" disabled={loading} onClick={() => void load()}>
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
        {!offers.length && !loading && (
          <Empty title="No offers yet">
            Create an offer from an approved decision — generation takes two
            clicks (FR-5.3.3).
          </Empty>
        )}
        {offers.map((o) => (
          <div className="list-row" key={o.id}>
            <div>
              <h3>{o.title}</h3>
              <p className="muted">
                {name(o.candidate_id)} · {o.contract_type} · {o.salary_monthly} €/month
              </p>
              <p className="small-text">
                CJM {o.cjm} € · target TJM {o.target_tjm} € · forecast margin{" "}
                <strong className={inCorridor(o.margin_pct) ? "margin-ok" : "margin-risk"}>
                  {o.margin_pct}%
                </strong>
                {" "}
                {inCorridor(o.margin_pct) ? "(in corridor)" : "(outside corridor — Direction/CFO required)"}
              </p>
              <Pill status={o.status} />
              {o.decided_by && (
                <p className="small-text muted">
                  {o.decided_by}: {o.approver_note}
                </p>
              )}
              {o.status === "declined" && (
                <p className="small-text muted">
                  Declined — first-class backward move; reason stays on the record and the
                  candidate returns to Decision.
                </p>
              )}
            </div>
            <div className="actions">
              {o.status === "pending_approval" && (
                <button className="btn small" disabled={busy} onClick={() => decide(o, "hr")}>
                  HR validate
                </button>
              )}
              {o.status === "pending_direction" && (
                <button className="btn small" disabled={busy} onClick={() => decide(o, "direction")}>
                  Direction / CFO approve
                </button>
              )}
              {o.status === "approved" && (
                <button className="btn small" disabled={busy} onClick={() => setStatus(o, "sent", "Offer sent for e-signature.")}>
                  Send offer
                </button>
              )}
              {o.status === "sent" && (
                <>
                  <button
                    className="btn small"
                    disabled={busy}
                    onClick={() => setStatus(o, "accepted", "Offer accepted — the contract gate is now open.")}
                  >
                    Accepted
                  </button>
                  <button
                    className="btn danger small"
                    disabled={busy}
                    onClick={() => {
                      const reason = window.prompt("Decline reason (stays on the record):", "");
                      if (reason === null) return;
                      void action(async () => {
                        const result = await db()
                          .from("offers")
                          .update({ status: "declined", approver_note: reason.trim() })
                          .eq("id", o.id)
                          .select("id")
                          .single();
                        if (result.error) throw result.error;
                      }, "Offer declined — recorded for offer-acceptance analytics.");
                    }}
                  >
                    Declined
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </section>
    </>
  );
}

function MarginHint() {
  return (
    <p className="muted small-text">
      Unit economics are computed before issuance (FR-5.3.3): forecast gross
      margin = (TJM − CJM) / TJM. Healthy corridor: {MARGIN_CORRIDOR.min}-
      {MARGIN_CORRIDOR.max}%. Sur profil offers additionally require the
      pipeline-justification gate.
    </p>
  );
}
