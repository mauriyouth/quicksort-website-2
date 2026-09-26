import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Search, Users, UserCheck, GraduationCap, AlarmClock, Archive } from "lucide-react";
import { db, errorMessage } from "@quicksort/hr-db";
import { Empty, Notice, Pill, Stat, formatDate } from "@quicksort/hr-ui";
import { stageLabel } from "./stages";
import type { Candidate, Opportunity } from "./data";

const FILTERS = [
  { key: "all", label: "Everyone" },
  { key: "preboarding", label: "Pre-boarding" },
  { key: "onboarding", label: "Onboarding" },
  { key: "probation", label: "Probation" },
  { key: "confirmed", label: "Confirmed" },
  { key: "alumni", label: "Alumni" },
] as const;

type Filter = (typeof FILTERS)[number]["key"];

/**
 * Employees — the directory of everyone past the hire gate (prd-hr.md §6):
 * pre-boarding, onboarding, probation and confirmed employees, plus alumni.
 * Day-to-day workflows live in the Pipeline's Onboarding / Offboarding views;
 * this page is the canonical "who works here, where are they in their
 * journey" overview. One record per person — history stays intact.
 */
export function Employees() {
  const [people, setPeople] = useState<Candidate[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const results = await Promise.all([
        db()
          .from("pipeline_candidates")
          .select("*")
          .in("person_status", ["employee", "alumni"])
          .order("updated_at", { ascending: false }),
        db().from("opportunities").select("*"),
      ]);
      for (const r of results) if (r.error) throw r.error;
      setPeople(results[0].data || []);
      setOpportunities(results[1].data || []);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = "Employees · Quicksort Admin";
    void load();
  }, [load]);

  const employees = people.filter((p) => p.person_status === "employee");
  const alumni = people.filter((p) => p.person_status === "alumni");

  const probationAlerts = employees.filter((p) => {
    if (!p.probation_end || p.stage === "confirmed") return false;
    const days = (new Date(p.probation_end).getTime() - Date.now()) / 86400000;
    return days <= 30 && days >= -15;
  });

  const query = search.toLowerCase();
  const visible = people.filter((p) => {
    if (filter === "alumni" && p.person_status !== "alumni") return false;
    if (filter !== "all" && filter !== "alumni" && p.stage !== filter) return false;
    if (
      query &&
      !p.full_name.toLowerCase().includes(query) &&
      !(p.email || "").toLowerCase().includes(query) &&
      !(p.skills || "").toLowerCase().includes(query)
    )
      return false;
    return true;
  });

  const role = (p: Candidate) =>
    opportunities.find((o) => o.id === p.opportunity_id)?.title || "—";

  return (
    <>
      <Notice error>{error}</Notice>
      <div className="stats">
        <Stat
          label="Employees"
          value={employees.length}
          detail="Pre-boarding to confirmed"
          icon={Users}
        />
        <Stat
          label="Onboarding"
          value={employees.filter((p) => p.stage === "onboarding").length}
          detail="Inside the 30-day plan"
          icon={GraduationCap}
        />
        <Stat
          label="Probation alerts"
          value={probationAlerts.length}
          detail="Decision due within 30 days"
          icon={AlarmClock}
        />
        <Stat
          label="Alumni"
          value={alumni.length}
          detail="Rehire-eligible profiles kept warm"
          icon={Archive}
        />
      </div>
      <section className="panel">
        <div className="toolbar">
          <Search size={18} />
          <input
            aria-label="Search employees"
            placeholder="Search employees or alumni…"
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
        <div className="view-menu" aria-label="Employee filters" style={{ marginBottom: 12 }}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              aria-pressed={filter === f.key}
              className={filter === f.key ? "active" : ""}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        {!visible.length && !loading && (
          <Empty title="No one here yet">
            People appear here once they’re marked as hired in the pipeline —
            the conversion keeps their full history (FR-5.4.1).
          </Empty>
        )}
        {visible.map((p) => {
          const probationDays = p.probation_end
            ? Math.ceil((new Date(p.probation_end).getTime() - Date.now()) / 86400000)
            : null;
          const alert =
            probationDays !== null &&
            p.stage !== "confirmed" &&
            probationDays <= 30 &&
            probationDays >= -15;
          return (
            <div className="list-row" key={p.id}>
              <div>
                <h3>{p.full_name}</h3>
                <p className="muted small-text">
                  {p.person_status === "alumni" ? "Alumni" : role(p)}
                  {p.start_date ? ` · started ${formatDate(p.start_date)}` : ""}
                  {p.parrain ? ` · parrain: ${p.parrain}` : ""}
                  {probationDays !== null && p.stage !== "confirmed"
                    ? ` · probation ends ${formatDate(p.probation_end!)}${
                        probationDays >= 0
                          ? ` (${probationDays}d left)`
                          : ` (overdue ${-probationDays}d)`
                      }`
                    : ""}
                </p>
                <Pill status={p.person_status === "alumni" ? "signed" : p.stage} />
              </div>
              <div className="actions">
                {alert && (
                  <span className="card-badge near">
                    <UserCheck size={12} /> Decision due
                  </span>
                )}
                <span className="muted small-text">
                  {p.person_status === "alumni" ? "Exited" : stageLabel(p.stage)}
                </span>
              </div>
            </div>
          );
        })}
      </section>
      <p className="muted small-text">
        Manage a hire’s plan from the Pipeline → Onboarding view and a departure
        from Pipeline → Offboarding. The pipeline owns every lifecycle move;
        this page is the directory.
      </p>
    </>
  );
}
