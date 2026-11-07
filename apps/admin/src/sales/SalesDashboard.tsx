import type { ReactNode } from "react";
import { ArrowUpRight, CalendarClock, HeartPulse, Target, Users, type LucideIcon } from "lucide-react";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Progress,
  Stat,
  StatGroup,
  StatLabel,
  StatUnit,
  StatValue,
} from "@quicksort-sas/ui";
import {
  HEALTH_META,
  amountDetail,
  isOpen,
  isStaleDeal,
  money,
  stageLabel,
  useSales,
  type SalesOpportunity,
} from "./data";

/**
 * Sales dashboard (sales.md §8.1): the command center. Open pipeline,
 * weighted forecast, the régie/forfait split, deals closing soon, stale
 * deals, the stage funnel and the latest activity — every number derived
 * from the opportunity records, régie priced as TJM × days.
 *
 * Built on @quicksort-sas/ui: the lime pivot marks the weighted forecast,
 * the one number that matters on this view.
 */
export function SalesDashboard({ actorEmail, onOpenClient }: {
  actorEmail: string;
  onOpenClient: (id: string) => void;
}) {
  const { data, loading, error, message } = useSales(actorEmail);
  const { clients, opportunities, activities } = data;

  const open = opportunities.filter(isOpen);
  const openTotal = open.reduce((t, o) => t + Number(o.amount), 0);
  const weightedTotal =
    Math.round(open.reduce((t, o) => t + (Number(o.amount) * o.probability) / 100, 0) * 100) / 100;
  const regie = open.filter((o) => o.pricing_model === "regie");
  const regieTotal = regie.reduce((t, o) => t + Number(o.amount), 0);

  const closingSoon = open
    .filter(
      (o) =>
        o.expected_close &&
        new Date(o.expected_close).getTime() <= Date.now() + 30 * 86400000,
    )
    .sort((a, b) => String(a.expected_close).localeCompare(String(b.expected_close)))
    .slice(0, 6);
  const stale = opportunities.filter(isStaleDeal).slice(0, 6);
  const stageCounts = (["lead", "qualified", "meeting", "proposal", "negotiation"] as const).map(
    (key) => ({
      key,
      count: open.filter((o) => o.stage === key).length,
      total: open.filter((o) => o.stage === key).reduce((t, o) => t + Number(o.amount), 0),
    }),
  );

  const clientName = (id: string) => clients.find((c) => c.id === id)?.name || "";
  const riskClients = clients.filter((c) => c.health !== "good").slice(0, 5);

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {message && (
        <Alert>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardContent>
          <StatGroup>
            <Stat>
              <StatValue>{figure(openTotal)}<StatUnit>€</StatUnit></StatValue>
              <StatLabel>Open pipeline</StatLabel>
            </Stat>
            <Stat pivot>
              <StatValue>{figure(weightedTotal)}<StatUnit>€</StatUnit></StatValue>
              <StatLabel>Weighted forecast</StatLabel>
            </Stat>
            <Stat>
              <StatValue>{figure(regieTotal)}<StatUnit>€</StatUnit></StatValue>
              <StatLabel>Régie</StatLabel>
            </Stat>
          </StatGroup>
        </CardContent>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel icon={CalendarClock} title="Closing in the next 30 days">
          {closingSoon.length ? (
            <ItemGroup>
              {closingSoon.map((o) => (
                <DealRow
                  key={o.id}
                  title={o.title}
                  detail={`${clientName(o.client_id)} · closes ${o.expected_close} · ${money(Number(o.amount), o.currency)} (${o.pricing_model === "regie" ? "Régie" : "Forfait"})`}
                  action="Client"
                  onAction={() => onOpenClient(o.client_id)}
                />
              ))}
            </ItemGroup>
          ) : (
            <EmptyState title="Nothing closing soon">Expected-close dates on open deals will line up here.</EmptyState>
          )}
        </Panel>
        <Panel icon={HeartPulse} title="Needs attention">
          {stale.length ? (
            <ItemGroup>
              {stale.map((o) => (
                <StaleRow key={o.id} o={o} clientName={clientName(o.client_id)} onOpenClient={onOpenClient} />
              ))}
            </ItemGroup>
          ) : (
            <EmptyState title="No stale deals">Open deals untouched for 21 days show up here.</EmptyState>
          )}
          {!!riskClients.length && (
            <div className="mt-2 flex flex-col gap-2">
              <h3 className="label-mono pt-2">Clients to watch</h3>
              <ItemGroup>
                {riskClients.map((c) => (
                  <DealRow
                    key={c.id}
                    title={c.name}
                    detail={c.industry || "—"}
                    badge={
                      <Badge variant={c.health === "risk" ? "destructive" : "warning"}>
                        {HEALTH_META[c.health]?.label || c.health}
                      </Badge>
                    }
                    action="Open"
                    onAction={() => onOpenClient(c.id)}
                  />
                ))}
              </ItemGroup>
            </div>
          )}
        </Panel>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel icon={Target} title="Stage funnel">
          {open.length || loading ? (
            <ol className="flex flex-col gap-4">
              {stageCounts.map((s) => (
                <li key={s.key} className="grid grid-cols-[2.5rem_1fr] items-start gap-3">
                  <span className="num pt-0.5 text-2xl leading-none">{s.count}</span>
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="font-medium">{stageLabel(s.key)}</span>
                      <span className="num text-muted-foreground">{money(s.total)}</span>
                    </div>
                    <Progress
                      aria-label={`${stageLabel(s.key)} share of open pipeline`}
                      value={openTotal ? Math.round((s.total / openTotal) * 100) : 0}
                    />
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState title="No open opportunities">Deals entered on the pipeline fill this funnel.</EmptyState>
          )}
        </Panel>
        <Panel icon={Users} title="Recent activity">
          {activities.length ? (
            <ItemGroup>
              {activities.slice(0, 8).map((a) => (
                <DealRow
                  key={a.id}
                  title={a.text}
                  detail={`${a.type.replace("_", " ")} · ${a.author_email} · ${new Date(a.created_at).toLocaleDateString("fr-FR")}`}
                />
              ))}
            </ItemGroup>
          ) : (
            <EmptyState title="No activity yet">Calls, emails, meetings and stage changes will appear here.</EmptyState>
          )}
        </Panel>
      </div>
    </div>
  );
}

/** KPI figure without the currency sign — StatUnit sets the € apart. */
const figure = (value: number) =>
  new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(value || 0);

function Panel({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">{children}</CardContent>
    </Card>
  );
}

function DealRow({ title, detail, badge, action, onAction }: {
  title: string;
  detail: string;
  badge?: ReactNode;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <Item variant="outline" size="sm">
      <ItemContent className="min-w-0">
        <ItemTitle>{title}</ItemTitle>
        <ItemDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{detail}</span>
          {badge}
        </ItemDescription>
      </ItemContent>
      {action && onAction && (
        <ItemActions>
          <Button variant="outline" size="sm" onClick={onAction}>
            {action}
            <ArrowUpRight data-icon="inline-end" />
          </Button>
        </ItemActions>
      )}
    </Item>
  );
}

function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Empty className="border border-dashed border-border py-8">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{children}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function StaleRow({ o, clientName, onOpenClient }: {
  o: SalesOpportunity;
  clientName: string;
  onOpenClient: (id: string) => void;
}) {
  const days = Math.floor(
    (Date.now() - new Date(o.updated_at).getTime()) / 86400000,
  );
  return (
    <DealRow
      title={o.title}
      detail={`${clientName} · ${money(Number(o.amount), o.currency)} (${amountDetail(o)}) · untouched ${days}d`}
      action="Client"
      onAction={() => onOpenClient(o.client_id)}
    />
  );
}
