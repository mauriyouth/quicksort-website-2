import { useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { db } from "@quicksort/hr-db";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  NativeSelect,
  NativeSelectOption,
  Textarea,
} from "@quicksort-sas/ui";
import { EmptyState, PageAlerts } from "../ui";
import {
  ACTIVITY_TYPES,
  HEALTH_META,
  INFLUENCE_META,
  amountDetail,
  daysSince,
  money,
  stageLabel,
  useSales,
  type SalesClient,
} from "./data";
import { DateField } from "../DateField";

type Sales = ReturnType<typeof useSales>;

/**
 * Client 360 (sales.md §8.4): company info, health, people inside the
 * client, linked opportunities with régie/forfait labels and sponsor
 * influence, plus the activity timeline with a composer. People and
 * opportunities can be added in context.
 */
export function ClientDetail({
  client,
  sales,
  actorEmail,
  onBack,
}: {
  client: SalesClient;
  sales: Sales;
  actorEmail: string;
  onBack: () => void;
}) {
  const { data, busy, action, logActivity } = sales;
  const [editing, setEditing] = useState(false);
  const [showPerson, setShowPerson] = useState(false);
  const [showOpportunity, setShowOpportunity] = useState(false);
  const [pricingModel, setPricingModel] = useState("regie");
  const [newDecisionMaker, setNewDecisionMaker] = useState(false);
  const [opportunityError, setOpportunityError] = useState("");
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);

  const people = data.people.filter((p) => p.client_id === client.id);
  const opportunities = data.opportunities.filter((o) => o.client_id === client.id);
  const activities = data.activities.filter((a) => a.client_id === client.id);

  function saveClient(e: FormEvent<HTMLFormElement>) {
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
      const result = await db()
        .from("sales_clients")
        .update(values)
        .eq("id", client.id)
        .select("id")
        .single();
      if (result.error) throw result.error;
      setEditing(false);
    }, "Client updated.");
  }

  function addPerson(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const name = String(f.get("name")).trim();
    if (!name) return;
    void action(async () => {
      const result = await db()
        .from("sales_contacts")
        .insert({
          name,
          role: String(f.get("role")).trim(),
          client_id: client.id,
          email: String(f.get("email")).trim(),
          phone: String(f.get("phone")).trim(),
          linkedin: String(f.get("linkedin")).trim(),
          is_decision_maker: newDecisionMaker,
        })
        .select("id")
        .single();
      if (result.error) throw result.error;
      const note = await db()
        .from("sales_activities")
        .insert({
          client_id: client.id,
          type: "note",
          text: `Added ${name} (${String(f.get("role")).trim() || "contact"}) to the relationship map.`,
          author_email: actorEmail,
        });
      if (note.error) throw note.error;
      setShowPerson(false);
      setNewDecisionMaker(false);
    }, `${name} added to ${client.name}.`);
  }

  function addOpportunity(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const pricingModel = String(f.get("pricing_model"));
    const values = {
      title: String(f.get("title")).trim(),
      client_id: client.id,
      pricing_model: pricingModel,
      tjm: pricingModel === "regie" ? Number(f.get("tjm")) : null,
      estimated_days: pricingModel === "regie" ? Number(f.get("estimated_days")) : null,
      fixed_price: pricingModel === "forfait" ? Number(f.get("fixed_price")) : null,
      expected_close: String(f.get("expected_close") || "") || null,
      owner_email: String(f.get("owner_email")).trim() || actorEmail,
      notes: "",
      updated_at: new Date().toISOString(),
    };
    if (pricingModel === "regie" && (!values.tjm || !values.estimated_days)) {
      setOpportunityError("A régie opportunity needs a TJM and an estimated number of days.");
      return;
    }
    if (pricingModel === "forfait" && !values.fixed_price) {
      setOpportunityError("A forfait opportunity needs a fixed price.");
      return;
    }
    setOpportunityError("");
    void action(async () => {
      const result = await db().from("sales_opportunities").insert(values).select("id").single();
      if (result.error) throw result.error;
      const note = await db()
        .from("sales_activities")
        .insert({
          client_id: client.id,
          opportunity_id: (result.data as { id: string }).id,
          type: "note",
          text: `Opportunity “${values.title}” created (${pricingModel === "regie" ? "régie" : "forfait"}).`,
          author_email: actorEmail,
        });
      if (note.error) throw note.error;
      setShowOpportunity(false);
    }, "Opportunity created.");
  }

  function log(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Keep the element: React clears e.currentTarget once the handler returns.
    const form = e.currentTarget;
    const f = new FormData(form);
    const text = String(f.get("text")).trim();
    if (!text) return;
    void logActivity(
      {
        client_id: client.id,
        opportunity_id: null,
        person_id: String(f.get("person_id") || "") || null,
        type: String(f.get("type")),
        text,
      },
      "Activity logged.",
    ).then(() => form.reset());
  }

  const idle = daysSince(client.last_activity_at);
  const health = HEALTH_META[client.health];
  const healthTone = client.health === "risk" ? "text-destructive" : client.health === "warning" ? "text-warning" : "text-success";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft data-icon="inline-start" />
          Clients
        </Button>
        <Button variant="outline" size="sm" onClick={() => setEditing((v) => !v)}>
          <Pencil data-icon="inline-start" />
          {editing ? "Close editor" : "Edit"}
        </Button>
      </div>
      <header className="flex flex-col gap-2">
        <span className="label-mono">Client 360</span>
        <h1 className="m-0 text-3xl font-medium tracking-tight">{client.name}</h1>
        <p className="m-0 text-sm text-muted-foreground">
          {[client.industry, client.size, client.location].filter(Boolean).join(" · ") || "—"}
          {" · "}
          <span className={healthTone}>{health?.label || client.health}</span>
          {idle !== null && ` · last activity ${idle}d ago`}
        </p>
      </header>
      <PageAlerts error={sales.error} message={sales.message} />

      <AlertDialog open={!!removing} onOpenChange={(open) => { if (!open) setRemoving(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.name}?</AlertDialogTitle>
            <AlertDialogDescription>They will also be removed from opportunity sponsors.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const target = removing;
                setRemoving(null);
                if (!target) return;
                void action(async () => {
                  const result = await db().from("sales_contacts").delete().eq("id", target.id);
                  if (result.error) throw result.error;
                }, `${target.name} removed.`);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card>
        <CardHeader>
          <CardTitle>Company information</CardTitle>
        </CardHeader>
        <CardContent>
          {editing ? (
            <form onSubmit={saveClient}>
              <FieldGroup>
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField id="cd-name" name="name" label="Company name" defaultValue={client.name} required maxLength={200} />
                  <TextField id="cd-industry" name="industry" label="Industry" defaultValue={client.industry} maxLength={200} />
                  <Field>
                    <FieldLabel htmlFor="cd-size">Size</FieldLabel>
                    <NativeSelect id="cd-size" name="size" defaultValue={client.size}>
                      <NativeSelectOption value="">Unknown</NativeSelectOption>
                      {["1-50", "51-200", "201-1000", "1000+"].map((v) => (
                        <NativeSelectOption key={v} value={v}>{v}</NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                  <TextField id="cd-location" name="location" label="Location" defaultValue={client.location} maxLength={200} />
                  <TextField id="cd-website" name="website" label="Website" type="url" defaultValue={client.website} maxLength={300} />
                  <TextField id="cd-revenue" name="revenue" label="Revenue" defaultValue={client.revenue} maxLength={100} />
                  <Field>
                    <FieldLabel htmlFor="cd-health">Health</FieldLabel>
                    <NativeSelect id="cd-health" name="health" defaultValue={client.health}>
                      <NativeSelectOption value="good">Good</NativeSelectOption>
                      <NativeSelectOption value="warning">Warning</NativeSelectOption>
                      <NativeSelectOption value="risk">At risk</NativeSelectOption>
                    </NativeSelect>
                  </Field>
                  <TextField id="cd-owner" name="owner_email" label="Owner" type="email" defaultValue={client.owner_email} maxLength={200} />
                </div>
                <TextField id="cd-tags" name="tags" label="Tags (comma-separated)" defaultValue={(client.tags || []).join(", ")} maxLength={300} />
                <Field>
                  <FieldLabel htmlFor="cd-notes">Notes</FieldLabel>
                  <Textarea id="cd-notes" name="notes" defaultValue={client.notes} rows={3} maxLength={5000} />
                </Field>
                <div>
                  <Button type="submit" disabled={busy}>Save client</Button>
                </div>
              </FieldGroup>
            </form>
          ) : (
            <div className="flex flex-col gap-4">
              <dl className="m-0 grid gap-x-6 gap-y-4 [grid-template-columns:repeat(auto-fill,minmax(10rem,1fr))]">
                <Info label="Industry" value={client.industry} />
                <Info label="Size" value={client.size} />
                <Info label="Location" value={client.location} />
                <Info
                  label="Website"
                  value={
                    client.website ? (
                      <a className="underline underline-offset-4" href={client.website} target="_blank" rel="noopener noreferrer">
                        {client.website.replace(/^https?:\/\//, "")}
                      </a>
                    ) : (
                      ""
                    )
                  }
                />
                <Info label="Revenue" value={client.revenue} />
                <Info label="Owner" value={client.owner_email} />
                <Info label="Last activity" value={idle === null ? "—" : `${idle} days ago`} />
              </dl>
              {!!client.tags?.length && (
                <div className="flex flex-wrap gap-1">
                  {client.tags.map((t) => (
                    <Badge key={t} variant="secondary" className="normal-case">{t}</Badge>
                  ))}
                </div>
              )}
              {client.notes && <p className="m-0 text-sm whitespace-pre-wrap">{client.notes}</p>}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>People ({people.length})</CardTitle>
            <CardAction>
              <Button variant="outline" size="sm" onClick={() => setShowPerson(true)}>
                <Plus data-icon="inline-start" />
                Add
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {people.length ? (
              <ItemGroup>
                {people.map((p) => {
                  const sponsorLinks = data.sponsors.filter((s) => s.person_id === p.id);
                  const contacted = daysSince(p.last_contact_at);
                  return (
                    <Item key={p.id} variant="outline" size="sm" className="items-start">
                      <ItemContent className="min-w-0 gap-1.5">
                        <ItemTitle className="flex-wrap">
                          {p.name}
                          {p.is_decision_maker && <Badge variant="outline">Decision-maker</Badge>}
                        </ItemTitle>
                        <ItemDescription>
                          {[p.role, p.email].filter(Boolean).join(" · ") || "—"}
                          {contacted !== null && ` · last contact ${contacted}d ago`}
                        </ItemDescription>
                        {p.linkedin && (
                          <a className="truncate text-xs text-muted-foreground underline underline-offset-4" href={p.linkedin} target="_blank" rel="noopener noreferrer">
                            {p.linkedin.replace(/^https?:\/\//, "")}
                          </a>
                        )}
                        {!!sponsorLinks.length && (
                          <div className="flex flex-wrap gap-1">
                            {sponsorLinks.map((s) => {
                              const opp = data.opportunities.find((o) => o.id === s.opportunity_id);
                              return (
                                <InfluenceBadge key={s.opportunity_id} influence={s.influence} primary={s.is_primary} title={opp?.title}>
                                  {opp?.title || "Opportunity"} · {INFLUENCE_META[s.influence]?.label}
                                </InfluenceBadge>
                              );
                            })}
                          </div>
                        )}
                      </ItemContent>
                      <ItemActions>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-destructive"
                          disabled={busy}
                          aria-label={`Remove ${p.name}`}
                          title={`Remove ${p.name}`}
                          onClick={() => setRemoving({ id: p.id, name: p.name })}
                        >
                          <Trash2 />
                        </Button>
                      </ItemActions>
                    </Item>
                  );
                })}
              </ItemGroup>
            ) : (
              <EmptyState title="No people yet">Add the contacts inside {client.name} to build the relationship map.</EmptyState>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Opportunities ({opportunities.length})</CardTitle>
            <CardAction>
              <Button variant="outline" size="sm" onClick={() => { setOpportunityError(""); setShowOpportunity(true); }}>
                <Plus data-icon="inline-start" />
                Add
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {opportunities.length ? (
              <ItemGroup>
                {opportunities.map((o) => {
                  const sponsors = data.sponsors.filter((s) => s.opportunity_id === o.id);
                  return (
                    <Item key={o.id} variant="outline" size="sm">
                      <ItemContent className="min-w-0 gap-1.5">
                        <ItemTitle className="flex-wrap">
                          {o.title}
                          <Badge variant="outline">{o.pricing_model === "regie" ? "Régie" : "Forfait"}</Badge>
                          <Badge variant={o.stage === "won" ? "success" : o.stage === "lost" ? "destructive" : "secondary"}>{stageLabel(o.stage)}</Badge>
                        </ItemTitle>
                        <ItemDescription>
                          {money(Number(o.amount), o.currency)} ({amountDetail(o)}) · {o.probability}%
                          {o.expected_close ? ` · closes ${o.expected_close}` : ""}
                          {o.owner_email ? ` · ${o.owner_email}` : ""}
                        </ItemDescription>
                        {!!sponsors.length && (
                          <div className="flex flex-wrap gap-1">
                            {sponsors.map((s) => {
                              const person = data.people.find((p) => p.id === s.person_id);
                              return (
                                <InfluenceBadge key={s.person_id} influence={s.influence} primary={s.is_primary} title={`${INFLUENCE_META[s.influence]?.label} on “${o.title}”`}>
                                  {person?.name || "?"} · {INFLUENCE_META[s.influence]?.label}
                                </InfluenceBadge>
                              );
                            })}
                          </div>
                        )}
                        {o.lost_reason && <p className="m-0 text-xs text-muted-foreground">Lost: {o.lost_reason}</p>}
                      </ItemContent>
                    </Item>
                  );
                })}
              </ItemGroup>
            ) : (
              <EmptyState title="No opportunities yet">Create the first opportunity for {client.name} to start the funnel.</EmptyState>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={showPerson} onOpenChange={setShowPerson}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add a person</DialogTitle>
            <DialogDescription>A contact inside {client.name}.</DialogDescription>
          </DialogHeader>
          <form onSubmit={addPerson}>
            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField id="ap-name" name="name" label="Name" required maxLength={200} />
                <TextField id="ap-role" name="role" label="Role" maxLength={200} placeholder="e.g. CTO" />
                <TextField id="ap-email" name="email" label="Email" type="email" maxLength={200} />
                <TextField id="ap-phone" name="phone" label="Phone" maxLength={40} />
                <TextField id="ap-linkedin" name="linkedin" label="LinkedIn" type="url" maxLength={300} placeholder="https://linkedin.com/in/…" />
              </div>
              <Field orientation="horizontal">
                <Checkbox id="ap-dm" checked={newDecisionMaker} onCheckedChange={(v) => setNewDecisionMaker(v === true)} />
                <FieldLabel htmlFor="ap-dm" className="font-normal">Decision-maker</FieldLabel>
              </Field>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowPerson(false)}>Cancel</Button>
                <Button type="submit" disabled={busy}>Add</Button>
              </DialogFooter>
            </FieldGroup>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={showOpportunity} onOpenChange={setShowOpportunity}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add an opportunity</DialogTitle>
            <DialogDescription>For {client.name}.</DialogDescription>
          </DialogHeader>
          <form onSubmit={addOpportunity}>
            <FieldGroup>
              <PageAlerts error={opportunityError} />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField id="ao-title" name="title" label="Title" required maxLength={200} />
                <Field>
                  <FieldLabel htmlFor="ao-model">Pricing model</FieldLabel>
                  <NativeSelect id="ao-model" name="pricing_model" value={pricingModel} onChange={(e) => { setPricingModel(e.target.value); setOpportunityError(""); }}>
                    <NativeSelectOption value="regie">Régie</NativeSelectOption>
                    <NativeSelectOption value="forfait">Forfait</NativeSelectOption>
                  </NativeSelect>
                </Field>
                {pricingModel === "regie" && (
                  <>
                    <TextField id="ao-tjm" name="tjm" label="TJM (€ / day)" type="number" min="0" step="10" />
                    <TextField id="ao-days" name="estimated_days" label="Estimated days" type="number" min="0" step="1" />
                  </>
                )}
                {pricingModel === "forfait" && (
                  <TextField id="ao-fixed" name="fixed_price" label="Forfait (€)" type="number" min="0" step="100" />
                )}
                <Field>
                  <FieldLabel>Expected close</FieldLabel>
                  <DateField name="expected_close" aria-label="Expected close" />
                </Field>
                <TextField id="ao-owner" name="owner_email" label="Owner" type="email" defaultValue={actorEmail} maxLength={200} />
              </div>
              <FieldDescription>
                {pricingModel === "regie" ? "Régie is priced as TJM × estimated days." : "Forfait is a lump-sum price."} The amount is derived automatically.
              </FieldDescription>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowOpportunity(false)}>Cancel</Button>
                <Button type="submit" disabled={busy}>Add</Button>
              </DialogFooter>
            </FieldGroup>
          </form>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <CardTitle>Activity timeline</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form className="flex flex-wrap gap-2" onSubmit={log}>
            <NativeSelect name="type" defaultValue="note" aria-label="Activity type">
              {ACTIVITY_TYPES.map((t) => (
                <NativeSelectOption key={t} value={t}>{t}</NativeSelectOption>
              ))}
            </NativeSelect>
            <NativeSelect name="person_id" defaultValue="" aria-label="Related person">
              <NativeSelectOption value="">No person</NativeSelectOption>
              {people.map((p) => (
                <NativeSelectOption key={p.id} value={p.id}>{p.name}</NativeSelectOption>
              ))}
            </NativeSelect>
            <Input name="text" required maxLength={5000} placeholder="Log a call, email, meeting or note…" aria-label="Activity" className="min-w-56 flex-1" />
            <Button type="submit" disabled={busy}>Log</Button>
          </form>
          {activities.length ? (
            <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
              {activities.map((a) => (
                <li key={a.id} className="py-2.5">
                  <div className="text-sm">{a.text}</div>
                  <div className="text-xs text-muted-foreground">
                    {a.type.replace("_", " ")} · {a.author_email} · {new Date(a.created_at).toLocaleString("fr-FR")}
                    {a.person_id && ` · with ${data.people.find((p) => p.id === a.person_id)?.name || "contact"}`}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No activity yet">Log calls, emails and meetings to keep the relationship history.</EmptyState>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const INFLUENCE_VARIANT: Record<string, "success" | "secondary" | "outline" | "destructive"> = {
  champion: "success",
  supporter: "secondary",
  neutral: "outline",
  blocker: "destructive",
};

function InfluenceBadge({ influence, primary, title, children }: { influence: string; primary?: boolean; title?: string; children: ReactNode }) {
  return (
    <Badge variant={INFLUENCE_VARIANT[influence] ?? "outline"} title={title} className="gap-1 normal-case">
      {primary && <Star className="size-3" aria-label="Primary" />}
      {children}
    </Badge>
  );
}

function TextField({ id, label, ...props }: { id: string; label: string } & React.ComponentProps<typeof Input>) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} {...props} />
    </Field>
  );
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="label-mono">{label}</dt>
      <dd className="m-0 truncate text-sm">{value || "—"}</dd>
    </div>
  );
}
