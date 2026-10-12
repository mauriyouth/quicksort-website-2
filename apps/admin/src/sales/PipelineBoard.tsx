import { useCallback, useEffect, useState } from "react";
import { useSession } from "@clerk/react";
import { RefreshCw, Search } from "lucide-react";
import { Notice, Empty } from "@quicksort/hr-ui";
import "./sales.css";

/**
 * Sales pipeline board (sales.md §8.2). Columns are the seven stages; each
 * card shows the pricing model (régie TJM × days / forfait fixed price), the
 * derived amount and the weighted value. Stage moves go through
 * PATCH /api/sales-pipeline, which enforces the lost-reason rule and writes
 * the activity timeline. Per sales.md §10, drag-and-drop may be replaced by
 * an explicit move-to-stage action, which is what the select on each card is.
 */
type Sponsor = {
  personId: string;
  name: string;
  role: string;
  influence: "champion" | "supporter" | "neutral" | "blocker";
  isPrimary: boolean;
};
export type BoardItem = {
  id: string;
  title: string;
  stage: string;
  clientId: string;
  clientName: string;
  clientHealth: "good" | "warning" | "risk";
  pricingModel: "regie" | "forfait";
  currency: string;
  tjm: number | null;
  estimatedDays: number | null;
  fixedPrice: number | null;
  amount: number;
  weighted: number;
  probability: number;
  expectedClose: string | null;
  ownerEmail: string;
  lostReason: string;
  sponsors: Sponsor[];
  updatedAt: string;
};
type StageColumn = {
  key: string;
  label: string;
  probability: number;
  count: number;
  total: number;
  weighted: number;
  items: BoardItem[];
};
type Board = {
  stages: StageColumn[];
  summary: {
    openCount: number;
    openTotal: number;
    weightedTotal: number;
    regie: { count: number; total: number };
    forfait: { count: number; total: number };
    wonTotal: number;
    closingSoon: BoardItem[];
  };
};

const STAGE_COLORS: Record<string, string> = {
  lead: "#64748b",
  qualified: "#3b82f6",
  meeting: "#8b5cf6",
  proposal: "#f59e0b",
  negotiation: "#f97316",
  won: "#22c55e",
  lost: "#ef4444",
};
const MODEL_LABEL: Record<BoardItem["pricingModel"], string> = {
  regie: "Régie",
  forfait: "Forfait",
};

function money(value: number, currency: string) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}
function amountLabel(item: BoardItem): string {
  if (item.pricingModel === "regie")
    return `${money(item.tjm ?? 0, item.currency)} × ${item.estimatedDays ?? 0} j`;
  return money(item.fixedPrice ?? 0, item.currency);
}

export function PipelineBoard() {
  const { session } = useSession();
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [model, setModel] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const token = await session?.getToken({ template: "supabase" });
      if (!token) throw new Error("Sign in again before continuing.");
      const params = new URLSearchParams();
      if (search.trim()) params.set("q", search.trim());
      if (model) params.set("pricingModel", model);
      const response = await fetch(`/api/sales-pipeline?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.headers.get("content-type")?.includes("application/json"))
        throw new Error("The sales API is unavailable in this environment. Use the preview deployment or add a dev proxy.");
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || "The pipeline could not be loaded.");
      if (!result || !Array.isArray(result.stages))
        throw new Error("The pipeline returned an unexpected response.");
      setBoard(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The pipeline could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [session, search, model]);

  useEffect(() => {
    document.title = "Sales pipeline · Quicksort Admin";
    void load();
  }, [load]);

  async function move(item: BoardItem, stage: string) {
    if (stage === item.stage) return;
    let lostReason: string | undefined;
    if (stage === "lost") {
      const reason = window.prompt(`Why was “${item.title}” lost? (required)`, "");
      if (reason === null) return;
      if (!reason.trim()) {
        setError("A lost deal needs a reason before it can be moved.");
        return;
      }
      lostReason = reason.trim();
    }
    setBusyId(item.id);
    setError("");
    setMessage("");
    try {
      const token = await session?.getToken({ template: "supabase" });
      if (!token) throw new Error("Sign in again before continuing.");
      const response = await fetch("/api/sales-pipeline", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: item.id, stage, lostReason }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "The stage could not be updated.");
      setMessage(`“${item.title}” moved to ${board?.stages.find((s) => s.key === stage)?.label || stage}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The stage could not be updated.");
    } finally {
      setBusyId("");
    }
  }

  const summary = board?.summary;
  return (
    <>
      <Notice error>{error}</Notice>
      <Notice>{message}</Notice>
      {summary && (
        <div className="stats">
          <div className="stat">
            <span className="stat-label">Open pipeline</span>
            <strong className="stat-value">{money(summary.openTotal, "EUR")}</strong>
            <span className="stat-detail">{summary.openCount} open opportunities</span>
          </div>
          <div className="stat">
            <span className="stat-label">Weighted forecast</span>
            <strong className="stat-value">{money(summary.weightedTotal, "EUR")}</strong>
            <span className="stat-detail">Amount × probability</span>
          </div>
          <div className="stat">
            <span className="stat-label">Régie</span>
            <strong className="stat-value">{money(summary.regie.total, "EUR")}</strong>
            <span className="stat-detail">{summary.regie.count} deals</span>
          </div>
          <div className="stat">
            <span className="stat-label">Forfait</span>
            <strong className="stat-value">{money(summary.forfait.total, "EUR")}</strong>
            <span className="stat-detail">{summary.forfait.count} deals</span>
          </div>
        </div>
      )}
      <section className="panel">
        <div className="toolbar">
          <Search size={18} />
          <input
            aria-label="Search the pipeline"
            placeholder="Search deals, clients, sponsors…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            aria-label="Pricing model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            <option value="">Régie + Forfait</option>
            <option value="regie">Régie only</option>
            <option value="forfait">Forfait only</option>
          </select>
          <button className="btn secondary small" disabled={loading} onClick={() => void load()}>
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
        {!board && !loading && (
          <Empty title="The pipeline is not reachable">
            The sales tables may not be migrated yet. Apply the sales pipeline
            migration, then refresh.
          </Empty>
        )}
        {board?.stages && !board.stages.some((s) => s.count) && !loading && (
          <Empty title="No opportunities on the board">
            Won and lost aside, every deal starts as a lead. Add opportunities
            to see the funnel fill up.
          </Empty>
        )}
      </section>
      {board?.stages && (
        <div className="kanban" role="list" aria-label="Opportunities by stage">
          {board.stages.map((stage) => (
            <section className="kanban-column" key={stage.key} aria-label={`${stage.label} column`}>
              <header className="kanban-head" style={{ borderColor: STAGE_COLORS[stage.key] }}>
                <h2>{stage.label}</h2>
                <span className="muted small-text">
                  {stage.count} · {money(stage.total, "EUR")}
                </span>
              </header>
              {stage.items.map((item) => (
                <article className="deal-card" key={item.id} role="listitem">
                  <div className="deal-card-top">
                    <h3>{item.title}</h3>
                    <span
                      className="pill"
                      style={{
                        background: `${item.pricingModel === "regie" ? "#0ea5e9" : "#a855f7"}`,
                      }}
                    >
                      {MODEL_LABEL[item.pricingModel]}
                    </span>
                  </div>
                  <p className="muted small-text">
                    {item.clientName}
                    {item.clientHealth !== "good" ? ` · client ${item.clientHealth}` : ""}
                  </p>
                  <p className="deal-amount">{money(item.amount, item.currency)}</p>
                  <p className="muted small-text">{amountLabel(item)}</p>
                  <p className="muted small-text">
                    weighted {money(item.weighted, item.currency)} · {item.probability}%
                    {item.expectedClose ? ` · closes ${item.expectedClose}` : ""}
                  </p>
                  {!!item.sponsors.length && (
                    <p className="small-text">
                      {item.sponsors.map((s) => (
                        <span
                          className="pill"
                          key={s.personId}
                          title={`${s.name} — ${s.influence}`}
                          style={{
                            marginRight: 4,
                            background:
                              s.influence === "champion"
                                ? "#16a34a"
                                : s.influence === "supporter"
                                  ? "#65a30d"
                                  : s.influence === "blocker"
                                    ? "#dc2626"
                                    : "#64748b",
                          }}
                        >
                          {s.isPrimary ? "★ " : ""}
                          {s.name}
                        </span>
                      ))}
                    </p>
                  )}
                  {item.lostReason && <p className="small-text muted">Lost: {item.lostReason}</p>}
                  <label className="deal-move">
                    Move to
                    <select
                      value={item.stage}
                      disabled={busyId === item.id}
                      onChange={(e) => void move(item, e.target.value)}
                    >
                      {board.stages.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </article>
              ))}
            </section>
          ))}
        </div>
      )}
    </>
  );
}
