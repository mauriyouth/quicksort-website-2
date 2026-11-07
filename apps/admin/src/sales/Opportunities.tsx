import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Plus, RefreshCw, Search, UserPlus } from "lucide-react";
import { db, errorMessage, type Job } from "@quicksort/hr-db";
import { formatDate } from "@quicksort/hr-ui";
import {
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
import { EmptyState, PageAlerts, StatusBadge } from "../ui";
import { useSession } from "@clerk/react";
import { loadWorkspace, executeCommand } from "../hr/data";
import { copyCv } from "../hr/recruitmentCv";
import type { Person, Application, Opportunity } from "../hr/domain";

export function Opportunities({ actorEmail }: { actorEmail: string }) {
  const { session } = useSession();
  const [opportunities, setOpportunities] = useState<
    RowOpportunity[]
  >([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<RowOpportunity | null | undefined>(undefined);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [workspace, jobResult] = await Promise.all([
        loadWorkspace(), db().from("jobs").select("*").order("created_at", { ascending: false }),
      ]);
      if (jobResult.error) throw jobResult.error;
      setOpportunities(workspace.opportunities);
      setJobs(jobResult.data || []);
      setPeople(workspace.people);
      setApplications(workspace.applications);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = "Opportunities · Quicksort Admin";
    void load();
  }, [load]);

  async function action(work: () => Promise<void>, success: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
      setMessage(success);
      setEditing(undefined);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const values = {
      title: String(f.get("title")).trim(),
      hiring_mode: String(f.get("hiring_mode")),
      job_id: String(f.get("job_id") || "") || null,
      client_need: String(f.get("client_need")).trim(),
      skill_family: String(f.get("skill_family")).trim(),
      owner_email: String(f.get("owner_email")).trim() || actorEmail,
      target_tjm: f.get("target_tjm") ? Number(f.get("target_tjm")) : null,
      justification: String(f.get("justification")).trim(),
    };
    void action(async () => {
      await executeCommand(editing
        ? { kind: "update_requisition", opportunity_id: editing.id, expected_version: editing.version, ...values }
        : { kind: "create_requisition", ...values });
    }, "Opportunity saved.");
  }

  function linkPerson(e: FormEvent<HTMLFormElement>, r: RowOpportunity) {
    e.preventDefault();
    const personId = String(new FormData(e.currentTarget).get("person_id") || "");
    if (!personId) return;
    let warning = "";
    void action(async () => {
      await executeCommand({ kind: "create_application", person_id: personId, opportunity_id: r.id });
      // Best-effort: copy the person's filed CV into <year>/<position> on Drive.
      warning = await copyCv(() => session?.getToken({ template: "supabase" }) ?? Promise.resolve(null), {
        personId,
        personName: people.find(p => p.id === personId)?.full_name || "Candidate",
        position: { title: r.title, openedAt: r.created_at },
      });
    }, "Application created. Existing applications remain linked to their own opportunities.").then(() => {
      if (warning) setError(warning);
    });
  }

  const query = search.toLowerCase();
  const visible = opportunities.filter(
    (r) =>
      !query ||
      r.title.toLowerCase().includes(query) ||
      r.skill_family.toLowerCase().includes(query),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        <Button variant="pivot" onClick={() => setEditing(null)}>
          <Plus data-icon="inline-start" />
          New opportunity
        </Button>
      </div>
      <PageAlerts error={error} message={message} />

      <Dialog open={editing !== undefined} onOpenChange={(open) => { if (!open) setEditing(undefined); }}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit opportunity" : "Create an opportunity"}</DialogTitle>
          </DialogHeader>
          <form key={editing?.id || "new"} onSubmit={save}>
            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="opp-title">Role title</FieldLabel>
                  <Input id="opp-title" name="title" defaultValue={editing?.title} required maxLength={200} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="opp-mode">Hiring mode</FieldLabel>
                  <NativeSelect id="opp-mode" name="hiring_mode" defaultValue={editing?.hiring_mode || "sur_mission"}>
                    <NativeSelectOption value="sur_mission">Sur mission (client need)</NativeSelectOption>
                    <NativeSelectOption value="sur_profil">Sur profil (speculative)</NativeSelectOption>
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="opp-skill">Skill family</FieldLabel>
                  <Input id="opp-skill" name="skill_family" defaultValue={editing?.skill_family} maxLength={200} placeholder="e.g. Data engineering" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="opp-owner">Owner (Business Manager)</FieldLabel>
                  <Input id="opp-owner" name="owner_email" type="email" defaultValue={editing?.owner_email || actorEmail} maxLength={200} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="opp-job">Career-site job post (optional)</FieldLabel>
                  <NativeSelect id="opp-job" name="job_id" defaultValue={editing?.job_id || ""}>
                    <NativeSelectOption value="">Not linked</NativeSelectOption>
                    {jobs.map((j) => (
                      <NativeSelectOption key={j.id} value={j.id}>
                        {j.title}
                        {j.published ? "" : " (draft)"}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="opp-tjm">Target TJM (€ / day)</FieldLabel>
                  <Input id="opp-tjm" name="target_tjm" type="number" min="0" step="10" defaultValue={editing?.target_tjm ?? ""} />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="opp-need">Client need / fiche de besoin</FieldLabel>
                <Textarea
                  id="opp-need"
                  name="client_need"
                  defaultValue={editing?.client_need}
                  rows={4}
                  maxLength={5000}
                  placeholder="Mandatory vs nice-to-have skills, seniority, location, duration, billing mode, start date…"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="opp-justification">Pipeline justification (sur profil only)</FieldLabel>
                <Textarea
                  id="opp-justification"
                  name="justification"
                  defaultValue={editing?.justification}
                  rows={3}
                  maxLength={5000}
                  placeholder="Expected utilization from probability-weighted pipeline demand, bench count, time-to-staff history…"
                />
              </Field>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditing(undefined)}>Cancel</Button>
                <Button type="submit" disabled={busy}>Save opportunity</Button>
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
              <InputGroupInput aria-label="Search opportunities" placeholder="Search opportunities…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </InputGroup>
            <Button variant="outline" disabled={loading} onClick={() => void load()}>
              <RefreshCw data-icon="inline-start" />
              Refresh
            </Button>
          </div>
          {!opportunities.length && !loading && (
            <EmptyState title="No opportunities yet">Create the first opportunity to open the funnel.</EmptyState>
          )}
          {!!visible.length && (
            <ItemGroup>
              {visible.map((r) => {
                const job = jobs.find((j) => j.id === r.job_id);
                const linked = applications.filter(a => a.opportunity_id === r.id);
                const linkable = people.filter(p => !linked.some(a => a.person_id === p.id && a.status === "active"));
                return (
                  <Item variant="outline" key={r.id} className="items-start">
                    <ItemContent className="min-w-0 gap-2">
                      <ItemTitle className="flex-wrap">
                        {r.title}
                        <StatusBadge status={r.status} />
                      </ItemTitle>
                      <ItemDescription>
                        {r.hiring_mode === "sur_mission" ? "Sur mission" : "Sur profil"}
                        {r.skill_family ? ` · ${r.skill_family}` : ""}
                        {r.target_tjm ? ` · target ${r.target_tjm} €/day` : ""}
                        {job ? ` · ${job.title}` : ""}
                      </ItemDescription>
                      {!!linked.length && (
                        <div className="flex flex-wrap gap-1">
                          {linked.map((a) => (
                            <Badge key={a.id} variant={a.status === "active" ? "secondary" : "outline"} className="normal-case">
                              {people.find(p => p.id === a.person_id)?.full_name || "Person"} · {a.status}
                            </Badge>
                          ))}
                        </div>
                      )}
                      <form className="flex max-w-md items-end gap-2" onSubmit={(e) => linkPerson(e, r)}>
                        <Field className="flex-1 gap-1">
                          <FieldLabel htmlFor={`apply-${r.id}`} className="text-xs font-normal text-muted-foreground">Create an application</FieldLabel>
                          <NativeSelect id={`apply-${r.id}`} size="sm" name="person_id" defaultValue="" required>
                            <NativeSelectOption value="" disabled>Select a person…</NativeSelectOption>
                            {linkable.map((p) => (
                              <NativeSelectOption key={p.id} value={p.id}>{p.full_name}</NativeSelectOption>
                            ))}
                          </NativeSelect>
                        </Field>
                        <Button type="submit" variant="outline" size="sm" disabled={busy || !linkable.length}>
                          <UserPlus data-icon="inline-start" />
                          Apply
                        </Button>
                      </form>
                      {!linkable.length && (
                        <p className="m-0 text-xs text-muted-foreground">No available people — add a person in HR first.</p>
                      )}
                      {r.decided_by && (
                        <p className="m-0 text-xs text-muted-foreground">
                          {r.decided_by} on {formatDate(r.decided_at || r.updated_at)}: {r.decision_rationale}
                        </p>
                      )}
                    </ItemContent>
                    <ItemActions>
                      {r.status === "draft" && (
                        <Button variant="outline" size="sm" disabled={busy} onClick={() => setEditing(r)}>Edit</Button>
                      )}
                      {r.status === "approved" && (
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            void action(async () => {
                              if (!r.job_id) throw new Error("Link a career-site job post before publishing.");
                              await executeCommand({ kind: "publish_requisition", opportunity_id: r.id, expected_version: r.version, job_id: r.job_id });
                            }, "Opportunity published — sourcing can start.")
                          }
                        >
                          Publish
                        </Button>
                      )}
                      {r.status === "published" && <Badge variant="success">live</Badge>}
                      {r.status === "filled" && <Badge variant="default">signed</Badge>}
                    </ItemActions>
                  </Item>
                );
              })}
            </ItemGroup>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

type RowOpportunity = Opportunity;
