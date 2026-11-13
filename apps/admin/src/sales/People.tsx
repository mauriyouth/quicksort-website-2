import { useState, type FormEvent, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Plus, RefreshCw, Search, Star, X } from "lucide-react";
import { db } from "@quicksort/hr-db";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Checkbox,
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
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Label,
  NativeSelect,
  NativeSelectOption,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Textarea,
} from "@quicksort-sas/ui";
import { cn } from "cn";
import { EmptyState, PageAlerts } from "../ui";
import {
  ACTIVITY_TYPES,
  INFLUENCE_META,
  amountDetail,
  daysSince,
  isOpen,
  isStaleContact,
  money,
  stageLabel,
  useSales,
  type SalesContact,
} from "./data";
import { ClientPicker } from "./ClientPicker";
import "./sales.css"; // ClientPicker styles

/**
 * People directory (sales.md §8.5): every contact across all clients,
 * searchable by name, role, client, email and notes. Champions and sponsors
 * are highlighted. The person drawer opens at /sales/people?focus=<personId>
 * with contact details, sponsor relationships (influence + primary champion)
 * and an activity composer that stamps last-contact.
 */
export function People({ actorEmail }: { actorEmail: string }) {
  const sales = useSales(actorEmail);
  const { data, loading, busy, error, message } = sales;
  const [search, setSearch] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [onlyDecisionMakers, setOnlyDecisionMakers] = useState(false);
  const [onlySponsors, setOnlySponsors] = useState(false);
  const [onlyStale, setOnlyStale] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newClientId, setNewClientId] = useState("");
  const [newDecisionMaker, setNewDecisionMaker] = useState(false);

  // The focused contact lives in the URL (?focus=<id>).
  const location = useLocation();
  const navigate = useNavigate();
  const focusId = new URLSearchParams(location.search).get("focus") || "";
  const setFocus = (id: string) => {
    const params = new URLSearchParams(location.search);
    if (id) params.set("focus", id);
    else params.delete("focus");
    const search = params.toString();
    navigate(location.pathname + (search ? `?${search}` : ""));
  };
  const openPerson = (id: string) => setFocus(id);
  const closePerson = () => setFocus("");

  const clientName = (id: string) => data.clients.find((c) => c.id === id)?.name || "";
  const sponsorPersonIds = new Set(data.sponsors.map((s) => s.person_id));

  const term = search.toLowerCase();
  const visible = data.people.filter((p) => {
    if (clientFilter && p.client_id !== clientFilter) return false;
    if (onlyDecisionMakers && !p.is_decision_maker) return false;
    if (onlySponsors && !sponsorPersonIds.has(p.id)) return false;
    if (onlyStale && !isStaleContact(p)) return false;
    if (
      term &&
      ![p.name, p.role, p.email, p.notes, clientName(p.client_id)]
        .join(" ")
        .toLowerCase()
        .includes(term)
    )
      return false;
    return true;
  });

  function addPerson(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const name = String(f.get("name")).trim();
    const clientId = String(f.get("client_id"));
    if (!name || !clientId) return;
    void sales.action(async () => {
      const result = await db()
        .from("sales_contacts")
        .insert({
          name,
          role: String(f.get("role")).trim(),
          client_id: clientId,
          email: String(f.get("email")).trim(),
          phone: String(f.get("phone")).trim(),
          linkedin: String(f.get("linkedin")).trim(),
          is_decision_maker: newDecisionMaker,
          notes: String(f.get("notes")).trim(),
        })
        .select("id")
        .single();
      if (result.error) throw result.error;
      setShowNew(false);
      setNewClientId("");
      setNewDecisionMaker(false);
    }, `${name} added.`);
  }

  const focused = data.people.find((p) => p.id === focusId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        <Button variant="pivot" onClick={() => setShowNew(true)}>
          <Plus data-icon="inline-start" />
          New person
        </Button>
      </div>
      <PageAlerts error={error} message={message} />

      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <span className="label-mono">Contacts</span>
            <DialogTitle>Create a person</DialogTitle>
          </DialogHeader>
          <form onSubmit={addPerson}>
            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="person-name">Name</FieldLabel>
                  <Input id="person-name" name="name" required maxLength={200} />
                </Field>
                <Field>
                  <FieldLabel>Client</FieldLabel>
                  <ClientPicker clients={data.clients} value={newClientId} onChange={setNewClientId} required />
                </Field>
                <Field>
                  <FieldLabel htmlFor="person-role">Role</FieldLabel>
                  <Input id="person-role" name="role" maxLength={200} placeholder="e.g. Head of Data" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="person-email">Email</FieldLabel>
                  <Input id="person-email" name="email" type="email" maxLength={200} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="person-phone">Phone</FieldLabel>
                  <Input id="person-phone" name="phone" maxLength={40} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="person-linkedin">LinkedIn</FieldLabel>
                  <Input id="person-linkedin" name="linkedin" type="url" maxLength={300} placeholder="https://linkedin.com/in/…" />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="person-notes">Notes</FieldLabel>
                <Textarea id="person-notes" name="notes" rows={3} maxLength={5000} />
              </Field>
              <Field orientation="horizontal">
                <Checkbox id="person-dm" checked={newDecisionMaker} onCheckedChange={(v) => setNewDecisionMaker(v === true)} />
                <FieldLabel htmlFor="person-dm" className="font-normal">Decision-maker</FieldLabel>
              </Field>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowNew(false)}>Cancel</Button>
                <Button type="submit" disabled={busy}>Save person</Button>
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
              <InputGroupInput aria-label="Search people" placeholder="Search people, roles, clients, emails…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </InputGroup>
            <NativeSelect aria-label="Client" value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
              <NativeSelectOption value="">All clients</NativeSelectOption>
              {data.clients.map((c) => (
                <NativeSelectOption key={c.id} value={c.id}>{c.name}</NativeSelectOption>
              ))}
            </NativeSelect>
            <Button variant="outline" disabled={loading} onClick={() => void sales.load()}>
              <RefreshCw data-icon="inline-start" />
              Refresh
            </Button>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <FilterCheck id="f-dm" checked={onlyDecisionMakers} onChange={setOnlyDecisionMakers}>Decision-makers</FilterCheck>
            <FilterCheck id="f-sponsor" checked={onlySponsors} onChange={setOnlySponsors}>Sponsors / champions</FilterCheck>
            <FilterCheck id="f-stale" checked={onlyStale} onChange={setOnlyStale}>Stale (90d+ no contact)</FilterCheck>
          </div>
          {!data.people.length && !loading && (
            <EmptyState title="No people yet">Add contacts from a client page or with "New person" above.</EmptyState>
          )}
          {data.people.length > 0 && !visible.length && (
            <EmptyState title="No people match">Try a different search or clear the filters.</EmptyState>
          )}
          {!!visible.length && (
            <ItemGroup>
              {visible.map((p) => {
                const links = data.sponsors.filter((s) => s.person_id === p.id);
                const stale = isStaleContact(p);
                const days = daysSince(p.last_contact_at);
                return (
                  <Item key={p.id} variant="outline" size="sm" render={<button type="button" onClick={() => openPerson(p.id)} />} className="cursor-pointer text-left hover:bg-accent/50">
                    <ItemContent className="min-w-0">
                      <ItemTitle className="flex-wrap">
                        {p.name}
                        <ContactBadges isPrimary={links.some((s) => s.is_primary)} isSponsor={!!links.length} isDecisionMaker={p.is_decision_maker} />
                      </ItemTitle>
                      <ItemDescription>
                        {[p.role, clientName(p.client_id)].filter(Boolean).join(" · ") || "—"}
                        {p.email ? ` · ${p.email}` : ""}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <span className={cn("text-xs", stale ? "text-warning" : "text-muted-foreground")}>
                        {days === null ? "Never contacted" : `${days}d since contact`}
                      </span>
                    </ItemActions>
                  </Item>
                );
              })}
            </ItemGroup>
          )}
        </CardContent>
      </Card>

      <Sheet open={!!focused} onOpenChange={(open) => { if (!open) closePerson(); }}>
        {focused && (
          <PersonDrawer
            key={focused.id}
            person={focused}
            sales={sales}
            actorEmail={actorEmail}
            clientName={clientName(focused.client_id)}
          />
        )}
      </Sheet>
    </div>
  );
}

function FilterCheck({ id, checked, onChange, children }: { id: string; checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      <Label htmlFor={id} className="font-normal">{children}</Label>
    </div>
  );
}

export function ContactBadges({ isPrimary, isSponsor, isDecisionMaker }: { isPrimary?: boolean; isSponsor?: boolean; isDecisionMaker?: boolean }) {
  return (
    <>
      {isPrimary && <Badge variant="success" className="gap-1"><Star className="size-3" aria-hidden="true" /> Primary champion</Badge>}
      {isSponsor && !isPrimary && <Badge variant="secondary">Sponsor</Badge>}
      {isDecisionMaker && <Badge variant="outline">Decision-maker</Badge>}
    </>
  );
}

function PersonDrawer({
  person,
  sales,
  actorEmail,
  clientName,
}: {
  person: SalesContact;
  sales: ReturnType<typeof useSales>;
  actorEmail: string;
  clientName: string;
}) {
  const { data, busy, action, logActivity } = sales;
  const clientOpportunities = data.opportunities.filter(
    (o) => o.client_id === person.client_id,
  );
  const links = data.sponsors.filter((s) => s.person_id === person.id);

  function setSponsor(opportunityId: string, influence: string) {
    void action(async () => {
      const result = await db()
        .from("sales_sponsors")
        .upsert({ opportunity_id: opportunityId, person_id: person.id, influence })
        .select("opportunity_id")
        .single();
      if (result.error) throw result.error;
      const note = await db()
        .from("sales_activities")
        .insert({
          client_id: person.client_id,
          opportunity_id: opportunityId,
          person_id: person.id,
          type: "note",
          text: `${person.name} marked as ${INFLUENCE_META[influence]?.label || influence} on "${
            data.opportunities.find((o) => o.id === opportunityId)?.title || "opportunity"
          }".`,
          author_email: actorEmail,
        });
      if (note.error) throw note.error;
    }, "Sponsor updated.");
  }

  function setPrimary(opportunityId: string, primary: boolean) {
    void action(async () => {
      // Only one primary champion per opportunity.
      await db()
        .from("sales_sponsors")
        .update({ is_primary: false })
        .eq("opportunity_id", opportunityId);
      const result = await db()
        .from("sales_sponsors")
        .update({ is_primary: primary })
        .eq("opportunity_id", opportunityId)
        .eq("person_id", person.id)
        .select("opportunity_id")
        .single();
      if (result.error) throw result.error;
    }, primary ? "Marked as primary champion." : "Primary champion removed.");
  }

  function removeSponsor(opportunityId: string) {
    void action(async () => {
      const result = await db()
        .from("sales_sponsors")
        .delete()
        .eq("opportunity_id", opportunityId)
        .eq("person_id", person.id)
        .select("opportunity_id")
        .single();
      if (result.error) throw result.error;
    }, "Removed from the opportunity.");
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
        client_id: person.client_id,
        opportunity_id: String(f.get("opportunity_id") || "") || null,
        person_id: person.id,
        type: String(f.get("type")),
        text,
      },
      "Activity logged.",
    ).then(() => form.reset());
  }

  const history = data.activities.filter((a) => a.person_id === person.id);

  const days = daysSince(person.last_contact_at);
  return (
    <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-xl">
      <SheetHeader className="border-b border-border">
        <span className="label-mono">{clientName}</span>
        <SheetTitle>{person.name}</SheetTitle>
        <SheetDescription>{[person.role, person.email, person.phone].filter(Boolean).join(" · ") || "—"}</SheetDescription>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <ContactBadges isDecisionMaker={person.is_decision_maker} />
          {days === null ? "Never contacted" : `Last contact ${days}d ago`}
          {person.linkedin && (
            <a className="underline underline-offset-4" href={person.linkedin} target="_blank" rel="noopener noreferrer">LinkedIn profile</a>
          )}
        </div>
      </SheetHeader>
      <div className="flex flex-col gap-6 p-6">
        {person.notes && <p className="m-0 text-sm whitespace-pre-wrap">{person.notes}</p>}

        <DrawerSection title="Sponsor relationships">
          {links.length ? (
            <ItemGroup>
              {links.map((s) => {
                const opp = data.opportunities.find((o) => o.id === s.opportunity_id);
                return (
                  <Item key={s.opportunity_id} variant="outline" size="sm">
                    <ItemContent className="min-w-0">
                      <ItemTitle className="flex-wrap">
                        {opp?.title || "Opportunity"}
                        {s.is_primary && <Badge variant="success" className="gap-1"><Star className="size-3" aria-hidden="true" /> Primary</Badge>}
                      </ItemTitle>
                      <ItemDescription>
                        {opp ? `${money(Number(opp.amount), opp.currency)} · ${amountDetail(opp)} · ${stageLabel(opp.stage)}${isOpen(opp) ? "" : " (closed)"}` : ""}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <NativeSelect size="sm" aria-label="Influence" value={s.influence} disabled={busy} onChange={(e) => setSponsor(s.opportunity_id, e.target.value)}>
                        {Object.entries(INFLUENCE_META).map(([key, meta]) => (
                          <NativeSelectOption key={key} value={key}>{meta.label}</NativeSelectOption>
                        ))}
                      </NativeSelect>
                      <Button
                        variant={s.is_primary ? "default" : "outline"}
                        size="icon-sm"
                        disabled={busy}
                        aria-pressed={s.is_primary}
                        aria-label={s.is_primary ? "Unmark primary champion" : "Mark as primary champion"}
                        title={s.is_primary ? "Unmark primary champion" : "Mark as primary champion"}
                        onClick={() => setPrimary(s.opportunity_id, !s.is_primary)}
                      >
                        <Star />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-destructive"
                        disabled={busy}
                        aria-label="Remove from opportunity"
                        title="Remove from opportunity"
                        onClick={() => removeSponsor(s.opportunity_id)}
                      >
                        <X />
                      </Button>
                    </ItemActions>
                  </Item>
                );
              })}
            </ItemGroup>
          ) : (
            <p className="m-0 text-xs text-muted-foreground">Not sponsoring any opportunity yet. Mark an influence below.</p>
          )}
          {!!clientOpportunities.length && (
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const id = String(f.get("opportunity_id"));
                if (id) setSponsor(id, "neutral");
              }}
            >
              <Field className="flex-1 gap-1">
                <FieldLabel htmlFor="sponsor-on" className="text-xs font-normal text-muted-foreground">Add as sponsor on…</FieldLabel>
                <NativeSelect id="sponsor-on" size="sm" name="opportunity_id" defaultValue="" required>
                  <NativeSelectOption value="" disabled>Select an opportunity…</NativeSelectOption>
                  {clientOpportunities
                    .filter((o) => !links.some((s) => s.opportunity_id === o.id))
                    .map((o) => (
                      <NativeSelectOption key={o.id} value={o.id}>
                        {o.title} ({o.pricing_model === "regie" ? "Régie" : "Forfait"})
                      </NativeSelectOption>
                    ))}
                </NativeSelect>
              </Field>
              <Button type="submit" variant="outline" size="sm" disabled={busy}>
                <Plus data-icon="inline-start" />
                Sponsor
              </Button>
            </form>
          )}
        </DrawerSection>

        <DrawerSection title="Log activity">
          <form onSubmit={log}>
            <FieldGroup className="gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="activity-type">Type</FieldLabel>
                  <NativeSelect id="activity-type" name="type" defaultValue="call">
                    {ACTIVITY_TYPES.map((t) => (
                      <NativeSelectOption key={t} value={t}>{t}</NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="activity-opp">Related opportunity</FieldLabel>
                  <NativeSelect id="activity-opp" name="opportunity_id" defaultValue="">
                    <NativeSelectOption value="">None</NativeSelectOption>
                    {clientOpportunities.map((o) => (
                      <NativeSelectOption key={o.id} value={o.id}>{o.title}</NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="activity-text">What happened?</FieldLabel>
                <Textarea id="activity-text" name="text" required rows={2} maxLength={5000} />
              </Field>
              <div>
                <Button type="submit" size="sm" disabled={busy}>Log activity</Button>
              </div>
            </FieldGroup>
          </form>
        </DrawerSection>

        {!!history.length && (
          <DrawerSection title="History">
            <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
              {history.slice(0, 10).map((a) => (
                <li key={a.id} className="py-2.5">
                  <div className="text-sm">{a.text}</div>
                  <div className="text-xs text-muted-foreground">
                    {a.type.replace("_", " ")} · {a.author_email} · {new Date(a.created_at).toLocaleDateString("fr-FR")}
                  </div>
                </li>
              ))}
            </ul>
          </DrawerSection>
        )}
      </div>
    </SheetContent>
  );
}

function DrawerSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="label-mono m-0 text-foreground">{title}</h3>
      {children}
    </section>
  );
}
