import { useCallback, useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowUpDown, LayoutGrid, List, Plus, RefreshCw, Search } from "lucide-react";
import { db, type Row } from "@quicksort/hr-db";
import { cn } from "cn";
import {
  Avatar as UiAvatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  NativeSelect,
  NativeSelectOption,
  Stat,
  StatGroup,
  StatLabel,
  StatValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  Toggle,
  ToggleGroup,
  ToggleGroupItem,
} from "@quicksort-sas/ui";
import { ClientDetail } from "./ClientDetail";
import { HEALTH_META, STAGES, daysSince, isOpen, stageLabel, useSales, type SalesClient } from "./data";
import { EmptyState, PageAlerts } from "../ui";
import "./sales.css"; // ClientDetail / pickers still use it

/**
 * Clients directory (sales.md §8.3) + Client 360 host (§8.4). The router
 * resolves both "/sales/clients" and "/sales/clients/:id" to this page; the
 * id is read from the URL so deep links stay shareable.
 *
 * Built on @quicksort-sas/ui: stat rail, search + filters, a table or card
 * grid, initials avatars and semantic health dots.
 */
const DETAIL_RE = /^\/sales\/clients\/([\w-]+)$/;

const HEALTH_SCORE: Record<string, number> = { good: 100, warning: 55, risk: 15 };
const SORTS = [
  { value: "name", label: "Name A-Z" },
  { value: "pipeline", label: "Pipeline value" },
  { value: "activity", label: "Last activity" },
  { value: "health", label: "Health" },
] as const;

const moneyCompact = (value: number) =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value || 0);

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "");
}

const HEALTH_DOT: Record<string, string> = { good: "bg-success", warning: "bg-warning", risk: "bg-destructive" };

function HealthDot({ health, className }: { health: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      title={HEALTH_META[health]?.label || health}
      className={cn("inline-block size-2 shrink-0 rounded-full", HEALTH_DOT[health] ?? "bg-faint", className)}
    />
  );
}

function Avatar({ name, size = "default" }: { name: string; size?: "sm" | "default" | "lg" }) {
  const letters = (initials(name || "?") || "?").toUpperCase();
  return (
    <UiAvatar size={size} aria-hidden="true">
      {/* Two letters do not fit the small size. */}
      <AvatarFallback>{size === "sm" ? letters[0] : letters}</AvatarFallback>
    </UiAvatar>
  );
}

function AvatarStack({ names }: { names: string[] }) {
  if (!names.length) return <span className="text-muted-foreground">—</span>;
  const shown = names.slice(0, 3);
  const extra = names.length - shown.length;
  return (
    <AvatarGroup title={names.join(", ")}>
      {shown.map((n) => (
        <Avatar key={n} name={n} size="sm" />
      ))}
      {extra > 0 && <AvatarGroupCount>+{extra}</AvatarGroupCount>}
    </AvatarGroup>
  );
}

function ownerName(email: string) {
  const local = (email || "").split("@")[0].replace(/[._-]+/g, " ").trim();
  if (!local) return "—";
  return local.replace(/\b\w/g, (m) => m.toUpperCase());
}

function domainOf(website: string) {
  return (website || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

type View = "list" | "grid";

export function Clients({ actorEmail }: { actorEmail: string }) {
  const sales = useSales(actorEmail);
  const { data, loading, busy, error, message, action } = sales;
  const [search, setSearch] = useState("");
  const [health, setHealth] = useState("");
  const [industry, setIndustry] = useState("");
  const [size, setSize] = useState("");
  const [openOnly, setOpenOnly] = useState(false);
  const [sort, setSort] = useState<string>("name");
  const [view, setView] = useState<View>("list");
  const [editing, setEditing] = useState<SalesClient | null | undefined>(undefined);

  // The open client lives in the URL (/sales/clients/<id>).
  const location = useLocation();
  const navigate = useNavigate();
  const selectedId = location.pathname.match(DETAIL_RE)?.[1] ?? "";

  useEffect(() => {
    document.title = "Clients · Quicksort Admin";
  }, []);

  const openClient = useCallback((id: string) => {
    navigate(`/sales/clients/${id}`);
    setEditing(undefined);
    window.scrollTo(0, 0);
  }, [navigate]);

  const closeClient = useCallback(() => {
    navigate("/sales/clients");
  }, [navigate]);

  const client = data.clients.find((c) => c.id === selectedId);
  if (selectedId) {
    return (
      <>
        <PageAlerts error={sales.error} message={sales.message} />
        {client ? (
          <ClientDetail
            key={client.id}
            client={client}
            sales={sales}
            actorEmail={actorEmail}
            onBack={closeClient}
          />
        ) : (
          !loading && (
            <EmptyState title="Client not found" action={<Button onClick={closeClient}>Back to clients</Button>}>
              This client may have been removed. Return to the directory.
            </EmptyState>
          )
        )}
      </>
    );
  }

  const industries = [...new Set(data.clients.map((c) => c.industry).filter(Boolean))].sort();
  const sizes = [...new Set(data.clients.map((c) => c.size).filter(Boolean))].sort();
  const term = search.toLowerCase();

  const rows = data.clients
    .filter((c) => {
      if (health && c.health !== health) return false;
      if (industry && c.industry !== industry) return false;
      if (size && c.size !== size) return false;
      const open = data.opportunities.some((o) => o.client_id === c.id && isOpen(o));
      if (openOnly && !open) return false;
      if (
        term &&
        ![c.name, c.industry, c.location, c.notes, ...(c.tags || [])]
          .join(" ")
          .toLowerCase()
          .includes(term)
      )
        return false;
      return true;
    })
    .map((c) => {
      const openOpps = data.opportunities.filter((o) => o.client_id === c.id && isOpen(o));
      const people = data.people.filter((p) => p.client_id === c.id);
      const best = openOpps.reduce<string | null>((acc, o) => {
        if (acc === null) return o.stage;
        const rank = (s: string) => STAGES.findIndex((x) => x.key === s);
        return rank(o.stage) > rank(acc) ? o.stage : acc;
      }, null);
      return {
        client: c,
        openPipeline: openOpps.reduce((t, o) => t + Number(o.amount), 0),
        openDeals: openOpps.length,
        people,
        bestStage: best,
        idle: daysSince(c.last_activity_at),
      };
    })
    .sort((a, b) => {
      if (sort === "pipeline") return b.openPipeline - a.openPipeline;
      if (sort === "activity")
        return String(b.client.last_activity_at || "").localeCompare(
          String(a.client.last_activity_at || ""),
        );
      if (sort === "health")
        return (HEALTH_SCORE[a.client.health] ?? 0) - (HEALTH_SCORE[b.client.health] ?? 0);
      return a.client.name.localeCompare(b.client.name);
    });

  const openDealCount = data.opportunities.filter(isOpen).length;
  const combinedPipeline = data.opportunities
    .filter(isOpen)
    .reduce((t, o) => t + Number(o.amount), 0);
  const avgHealth = data.clients.length
    ? Math.round(
        data.clients.reduce((t, c) => t + (HEALTH_SCORE[c.health] ?? 0), 0) / data.clients.length,
      )
    : 0;
  const avgHealthKey = avgHealth >= 70 ? "good" : avgHealth >= 40 ? "warning" : "risk";

  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const values = {
      name: String(f.get("name")).trim(),
      industry: String(f.get("industry")).trim(),
      size: String(f.get("size")).trim(),
      website: String(f.get("website")).trim(),
      location: String(f.get("location")).trim(),
      revenue: String(f.get("revenue")).trim(),
      tags: String(f.get("tags"))
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 20),
      health: String(f.get("health")),
      owner_email: String(f.get("owner_email")).trim(),
      notes: String(f.get("notes")).trim(),
      updated_at: new Date().toISOString(),
    };
    void action(async () => {
      const result = editing
        ? await db().from("sales_clients").update(values).eq("id", editing.id).select("id").single()
        : await db().from("sales_clients").insert(values).select("id").single();
      if (result.error) throw result.error;
      if (!editing && result.data) openClient((result.data as Row<"sales_clients">).id);
      setEditing(undefined);
    }, editing ? "Client updated." : "Client created.");
  }

  const openRow = (id: string) => () => openClient(id);
  const rowKeys = (id: string) => (e: KeyboardEvent) => {
    if (e.key === "Enter") openClient(id);
  };

  const healthOptions = [
    ["good", "Good"],
    ["warning", "Warning"],
    ["risk", "At risk"],
  ] as const;
  return (
    <div className="flex flex-col gap-6">
      <PageAlerts error={error} message={message} />

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-6">
          <StatGroup className="flex-1">
            <Stat size="sm">
              <StatValue>{data.clients.length}</StatValue>
              <StatLabel>Total clients</StatLabel>
            </Stat>
            <Stat size="sm">
              <StatValue>{openDealCount}</StatValue>
              <StatLabel>Active deals</StatLabel>
            </Stat>
            <Stat size="sm">
              <StatValue>{moneyCompact(combinedPipeline)}</StatValue>
              <StatLabel>Combined pipeline</StatLabel>
            </Stat>
            <Stat size="sm">
              <StatValue className="items-center gap-2">
                {data.clients.length > 0 && <HealthDot health={avgHealthKey} className="size-2.5" />}
                {data.clients.length ? `${avgHealth}%` : "—"}
              </StatValue>
              <StatLabel>Avg. health</StatLabel>
            </Stat>
          </StatGroup>
          <Button variant="pivot" onClick={() => setEditing(null)}>
            <Plus data-icon="inline-start" />
            New client
          </Button>
        </CardContent>
      </Card>

      <Dialog open={editing !== undefined} onOpenChange={(open) => { if (!open) setEditing(undefined); }}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : "Create a client"}</DialogTitle>
          </DialogHeader>
          <form key={editing?.id || "new"} onSubmit={save}>
            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="client-name">Company name</FieldLabel>
                  <Input id="client-name" name="name" defaultValue={editing?.name} required maxLength={200} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="client-industry">Industry</FieldLabel>
                  <Input id="client-industry" name="industry" defaultValue={editing?.industry} maxLength={200} placeholder="e.g. Banking" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="client-size">Size</FieldLabel>
                  <NativeSelect id="client-size" name="size" defaultValue={editing?.size}>
                    <NativeSelectOption value="">Unknown</NativeSelectOption>
                    {["1-50", "51-200", "201-1000", "1000+"].map((v) => (
                      <NativeSelectOption key={v} value={v}>{v}</NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="client-location">Location</FieldLabel>
                  <Input id="client-location" name="location" defaultValue={editing?.location} maxLength={200} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="client-website">Website</FieldLabel>
                  <Input id="client-website" name="website" type="url" defaultValue={editing?.website} maxLength={300} placeholder="https://…" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="client-revenue">Revenue</FieldLabel>
                  <Input id="client-revenue" name="revenue" defaultValue={editing?.revenue} maxLength={100} placeholder="e.g. €50M" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="client-health">Health</FieldLabel>
                  <NativeSelect id="client-health" name="health" defaultValue={editing?.health || "good"}>
                    {healthOptions.map(([v, label]) => <NativeSelectOption key={v} value={v}>{label}</NativeSelectOption>)}
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="client-owner">Owner</FieldLabel>
                  <Input id="client-owner" name="owner_email" type="email" defaultValue={editing?.owner_email || actorEmail} maxLength={200} />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="client-tags">Tags (comma-separated)</FieldLabel>
                <Input id="client-tags" name="tags" defaultValue={(editing?.tags || []).join(", ")} maxLength={300} placeholder="strategic, framework agreement…" />
              </Field>
              <Field>
                <FieldLabel htmlFor="client-notes">Notes</FieldLabel>
                <Textarea id="client-notes" name="notes" defaultValue={editing?.notes} rows={3} maxLength={5000} />
              </Field>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditing(undefined)}>Cancel</Button>
                <Button type="submit" disabled={busy}>Save client</Button>
              </DialogFooter>
            </FieldGroup>
          </form>
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <InputGroup className="min-w-56 flex-1">
              <InputGroupAddon><Search /></InputGroupAddon>
              <InputGroupInput aria-label="Search clients" placeholder="Search clients by name, industry, tag…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </InputGroup>
            <Button variant="outline" size="icon" aria-label="Refresh" title="Refresh" disabled={loading} onClick={() => void sales.load()}>
              <RefreshCw />
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect size="sm" aria-label="Industry" value={industry} onChange={(e) => setIndustry(e.target.value)}>
              <NativeSelectOption value="">All industries</NativeSelectOption>
              {industries.map((i) => <NativeSelectOption key={i} value={i}>{i}</NativeSelectOption>)}
            </NativeSelect>
            <NativeSelect size="sm" aria-label="Size" value={size} onChange={(e) => setSize(e.target.value)}>
              <NativeSelectOption value="">Any size</NativeSelectOption>
              {sizes.map((v) => <NativeSelectOption key={v} value={v}>{v}</NativeSelectOption>)}
            </NativeSelect>
            <NativeSelect size="sm" aria-label="Health" value={health} onChange={(e) => setHealth(e.target.value)}>
              <NativeSelectOption value="">Any health</NativeSelectOption>
              {healthOptions.map(([v, label]) => <NativeSelectOption key={v} value={v}>{label}</NativeSelectOption>)}
            </NativeSelect>
            <Toggle variant="outline" size="sm" pressed={openOnly} onPressedChange={setOpenOnly}>
              Has open deals
            </Toggle>
            <div className="ml-auto flex items-center gap-2">
              <ArrowUpDown className="size-4 text-muted-foreground" aria-hidden="true" />
              <NativeSelect size="sm" aria-label="Sort clients" value={sort} onChange={(e) => setSort(e.target.value)}>
                {SORTS.map((s) => <NativeSelectOption key={s.value} value={s.value}>{s.label}</NativeSelectOption>)}
              </NativeSelect>
              <ToggleGroup variant="outline" size="sm" aria-label="Directory view" value={[view]} onValueChange={(v) => { if (v[0]) setView(v[0] as View); }}>
                <ToggleGroupItem value="list" aria-label="List view"><List /></ToggleGroupItem>
                <ToggleGroupItem value="grid" aria-label="Grid view"><LayoutGrid /></ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>

          <p className="m-0 text-xs text-muted-foreground">{rows.length} of {data.clients.length} clients</p>

          {!data.clients.length && !loading && (
            <EmptyState title="No clients yet">Create the first client to start mapping relationships.</EmptyState>
          )}
          {!!data.clients.length && !rows.length && (
            <EmptyState title="No clients match">Try a different search or clear the filters.</EmptyState>
          )}

          {!!rows.length && view === "list" && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead className="hidden xl:table-cell">Industry</TableHead>
                  <TableHead>Contacts</TableHead>
                  <TableHead>Open deals</TableHead>
                  <TableHead>Pipeline value</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead>Owner</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ client: c, openPipeline, openDeals, people, bestStage, idle }) => (
                  <TableRow key={c.id} className="cursor-pointer" tabIndex={0} onClick={openRow(c.id)} onKeyDown={rowKeys(c.id)}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar name={c.name} />
                        <div className="min-w-0">
                          <div className="font-medium">{c.name}</div>
                          <div className="text-xs text-muted-foreground">{domainOf(c.website) || "—"}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden xl:table-cell">{c.industry ? <Badge variant="secondary" className="normal-case">{c.industry}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell><AvatarStack names={people.map((p) => p.name)} /></TableCell>
                    <TableCell>
                      <span className="num">{openDeals}</span>
                      {bestStage && <span className="ml-2 text-xs text-muted-foreground" title="Most advanced open deal">{stageLabel(bestStage)}</span>}
                    </TableCell>
                    <TableCell className="num">{moneyCompact(openPipeline)}</TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2 text-xs text-muted-foreground">
                        <HealthDot health={c.health} />
                        {idle === null ? "No activity yet" : `Active ${idle}d ago`}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <Avatar name={ownerName(c.owner_email)} size="sm" />
                        {ownerName(c.owner_email)}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {!!rows.length && view === "grid" && (
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))]">
              {rows.map(({ client: c, openPipeline, openDeals, people, idle }) => (
                <Card
                  key={c.id}
                  size="sm"
                  role="link"
                  tabIndex={0}
                  onClick={openRow(c.id)}
                  onKeyDown={rowKeys(c.id)}
                  className="cursor-pointer transition-colors hover:border-foreground/40"
                >
                  <CardContent className="flex flex-col gap-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={c.name} size="lg" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{c.name}</div>
                        <div className="truncate text-xs text-muted-foreground">{domainOf(c.website) || c.industry || "—"}</div>
                      </div>
                      <HealthDot health={c.health} className="size-2.5" />
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {c.industry && <Badge variant="secondary" className="normal-case">{c.industry}</Badge>}
                      {c.size && <Badge variant="outline" className="normal-case">{c.size} employees</Badge>}
                      {!c.industry && !c.size && <span className="text-xs text-muted-foreground">—</span>}
                    </div>
                    <div className="grid grid-cols-3 gap-2 border-y border-border py-2 text-center">
                      <div><div className="num text-sm">{moneyCompact(openPipeline)}</div><div className="text-[11px] text-muted-foreground">pipeline</div></div>
                      <div><div className="num text-sm">{openDeals}</div><div className="text-[11px] text-muted-foreground">open {openDeals === 1 ? "deal" : "deals"}</div></div>
                      <div><div className="num text-sm">{people.length}</div><div className="text-[11px] text-muted-foreground">{people.length === 1 ? "person" : "people"}</div></div>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <AvatarStack names={people.map((p) => p.name)} />
                      <span className="text-xs text-muted-foreground">{idle === null ? "No activity yet" : `Active ${idle}d ago`}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
