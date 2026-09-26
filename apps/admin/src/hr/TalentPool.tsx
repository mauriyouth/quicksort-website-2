import { useState } from "react";
import { Empty, Pill, formatDate } from "@quicksort/hr-ui";
import { sourceLabel, stageLabel } from "./stages";
import type { Candidate, Opportunity } from "./data";

/**
 * Talent pool — the CVthèque as a Pipeline view (prd-hr.md §1.3). One
 * canonical record per person: candidates in flight, employees, alumni and
 * rejected/withdrawn profiles stay searchable for rediscovery. Lifecycle
 * chips narrow the list; opening a row lands on the same candidate record
 * used everywhere else on the page.
 */
type Lifecycle = "in-funnel" | "employees" | "alumni" | "exited" | "all";

const LIFECYCLES: { key: Lifecycle; label: string }[] = [
  { key: "all", label: "Everyone" },
  { key: "in-funnel", label: "In funnel" },
  { key: "employees", label: "Employees" },
  { key: "alumni", label: "Alumni" },
  { key: "exited", label: "Rejected / withdrawn" },
];

export function TalentPool({
  candidates,
  total,
  opportunities,
  onOpen,
}: {
  /** Everyone in the CVthèque, already narrowed by the page search box. */
  candidates: Candidate[];
  /** People in the CVthèque before the page search box is applied. */
  total: number;
  opportunities: Opportunity[];
  onOpen: (id: string) => void;
}) {
  const [lifecycle, setLifecycle] = useState<Lifecycle>("all");

  const visible = candidates.filter((c) => {
    switch (lifecycle) {
      case "in-funnel":
        return !c.disposition && c.person_status === "candidate";
      case "employees":
        return c.person_status === "employee";
      case "alumni":
        return c.person_status === "alumni";
      case "exited":
        return !!c.disposition && c.person_status === "candidate";
      default:
        return true;
    }
  });

  return (
    <div>
      <div className="pool-chips" role="tablist" aria-label="Talent pool filter">
        {LIFECYCLES.map((l) => (
          <button
            key={l.key}
            role="tab"
            aria-selected={lifecycle === l.key}
            className={`pool-chip${lifecycle === l.key ? " active" : ""}`}
            onClick={() => setLifecycle(l.key)}
          >
            {l.label}
            <span className="pool-chip-count">
              {
                candidates.filter((c) => {
                  switch (l.key) {
                    case "in-funnel":
                      return !c.disposition && c.person_status === "candidate";
                    case "employees":
                      return c.person_status === "employee";
                    case "alumni":
                      return c.person_status === "alumni";
                    case "exited":
                      return !!c.disposition && c.person_status === "candidate";
                    default:
                      return true;
                  }
                }).length
              }
            </span>
          </button>
        ))}
      </div>

      {!total && (
        <Empty title="The talent pool is empty">
          Drop a resume PDF or use “Add candidate” to create the first record.
        </Empty>
      )}
      {!candidates.length && !!total && (
        <Empty title="No one matches your search">
          Try a different name, email or skill — or clear the search box.
        </Empty>
      )}
      {!!candidates.length && !visible.length && (
        <Empty title="No one matches this filter">
          Try another lifecycle — or clear the search box.
        </Empty>
      )}

      {visible.map((c) => {
        const role = opportunities.find((o) => o.id === c.opportunity_id);
        return (
          <div className="list-row" key={c.id}>
            <div>
              <h3>{c.full_name}</h3>
              <p className="muted">
                {sourceLabel(c.source)}
                {c.referrer ? ` · referred by ${c.referrer}` : ""} ·{" "}
                {stageLabel(c.stage)} · added {formatDate(c.created_at)}
              </p>
              <span className="actions">
                <Pill
                  status={
                    c.person_status === "employee"
                      ? "approved"
                      : c.person_status === "alumni"
                        ? "signed"
                        : c.disposition || "pending"
                  }
                />
                {c.match_score !== null && (
                  <span className="score-chip">{c.match_score}% match</span>
                )}
                {role && <span className="score-chip">{role.title}</span>}
              </span>
            </div>
            <button className="btn secondary small" onClick={() => onOpen(c.id)}>
              Open
            </button>
          </div>
        );
      })}
    </div>
  );
}
