import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import {
  LayoutDashboard,
  Upload,
  FileText,
  KeyRound,
  Settings,
  ArrowUpRight,
  Check,
  CalendarDays,
  Receipt,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useClerk } from "@clerk/react";
import {
  db,
  downloadFile,
  errorMessage,
  type Row,
} from "@quicksort/hr-db";
import { validateFile } from "@quicksort/hr-db/validation";
import { resolvePortalRoute, formatDate } from "@quicksort/hr-ui";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  NativeSelect,
  NativeSelectOption,
  Stat,
  StatGroup,
  StatLabel,
  StatSource,
  StatValue,
  Textarea,
} from "@quicksort-sas/ui";
import { cn } from "cn";
import { z } from "zod";
import { AdminShell } from "../AdminShell";
import { SectionHeader } from "../SectionHeader";
import { EmptyState, PageAlerts, PageHeading, StatusBadge } from "../ui";
import { executeCommand } from "../hr/data";
import { CraScreen } from '../cra/CraScreen';
import { downloadOwnDocument, downloadOwnPayslip, previewOwnDocument, previewOwnPayslip } from '../documents/client';
import { MyPayslips } from '../payslips/MyPayslips';
import { MyDocuments, type MyDocumentType } from '../documents/MyDocuments';

type PortalRoute = { id: string; href: string };

/** Section navigation through react-router, so the portal and the pages it
 * hosts (the CRA screen) share one history. "/" lands on the first section. */
function usePortalRoute(routes: readonly PortalRoute[]) {
  const location = useLocation();
  const routerNavigate = useNavigate();
  useEffect(() => {
    if (location.pathname === "/")
      routerNavigate(routes[0].href + location.search + location.hash, { replace: true });
  }, [location.pathname, routes]);
  const current = resolvePortalRoute(routes, location.pathname);
  const navigate = useCallback((id: string, href?: string) => {
    const route = routes.find(item => item.id === id);
    if (!route) return;
    // Deep links pass their full path; plain navigation uses the section href.
    const target = href ?? route.href;
    if (window.location.pathname + window.location.search + window.location.hash !== target)
      routerNavigate(target);
    window.scrollTo(0, 0);
  }, [routes, routerNavigate]);
  return [current, navigate] as const;
}

const applicationSchema = z.object({ id: z.uuid(), person_id: z.uuid(), opportunity_id: z.uuid(), full_name: z.string(), title: z.string(), stage: z.string(), status: z.string(), created_at: z.string(), updated_at: z.string() });
const applicationEventSchema = z.object({ id: z.number(), application_id: z.uuid(), to_stage: z.string(), kind: z.string(), created_at: z.string() });
const employmentSchema = z.object({ id: z.uuid(), person_id: z.uuid(), matricule: z.string(), role: z.string(), start_date: z.string(), end_date: z.string().nullable(), status: z.string(), onboarding_completed_at: z.string().nullable(), probation_status: z.string(), probation_end: z.string().nullable() });
const taskSchema = z.object({ id: z.uuid(), employee_id: z.uuid(), phase: z.string(), title: z.string(), assignee: z.string(), due_date: z.string().nullable(), required: z.boolean(), dependency_id: z.uuid().nullable(), evidence: z.string(), completed_at: z.string().nullable(), version: z.number().int() });
const offerSchema = z.object({ id: z.uuid(), application_id: z.uuid(), title: z.string(), contract_type: z.string(), salary_monthly: z.number(), status: z.string(), shared_at: z.string().nullable(), valid_until: z.string().nullable(), version: z.number().int() });
const payslipSchema = z.object({ id: z.uuid(), person_id: z.uuid(), title: z.string(), valid_from: z.string().nullable(), file_name: z.string(), size_bytes: z.number().nullable(), created_at: z.string() });
type MyPayslip = z.infer<typeof payslipSchema>;
const registrySchema = z.object({ id: z.uuid(), upload_path: z.string().nullable(), uploaded_by_me: z.boolean(), type_code: z.string(), type_label: z.string().nullable(), title: z.string(), file_name: z.string(), mime_type: z.string(), size_bytes: z.number().nullable(), status: z.enum(["active", "superseded", "archived"]), needs_review: z.boolean(), issued_on: z.string().nullable(), expires_on: z.string().nullable(), warn_days: z.array(z.number()), created_at: z.string() });
type MyRegistryDocument = z.infer<typeof registrySchema>;
type MyApplication = z.infer<typeof applicationSchema>;
type MyApplicationEvent = z.infer<typeof applicationEventSchema>;
type MyEmployment = z.infer<typeof employmentSchema>;
type MyTask = z.infer<typeof taskSchema>;
type MyOffer = z.infer<typeof offerSchema>;

const STAGE_LABELS: Record<string, string> = {
  opportunity: "Job opportunity",
  published: "Published / sourcing",
  application: "Application received",
  matching: "Review",
  screening: "Pre-qualification",
  hr_interview: "HR interview",
  technical_interview: "Technical interview",
  client_presentation: "Client presentation",
  decision: "Decision",
  offer: "Offer",
  contract: "Contract signature",
  preboarding: "Pre-boarding",
  onboarding: "Onboarding",
  probation: "Probation",
  confirmed: "Confirmed",
  offboarding: "Alumni",
};
const nav = [
  { id: "overview", href: "/onboarding", label: "My onboarding", icon: LayoutDashboard },
  { id: "application", href: "/application", label: "My application", icon: FileText },
  { id: "documents", href: "/documents", label: "Documents", icon: Upload },
  { id: "payslips", href: "/payslips", label: "Payslips", icon: Receipt },
  { id: "cra", href: "/cra", label: "My CRA", icon: CalendarDays },
  { id: "requests", href: "/tool-access", label: "Tool access", icon: KeyRound },
  { id: "account", href: "/account", label: "Account", icon: Settings },
];

const GATED_TABS = ["overview", "requests"];

/**
 * Candidate/employee self-service portal ("HR portal"). Rendered by the app
 * root for every signed-in user who is not staff — see App.tsx.
 */
export function HrPortal({ userId, email }: { userId: string; email: string }) {
  const [applications, setApplications] = useState<MyApplication[]>([]);
  const [applicationEvents, setApplicationEvents] = useState<MyApplicationEvent[]>([]);
  const [employments, setEmployments] = useState<MyEmployment[]>([]);
  const [tasks, setTasks] = useState<MyTask[]>([]);
  const [offers, setOffers] = useState<MyOffer[]>([]);
  const [payslips, setPayslips] = useState<MyPayslip[]>([]);
  // The employee's HR folder (registry rows filed by HR, an admin or themselves).
  const [folder, setFolder] = useState<MyRegistryDocument[]>([]);
  const [journeyError, setJourneyError] = useState("");
  const onboardingOpen = employments.some(e => e.status !== "ended");
  // Employment unlocks the journey. Employees sign through Youtrust, so the
  // application page only exists before hiring.
  const routes = useMemo(
    () => (onboardingOpen
      ? nav.filter((n) => n.id !== "application")
      : [nav[1], nav[0], ...nav.slice(2)]),
    [onboardingOpen],
  );
  const visibleNav = onboardingOpen
    ? routes
    : routes.filter((n) => !GATED_TABS.includes(n.id) && (n.id !== "cra" || employments.length > 0));
  const [tab, setTab] = usePortalRoute(routes);
  const
    [profile, setProfile] = useState<Row<"profiles"> | null>(null),
    [documents, setDocuments] = useState<Row<"candidate_documents">[]>([]),
    [docTypes, setDocTypes] = useState<MyDocumentType[]>([]),
    [nameFromHr, setNameFromHr] = useState(false),
    [requests, setRequests] = useState<Row<"tool_requests">[]>([]);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setJourneyError("");
      try {
        const journeys = await Promise.all([
          db().from("my_applications").select("*").order("created_at", { ascending: false }),
          db().from("my_application_events").select("*").order("created_at"),
          db().from("my_employment").select("*").order("start_date", { ascending: false }),
          db().from("my_onboarding_items").select("*"),
          db().from("my_offers").select("*"),
          db().from("my_payslips").select("*").order("valid_from", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }),
        ]);
        for (const result of journeys) if (result.error) throw result.error;
        setApplications(applicationSchema.array().parse(journeys[0].data));
        setApplicationEvents(applicationEventSchema.array().parse(journeys[1].data));
        setEmployments(employmentSchema.array().parse(journeys[2].data));
        setTasks(taskSchema.array().parse(journeys[3].data));
        setOffers(offerSchema.array().parse(journeys[4].data));
        setPayslips(payslipSchema.array().parse(journeys[5].data));
      } catch (e) {
        setApplications([]); setApplicationEvents([]); setEmployments([]); setTasks([]); setOffers([]); setPayslips([]);
        setJourneyError(errorMessage(e));
      }
      // The HR folder is a bonus: own uploads still list without it.
      const folderRows = await db().from("my_documents").select("*").order("created_at", { ascending: false });
      try {
        if (folderRows.error) throw folderRows.error;
        setFolder(registrySchema.array().parse(folderRows.data));
      } catch {
        setFolder([]);
      }
      const managed = await db().rpc("my_name_from_hr");
      setNameFromHr(!managed.error && managed.data === true);
      const typeRows = await db().from("my_document_types").select("*");
      setDocTypes(typeRows.error ? [] : (typeRows.data as MyDocumentType[]));
      const results = await Promise.all([
        db().from("profiles").select("*").eq("id", userId).single(),
        db()
          .from("candidate_documents")
          .select("*")
          .eq("candidate_id", userId)
          .order("created_at", { ascending: false }),
        db()
          .from("tool_requests")
          .select("*")
          .eq("candidate_id", userId)
          .order("created_at", { ascending: false }),
      ]);
      for (const r of results) if (r.error) throw r.error;
      setProfile(results[0].data);
      setDocuments(results[1].data || []);
      setRequests(results[2].data || []);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [userId]);
  useEffect(() => {
    document.title = "Quicksort HR";
    void load();
  }, [load]);
  async function action(work: () => Promise<void>, success = "Saved.") {
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
  useEffect(() => { setError(""); setMessage(""); }, [tab]);
  function navigate(id: string) {
    setTab(id);
    setError("");
    setMessage("");
  }
  async function upload(file: File, typeCode: string | null, category: string) {
    await action(async () => {
      validateFile(file);
      const extension =
        file.name
          .split(".")
          .pop()
          ?.replace(/[^a-zA-Z0-9]/g, "") || "bin";
      const path = `${userId}/${crypto.randomUUID()}.${extension}`;
      const result = await db()
        .storage.from("candidate-documents")
        .upload(path, file, { upsert: false, contentType: file.type });
      if (result.error) throw result.error;
      const saved = await db()
        .from("candidate_documents")
        .insert({
          candidate_id: userId,
          name: file.name,
          category,
          type_code: typeCode,
          storage_path: path,
          size_bytes: file.size,
        });
      if (saved.error) {
        await db().storage.from("candidate-documents").remove([path]);
        throw saved.error;
      }
    }, "Document sent. HR will check it.");
  }
  // Removing an own upload asks first (an AlertDialog, in place of confirm()).
  const [removing, setRemoving] = useState<Row<"candidate_documents"> | null>(null);
  function removeUpload(upload: Row<"candidate_documents">) {
    void action(async () => {
      const storage = await db().storage.from("candidate-documents").remove([upload.storage_path]);
      if (storage.error) throw storage.error;
      const result = await db().from("candidate_documents").delete().eq("id", upload.id).select("id").single();
      if (result.error) throw result.error;
    }, "Document removed.");
  }
  // One list: every HR-folder document, plus own uploads HR has not filed (not
  // linked yet, or a CV). An own upload rides on its registry row; a replaced
  // or archived one only shows while the upload itself still exists.
  const uploadByPath = new Map(documents.map((d) => [d.storage_path, d]));
  const filedPaths = new Set(folder.map((f) => f.upload_path).filter(Boolean));
  const folderRows = [
    ...folder
      .map((f) => ({ key: f.id, filed: f as MyRegistryDocument | undefined, upload: f.upload_path ? uploadByPath.get(f.upload_path) : undefined, createdAt: f.created_at }))
      .filter((r) => r.filed!.status === "active" || r.upload),
    ...documents
      .filter((d) => !filedPaths.has(d.storage_path))
      .map((d) => ({ key: d.id, filed: undefined as MyRegistryDocument | undefined, upload: d as typeof d | undefined, createdAt: d.created_at })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <AdminShell
      portal="HR"
      email={email}
      nav={visibleNav}
      current={tab}
      onNavigate={navigate}
      header={<SectionHeader label={visibleNav.find((n) => n.id === tab)?.label ?? nav.find((n) => n.id === tab)?.label ?? "Page not found"} current={tab} onNavigate={navigate} />}
    >
      <div className="flex min-w-0 flex-col gap-6">
      <PageAlerts error={error} message={message} />
      {!onboardingOpen && GATED_TABS.includes(tab) && (
        <EmptyState title="Opens when you join">
          This section becomes available once your offer is accepted and your
          onboarding begins. Follow your progress in My application.
        </EmptyState>
      )}
      {tab === "cra" && <>
        <PageHeading title="Monthly CRA">
          Fill your month day by day, or paint whole ranges, then save. Mornings and afternoons can be filled separately.
        </PageHeading>
        <CraScreen audience="employee" draftOwner={email} basePath="/cra" />
      </>}
      {tab === "application" && !onboardingOpen && <MyApplicationTab email={email} busy={busy} action={action} applications={applications} events={applicationEvents} offers={offers} employments={employments} journeyError={journeyError} loading={loading} />}
      {tab === "overview" && onboardingOpen && (
        <>
          <Card>
            <CardContent className="flex flex-col items-start gap-3 py-2">
              <p className="m-0 max-w-xl text-sm text-muted-foreground">
                Keep your documents, agreements and access requests together. Your
                Quicksort team is here to help along the way.
              </p>
              <Button className="mt-2" onClick={() => navigate("documents")}>
                Upload your documents
                <ArrowUpRight data-icon="inline-end" aria-hidden="true" />
              </Button>
            </CardContent>
          </Card>
          <StatGroup>
            <PortalStat label="Documents" value={folderRows.length} detail="Securely shared with your team" icon={Upload} />
            <PortalStat label="Tool requests" value={requests.filter((r) => r.status === "pending").length} detail="Awaiting a team response" icon={KeyRound} />
          </StatGroup>
          <div className="@container grid items-start gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <PortalCardTitle>Your onboarding checklist</PortalCardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
              <PageAlerts error={journeyError} />
              {employments.filter(e => e.status !== "ended").map(employment => (
                <div key={employment.id} className="flex flex-col gap-1">
                  <h3 className="m-0 text-[15px] font-medium">{employment.role}</h3>
                  <p className={QUIET}>Starting {formatDate(employment.start_date)} · {employment.status}</p>
                  <ul className={cn(LIST, "mt-2")}>
                  {tasks.filter(t => t.employee_id === employment.id).map(task => {
                    const dependency = task.dependency_id ? tasks.find(t => t.id === task.dependency_id) : null;
                    const waiting = Boolean(dependency && !dependency.completed_at);
                    return <li className={cn(ROW, "flex-col items-stretch")} key={task.id}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <h4 className="m-0 text-sm font-medium">{task.title}</h4>
                          <p className={QUIET}>{task.phase} · {task.required ? "Required" : "Optional"}{task.due_date ? ` · Due ${formatDate(task.due_date)}` : ""}</p>
                          {task.assignee && <p className="m-0 text-xs text-muted-foreground">Owner: {task.assignee}</p>}
                          {waiting && <p className="m-0 text-xs text-muted-foreground">Waiting for {dependency?.title}</p>}
                        </div>
                        {task.completed_at && <Check className="mt-0.5 size-4 shrink-0" aria-label="Completed" />}
                      </div>
                      {!task.completed_at && <form className="flex flex-wrap gap-2" onSubmit={e => {
                        e.preventDefault(); const fields = new FormData(e.currentTarget);
                        void action(async () => { await executeCommand({ kind: "complete_task", task_id: task.id, expected_version: task.version, evidence: String(fields.get("evidence") || "").trim() }); }, "Task completed.");
                      }}>
                        <Input name="evidence" placeholder="Completion evidence" required aria-label={`Evidence for ${task.title}`} className="min-w-0 flex-[1_1_12rem]" />
                        <Button type="submit" variant="outline" disabled={busy || waiting || ![email.toLowerCase(), "employee", "candidate"].includes(task.assignee.toLowerCase())}>Complete</Button>
                      </form>}
                    </li>;
                  })}
                  </ul>
                  {!tasks.some(t => t.employee_id === employment.id) && <p className={QUIET}>Your team is preparing your onboarding plan.</p>}
                </div>
              ))}
              </CardContent>
            </Card>
          </div>
        </>
      )}
      {tab === "documents" && (
        <>
          <PageHeading title="Documents" />
          <MyDocuments
            folder={folder}
            uploads={documents}
            types={docTypes}
            busy={busy}
            loading={loading}
            onUpload={(file, typeCode, category) => void upload(file, typeCode, category)}
            onOpen={(doc) => void action(() => previewOwnDocument(doc), "Document opened.")}
            onDownload={(row) =>
              void action(
                () => (row.filed ? downloadOwnDocument(row.filed) : downloadFile("candidate-documents", row.upload!.storage_path, row.upload!.name)),
                "Document downloaded.",
              )
            }
            onRemove={(u) => setRemoving(documents.find((d) => d.id === u.id) ?? null)}
          />
          <AlertDialog open={!!removing} onOpenChange={(open) => { if (!open) setRemoving(null); }}>
            <AlertDialogContent size="sm">
              <AlertDialogHeader>
                <AlertDialogTitle>Remove "{removing?.name}"?</AlertDialogTitle>
                <AlertDialogDescription>HR will no longer see this file. You can send it again later.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => {
                    const target = removing;
                    setRemoving(null);
                    if (target) removeUpload(target);
                  }}
                >
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
      {tab === "payslips" && (
        <>
          <PageHeading title="Payslips" />
          {!payslips.length && !loading && (
            <EmptyState title="No payslips yet">
              Your payslips appear here once HR has filed them.
            </EmptyState>
          )}
          <MyPayslips
            rows={payslips}
            busy={busy}
            onOpen={(p) => void action(() => previewOwnPayslip(p), "Payslip opened.")}
            onDownload={(p) => void action(() => downloadOwnPayslip(p), "Payslip downloaded.")}
            onDownloadAll={(rows) => void action(async () => { for (const p of rows) await downloadOwnPayslip(p); }, rows.length === 1 ? "Payslip downloaded." : "Payslips downloaded.")}
          />
        </>
      )}
      {tab === "requests" && onboardingOpen && (
        <>
          <PageHeading title="Tool access" />
          <Card>
            <CardHeader>
              <PortalCardTitle>Request a tool</PortalCardTitle>
            </CardHeader>
            <CardContent>
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const f = new FormData(form);
                void action(async () => {
                  const { error } = await db()
                    .from("tool_requests")
                    .insert({
                      tool_name: String(f.get("tool")).trim(),
                      reason: String(f.get("reason")).trim(),
                    });
                  if (error) throw error;
                  form.reset();
                }, "Request sent to your Quicksort team.");
              }}
            >
              <LabelledField label="Tool or service">
                {(id) => <Input
                  id={id}
                  name="tool"
                  required
                  maxLength={100}
                  placeholder="e.g. GitHub, Notion, Figma"
                />}
              </LabelledField>
              <LabelledField label="What do you need it for?">
                {(id) => <Textarea
                  id={id}
                  name="reason"
                  required
                  maxLength={2000}
                  className="min-h-24 resize-y"
                  placeholder="Tell us about the project and access you need…"
                />}
              </LabelledField>
              <div>
                <Button type="submit" disabled={busy}>
                  Send request
                </Button>
              </div>
            </form>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <PortalCardTitle>Your requests</PortalCardTitle>
            </CardHeader>
            <CardContent>
            {!requests.length && !loading && (
              <EmptyState title="No requests yet">
                Need a tool to get started? Let your team know above.
              </EmptyState>
            )}
            <ul className={LIST}>
            {requests.map((r) => (
              <li className={ROW} key={r.id}>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <h3 className="m-0 text-[15px] font-medium">{r.tool_name}</h3>
                  <p className={cn(QUIET, "whitespace-pre-wrap [overflow-wrap:anywhere]")}>{r.reason}</p>
                  {r.admin_note && (
                    <p className="m-0 text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">Team response: {r.admin_note}</p>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {formatDate(r.created_at)}
                  </span>
                </div>
                <StatusBadge status={r.status} />
              </li>
            ))}
            </ul>
            </CardContent>
          </Card>
        </>
      )}
      {tab === "account" && (
        <>
          <PageHeading title="Account" />
          <div className="grid items-start gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <PortalCardTitle>Your profile</PortalCardTitle>
                <CardDescription>{email}</CardDescription>
              </CardHeader>
              <CardContent>
              {nameFromHr ? (
                <LabelledField label="Full name" hint="Managed by HR from your employee record. Ask HR if it needs correcting." hintId="name-from-hr">
                  {(id) => <Input id={id} value={profile?.full_name ?? ""} readOnly disabled aria-describedby="name-from-hr" />}
                </LabelledField>
              ) : (
              <form
                className="flex flex-col gap-4"
                key={profile?.full_name}
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void action(async () => {
                    const { error } = await db()
                      .from("profiles")
                      .update({ full_name: String(f.get("name")).trim() })
                      .eq("id", userId)
                      .select("id")
                      .single();
                    if (error) throw error;
                  }, "Profile updated.");
                }}
              >
                <LabelledField label="Full name">
                  {(id) => <Input
                    id={id}
                    name="name"
                    defaultValue={profile?.full_name}
                    required
                    maxLength={200}
                  />}
                </LabelledField>
                <div>
                  <Button type="submit" disabled={busy}>
                    Save profile
                  </Button>
                </div>
              </form>
              )}
              </CardContent>
            </Card>
            <AccountCard />
          </div>
        </>
      )}
      {loading && (
        <p className={QUIET} role="status">
          Refreshing your workspace…
        </p>
      )}
      </div>
    </AdminShell>
  );
}

const QUIET = "m-0 text-[13px] text-muted-foreground";
/** Divided list of records inside a card. */
const LIST = "m-0 flex list-none flex-col divide-y divide-border p-0";
const ROW = "flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0";

/** Card title carrying the outline semantics of the old <h2>. */
function PortalCardTitle({ children }: { children: ReactNode }) {
  return <CardTitle role="heading" aria-level={2}>{children}</CardTitle>;
}

/** Label + control + optional hint; the control receives the generated id. */
function LabelledField({ label, hint, hintId, children, className }: { label: string; hint?: string; hintId?: string; children: (id: string) => ReactNode; className?: string }) {
  const id = useId();
  return (
    <Field className={cn("min-w-0 gap-1.5", className)}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {children(id)}
      {hint && <FieldDescription id={hintId} className="text-xs">{hint}</FieldDescription>}
    </Field>
  );
}

/** Overview figure (replaces hr-ui <Stat>): the count, padded to two digits, over its label and detail. */
function PortalStat({ label, value, detail, icon: Icon }: { label: string; value: number; detail: string; icon: typeof Upload }) {
  return (
    <Stat>
      <StatLabel className="flex max-w-none items-center justify-between gap-2">
        {label}
        <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
      </StatLabel>
      <StatValue>{value.toString().padStart(2, "0")}</StatValue>
      <StatSource>{detail}</StatSource>
    </Stat>
  );
}

/** Clerk account management (replaces hr-ui <AccountSecurity>). */
function AccountCard() {
  const clerk = useClerk();
  return (
    <Card>
      <CardHeader>
        <PortalCardTitle>Your account</PortalCardTitle>
        <CardDescription>Manage your Google connection and active sessions.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={() => clerk.openUserProfile()}>Manage account</Button>
      </CardContent>
    </Card>
  );
}

function MyApplicationTab({
  email, busy, action, applications, events, offers, employments, journeyError, loading,
}: {
  email: string;
  busy: boolean;
  action: (work: () => Promise<void>, success?: string) => Promise<void>;
  applications: MyApplication[];
  events: MyApplicationEvent[];
  offers: MyOffer[];
  employments: MyEmployment[];
  journeyError: string;
  loading: boolean;
}) {
  const [selectedId, setSelectedId] = useState("");
  const application = applications.find(a => a.id === selectedId) || applications.find(a => a.status === "active") || applications[0];
  return (
    <>
      <PageHeading title="My application" />
      <PageAlerts error={journeyError} />
      {loading && <p className={QUIET} role="status">Loading your applications…</p>}
      {!loading && !journeyError && !application && <EmptyState title="No application linked yet">Your HR team can link your account to your person record. Your documents are already available.</EmptyState>}
      {application && <>
        <Card>
          <CardContent className="flex flex-col items-start gap-5">
          <LabelledField label="Application" className="w-full max-w-md">
            {(id) => <NativeSelect id={id} className="w-full" value={application.id} onChange={e => setSelectedId(e.target.value)}>{applications.map(a => <NativeSelectOption value={a.id} key={a.id}>{a.title} · {a.status}</NativeSelectOption>)}</NativeSelect>}
          </LabelledField>
          <div className="flex flex-col items-start gap-2">
            <h2 className="m-0 text-xl font-medium tracking-tight">{application.title}</h2>
            <StatusBadge status={application.status === "active" ? application.stage : application.status} />
          </div>
          <h3 className="m-0 text-sm font-medium">Your journey so far</h3>
          <ol className="m-0 flex list-none flex-col p-0">
            <TimelineItem title="Application received" at={application.created_at} />
            {events.filter(e => e.application_id === application.id).map(event => <TimelineItem key={event.id} title={STAGE_LABELS[event.to_stage] || event.to_stage || event.kind.replaceAll("_", " ")} at={event.created_at} />)}
          </ol>
          </CardContent>
        </Card>
        {offers.filter(o => o.application_id === application.id).map(offer => <Card key={offer.id}>
          <CardHeader>
            <PortalCardTitle>{offer.title}</PortalCardTitle>
            <CardDescription>{offer.contract_type} · {new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(offer.salary_monthly)} gross per month</CardDescription>
            <CardAction><StatusBadge status={offer.status} /></CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
          {offer.valid_until && <p className={QUIET}>Valid until {formatDate(offer.valid_until)}</p>}
          {offer.status === "shared" && <form className="flex max-w-xl flex-col gap-4" onSubmit={e => {
            e.preventDefault(); const fields = new FormData(e.currentTarget); const response = fields.get("response");
            if (response !== "accepted" && response !== "declined") return;
            void action(async () => { await executeCommand({ kind: "respond_offer", offer_id: offer.id, expected_version: offer.version, response, rationale: String(fields.get("rationale") || "Offer response recorded by recipient.").trim() }); }, "Your offer response has been recorded.");
          }}>
            <LabelledField label="Your response">
              {(id) => <NativeSelect id={id} className="w-full" name="response" required defaultValue=""><NativeSelectOption value="" disabled>Choose a response</NativeSelectOption><NativeSelectOption value="accepted">Accept offer</NativeSelectOption><NativeSelectOption value="declined">Decline offer</NativeSelectOption></NativeSelect>}
            </LabelledField>
            <LabelledField label="Message to HR">
              {(id) => <Textarea id={id} name="rationale" maxLength={2000} className="min-h-24 resize-y" />}
            </LabelledField>
            <div><Button type="submit" disabled={busy}>Confirm response</Button></div>
          </form>}
          </CardContent>
        </Card>)}
        <Card>
          <CardHeader>
            <PortalCardTitle>About AI in our process</PortalCardTitle>
            <CardDescription>AI helps prepare profile summaries and interview questions. HR reviews suggestions and makes recruitment decisions. You can request human review below.</CardDescription>
          </CardHeader>
        </Card>
      </>}
      {employments.length > 0 && <Card>
        <CardHeader><PortalCardTitle>Your employment history</PortalCardTitle></CardHeader>
        <CardContent>
          <ul className={LIST}>{employments.map(period => <li className={ROW} key={period.id}><div className="flex min-w-0 flex-col gap-0.5"><h3 className="m-0 text-[15px] font-medium">{period.role}</h3><p className={QUIET}>{period.matricule} · {formatDate(period.start_date)}{period.end_date ? ` to ${formatDate(period.end_date)}` : " onwards"}</p></div><StatusBadge status={period.status} /></li>)}</ul>
        </CardContent>
      </Card>}
      <Card>
        <CardHeader>
          <PortalCardTitle>Your rights</PortalCardTitle>
          <CardDescription>
            Request human re-review of any AI-assisted step, or exercise your
            GDPR rights: access, rectification, erasure, portability, and the
            right to express your point of view (Art. 22(3)). We respond without
            detriment to your application.
          </CardDescription>
        </CardHeader>
        <CardContent>
        <form
          className="@container flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const f = new FormData(form);
            void action(async () => {
              const { error } = await db()
                .from("candidate_requests")
                .insert({
                  email,
                  kind: String(f.get("kind")),
                  message: String(f.get("message")).trim(),
                });
              if (error) throw error;
              form.reset();
            }, "Request sent. Our HR team will review it.");
          }}
        >
          <div className="grid gap-4 @xl:grid-cols-2">
            <LabelledField label="Request type">
              {(id) => <NativeSelect id={id} className="w-full" name="kind" defaultValue="human_review">
                <NativeSelectOption value="human_review">Human re-review of an AI-assisted step</NativeSelectOption>
                <NativeSelectOption value="viewpoint">Express my point of view</NativeSelectOption>
                <NativeSelectOption value="rectification">Rectify my data</NativeSelectOption>
                <NativeSelectOption value="portability">Portability of my data</NativeSelectOption>
                <NativeSelectOption value="erasure">Erase my data</NativeSelectOption>
              </NativeSelect>}
            </LabelledField>
            <LabelledField label="Message">
              {(id) => <Textarea
                id={id}
                name="message"
                maxLength={3000}
                className="min-h-24 resize-y"
                placeholder="Tell us what you'd like reviewed or corrected…"
              />}
            </LabelledField>
          </div>
          <div>
            <Button type="submit" disabled={busy}>
              Send request to HR
            </Button>
          </div>
        </form>
        </CardContent>
      </Card>
    </>
  );
}

/** One step of the application timeline: a dot on a hairline, the stage, its date. */
function TimelineItem({ title, at }: { title: string; at: string }) {
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0 before:absolute before:top-3 before:bottom-0 before:left-[3.5px] before:w-px before:bg-border last:before:hidden">
      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-foreground" aria-hidden="true" />
      <div className="flex flex-col gap-0.5">
        <p className="m-0 text-sm font-medium">{title}</p>
        <p className="m-0 text-xs text-muted-foreground">{formatDate(at)}</p>
      </div>
    </li>
  );
}
