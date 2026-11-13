import { useCallback, useEffect, useState } from "react";
import { useSession } from "@clerk/react";
import { RefreshCw, Search } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  NativeSelect,
  NativeSelectOption,
  Stat,
  StatGroup,
  StatLabel,
  StatSource,
  StatUnit,
  StatValue,
  Textarea,
} from "@quicksort-sas/ui";
import { EmptyState, PageAlerts } from "../ui";

/**
 * Sales pipeline board (sales.md §8.2). Columns are the seven stages; each
 * card shows the pricing model (régie TJM × days / forfait fixed price), the
 * derived amount and the weighted value. Stage moves go through
 * PATCH /api/sales-pipeline, which enforces the lost-reason rule and writes
 * the activity timeline. Per sales.md §10, drag-and-drop may be replaced by
 * an explicit move-to-stage action, which is what the select on each card is.
 * Moving a deal to "lost" asks for the required reason in a dialog.
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

const INFLUENCE_BADGE: Record<Sponsor["influence"], "success" | "secondary" | "destructive" | "outline"> = {
  champion: "success",
  supporter: "secondary",
  neutral: "outline",
  blocker: "destructive",
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
/** KPI figure without the currency sign — StatUnit sets the € apart. */
const figure = (value: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(value || 0);

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
  const [losing, setLosing] = useState<BoardItem | null>(null);
  const [lostReason, setLostReason] = useState("");

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

  function move(item: BoardItem, stage: string) {
    if (stage === item.stage) return;
    if (stage === "lost") {
      setLostReason("");
      setLosing(item);
      return;
    }
    void commitMove(item, stage);
  }

  async function commitMove(item: BoardItem, stage: string, lostReason?: string) {
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
      setMessage(`"${item.title}" moved to ${board?.stages.find((s) => s.key === stage)?.label || stage}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The stage could not be updated.");
    } finally {
      setBusyId("");
    }
  }

  const summary = board?.summary;
  return (
    <div className="flex flex-col gap-6">
      <PageAlerts error={error} message={message} />

      <Dialog open={!!losing} onOpenChange={(open) => { if (!open) setLosing(null); }}>
        <DialogContent>
          <form
            className="grid gap-6"
            onSubmit={(e) => {
              e.preventDefault();
              if (!losing || !lostReason.trim()) return;
              const item = losing;
              setLosing(null);
              void commitMove(item, "lost", lostReason.trim());
            }}
          >
            <DialogHeader>
              <DialogTitle>Mark as lost</DialogTitle>
              <DialogDescription>Why was "{losing?.title}" lost? A reason is required and goes on the activity timeline.</DialogDescription>
            </DialogHeader>
            <Field>
              <FieldLabel htmlFor="lost-reason">Reason</FieldLabel>
              <Textarea id="lost-reason" required autoFocus value={lostReason} onChange={(e) => setLostReason(e.target.value)} placeholder="e.g. Budget frozen, went with an in-house team…" />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setLosing(null)}>Cancel</Button>
              <Button type="submit" variant="destructive" disabled={!lostReason.trim()}>Mark as lost</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {summary && (
        <Card>
          <CardContent>
            <StatGroup>
              <Stat size="sm">
                <StatValue>{figure(summary.openTotal)}<StatUnit>€</StatUnit></StatValue>
                <StatLabel>Open pipeline</StatLabel>
                <StatSource>{summary.openCount} open opportunities</StatSource>
              </Stat>
              <Stat size="sm" pivot>
                <StatValue>{figure(summary.weightedTotal)}<StatUnit>€</StatUnit></StatValue>
                <StatLabel>Weighted forecast</StatLabel>
                <StatSource>Amount × probability</StatSource>
              </Stat>
              <Stat size="sm">
                <StatValue>{figure(summary.regie.total)}<StatUnit>€</StatUnit></StatValue>
                <StatLabel>Régie</StatLabel>
                <StatSource>{summary.regie.count} deals</StatSource>
              </Stat>
              <Stat size="sm">
                <StatValue>{figure(summary.forfait.total)}<StatUnit>€</StatUnit></StatValue>
                <StatLabel>Forfait</StatLabel>
                <StatSource>{summary.forfait.count} deals</StatSource>
              </Stat>
            </StatGroup>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <InputGroup className="min-w-56 flex-1">
          <InputGroupAddon><Search /></InputGroupAddon>
          <InputGroupInput aria-label="Search the pipeline" placeholder="Search deals, clients, sponsors…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </InputGroup>
        <NativeSelect aria-label="Pricing model" value={model} onChange={(e) => setModel(e.target.value)}>
          <NativeSelectOption value="">Régie + Forfait</NativeSelectOption>
          <NativeSelectOption value="regie">Régie only</NativeSelectOption>
          <NativeSelectOption value="forfait">Forfait only</NativeSelectOption>
        </NativeSelect>
        <Button variant="outline" disabled={loading} onClick={() => void load()}>
          <RefreshCw data-icon="inline-start" />
          Refresh
        </Button>
      </div>

      {!board && !loading && (
        <EmptyState title="The pipeline is not reachable">
          The sales tables may not be migrated yet. Apply the sales pipeline migration, then refresh.
        </EmptyState>
      )}
      {board?.stages && !board.stages.some((s) => s.count) && !loading && (
        <EmptyState title="No opportunities on the board">
          Add opportunities to see the funnel fill up.
        </EmptyState>
      )}

      {board?.stages && (
        <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-3" role="list" aria-label="Opportunities by stage">
          {board.stages.map((stage) => (
            <section key={stage.key} aria-label={`${stage.label} column`} className="flex w-72 shrink-0 snap-start flex-col gap-2 rounded-lg bg-muted/60 p-2">
              <header className="flex items-baseline justify-between gap-2 border-b border-border px-1.5 pt-1 pb-2">
                <h2 className="label-mono m-0 text-foreground">{stage.label}</h2>
                <span className="num text-xs text-muted-foreground">{stage.count} · {money(stage.total, "EUR")}</span>
              </header>
              {stage.items.map((item) => (
                <Card key={item.id} size="sm" role="listitem" className="gap-2">
                  <CardContent className="flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="m-0 text-sm font-medium leading-snug">{item.title}</h3>
                      <Badge variant="outline" className="shrink-0">{MODEL_LABEL[item.pricingModel]}</Badge>
                    </div>
                    <p className="m-0 text-xs text-muted-foreground">
                      {item.clientName}
                      {item.clientHealth !== "good" && (
                        <> · <span className={item.clientHealth === "risk" ? "text-destructive" : "text-warning"}>client {item.clientHealth}</span></>
                      )}
                    </p>
                    <div>
                      <p className="num m-0 text-lg">{money(item.amount, item.currency)}</p>
                      <p className="m-0 text-xs text-muted-foreground">{amountLabel(item)}</p>
                    </div>
                    <p className="m-0 text-xs text-muted-foreground">
                      weighted {money(item.weighted, item.currency)} · {item.probability}%
                      {item.expectedClose ? ` · closes ${item.expectedClose}` : ""}
                    </p>
                    {!!item.sponsors.length && (
                      <div className="flex flex-wrap gap-1">
                        {item.sponsors.map((s) => (
                          <Badge key={s.personId} variant={INFLUENCE_BADGE[s.influence]} title={`${s.name} · ${s.influence}`} className="normal-case">
                            {s.isPrimary ? "★ " : ""}
                            {s.name}
                          </Badge>
                        ))}
                      </div>
                    )}
                    {item.lostReason && <p className="m-0 text-xs text-muted-foreground">Lost: {item.lostReason}</p>}
                    <NativeSelect
                      size="sm"
                      aria-label={`Move "${item.title}" to stage`}
                      value={item.stage}
                      disabled={busyId === item.id}
                      onChange={(e) => move(item, e.target.value)}
                    >
                      {board.stages.map((s) => (
                        <NativeSelectOption key={s.key} value={s.key}>
                          {s.key === item.stage ? s.label : `Move to ${s.label}`}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </CardContent>
                </Card>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
