import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  MoreVertical,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { db, errorMessage, type Row } from "@quicksort/hr-db";
import { cn } from "cn";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  NativeSelect,
  NativeSelectOption,
  Stat,
  StatLabel,
  StatSource,
  StatUnit,
  StatValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
} from "@quicksort-sas/ui";
import { EmptyState, PageAlerts, PageHeading } from "../ui";
import {
  money,
  useSales,
  type SalesClient,
  type SalesOpportunity,
} from "./data";
import {
  useAdminReferentials,
  statusesFor,
  statusMeta,
  typeLabel,
  type AdminStatus,
} from "../referentials";
import { ClientPicker } from "./ClientPicker";
import { DocumentsPanel } from "../documents/DocumentsPanel";
import { documentFlag, formatDay, loadAlerts } from "../documents/client";
import {
  ProjectExtensionsSection,
  isActiveExtension,
  type ProjectExtension,
} from "./ProjectExtensions";
import {
  lineDays,
  linesAmount,
  linesDays,

  openDaysBetween,
  storedPricingLines,
  type PricingLine,
} from "./pricing-lines";
import {
  cappedLineDays,
  craMonthYear,
  extensionValue,
  linesCappedAmount,
  proratedBillableDays,
} from "./billable-cap";
import { DateField } from "../DateField";
import "./sales.css"; // ClientPicker still uses it
import { executeCommand, loadWorkspace, type Assignment } from "../hr/data";
import {
  isOpenAssignment,
  isStaffedAssignment,
  lineStaffing,
  LineStaffingPanel,
  ProjectTeamCard,
  type LineStaffing,
  type StaffingPerson,
} from "./ProjectStaffing";
import { ProjectInvoices } from "./invoicing/ProjectInvoices";
import { placeContractFolder } from "./contract-folder";

/**
 * Projects (sales.md §14 Phase 2) — the delivery continuation of won deals.
 * Each project keeps the pricing model of its origin opportunity (régie
 * TJM × days / forfait fixed price) and its lifecycle statuses come from the
 * configurable referentials edited under Administration → Global settings,
 * BoondManager-style. Régie contracts carry named pricing lines
 * ("Lead dev", "Data engineer"…), each with its own rate and end date —
 * the line window runs from the contract start to that date and the
 * contract value is the sum of rate × capped open days across the lines
 * (annual billable cap per line), extensions valued the same way.
 */
type Project = Row<"sales_projects">;

/** One named daily rate on a régie contract (sales_projects.tjm_profiles). */
export type TjmProfile = PricingLine;

/** Defensive parse of the JSONB column — see pricing-lines.ts. */
export const storedTjmProfiles = storedPricingLines;

type TjmProfileDraft = {
  name: string;
  tjm: string;
  end_date: string;
  /** Full-year billable-days allowance for this line — "" when exempt. */
  cap: string;
  /** The line's name as saved — assignments are keyed by it, so a rename
      moves them along on save. Undefined for a line added in this draft. */
  savedName?: string;
};

/** Semantic list tabs (source design "Projects — redesign.html"). */
type ProjectsTab = "all" | "attention" | "ending" | "archived";

/** One row of the projects list — every display value precomputed from the
    raw project, its signed extensions, team assignments and CRA days. */
type ProjectRow = {
  project: Project;
  meta: AdminStatus;
  client?: SalesClient;
  /** Billing intermediary when set — invoices go to it, not the client. */
  intermediary?: SalesClient;
  team: string[];
  who: string;
  initials: string;
  isRegie: boolean;
  /** "Forfait", the blended €/j, or a short label for the meta line. */
  rateLabel: string;
  /** Distinct TJM profiles (project + signed extensions) — one chip per
      named rate, shown on the list row when a contract has several. */
  rateChips: { name: string; tjm: number }[];
  metaLine: string;
  effEnd: string | null;
  extended: boolean;
  total: number;
  budgetDays: number;
  consumedDays: number;
  usedPct: number;
  billed: number;
  /** Per pricing line: the current-year prorated billable-days allowance
      and the CRA days attributed to that line this year. Only lines
      carrying a cap appear — exempt lines are absent. */
  lineCaps: { name: string; cap: number; consumed: number }[];
  timePct: number | null;
  daysLeft: number | null;
  /** Non-empty when the row needs attention (drives the inverted pill,
      the flag strip, the tab filter and the inverted stat card). */
  flag: string | null;
};

/** Page state from the address bar: /sales/projects/<id> → edit that
    project, /sales/projects/new → create form, otherwise the projects
    list. Unknown ids fall back to the list. */
function sheetFromUrl(list: Project[]): Project | null | undefined {
  const path = window.location.pathname.replace(/\/+$/, "");
  if (path === "/sales/projects/new") return null;
  if (!path.startsWith("/sales/projects/")) return undefined;
  const id = decodeURIComponent(path.slice("/sales/projects/".length));
  return list.find((p) => p.id === id) ?? undefined;
}

/** Legacy query-param deep links (?project=<id>, ?new=1) still arrive from
    old bookmarks — returns the path form to redirect to, if any. */
function legacyProjectRedirect(): string | null {
  const params = new URLSearchParams(window.location.search);
  const legacyId = params.get("project");
  if (params.get("new") !== "1" && !legacyId) return null;
  const url = new URL(window.location.href);
  url.pathname =
    params.get("new") === "1"
      ? "/sales/projects/new"
      : `/sales/projects/${encodeURIComponent(legacyId!)}`;
  url.searchParams.delete("project");
  url.searchParams.delete("new");
  return url.pathname + url.search + url.hash;
}

/** Open working days between ISO dates lives in pricing-lines.ts. */

/** Compact date for the timeline column — day + short month. */
const shortDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });

/** Day count for display: whole days plain, half days with one decimal. */
const fmtDays = (n: number) =>
  Number.isInteger(n) ? String(n) : n.toFixed(1);

/** Longer date for the header meta and stat subtitles — day + month + year. */
const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

/** Distinct TJM profiles (same name + rate deduped, zero rates dropped),
    keeping contract order — feeds the per-rate chips on the list row. */
function distinctRates(lines: PricingLine[]): { name: string; tjm: number }[] {
  const seen = new Set<string>();
  const out: { name: string; tjm: number }[] = [];
  for (const l of lines) {
    if (!(l.tjm > 0)) continue;
    const key = `${l.name}\u0000${l.tjm}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: l.name, tjm: l.tjm });
  }
  return out;
}

/** Elapsed percentage + days left between the project start and end. */
function timelineProgress(p: Project) {
  if (!p.start_date || !p.end_date) return null;
  const start = new Date(`${p.start_date}T00:00:00`).getTime();
  const end = new Date(`${p.end_date}T00:00:00`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
  const now = Date.now();
  return {
    pct: Math.round(
      Math.max(0, Math.min(1, (now - start) / (end - start))) * 100,
    ),
    left: Math.ceil((end - now) / 86400000),
  };
}

export function Projects({ actorEmail }: { actorEmail: string }) {
  const { data, loading, busy, error, message, load, action } =
    useSales(actorEmail);
  const ref = useAdminReferentials();
  const [projects, setProjects] = useState<Project[]>([]);
  const [assignments, setAssignments] = useState<
    {
      project_id: string;
      employee_id: string;
      /** Named TJM profile the person is staffed on, when set. */
      pricing_line?: string;
    }[]
  >([]);
  const [employees, setEmployees] = useState<
    {
      id: string;
      full_name: string;
      start_date: string;
      status: string;
    }[]
  >([]);
  /** People with no open employment — the assign panel can engage them
      directly onto a line (HR operators only). */
  const [talentPool, setTalentPool] = useState<
    { personId: string; name: string }[]
  >([]);
  const [canEngage, setCanEngage] = useState(false);
  /** Every open assignment across all projects — feeds the staffing
      blocks and the team card on the project (contract) page. */
  const [staffingAssignments, setStaffingAssignments] = useState<
    Assignment[]
  >([]);
  const [extensions, setExtensions] = useState<ProjectExtension[]>([]);
  /** Days consumed per project, summed from employee CRA entries (status
      'client_project'). The map is best-effort: a missing cra_entries
      migration or a permission error leaves it empty rather than breaking
      the projects screen. */
  const [craDaysByProject, setCraDaysByProject] = useState<Map<string, number>>(
    new Map(),
  );
  /** Client-project CRA days per project and pricing line for the current
      calendar year — the consumption compared against each line's
      billable cap. */
  const [craLineYearDaysByProject, setCraLineYearDaysByProject] = useState<
    Map<string, Map<string, number>>
  >(new Map());
  const [loadError, setLoadError] = useState("");
  const [reloadTick, setReloadTick] = useState(0);
  /** Contract warnings per project (document_alerts): expired, missing, expiring. */
  const [documentFlags, setDocumentFlags] = useState<Map<string, string>>(new Map());
  // Finalized + paid invoices HT per project — feeds the Billed stat card.
  const [billedByProject, setBilledByProject] = useState<Map<string, number>>(new Map());
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<ProjectsTab>("all");
  // Project awaiting the delete confirmation (replaces window.confirm).
  const [deleting, setDeleting] = useState<Project | null>(null);
  // The create/edit form is a page, addressed by the URL: /sales/projects/<id>
  // edits, /sales/projects/new creates. `undefined` = the projects list itself.
  const [editing, setEditing] = useState<Project | null | undefined>(undefined);
  // Finalized + paid invoices HT for the edited project, reported by its
  // invoices card — feeds the Billed stat. Keyed so a stale project's
  // figure never shows on another.
  const [invoicedHt, setInvoicedHt] = useState<{
    projectId: string;
    amount: number;
  } | null>(null);
  const projectsRef = useRef<Project[]>([]);
  const location = useLocation();
  const navigate = useNavigate();

  // Old ?project=/?new= bookmarks redirect to the path form on arrival.
  useEffect(() => {
    const target = legacyProjectRedirect();
    if (target) navigate(target, { replace: true });
  }, []);

  useEffect(() => {
    document.title =
      editing === null
        ? "New project · Quicksort Admin"
        : editing
          ? `${editing.title} · Quicksort Admin`
          : "Projects · Quicksort Admin";
  }, [editing]);

  // The open page follows the URL: back/forward, header tabs and links
  // from other pages (e.g. an HR assignment) all land here.
  // Keeps the open object when it is the same project, so local patches
  // (onProjectPatched) survive a same-page navigation.
  useEffect(() => {
    const next = sheetFromUrl(projectsRef.current);
    setEditing((prev) => (next && prev && prev.id === next.id ? prev : next));
  }, [location.pathname]);

  /** The annual cap and its consumption are always evaluated against the
      current calendar year. */
  const currentYear = new Date().getFullYear();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await db()
          .from("sales_projects")
          .select("*")
          .order("updated_at", { ascending: false });
        if (r.error) throw r.error;
        const ext = await db().from("sales_project_extensions").select("*");
        if (ext.error) throw ext.error;
        // Loaded before the CRA pass: line attribution needs every
        // assignment's pricing line and window.
        const staffing = await loadWorkspace();
        // CRA consumption: a full 'client_project' entry = one day billed
        // to that project, a half-day entry (am/pm) = half a day. HR
        // operators read every employee's CRA through the cra_access
        // policy, so a single grouped count feeds the progress bars on
        // every project row.
        // PostgREST caps a response at 1000 rows, so page through until a
        // short page arrives — summing a single capped response silently
        // drops consumption days once client_project rows exceed the cap.
        // Databases without the half-day migration reject the part column —
        // fall back to counting every entry as a full day instead of losing
        // consumption entirely.
        const PAGE = 1000;
        let craSelect = "project_id, part, month, employee_id, day";
        let halfDays = true;
        const craRows: {
          project_id: string | null;
          month: string;
          employee_id: string;
          day: string;
          part?: string;
        }[] = [];
        let craFailed = false;
        for (let offset = 0; ; offset += PAGE) {
          const page = await db()
            .from("cra_entries")
            .select(craSelect)
            .eq("status", "client_project")
            .range(offset, offset + PAGE - 1);
          if (page.error) {
            if (offset === 0 && halfDays) {
              halfDays = false;
              craSelect = "project_id, month, employee_id, day";
              offset = -PAGE;
              continue;
            }
            craFailed = true;
            break;
          }
          craRows.push(...((page.data || []) as unknown as typeof craRows));
          if ((page.data?.length ?? 0) < PAGE) break;
        }
        const craDays = new Map<string, number>();
        // The annual billable cap is per pricing line and prorated per
        // calendar year, so consumption is split the same way: a CRA day
        // attributes to the pricing line of the employee's assignment
        // covering that day (same window/status rules as the CRA screen).
        const craLineYearDays = new Map<string, Map<string, number>>();
        if (!craFailed) {
          // Assignments able to carry a CRA day onto a priced line — one
          // assignment per employee/project pair, like assignedProjects().
          const pricedByEmployee = new Map<
            string,
            {
              project_id: string;
              start_date: string;
              end_date: string | null;
              pricing_line: string;
            }[]
          >();
          for (const a of staffing.assignments) {
            if (
              !["confirmed", "active", "completed"].includes(a.status) ||
              !a.pricing_line
            )
              continue;
            const list = pricedByEmployee.get(a.employee_id) || [];
            list.push({
              project_id: a.project_id,
              start_date: a.start_date,
              end_date: a.end_date,
              pricing_line: a.pricing_line,
            });
            pricedByEmployee.set(a.employee_id, list);
          }
          for (const row of craRows) {
            if (!row.project_id) continue;
            const days =
              row.part === "am" || row.part === "pm" ? 0.5 : 1;
            // All-time consumption on the project; the cap check below only
            // tallies the current calendar year.
            craDays.set(row.project_id, (craDays.get(row.project_id) || 0) + days);
            // Only the current calendar year feeds the cap check.
            if (craMonthYear(row.month) !== currentYear) continue;
            const line = pricedByEmployee
              .get(row.employee_id)
              ?.find(
                (a) =>
                  a.project_id === row.project_id &&
                  a.start_date <= row.day &&
                  (!a.end_date || a.end_date >= row.day),
              )?.pricing_line;
            if (!line) continue;
            const byLine = craLineYearDays.get(row.project_id) || new Map<string, number>();
            byLine.set(line, (byLine.get(line) || 0) + days);
            craLineYearDays.set(row.project_id, byLine);
          }
        }
        const today = new Date().toISOString().slice(0, 10);
        if (!cancelled) {
          const list = r.data || [];
          setProjects(list);
          projectsRef.current = list;
          setExtensions(ext.data || []);
          setAssignments(
            staffing.assignments.filter(
              (a) =>
                ["reserved", "confirmed", "active"].includes(a.status) &&
                a.start_date <= today &&
                (!a.end_date || a.end_date >= today),
            ),
          );
          setEmployees(
            staffing.employees.map((e) => ({
              id: e.id,
              full_name:
                staffing.people.find((p) => p.id === e.person_id)?.full_name ||
                "Person",
              start_date: e.start_date,
              status: e.status,
            })),
          );
          setTalentPool(
            staffing.people
              .filter(
                (p) =>
                  !staffing.employees.some(
                    (e) => e.person_id === p.id && e.status !== "ended",
                  ),
              )
              .map((p) => ({ personId: p.id, name: p.full_name })),
          );
          setCanEngage(staffing.capabilities.recruit);
          setStaffingAssignments(
            staffing.assignments.filter((a) => isStaffedAssignment(a)),
          );
          setCraDaysByProject(craDays);
          setCraLineYearDaysByProject(craLineYearDays);
          setLoadError("");
          // The URL is the source of truth: (re)open the create/edit page
          // after every reload so deep links and redirects land on it.
          setEditing(sheetFromUrl(list));
        }
      } catch (e) {
        if (!cancelled) setLoadError(errorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // reloadTick lets child sections (extensions) ask for a project refresh.
  }, [data, reloadTick]); // re-fetch after every sales action() reload

  useEffect(() => {
    let cancelled = false;
    // Optional: before the documents migration the list simply has no contract flags.
    loadAlerts({ kind: "project" }).then(
      (alerts) => {
        if (cancelled) return;
        const byProject = new Map<string, typeof alerts>();
        for (const alert of alerts)
          if (alert.project_id) byProject.set(alert.project_id, [...(byProject.get(alert.project_id) || []), alert]);
        setDocumentFlags(new Map([...byProject].map(([id, list]) => [id, documentFlag(list)])));
      },
      () => !cancelled && setDocumentFlags(new Map()),
    );
    return () => {
      cancelled = true;
    };
  }, [data, reloadTick]);

  useEffect(() => {
    let cancelled = false;
    // Optional: before the invoicing migration the Billed stat stays at zero.
    // Summed in cents, paged past PostgREST's 1000-row cap like the CRA pass.
    // invoices is not in the generated Database types yet; read it untyped.
    const untyped = db() as unknown as SupabaseClient;
    (async () => {
      const PAGE = 1000;
      const cents = new Map<string, number>();
      for (let offset = 0; ; offset += PAGE) {
        const page = await untyped
          .from("invoices")
          .select("project_id, total_ht")
          .in("status", ["finalized", "paid"])
          .not("project_id", "is", null)
          .range(offset, offset + PAGE - 1);
        if (page.error) throw page.error;
        for (const i of (page.data || []) as { project_id: string; total_ht: number | string }[])
          cents.set(
            i.project_id,
            (cents.get(i.project_id) || 0) + Math.round(Number(i.total_ht) * 100),
          );
        if ((page.data?.length ?? 0) < PAGE) break;
      }
      if (!cancelled)
        setBilledByProject(new Map([...cents].map(([id, c]) => [id, c / 100])));
    })().catch(() => !cancelled && setBilledByProject(new Map()));
    return () => {
      cancelled = true;
    };
  }, [data, reloadTick]);

  const projectStatuses = statusesFor(ref.statuses, "project", {
    includeHidden: false,
  });
  const terminalStatus =
    projectStatuses.find((s) => s.is_terminal) ||
    projectStatuses[projectStatuses.length - 1];
  const defaultStatus =
    projectStatuses.find((s) => s.is_default) || projectStatuses[0];

  const clientsById = useMemo(
    () => new Map<string, SalesClient>(data.clients.map((c) => [c.id, c])),
    [data.clients],
  );
  const teamByProject = useMemo(() => {
    const employeesById = new Map(employees.map((e) => [e.id, e.full_name]));
    const map = new Map<string, string[]>();
    for (const a of assignments) {
      const name = employeesById.get(a.employee_id);
      if (!name) continue;
      // Staffing targets a named TJM profile when set — show the line so a
      // person staffed on two profiles appears once per line.
      const label = a.pricing_line ? `${name} (${a.pricing_line})` : name;
      map.set(a.project_id, [...(map.get(a.project_id) || []), label]);
    }
    for (const [id, names] of map)
      map.set(
        id,
        [...new Set(names)].sort((a, b) => a.localeCompare(b)),
      );
    return map;
  }, [assignments, employees]);
  const opportunitiesById = useMemo(
    () =>
      new Map<string, SalesOpportunity>(
        data.opportunities.map((o) => [o.id, o]),
      ),
    [data.opportunities],
  );
  /** Signed extensions per project — they extend the timeline and value. */
  const signedExtensionsByProject = useMemo(() => {
    const map = new Map<string, ProjectExtension[]>();
    for (const e of extensions.filter(isActiveExtension)) {
      map.set(e.project_id, [...(map.get(e.project_id) || []), e]);
    }
    return map;
  }, [extensions]);
  /** Staffed assignments per employee, every project — availability readout
      and the capacity pre-check on the contract page's assign panel. */
  const assignmentsByEmployee = useMemo(() => {
    const map = new Map<string, Assignment[]>();
    for (const a of staffingAssignments)
      map.set(a.employee_id, [...(map.get(a.employee_id) || []), a]);
    return map;
  }, [staffingAssignments]);
  /** Staffing overview of the project being edited: total billable line
      days across the contract and its signed extensions, and how many of
      them have someone assigned (allocation-weighted, per line). */
  const editingStaffing = useMemo(() => {
    if (!editing) return null;
    const assigns = staffingAssignments.filter(
      (a) => a.project_id === editing.id,
    );
    const parts = [
      {
        lines: storedTjmProfiles(editing.tjm_profiles),
        start: editing.start_date,
        end: editing.end_date,
      },
      ...(signedExtensionsByProject.get(editing.id) || []).map((ext) => ({
        lines: storedTjmProfiles(ext.tjm_profiles),
        start: ext.start_date,
        end: ext.end_date,
      })),
    ];
    let days = 0;
    let staffedDays = 0;
    for (const part of parts)
      for (const s of lineStaffing(part.lines, part.start, part.end, assigns)) {
        days += s.days;
        staffedDays += Math.min(s.staffedDays, s.days);
      }
    return {
      assignments: assigns,
      days,
      staffedDays,
      pct: days > 0 ? Math.round((staffedDays / days) * 100) : 0,
    };
  }, [editing, staffingAssignments, signedExtensionsByProject]);
  /** Won deals that don't have a project yet — convertible. */
  const convertible = data.opportunities.filter(
    (o) =>
      o.stage === "won" && !projects.some((p) => p.opportunity_id === o.id),
  );

  /** Precomputed list rows — one pass over projects feeds the table, the
      stat cards and every tab count. */
  const rows = useMemo<ProjectRow[]>(() => {
    return projects.map((p) => {
      const meta = statusMeta(ref.statuses, "project", p.status);
      const client = clientsById.get(p.client_id);
      const intermediary = p.intermediary_client_id
        ? clientsById.get(p.intermediary_client_id)
        : undefined;
      const team = teamByProject.get(p.id) || [];
      const isRegie = p.pricing_model === "regie";
      // Signed extensions push the end date out and add value.
      const signedExts = signedExtensionsByProject.get(p.id) || [];
      let effEnd = p.end_date;
      for (const ext of signedExts) {
        if (ext.end_date && (!effEnd || ext.end_date > effEnd))
          effEnd = ext.end_date;
      }
      // Contract value comes from the pricing lines only: each line bills
      // its own rate over the open days of its window (window start → line
      // end date), shrunk by its per-year billable cap. The stored amount
      // columns (mean rate × days) are not used for régie.
      const extTotal = signedExts.reduce(
        (sum, ext) => sum + extensionValue(ext),
        0,
      );
      const total =
        (isRegie
          ? linesCappedAmount(
              storedTjmProfiles(p.tjm_profiles),
              p.start_date,
              p.end_date,
            )
          : Number(p.amount)) + extTotal;
      // Consumption comes from the CRA: signed régie extensions grow the
      // day budget alongside the value.
      const consumedDays = craDaysByProject.get(p.id) || 0;
      const budgetDays = isRegie
        ? Number(p.estimated_days ?? 0) +
          signedExts.reduce(
            (sum, ext) =>
              ext.pricing_model === "regie" && ext.estimated_days != null
                ? sum + Number(ext.estimated_days)
                : sum,
            0,
          )
        : 0;
      const usedPct =
        budgetDays > 0 ? Math.round((consumedDays / budgetDays) * 100) : 0;
      // Blended rate (amount ÷ budget) turns consumed days into an
      // approximate consumed value — all we can do across TJM profiles.
      const billed =
        budgetDays > 0 ? Math.round((consumedDays / budgetDays) * total) : 0;
      const progress = timelineProgress({ ...p, end_date: effEnd });
      // Per-line annual billable caps: every contract or signed-extension
      // line carrying a cap contributes its allowance prorated over the
      // line's own window for the current calendar year (a mid-year start
      // or end shrinks it). Caps and CRA consumption group by line name,
      // so a renewal line continues the same profile's tally.
      const capsByLine = new Map<string, { cap: number; consumed: number }>();
      const addCap = (line: PricingLine, start: string | null, windowEnd: string | null) => {
        if (line.max_billable_days_per_year == null) return;
        // The line window runs from the contract/extension start to the
        // line end, capped by the overall window end — like lineDays().
        const end =
          windowEnd && line.end_date && line.end_date > windowEnd
            ? windowEnd
            : (line.end_date ?? null);
        const entry = capsByLine.get(line.name) || { cap: 0, consumed: 0 };
        entry.cap += proratedBillableDays(
          Number(line.max_billable_days_per_year),
          start,
          end,
          currentYear,
        );
        capsByLine.set(line.name, entry);
      };
      for (const line of storedTjmProfiles(p.tjm_profiles))
        addCap(line, p.start_date, p.end_date);
      for (const ext of signedExts)
        for (const line of storedTjmProfiles(ext.tjm_profiles))
          addCap(line, ext.start_date, ext.end_date);
      const lineYearDays = craLineYearDaysByProject.get(p.id);
      const lineCaps = [...capsByLine.entries()]
        .map(([name, v]) => ({
          name,
          cap: v.cap,
          consumed: lineYearDays?.get(name) || 0,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      // Needs attention: budget exceeded, then per-line cap exceeded.
      let flag: string | null = null;
      if (budgetDays > 0 && consumedDays > budgetDays)
        flag = `Budget exceeded by ${fmtDays(consumedDays - budgetDays)} days (${usedPct}% of ${fmtDays(budgetDays)} days)`;
      if (!flag) {
        const over = lineCaps.filter((c) => c.consumed > c.cap);
        if (over.length)
          flag = over
            .map(
              (c) =>
                `${c.name ? `${c.name} ` : ""}cap exceeded for ${currentYear}: ${fmtDays(c.consumed)} of ${fmtDays(c.cap)} days used`,
            )
            .join(" · ");
      }
      if (!flag) flag = documentFlags.get(p.id) ?? null;
      const rateChips = isRegie
        ? distinctRates([
            ...storedTjmProfiles(p.tjm_profiles),
            ...signedExts.flatMap((ext) =>
              storedTjmProfiles(ext.tjm_profiles),
            ),
          ])
        : [];
      const rateLabel = !isRegie
        ? "Forfait"
        : rateChips.length === 1
          ? rateChips[0].name
            ? `${rateChips[0].name} · ${money(rateChips[0].tjm, p.currency)}/j`
            : `${money(rateChips[0].tjm, p.currency)}/j`
          : rateChips.length > 1
            ? "" // several profiles — the chips under the row carry the rates
            : `${money(Number(p.tjm ?? 0), p.currency)}/j`;
      return {
        project: p,
        meta,
        client,
        intermediary,
        team,
        who: team.length
          ? team.length > 1
            ? `${team[0]} +${team.length - 1}`
            : team[0]
          : "Unassigned",
        initials: team.length
          ? team[0]
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((n) => n[0]?.toUpperCase() ?? "")
              .join("")
          : "—",
        isRegie,
        rateLabel,
        rateChips,
        metaLine: [
          client?.name,
          intermediary ? `billed to ${intermediary.name}` : "",
          p.type ? typeLabel(ref.types, p.type) : "",
          rateLabel,
        ]
          .filter(Boolean)
          .join(" · "),
        effEnd,
        extended: !!effEnd && effEnd !== p.end_date,
        total,
        budgetDays,
        consumedDays,
        usedPct,
        billed,
        lineCaps,
        timePct: progress?.pct ?? null,
        daysLeft: progress?.left ?? null,
        flag,
      };
    });
  }, [
    projects,
    ref.statuses,
    ref.types,
    clientsById,
    teamByProject,
    signedExtensionsByProject,
    craDaysByProject,
    craLineYearDaysByProject,
    documentFlags,
  ]);

  const activeRows = rows.filter((r) => !r.meta.is_terminal);
  const activeCount = activeRows.length;
  const activeTotal = activeRows.reduce(
    (sum, r) => sum + Number(r.project.amount),
    0,
  );
  const staffedCount = activeRows.filter((r) => r.team.length > 0).length;
  const trackedRows = activeRows.filter((r) => r.budgetDays > 0);
  const consumedTotal = activeRows.reduce((sum, r) => sum + r.billed, 0);
  // Billed vs contract value (signed extensions included) on active projects.
  const invoicedTotal = activeRows.reduce(
    (sum, r) => sum + (billedByProject.get(r.project.id) || 0),
    0,
  );
  const contractTotal = activeRows.reduce((sum, r) => sum + r.total, 0);
  const attentionRows = rows.filter((r) => r.flag);
  const endingSoon = activeRows.filter((r) => {
    if (!r.effEnd) return false;
    const days = Math.ceil(
      (new Date(r.effEnd).getTime() - Date.now()) / 86400000,
    );
    return days >= 0 && days <= 30;
  }).length;
  const archivedCount = rows.length - activeCount;
  // Breakdown for the inverted "Needs attention" card subtitle.
  const overBudgetCount = rows.filter(
    (r) => r.budgetDays > 0 && r.consumedDays > r.budgetDays,
  ).length;
  const overCapCount = rows.filter((r) =>
    r.lineCaps.some((c) => c.consumed > c.cap),
  ).length;
  const attentionSub = [
    overBudgetCount ? `${overBudgetCount} over budget` : "",
    overCapCount ? `${overCapCount} over annual cap` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const query = search.toLowerCase();
  const visible = rows.filter((r) => {
    if (tab === "attention" && !r.flag) return false;
    if (tab === "ending") {
      if (!r.effEnd) return false;
      const days = Math.ceil(
        (new Date(r.effEnd).getTime() - Date.now()) / 86400000,
      );
      if (days < 0 || days > 30) return false;
    }
    if (tab === "archived" && !r.meta.is_terminal) return false;
    if (tab === "all" && r.meta.is_terminal) return false;
    if (!query) return true;
    const p = r.project;
    return (
      p.title.toLowerCase().includes(query) ||
      (r.client?.name.toLowerCase().includes(query) ?? false) ||
      (r.intermediary?.name.toLowerCase().includes(query) ?? false) ||
      typeLabel(ref.types, p.type).toLowerCase().includes(query) ||
      p.owner_email.toLowerCase().includes(query) ||
      r.team.join(" ").toLowerCase().includes(query)
    );
  });

  // Escape leaves the create/edit page, like every other sheet.
  useEffect(() => {
    if (editing === undefined) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeProjectDialog();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing]);

  // Opening a project page pushes a history entry so the browser back
  // button returns to the list; /sales/projects/new addresses the create form.
  function openProjectPage(project: Project | null) {
    const url = new URL(window.location.href);
    url.pathname = project
      ? `/sales/projects/${encodeURIComponent(project.id)}`
      : "/sales/projects/new";
    navigate(url.pathname + url.search + url.hash);
    setEditing(project);
  }

  // Closing the page drops the project id segment so refreshes land back
  // on the list.
  function closeProjectDialog() {
    setEditing(undefined);
    const url = new URL(window.location.href);
    if (url.pathname.replace(/\/+$/, "") !== "/sales/projects") {
      url.pathname = "/sales/projects";
      navigate(url.pathname + url.search + url.hash, { replace: true });
    }
  }

  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const pricing_model = String(f.get("pricing_model"));
    const opportunityId = String(f.get("opportunity_id") || "");
    // Named régie lines are serialized into a hidden field by the form;
    // the flat tjm/estimated_days columns stay in sync below as the blended
    // rate / total days so the table, extensions and dashboards keep working.
    const windowStart = String(f.get("start_date") || "");
    const windowEnd = String(f.get("end_date") || "");
    const profiles =
      pricing_model === "regie"
        ? storedTjmProfiles(JSON.parse(String(f.get("tjm_profiles") || "[]")))
        : [];
    // Saved lines renamed in this edit — their open assignments follow.
    const renames: { from: string; to: string }[] =
      editing && pricing_model === "regie"
        ? JSON.parse(String(f.get("tjm_renames") || "[]"))
        : [];
    const daysSum = linesDays(profiles, windowStart, windowEnd);
    const regieRate = linesAmount(profiles, windowStart, windowEnd);
    // Stored amount: per-line rate × capped days — the contract value.
    const regieAmount = linesCappedAmount(profiles, windowStart, windowEnd);
    const fixedPrice =
      pricing_model === "forfait" ? Number(f.get("fixed_price") ?? 0) : null;
    const values = {
      title: String(f.get("title")).trim(),
      client_id: String(f.get("client_id")),
      // Optional intermediary: when set, invoices go to the intermediary
      // instead of the main client. Empty picker → NULL → bill the client.
      intermediary_client_id:
        String(f.get("intermediary_client_id") || "") || null,
      // The convert picker only exists on create — never unlink on edit.
      opportunity_id: editing ? editing.opportunity_id : opportunityId || null,
      pricing_model,
      currency: String(f.get("currency") || "EUR"),
      tjm_profiles: profiles,
      tjm:
        pricing_model === "regie"
          ? daysSum > 0
            ? Math.round((regieRate / daysSum) * 100) / 100
            : 0
          : null,
      estimated_days: pricing_model === "regie" ? daysSum : null,
      fixed_price: fixedPrice,
      amount: pricing_model === "regie" ? regieAmount : Number(fixedPrice ?? 0),
      status: String(f.get("status") || defaultStatus?.key || ""),
      start_date: String(f.get("start_date") || "") || null,
      end_date: String(f.get("end_date") || "") || null,
      owner_email: String(f.get("owner_email")).trim() || actorEmail,
      notes: String(f.get("notes")).trim(),
      updated_at: new Date().toISOString(),
    };
    void action(async () => {
      const result = editing
        ? await db()
            .from("sales_projects")
            .update(values)
            .eq("id", editing.id)
            .select("id")
            .single()
        : await db()
            .from("sales_projects")
            .insert(values)
            .select("id")
            .single();
      if (result.error) throw result.error;
      if (editing && isTerminalStatus(values.status) !== isTerminalStatus(editing.status))
        await syncContractFolder(editing.id, isTerminalStatus(values.status));
      // Assignments reference their line by name: move the open ones onto
      // the renamed line (after the save, so the new name exists).
      for (const { from, to } of renames)
        for (const a of staffingAssignments.filter(
          (a) =>
            a.project_id === editing?.id &&
            a.pricing_line === from &&
            isOpenAssignment(a),
        ))
          await executeCommand({
            kind: "update_assignment",
            assignment_id: a.id,
            expected_version: a.version,
            position: a.position === from ? to : a.position,
            pricing_line: to,
            allocation_pct: a.allocation_pct,
            start_date: a.start_date,
            end_date: a.end_date,
            status: a.status,
            rationale: `Pricing line renamed to "${to}" on the contract page.`,
          });
    }, "Project saved.");
    closeProjectDialog();
  }

  const isTerminalStatus = (key: string | null | undefined) =>
    !!projectStatuses.find((s) => s.key === key)?.is_terminal;

  /** Archiving files the Drive folder under archived/<year>; restoring brings it back. */
  async function syncContractFolder(projectId: string, archived: boolean) {
    try {
      await placeContractFolder(projectId, archived);
    } catch (e) {
      void load();
      throw new Error(
        `Project ${archived ? "archived" : "restored"}, but its Drive folder could not be moved: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  function setStatus(p: Project, status: string, success: string) {
    void action(async () => {
      const result = await db()
        .from("sales_projects")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", p.id)
        .select("id")
        .single();
      if (result.error) throw result.error;
      if (isTerminalStatus(status) !== isTerminalStatus(p.status))
        await syncContractFolder(p.id, isTerminalStatus(status));
    }, success);
  }

  return (
    <div className="@container flex flex-col gap-6">
      <PageAlerts error={error || loadError} message={message} />
      {ref.missing && (
        <PageAlerts error="The admin_settings migration is missing. Apply supabase/migrations/20261007090000_sales_projects_admin_settings.sql; until then, built-in defaults are used." />
      )}
      <AlertDialog open={!!deleting} onOpenChange={(open) => { if (!open) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project "{deleting?.title}"?</AlertDialogTitle>
            <AlertDialogDescription>The project is removed for good. This can't be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={() => {
                const p = deleting;
                setDeleting(null);
                if (!p) return;
                void action(async () => {
                  const r = await db()
                    .from("sales_projects")
                    .delete()
                    .eq("id", p.id)
                    .select("id")
                    .single();
                  if (r.error) throw r.error;
                }, "Project deleted.");
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {editing !== undefined && (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col items-start gap-3">
            <Button variant="ghost" size="sm" className="-ml-2" onClick={closeProjectDialog}>
              <ArrowLeft data-icon="inline-start" />
              Projects
            </Button>
            <header className="flex w-full flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 flex-col gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                  <h1 className="m-0 text-3xl font-medium tracking-tight" id="pj-title">
                    {editing ? "Edit project" : "Create a project"}
                  </h1>
                  {editing && (
                    <Badge variant="outline" className="h-6 max-w-80 truncate px-2 text-xs normal-case tracking-normal">
                      <span className="truncate">{editing.title}</span>
                    </Badge>
                  )}
                </div>
                {editing && (
                  <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                    {(() => {
                      const meta = statusMeta(
                        ref.statuses,
                        "project",
                        editing.status,
                      );
                      const client = clientsById.get(editing.client_id);
                      const intermediary = editing.intermediary_client_id
                        ? clientsById.get(editing.intermediary_client_id)
                        : undefined;
                      const signed =
                        signedExtensionsByProject.get(editing.id) || [];
                      let effEnd = editing.end_date;
                      for (const ext of signed) {
                        if (ext.end_date && (!effEnd || ext.end_date > effEnd))
                          effEnd = ext.end_date;
                      }
                      const items: ReactElement[] = [
                        <span className="inline-flex items-center gap-1.5 text-foreground" key="status">
                          <span
                            className="size-2 shrink-0 rounded-full"
                            style={{ background: meta.color }}
                            aria-hidden="true"
                          />
                          {meta.label}
                        </span>,
                      ];
                      if (client)
                        items.push(<span key="client">{client.name}</span>);
                      if (intermediary)
                        items.push(
                          <span key="intermediary">
                            {`Billed to ${intermediary.name} (intermediary)`}
                          </span>,
                        );
                      items.push(
                        <span key="pricing">
                          {editing.pricing_model === "regie"
                            ? "Régie"
                            : "Forfait"}
                          {` · ${editing.currency}`}
                        </span>,
                      );
                      if (editing.start_date && effEnd)
                        items.push(
                          <span className="num text-[13px]" key="range">
                            {`${shortDate(editing.start_date)} → ${longDate(effEnd)}`}
                          </span>,
                        );
                      return items.flatMap((item, i) =>
                        i === 0
                          ? [item]
                          : [<span key={`sep-${i}`} aria-hidden="true" className="text-faint">·</span>, item],
                      );
                    })()}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2 max-sm:w-full max-sm:*:flex-1">
                <Button type="button" variant="outline" onClick={closeProjectDialog}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  form="pj-form"
                  variant="pivot"
                  data-save-shortcut
                  disabled={busy}
                >
                  {editing ? "Save changes" : "Create project"}
                </Button>
              </div>
            </header>
          </div>
          {editing && (
            <ProjectStatsStrip
              project={editing}
              signedExts={signedExtensionsByProject.get(editing.id) || []}
              craDays={craDaysByProject.get(editing.id) || 0}
              staffed={editingStaffing}
              billedHt={
                invoicedHt?.projectId === editing.id ? invoicedHt.amount : null
              }
            />
          )}
          <ProjectForm
            key={editing?.id || "new"}
            editing={editing}
            clients={data.clients}
            convertible={convertible}
            opportunitiesById={opportunitiesById}
            statuses={projectStatuses}
            defaultStatusKey={defaultStatus?.key}
            busy={busy}
            actorEmail={actorEmail}
            currentYear={currentYear}
            craDaysByProject={craDaysByProject}
            craLineYearDaysByProject={craLineYearDaysByProject}
            signedExtensions={
              editing ? signedExtensionsByProject.get(editing.id) || [] : []
            }
            onCancel={closeProjectDialog}
            onSubmit={save}
            onDocumentsChanged={() => setReloadTick((t) => t + 1)}
            onExtensionsChanged={() => setReloadTick((t) => t + 1)}
            onStaffingChanged={() => setReloadTick((t) => t + 1)}
            staffing={editingStaffing}
            staffingPeople={employees}
            talentPool={talentPool}
            canEngage={canEngage}
            assignmentsByEmployee={assignmentsByEmployee}
            onInvoicedHt={(projectId, amount) =>
              setInvoicedHt({ projectId, amount })
            }
            onProjectPatched={(projectId, patch) => {
              setProjects((list) =>
                list.map((x) => (x.id === projectId ? { ...x, ...patch } : x)),
              );
              setEditing((e) =>
                e && e.id === projectId ? { ...e, ...patch } : e,
              );
            }}
          />
        </div>
      )}
      {editing === undefined && (
        <>
          <PageHeading
            title="Projects"
            action={
              <Button variant="pivot" onClick={() => openProjectPage(null)}>
                <Plus data-icon="inline-start" />
                New project
              </Button>
            }
          >
            Delivery, consumption and billing across your engagements
          </PageHeading>
          <Card role="region" aria-label="Summary">
            <CardContent>
              <StatGrid className="grid-cols-2 @2xl:grid-cols-3 @6xl:grid-cols-5">
                <Stat size="sm">
                  <StatValue className={STAT_VALUE}>{activeCount}</StatValue>
                  <StatLabel>Active projects</StatLabel>
                  <StatSource>
                    {staffedCount} staffed · {activeCount - staffedCount} unassigned
                  </StatSource>
                </Stat>
                <Stat size="sm">
                  <StatValue className={STAT_VALUE}><Figure value={money(activeTotal)} /></StatValue>
                  <StatLabel>Contract value</StatLabel>
                  <StatSource>Régie + forfait, active contracts</StatSource>
                </Stat>
                <Stat size="sm">
                  <StatValue className={STAT_VALUE}>
                    <span className="text-muted-foreground">≈</span>
                    <Figure value={money(consumedTotal)} />
                  </StatValue>
                  <StatLabel>Consumed to date</StatLabel>
                  <StatSource>
                    {trackedRows.length
                      ? `Tracked on ${trackedRows.filter((r) => r.consumedDays > 0).length} of ${trackedRows.length} régie projects`
                      : "No régie contracts active"}
                  </StatSource>
                </Stat>
                <Stat size="sm">
                  <StatValue className={STAT_VALUE}>
                    {contractTotal > 0 ? (
                      <>
                        {Math.round((invoicedTotal / contractTotal) * 100)}
                        <StatUnit>%</StatUnit>
                      </>
                    ) : (
                      "—"
                    )}
                  </StatValue>
                  <StatLabel>Billed</StatLabel>
                  <StatSource>
                    {money(invoicedTotal)} of {money(contractTotal)} contract value
                  </StatSource>
                </Stat>
                <Stat size="sm">
                  <StatValue
                    className={cn(
                      STAT_VALUE,
                      attentionRows.length > 0 && "text-destructive",
                    )}
                  >
                    {attentionRows.length}
                  </StatValue>
                  <StatLabel>Needs attention</StatLabel>
                  <StatSource>{attentionSub || "Nothing flagged"}</StatSource>
                </Stat>
              </StatGrid>
            </CardContent>
          </Card>
          <Card role="region" aria-label="Project list" className="pb-0">
            <CardHeader className="flex flex-col gap-3 @5xl:flex-row @5xl:items-center @5xl:justify-between">
              <Tabs
                value={tab}
                onValueChange={(v) => setTab(v as ProjectsTab)}
                className="max-w-full min-w-0"
              >
                <TabsList
                  variant="line"
                  aria-label="Filter projects"
                  className="max-w-full flex-wrap justify-start gap-x-4 gap-y-1 group-data-horizontal/tabs:h-auto"
                >
                  {(
                    [
                      ["all", "All", activeCount],
                      ["attention", "Needs attention", attentionRows.length],
                      ["ending", "Ending in 30 days", endingSoon],
                      ["archived", "Archived", archivedCount],
                    ] as [ProjectsTab, string, number][]
                  ).map(([id, label, count]) => (
                    <TabsTrigger key={id} value={id} className="gap-1.5 py-2">
                      {label}
                      <span className="num text-xs text-muted-foreground">
                        {count}
                      </span>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              <div className="flex min-w-0 items-center gap-2 @5xl:w-80">
                <InputGroup className="min-w-0 flex-1">
                  <InputGroupAddon>
                    <Search />
                  </InputGroupAddon>
                  <InputGroupInput
                    type="search"
                    aria-label="Search projects"
                    placeholder="Search code, consultant, client"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </InputGroup>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Refresh"
                  title="Refresh"
                  disabled={loading}
                  onClick={() => void load()}
                >
                  <RefreshCw />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="px-0">
              {!visible.length ? (
                <div className="px-(--card-spacing) pb-(--card-spacing)">
                  <EmptyState
                    title={
                      projects.length
                        ? "No projects match this view."
                        : "No projects yet"
                    }
                  >
                    {projects.length
                      ? undefined
                      : "Convert a won deal from the pipeline, or create a project manually."}
                  </EmptyState>
                </div>
              ) : (
                <Table aria-label="Projects">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-(--card-spacing)!">Project</TableHead>
                      <TableHead>Timeline</TableHead>
                      <TableHead>
                        Consumption
                        <span className="hidden normal-case tracking-normal text-faint @5xl:inline">
                          {" "}· bar = days used, tick = time elapsed
                        </span>
                      </TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-12 pr-(--card-spacing)!">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.map((r) => {
                      const p = r.project;
                      const ended = r.daysLeft !== null && r.daysLeft < 0;
                      const tracked = r.consumedDays > 0 && r.budgetDays > 0;
                      return (
                        <Fragment key={p.id}>
                          <TableRow className={cn(r.flag && "border-b-0")}>
                            <TableCell
                              className="cursor-pointer pl-(--card-spacing)! align-top whitespace-normal"
                              onClick={() => openProjectPage(p)}
                            >
                              <div className="flex min-w-0 items-start gap-3">
                                <Avatar
                                  aria-hidden="true"
                                  className="mt-0.5 hidden @3xl:flex"
                                >
                                  <AvatarFallback
                                    className={cn(
                                      !r.team.length && "text-muted-foreground",
                                    )}
                                  >
                                    {r.initials}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="flex min-w-0 flex-col gap-0.5">
                                  <span className="text-xs text-muted-foreground">
                                    {r.who}
                                  </span>
                                  <button
                                    type="button"
                                    className="w-fit max-w-full truncate text-left font-medium underline-offset-4 hover:underline"
                                    title={p.title}
                                    onClick={(ev) => {
                                      ev.stopPropagation();
                                      openProjectPage(p);
                                    }}
                                  >
                                    {p.title}
                                  </button>
                                  <span className="text-xs text-muted-foreground">
                                    {r.metaLine || "—"}
                                  </span>
                                  {r.rateChips.length > 1 && (
                                    <span className="mt-1 flex flex-wrap gap-1">
                                      {r.rateChips.map((c, i) => (
                                        <Badge
                                          variant="secondary"
                                          className="normal-case tracking-normal"
                                          key={`${c.name}-${c.tjm}-${i}`}
                                        >
                                          {c.name && (
                                            <span className="font-sans text-muted-foreground">
                                              {c.name}
                                            </span>
                                          )}
                                          {`${money(c.tjm, p.currency)}/j`}
                                        </Badge>
                                      ))}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="min-w-36 align-top whitespace-normal">
                              {p.start_date && r.effEnd ? (
                                <div className="flex flex-col gap-2">
                                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                    <span className="num text-[13px] whitespace-nowrap">{`${shortDate(p.start_date)} → ${shortDate(r.effEnd)}`}</span>
                                    {r.extended && (
                                      <Badge variant="outline">extended</Badge>
                                    )}
                                    {r.daysLeft !== null && (
                                      <span
                                        className={cn(
                                          "text-xs",
                                          ended ? "text-faint" : "text-muted-foreground",
                                        )}
                                      >
                                        {ended
                                          ? `Ended ${Math.abs(r.daysLeft)}d ago`
                                          : `${r.daysLeft}d left`}
                                      </span>
                                    )}
                                  </div>
                                  {r.timePct !== null && (
                                    <div
                                      className="h-1 w-full overflow-hidden rounded-full bg-border"
                                      role="progressbar"
                                      aria-label="Contract time elapsed"
                                      aria-valuenow={r.timePct}
                                      aria-valuemin={0}
                                      aria-valuemax={100}
                                    >
                                      <div
                                        className="h-full rounded-full bg-muted-foreground/60"
                                        style={{ width: `${r.timePct}%` }}
                                      />
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span className="text-[13px] text-muted-foreground">
                                  {p.start_date
                                    ? `Starts ${shortDate(p.start_date)}`
                                    : "No dates"}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="min-w-44 align-top whitespace-normal">
                              <div className="flex flex-col gap-2">
                                {tracked ? (
                                  <>
                                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs">
                                      <span className="num">
                                        {fmtDays(r.consumedDays)} / {fmtDays(r.budgetDays)} j ·{" "}
                                        <span className="text-muted-foreground">
                                          {r.usedPct}%
                                        </span>
                                      </span>
                                      <span className="num">
                                        <strong className="font-medium">{money(r.billed, p.currency)}</strong>{" "}
                                        <span className="text-muted-foreground">
                                          / {money(r.total, p.currency)}
                                        </span>
                                      </span>
                                    </div>
                                    <div
                                      className="relative h-1.5 w-full rounded-full bg-border"
                                      role="progressbar"
                                      aria-label="Contract days consumed"
                                      aria-valuenow={Math.min(r.usedPct, 100)}
                                      aria-valuemin={0}
                                      aria-valuemax={100}
                                    >
                                      <div
                                        className={cn(
                                          "h-full rounded-full",
                                          r.usedPct > 100 ? "bg-destructive" : "bg-foreground",
                                        )}
                                        style={{
                                          width: `${Math.min(r.usedPct, 100)}%`,
                                        }}
                                      />
                                      {r.timePct !== null && (
                                        <div
                                          className="absolute -top-1 -bottom-1 w-0.5 -translate-x-px rounded-full bg-muted-foreground"
                                          style={{ left: `${r.timePct}%` }}
                                          aria-hidden="true"
                                        />
                                      )}
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs">
                                      <span className="text-muted-foreground">
                                        {r.isRegie
                                          ? r.consumedDays > 0
                                            ? `${fmtDays(r.consumedDays)} logged · set a day budget`
                                            : "No days logged yet"
                                          : "Forfait, no day budget"}
                                      </span>
                                      <span className="num">
                                        <span className="text-muted-foreground">
                                          — /
                                        </span>{" "}
                                        <strong className="font-medium">{money(r.total, p.currency)}</strong>
                                      </span>
                                    </div>
                                    <div
                                      className="h-1.5 w-full rounded-full border border-dashed border-border"
                                      aria-hidden="true"
                                    />
                                  </>
                                )}
                                {r.lineCaps.map((c) => (
                                  <div
                                    key={c.name}
                                    className={cn(
                                      "num text-[11px]",
                                      c.consumed > c.cap
                                        ? "text-destructive"
                                        : "text-muted-foreground",
                                    )}
                                  >
                                    {currentYear}
                                    {c.name ? ` ${c.name}` : ""} cap:{" "}
                                    {fmtDays(c.consumed)} / {fmtDays(c.cap)} days
                                  </div>
                                ))}
                              </div>
                            </TableCell>
                            <TableCell className="align-top">
                              <Badge
                                variant={r.flag ? "destructive" : "outline"}
                                className="h-6 gap-1.5 px-2 text-xs normal-case tracking-normal"
                              >
                                {!r.flag && (
                                  <span
                                    className="size-1.5 shrink-0 rounded-full"
                                    style={{ background: r.meta.color }}
                                    aria-hidden="true"
                                  />
                                )}
                                {r.flag && (
                                  <TriangleAlert className="size-3" aria-hidden="true" />
                                )}
                                <span className="font-sans">{r.meta.label}</span>
                              </Badge>
                            </TableCell>
                            <TableCell className="pr-(--card-spacing)! text-right align-top">
                              <DropdownMenu>
                                <DropdownMenuTrigger
                                  render={
                                    <Button
                                      variant="ghost"
                                      size="icon-sm"
                                      aria-label={`More actions for ${p.title}`}
                                    />
                                  }
                                >
                                  <MoreVertical />
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-44">
                                  <DropdownMenuItem
                                    disabled={busy}
                                    onClick={() => openProjectPage(p)}
                                  >
                                    <Pencil />
                                    Edit
                                  </DropdownMenuItem>
                                  {r.meta.is_terminal
                                    ? defaultStatus &&
                                      p.status !== defaultStatus.key && (
                                        <DropdownMenuItem
                                          disabled={busy}
                                          onClick={() =>
                                            setStatus(
                                              p,
                                              defaultStatus.key,
                                              "Project restored.",
                                            )
                                          }
                                        >
                                          <ArchiveRestore />
                                          Restore
                                        </DropdownMenuItem>
                                      )
                                    : terminalStatus &&
                                      p.status !== terminalStatus.key && (
                                        <DropdownMenuItem
                                          disabled={busy}
                                          onClick={() =>
                                            setStatus(
                                              p,
                                              terminalStatus.key,
                                              "Project archived.",
                                            )
                                          }
                                        >
                                          <Archive />
                                          Archive
                                        </DropdownMenuItem>
                                      )}
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    variant="destructive"
                                    disabled={busy}
                                    onClick={() => setDeleting(p)}
                                  >
                                    <Trash2 />
                                    Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                          {r.flag && (
                            <TableRow className="hover:bg-transparent">
                              <TableCell
                                colSpan={5}
                                className="h-auto px-(--card-spacing)! pt-0 pb-3 whitespace-normal"
                              >
                                <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                                  <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                                  <span>{r.flag}</span>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
            <CardFooter className="flex flex-wrap justify-between gap-2 py-3 text-xs text-muted-foreground">
              <span>
                Showing {visible.length} of {rows.length} projects
              </span>
              <span className="truncate">Account owner · {actorEmail}</span>
            </CardFooter>
          </Card>
        </>
      )}
    </div>
  );
}

/** Stat value size shared by the list and project stat grids. */
const STAT_VALUE =
  "group-data-[size=sm]/stat:text-[22px] @5xl:group-data-[size=sm]/stat:text-[26px]";

/** A wrapping grid of stats — StatGroup keeps every stat on one row, which
    does not fit five or six money figures in ~800px. */
function StatGrid({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("grid gap-x-6 gap-y-6", className)}>{children}</div>
  );
}

/** A money figure with its currency set as the stat unit ("410 000 €"). */
function Figure({ value }: { value: string }) {
  const m = value.match(/^(.*\d)\s*([^\d\s][^\d]*)$/);
  return m ? <>{m[1]}<StatUnit>{m[2]}</StatUnit></> : <>{value}</>;
}

/** Card heading with the outline semantics of the old <h2>. */
function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <CardTitle role="heading" aria-level={2}>
      {children}
    </CardTitle>
  );
}

/** Thin progress track — `tone` colours the fill. */
function Meter({
  pct,
  label,
  over,
}: {
  pct: number;
  label: string;
  over?: boolean;
}) {
  return (
    <div
      className="h-1 w-full overflow-hidden rounded-full bg-border"
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.min(pct, 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn("h-full rounded-full", over ? "bg-destructive" : "bg-foreground")}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
    </div>
  );
}

/**
 * Stat strip under the edit page header (source design "Edit Project.html"):
 * contract value, CRA consumption, remaining budget and time left — all
 * derived from the saved project row plus its signed extensions and the
 * CRA days already recorded against it.
 */
function ProjectStatsStrip({
  project,
  signedExts,
  craDays,
  staffed,
  billedHt,
}: {
  project: Project;
  signedExts: ProjectExtension[];
  craDays: number;
  /** Finalized + paid invoices HT; null until the invoices card loads. */
  billedHt: number | null;
  /** Open assignments vs billable line days (contract + extensions). */
  staffed: {
    days: number;
    staffedDays: number;
    pct: number;
  } | null;
}) {
  const isRegie = project.pricing_model === "regie";
  const days = Number(project.estimated_days ?? 0);
  // Signed extensions grow both the day budget and the contract value.
  const extDays = signedExts.reduce(
    (sum, ext) =>
      ext.pricing_model === "regie" && ext.estimated_days != null
        ? sum + Number(ext.estimated_days)
        : sum,
    0,
  );
  const budget = isRegie ? days + extDays : 0;
  const extAmount = signedExts.reduce(
    (sum, ext) => sum + extensionValue(ext),
    0,
  );
  const total =
    (isRegie
      ? linesCappedAmount(
          storedTjmProfiles(project.tjm_profiles),
          project.start_date,
          project.end_date,
        )
      : Number(project.amount)) + extAmount;
  // Per-line annual billable caps (sales.md §14): a capped line can bill at
  // most its prorated allowance per calendar year, so line days beyond the
  // cap never become value. The value itself is the per-line build-up —
  // each line's rate × its capped open days, contract and signed
  // extensions summed; cappedDaysLost below only shrinks the day budget.
  let cappedDaysLost = 0;
  const addCapLoss = (
    line: PricingLine,
    windowStart: string | null,
    windowEnd: string | null,
  ) => {
    if (line.max_billable_days_per_year == null || !windowStart) return;
    const end =
      windowEnd && line.end_date && line.end_date > windowEnd
        ? windowEnd
        : line.end_date;
    // A line without its own end date prices 0 days (lineDays) — nothing
    // to cap. An undated window can't be prorated either.
    if (!end) return;
    for (let year = Number(windowStart.slice(0, 4)); year <= Number(end.slice(0, 4)); year++) {
      const yearStart = `${year}-01-01`;
      const yearEnd = `${year}-12-31`;
      const from = windowStart > yearStart ? windowStart : yearStart;
      const to = end < yearEnd ? end : yearEnd;
      if (to < from) continue;
      const daysInYear = openDaysBetween(from, to);
      const allowance = proratedBillableDays(
        Number(line.max_billable_days_per_year),
        windowStart,
        end,
        year,
      );
      cappedDaysLost += Math.max(0, daysInYear - allowance);
    }
  };
  for (const line of storedTjmProfiles(project.tjm_profiles))
    addCapLoss(line, project.start_date, project.end_date);
  for (const ext of signedExts)
    for (const line of storedTjmProfiles(ext.tjm_profiles))
      addCapLoss(line, ext.start_date, ext.end_date);
  const capped = cappedDaysLost > 0;
  const budgetCapped = capped ? Math.max(0, budget - cappedDaysLost) : budget;
  // The value already reflects the caps line by line (see above), so it
  // stands as the consumption ceiling — no proportional shrink needed.
  const cappedTotal = total;
  const effDays = capped ? Math.min(craDays, budgetCapped) : craDays;
  const pct =
    budgetCapped > 0 ? Math.round((effDays / budgetCapped) * 100) : 0;
  const consumedValue =
    budgetCapped > 0
      ? Math.round((effDays / budgetCapped) * cappedTotal)
      : 0;
  let effEnd = project.end_date;
  for (const ext of signedExts) {
    if (ext.end_date && (!effEnd || ext.end_date > effEnd))
      effEnd = ext.end_date;
  }
  const progress = timelineProgress({ ...project, end_date: effEnd });
  return (
    <Card role="region" aria-label="Project figures">
      <CardContent>
        <StatGrid className="grid-cols-2 @2xl:grid-cols-3 @6xl:grid-cols-6">
          <Stat size="sm">
            <StatValue className={STAT_VALUE}>
              <Figure value={money(cappedTotal, project.currency)} />
            </StatValue>
            <StatLabel>Contract value</StatLabel>
            <StatSource>
              {isRegie
                ? `${fmtDays(budgetCapped)} billable days`
                : "Forfait"}
              {extAmount > 0 ? " · incl. extensions" : ""}
              {capped ? " · capped by annual caps" : ""}
            </StatSource>
          </Stat>
          {staffed && (
            <Stat size="sm">
              <StatValue className={STAT_VALUE}>
                {staffed.pct}
                <StatUnit>%</StatUnit>
              </StatValue>
              <StatLabel>Staffed</StatLabel>
              <StatSource>
                {fmtDays(staffed.staffedDays)} of {fmtDays(staffed.days)} days
                have someone on them
              </StatSource>
            </Stat>
          )}
          <Stat size="sm">
            <StatValue className={STAT_VALUE}>
              {budgetCapped > 0 ? (
                <Figure value={money(consumedValue, project.currency)} />
              ) : (
                <>
                  {fmtDays(craDays)}
                  <StatUnit>days</StatUnit>
                </>
              )}
            </StatValue>
            <StatLabel>Consumed (CRA)</StatLabel>
            <StatSource>
              {budgetCapped > 0
                ? `${fmtDays(effDays)} of ${fmtDays(budgetCapped)} days · ${pct}%`
                : "from CRA timesheets"}
            </StatSource>
          </Stat>
          {billedHt !== null && (
            <Stat size="sm">
              <StatValue className={STAT_VALUE}>
                <Figure value={money(billedHt, project.currency)} />
              </StatValue>
              <StatLabel>Billed</StatLabel>
              <StatSource>
                {cappedTotal > 0
                  ? `${Math.round((billedHt / cappedTotal) * 100)}% of contract value`
                  : "Finalized and paid invoices, HT"}
              </StatSource>
            </Stat>
          )}
          <Stat size="sm">
            <StatValue className={STAT_VALUE}>
              {budgetCapped > 0 ? (
                <Figure value={money(cappedTotal - consumedValue, project.currency)} />
              ) : (
                "—"
              )}
            </StatValue>
            <StatLabel>Remaining</StatLabel>
            <StatSource>
              {budgetCapped > 0
                ? `${fmtDays(budgetCapped - effDays)} days left to deliver`
                : "Fixed price"}
            </StatSource>
          </Stat>
          <Stat size="sm">
            <StatValue className={STAT_VALUE}>
              {progress ? (
                progress.left < 0 ? (
                  "Ended"
                ) : (
                  <>
                    {progress.left}
                    <StatUnit>days</StatUnit>
                  </>
                )
              ) : (
                "—"
              )}
            </StatValue>
            <StatLabel>Time left</StatLabel>
            <StatSource>
              {effEnd ? `Ends ${longDate(effEnd)}` : "No end date"}
            </StatSource>
          </Stat>
        </StatGrid>
      </CardContent>
    </Card>
  );
}


function ProjectForm({
  editing,
  clients,
  convertible,
  opportunitiesById,
  statuses,
  defaultStatusKey,
  busy,
  actorEmail,
  currentYear,
  craDaysByProject,
  craLineYearDaysByProject,
  signedExtensions,
  onCancel,
  onSubmit,
  onDocumentsChanged,
  onExtensionsChanged,
  onStaffingChanged,
  staffing,
  staffingPeople,
  talentPool,
  canEngage,
  assignmentsByEmployee,
  onInvoicedHt,
  onProjectPatched,
}: {
  editing: Project | null;
  clients: SalesClient[];
  convertible: SalesOpportunity[];
  opportunitiesById: Map<string, SalesOpportunity>;
  statuses: ReturnType<typeof statusesFor>;
  defaultStatusKey: string | undefined;
  busy: boolean;
  actorEmail: string;
  currentYear: number;
  craDaysByProject: Map<string, number>;
  craLineYearDaysByProject: Map<string, Map<string, number>>;
  signedExtensions: ProjectExtension[];
  onCancel: () => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  /** Reload list flags after a contract or avenant was filed. */
  onDocumentsChanged: () => void;
  onExtensionsChanged: () => void;
  /** Reload after an assignment was created or ended from the contract page. */
  onStaffingChanged: () => void;
  /** Open assignments + coverage totals for the edited project. */
  staffing: {
    assignments: Assignment[];
    days: number;
    staffedDays: number;
    pct: number;
  } | null;
  /** Every employment with its person's name — the assign panel's roster. */
  staffingPeople: {
    id: string;
    full_name: string;
    start_date: string;
    status: string;
  }[];
  /** People with no open employment — offered in the assign panel for a
      direct engagement (HR operators only). */
  talentPool: { personId: string; name: string }[];
  canEngage: boolean;
  /** Open assignments per employee, all projects — availability readout. */
  assignmentsByEmployee: Map<string, Assignment[]>;
  /** The invoices card's HT total, for the stat strip's Billed figure. */
  onInvoicedHt: (projectId: string, amount: number) => void;
  onProjectPatched: (
    projectId: string,
    patch: { end_date: string | null; updated_at: string },
  ) => void;
}) {
  const source = editing?.opportunity_id
    ? opportunitiesById.get(editing.opportunity_id)
    : undefined;
  const [pricingModel, setPricingModel] = useState(
    editing?.pricing_model || source?.pricing_model || "regie",
  );
  const [clientId, setClientId] = useState(editing?.client_id || "");
  // Optional billing intermediary — when set, invoices go to it instead of
  // the main client. Cleared if the main client is switched to the same id
  // (the database rejects client == intermediary).
  const [intermediaryId, setIntermediaryId] = useState(
    editing?.intermediary_client_id || "",
  );
  const [startDate, setStartDate] = useState(editing?.start_date || "");
  const [endDate, setEndDate] = useState(editing?.end_date || "");
  const [profiles, setProfiles] = useState<TjmProfileDraft[]>(() => {
    const stored = storedTjmProfiles(editing?.tjm_profiles);
    if (editing && stored.length)
      return stored.map((p) => ({
        name: p.name,
        savedName: p.name,
        tjm: String(p.tjm),
        end_date: p.end_date || "",
        cap:
          p.max_billable_days_per_year != null
            ? String(p.max_billable_days_per_year)
            : "",
      }));
    if (editing?.pricing_model === "regie" && editing.tjm != null)
      return [{ name: "", tjm: String(editing.tjm), end_date: "", cap: "" }];
    if (!editing && source?.pricing_model === "regie" && source.tjm != null)
      return [{ name: "", tjm: String(source.tjm), end_date: "", cap: "" }];
    return [{ name: "", tjm: "", end_date: "", cap: "" }];
  });
  const [currency, setCurrency] = useState(editing?.currency || "EUR");
  const [fixedPrice, setFixedPrice] = useState(
    editing?.fixed_price != null
      ? String(editing.fixed_price)
      : source?.fixed_price != null
        ? String(source.fixed_price)
        : "",
  );
  const [owner, setOwner] = useState(editing?.owner_email || actorEmail);

  // Staffing on the saved contract lines: assignments are keyed by line
  // name in the database, so the panels follow the saved lines — a draft
  // line that was renamed or just added can't be staffed until saved.
  const personNameByEmployee = useMemo(
    () => new Map(staffingPeople.map((e) => [e.id, e.full_name])),
    [staffingPeople],
  );
  const people: StaffingPerson[] = useMemo(
    () =>
      staffingPeople
        .filter((e) => ["preboarding", "active"].includes(e.status))
        .map((e) => ({
          employeeId: e.id,
          name: e.full_name,
          startDate: e.start_date,
        })),
    [staffingPeople],
  );
  const staffingByLine = useMemo(() => {
    const map = new Map<string, LineStaffing>();
    if (!editing || !staffing) return map;
    for (const s of lineStaffing(
      storedTjmProfiles(editing.tjm_profiles),
      editing.start_date,
      editing.end_date,
      staffing.assignments,
    ))
      map.set(s.line.name, s);
    return map;
  }, [editing, staffing]);

  // Line volumes derive from each line's end date inside the contract
  // window (open days).
  const openDays = openDaysBetween(startDate, endDate);
  const cleanedProfiles: PricingLine[] = profiles.map((p) => ({
    name: p.name.trim(),
    tjm: Number(p.tjm) || 0,
    end_date: p.end_date || null,
    max_billable_days_per_year: Number(p.cap) > 0 ? Number(p.cap) : null,
  }));
  const totalDays = linesDays(cleanedProfiles, startDate, endDate);
  // The contract's total days are the Σ of the profile line volumes — a
  // profile can end before the contract does, so the raw start→end
  // count overstates the budget. Forfait has no lines; the window count
  // stands there.
  const contractDays = pricingModel === "regie" ? totalDays : openDays;
  // Estimated value: per-line rate × capped open days, no mean rate.
  const regieTotal = linesCappedAmount(cleanedProfiles, startDate, endDate);
  const daysDiffer = openDays > 0 && totalDays !== openDays;
  const currencySymbol =
    { EUR: "€", USD: "$", SAR: "SAR" }[currency as "EUR" | "USD" | "SAR"] ||
    currency;
  const fixedNumber = Number(fixedPrice) || 0;

  // Timeline track between the picked dates — a muted fill up to today with
  // a lime marker, like the source design's schedule track.
  const timeline = useMemo(() => {
    if (!startDate || !endDate) return null;
    const start = new Date(`${startDate}T00:00:00`).getTime();
    const end = new Date(`${endDate}T00:00:00`).getTime();
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
    return {
      pct: Math.round(
        Math.max(0, Math.min(1, (Date.now() - start) / (end - start))) * 100,
      ),
    };
  }, [startDate, endDate]);

  // CRA consumption for an existing project: the day budget mirrors the
  // régie profiles (plus signed régie extensions), the amount the matching
  // contract value — the same figures as the projects list and stat strip.
  const consumedDays = editing ? craDaysByProject.get(editing.id) || 0 : 0;
  // Per-line billable caps for the side card: every saved contract or
  // signed-extension line carrying a cap, prorated over its own window for
  // the current year, with this year's CRA days attributed by line name.
  const savedLineCaps = useMemo(() => {
    if (!editing) return [];
    const byName = new Map<string, { cap: number; consumed: number }>();
    const add = (line: PricingLine, start: string | null, windowEnd: string | null) => {
      if (line.max_billable_days_per_year == null) return;
      const end =
        windowEnd && line.end_date && line.end_date > windowEnd
          ? windowEnd
          : (line.end_date ?? null);
      const entry = byName.get(line.name) || { cap: 0, consumed: 0 };
      entry.cap += proratedBillableDays(
        Number(line.max_billable_days_per_year),
        start,
        end,
        currentYear,
      );
      byName.set(line.name, entry);
    };
    for (const line of storedTjmProfiles(editing.tjm_profiles))
      add(line, editing.start_date, editing.end_date);
    for (const ext of signedExtensions)
      for (const line of storedTjmProfiles(ext.tjm_profiles))
        add(line, ext.start_date, ext.end_date);
    const consumedByLine = craLineYearDaysByProject.get(editing.id);
    return [...byName.entries()]
      .map(([name, v]) => ({
        name,
        cap: v.cap,
        consumed: consumedByLine?.get(name) || 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [editing, signedExtensions, craLineYearDaysByProject, currentYear]);
  const extBudgetDays = signedExtensions.reduce(
    (sum, ext) =>
      ext.pricing_model === "regie" && ext.estimated_days != null
        ? sum + Number(ext.estimated_days)
        : sum,
    0,
  );
  const extAmount = signedExtensions.reduce(
    (sum, ext) => sum + extensionValue(ext),
    0,
  );
  const consumptionBudget =
    pricingModel === "regie" ? totalDays + extBudgetDays : 0;
  const consumptionAmount =
    pricingModel === "regie" ? regieTotal + extAmount : fixedNumber + extAmount;
  const consumePct =
    consumptionBudget > 0
      ? Math.round((consumedDays / consumptionBudget) * 100)
      : 0;
  const consumedValue =
    consumptionBudget > 0
      ? Math.round((consumedDays / consumptionBudget) * consumptionAmount)
      : 0;

  const setProfile = (i: number, patch: Partial<TjmProfileDraft>) =>
    setProfiles((list) =>
      list.map((p, j) => (j === i ? { ...p, ...patch } : p)),
    );
  const addProfile = () =>
    setProfiles((list) => [...list, { name: "", tjm: "", end_date: "", cap: "" }]);
  const removeProfile = (i: number) =>
    setProfiles((list) =>
      list.length <= 1 ? list : list.filter((_, j) => j !== i),
    );

  return (
    <form id="pj-form" className="flex flex-col gap-4" onSubmit={onSubmit}>
      {!editing && !!convertible.length && (
        <Card size="sm">
          <CardContent>
            <Field className="max-w-xl">
              <FieldLabel htmlFor="pj-opportunity">
                Convert a won deal (optional)
              </FieldLabel>
              <NativeSelect
                id="pj-opportunity"
                name="opportunity_id"
                defaultValue=""
                onChange={(e) => {
                  const o = opportunitiesById.get(e.target.value);
                  if (o) {
                    setPricingModel(o.pricing_model);
                    setClientId(o.client_id);
                    setProfiles(
                      o.pricing_model === "regie" && o.tjm != null
                        ? [{ name: "", tjm: String(o.tjm), end_date: "", cap: "" }]
                        : [{ name: "", tjm: "", end_date: "", cap: "" }],
                    );
                  }
                }}
              >
                <NativeSelectOption value="">Create manually</NativeSelectOption>
                {convertible.map((o) => (
                  <NativeSelectOption key={o.id} value={o.id}>
                    {o.title},{" "}
                    {clients.find((c) => c.id === o.client_id)?.name ||
                      "Client"}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          </CardContent>
        </Card>
      )}

      <div
        className={cn(
          "grid items-start gap-4",
          editing && "@5xl:grid-cols-[minmax(0,1fr)_20rem]",
        )}
      >
        <div className="@container flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader>
              <SectionTitle>General</SectionTitle>
              <CardDescription>
                Who the project is for and who owns it.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <div className="grid gap-5 @2xl:grid-cols-2">
                <Field className="@2xl:col-span-2">
                  <FieldLabel htmlFor="pj-title-input">Project title</FieldLabel>
                  <Input
                    id="pj-title-input"
                    name="title"
                    defaultValue={editing?.title}
                    required
                    maxLength={200}
                  />
                  <FieldDescription>
                    Same as the code: give it a readable name, e.g. "Credit
                    Chain · AI squad"
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel>Client</FieldLabel>
                  <ClientPicker
                    clients={clients}
                    value={clientId}
                    onChange={(id) => {
                      setClientId(id);
                      if (intermediaryId && intermediaryId === id)
                        setIntermediaryId("");
                    }}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel>
                    Intermediary
                    <span className="font-normal text-muted-foreground">(optional)</span>
                  </FieldLabel>
                  <ClientPicker
                    clients={clients.filter((c) => c.id !== clientId)}
                    value={intermediaryId}
                    onChange={setIntermediaryId}
                    name="intermediary_client_id"
                  />
                  <FieldDescription>
                    {intermediaryId
                      ? `Billed to ${clients.find((c) => c.id === intermediaryId)?.name || "the intermediary"}: the main client isn't invoiced.`
                      : "No intermediary: the main client is billed directly."}
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="pj-status">Status</FieldLabel>
                  <NativeSelect
                    id="pj-status"
                    name="status"
                    className="w-full"
                    defaultValue={
                      editing?.status || defaultStatusKey || statuses[0]?.key
                    }
                  >
                    {statuses.map((s) => (
                      <NativeSelectOption key={s.key} value={s.key}>
                        {s.label}
                        {s.is_default ? " (default)" : ""}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="pj-owner">Owner</FieldLabel>
                  <InputGroup>
                    <InputGroupAddon>
                      <span
                        className="flex size-6 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-foreground uppercase"
                        aria-hidden="true"
                      >
                        {owner.trim().charAt(0) || "?"}
                      </span>
                    </InputGroupAddon>
                    <InputGroupInput
                      id="pj-owner"
                      name="owner_email"
                      type="email"
                      value={owner}
                      onChange={(e) => setOwner(e.target.value)}
                      maxLength={200}
                    />
                  </InputGroup>
                </Field>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <SectionTitle>Contract</SectionTitle>
              <CardDescription>
                The initial contract window and its pricing. Renewals
                continue as extensions below.
              </CardDescription>
              {contractDays > 0 && (
                <CardAction>
                  <Badge variant="secondary" className="h-6 px-2 text-xs normal-case tracking-normal">
                    {contractDays} working days
                  </Badge>
                </CardAction>
              )}
            </CardHeader>

            {/* The initial contract is modeled like an extension: an
                index badge, a window, and its own pricing lines in one
                sunken row. */}
            <CardContent>
              <div className="flex flex-col gap-4 rounded-lg border border-border bg-muted/40 p-4">
                <div className="flex flex-wrap items-center gap-2.5 text-[13px]">
                  <span
                    className="num flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] text-muted-foreground"
                    aria-hidden="true"
                  >
                    1
                  </span>
                  <span className="font-medium">Initial contract</span>
                  {startDate && (
                    <span className="text-muted-foreground">
                      From {shortDate(startDate)}
                    </span>
                  )}
                </div>

                <div className="grid gap-4 @lg:grid-cols-2">
                  <Field>
                    <FieldLabel>Start date</FieldLabel>
                    <DateField
                      name="start_date"
                      aria-label="Start date"
                      defaultValue={editing?.start_date || ""}
                      onChange={(value) => setStartDate(value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel>End date</FieldLabel>
                    <DateField
                      name="end_date"
                      aria-label="End date"
                      value={endDate}
                      onChange={(value) => setEndDate(value)}
                    />
                  </Field>
                </div>
                {pricingModel === "regie" && openDays > 0 && daysDiffer && (
                  <p className="m-0 flex flex-wrap items-center gap-x-2 text-[13px] text-muted-foreground">
                    The profile windows don't match the contract end date.
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto px-0 text-[13px]"
                      onClick={() => setProfile(0, { end_date: endDate })}
                    >
                      Run the first profile to {longDate(endDate)}
                    </Button>
                  </p>
                )}
                {timeline && (
                  <div className="flex flex-col gap-2.5 pt-1">
                    <div
                      className="relative h-1 rounded-full bg-border"
                      role="progressbar"
                      aria-label="Contract window elapsed"
                      aria-valuenow={timeline.pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div
                        className="absolute inset-y-0 left-0 rounded-full bg-muted-foreground/50"
                        style={{ width: `${timeline.pct}%` }}
                      />
                      <div
                        className="absolute -top-1 -bottom-1 w-0.5 -translate-x-px rounded-full bg-foreground"
                        style={{ left: `${timeline.pct}%` }}
                      />
                    </div>
                    <div className="num flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
                      <span className="whitespace-nowrap">{shortDate(startDate)}</span>
                      <span className="text-center text-foreground/80">
                        Today · {timeline.pct}% of the window elapsed
                      </span>
                      <span className="whitespace-nowrap">{shortDate(endDate)}</span>
                    </div>
                  </div>
                )}

                <div className="grid gap-4 @lg:grid-cols-2">
                  <Field>
                    <FieldLabel>Pricing model</FieldLabel>
                    <ToggleGroup
                      aria-label="Pricing model"
                      className="w-full *:flex-1"
                      value={[pricingModel]}
                      onValueChange={(v) => {
                        if (v[0]) setPricingModel(v[0] as string);
                      }}
                    >
                      <ToggleGroupItem value="regie">Régie</ToggleGroupItem>
                      <ToggleGroupItem value="forfait">Forfait</ToggleGroupItem>
                    </ToggleGroup>
                    <input
                      type="hidden"
                      name="pricing_model"
                      value={pricingModel}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="pj-currency">Currency</FieldLabel>
                    <NativeSelect
                      id="pj-currency"
                      name="currency"
                      className="w-full"
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                    >
                      <NativeSelectOption value="EUR">EUR (Euro)</NativeSelectOption>
                      <NativeSelectOption value="SAR">SAR (Saudi riyal)</NativeSelectOption>
                      <NativeSelectOption value="USD">USD (US dollar)</NativeSelectOption>
                    </NativeSelect>
                  </Field>
                </div>
                {pricingModel === "forfait" && (
                  <Field className="max-w-xs">
                    <FieldLabel htmlFor="pj-fixed-price">Forfait</FieldLabel>
                    <InputGroup>
                      <InputGroupInput
                        id="pj-fixed-price"
                        name="fixed_price"
                        type="number"
                        min="0"
                        step="100"
                        className="num"
                        value={fixedPrice}
                        onChange={(e) => setFixedPrice(e.target.value)}
                        required
                      />
                      <InputGroupAddon align="inline-end">
                        <InputGroupText>{currencySymbol}</InputGroupText>
                      </InputGroupAddon>
                    </InputGroup>
                  </Field>
                )}
                {pricingModel === "regie" && (
                  <div className="flex flex-col gap-3">
                    {profiles.map((profile, i) => {
                      const cleaned = cleanedProfiles[i];
                      const days = lineDays(cleaned, startDate, endDate);
                      const billableDays = cappedLineDays(
                        cleaned,
                        startDate,
                        endDate,
                      );
                      // Live prorata: the cap input is the full-year
                      // allowance; the caption shows what this calendar
                      // year actually allows over the line window.
                      const capNumber = Number(profile.cap) || 0;
                      const capThisYear =
                        capNumber > 0
                          ? proratedBillableDays(
                              capNumber,
                              startDate || null,
                              cleaned.end_date ?? null,
                              currentYear,
                            )
                          : null;
                      // Staffing follows the saved lines — assignments
                      // are keyed by the saved line name (possibly ""), so
                      // a line keeps its staffing while being renamed and
                      // a brand-new draft line can only be staffed after
                      // saving.
                      const lineStaff =
                        editing && profile.savedName !== undefined
                          ? staffingByLine.get(profile.savedName)
                          : undefined;
                      return (
                        <div
                          className="@container relative flex flex-col overflow-hidden rounded-lg border border-border bg-card"
                          key={i}
                        >
                          <div className="grid grid-cols-1 items-start gap-3 p-3.5 @xs:grid-cols-2 @2xl:grid-cols-[minmax(0,1.1fr)_minmax(7.5rem,1fr)_minmax(10rem,1.1fr)_minmax(7.25rem,0.7fr)_auto_auto]">
                            <Field className="gap-2 @xs:col-span-2 @2xl:col-span-1">
                              <FieldLabel htmlFor={`pj-line-${i}-name`}>Profile</FieldLabel>
                              <Input
                                id={`pj-line-${i}-name`}
                                aria-label={`Profile ${i + 1} name`}
                                placeholder="Name this profile, e.g. Data Engineer"
                                value={profile.name}
                                maxLength={100}
                                onChange={(e) =>
                                  setProfile(i, { name: e.target.value })
                                }
                              />
                            </Field>
                            <Field className="gap-2">
                              <FieldLabel htmlFor={`pj-line-${i}-rate`}>Daily rate</FieldLabel>
                              <InputGroup>
                                <InputGroupInput
                                  id={`pj-line-${i}-rate`}
                                  aria-label={`Profile ${i + 1} daily rate`}
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  required
                                  className="num"
                                  value={profile.tjm}
                                  onChange={(e) =>
                                    setProfile(i, { tjm: e.target.value })
                                  }
                                />
                                <InputGroupAddon align="inline-end">
                                  <InputGroupText className="text-xs whitespace-nowrap">
                                    {currencySymbol} / day
                                  </InputGroupText>
                                </InputGroupAddon>
                              </InputGroup>
                            </Field>
                            <Field className="gap-2">
                              <FieldLabel>End date</FieldLabel>
                              <DateField
                                aria-label={`Profile ${i + 1} end date`}
                                value={profile.end_date}
                                min={startDate || undefined}
                                max={endDate || undefined}
                                onChange={(value) =>
                                  setProfile(i, { end_date: value })
                                }
                              />
                            </Field>
                            <Field className="gap-2">
                              <FieldLabel htmlFor={`pj-line-${i}-cap`}>Cap / year</FieldLabel>
                              <Input
                                id={`pj-line-${i}-cap`}
                                aria-label={`Profile ${i + 1} yearly billable cap`}
                                type="number"
                                min="0"
                                step="1"
                                className="num"
                                value={profile.cap}
                                placeholder="e.g. 210"
                                onChange={(e) =>
                                  setProfile(i, { cap: e.target.value })
                                }
                              />
                              {capThisYear !== null && (
                                <span className="num -mt-1 text-[11px] whitespace-nowrap text-muted-foreground">
                                  ≈ {fmtDays(capThisYear)} d in {currentYear}
                                </span>
                              )}
                            </Field>
                            <Field className="gap-2">
                              <span className="text-sm leading-none font-medium @2xl:text-right">Subtotal</span>
                              <span
                                className="num flex h-10 items-center text-sm font-medium whitespace-nowrap @2xl:justify-end"
                                title={
                                  billableDays < days
                                    ? `${fmtDays(billableDays)} billable of ${days} working days (annual cap)`
                                    : `${days} working days`
                                }
                              >
                                {money(cleaned.tjm * billableDays, currency)}
                              </span>
                            </Field>
                            <div className="absolute top-2 right-2 @2xl:static @2xl:flex @2xl:items-end @2xl:justify-end @2xl:self-stretch @2xl:pb-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="text-muted-foreground hover:text-destructive"
                                aria-label={`Remove profile ${i + 1}`}
                                title={
                                  profiles.length <= 1
                                    ? "A régie project needs at least one profile"
                                    : "Remove profile"
                                }
                                disabled={profiles.length <= 1}
                                onClick={() => removeProfile(i)}
                              >
                                <X />
                              </Button>
                            </div>
                          </div>

                          {/* The line bills from the contract start to its
                              own end date — a read-out of the window the
                              fields above define. */}
                          <div className="num flex flex-wrap items-center gap-x-3.5 gap-y-2 px-3.5 pb-3 text-[13px]">
                            <span className="text-muted-foreground">Billed</span>
                            <span>
                              {startDate ? shortDate(startDate) : "—"} →{" "}
                              {cleaned.end_date ? shortDate(cleaned.end_date) : "—"}
                            </span>
                            <span className="text-muted-foreground">
                              {fmtDays(days)} working days ×{" "}
                              {money(cleaned.tjm, currency)}
                            </span>
                            {!!cleaned.end_date &&
                              !!endDate &&
                              cleaned.end_date === endDate && (
                                <Badge variant="secondary" className="normal-case tracking-normal">
                                  Same as contract
                                </Badge>
                              )}
                          </div>

                          {editing &&
                            (lineStaff ? (
                              <div className="border-t border-border bg-muted/40 p-3.5">
                                <LineStaffingPanel
                                  projectId={editing.id}
                                  staffing={lineStaff}
                                  people={people}
                                  talentPool={talentPool}
                                  canEngage={canEngage}
                                  assignmentsByEmployee={
                                    assignmentsByEmployee
                                  }
                                  personNameByEmployee={personNameByEmployee}
                                  currency={currency}
                                  onChanged={onStaffingChanged}
                                />
                              </div>
                            ) : cleaned.name ? (
                              <p className="m-0 border-t border-border bg-muted/40 px-3.5 py-3 text-[13px] text-muted-foreground">
                                Save changes to staff this line.
                              </p>
                            ) : null)}
                        </div>
                      );
                    })}
                    <input
                      type="hidden"
                      name="tjm_profiles"
                      value={JSON.stringify(cleanedProfiles)}
                    />
                    <input
                      type="hidden"
                      name="tjm_renames"
                      value={JSON.stringify(
                        profiles.flatMap((p, i) =>
                          p.savedName !== undefined &&
                          cleanedProfiles[i].name &&
                          cleanedProfiles[i].name !== p.savedName
                            ? [{ from: p.savedName, to: cleanedProfiles[i].name }]
                            : [],
                        ),
                      )}
                    />
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border px-3.5 py-2.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="-ml-2"
                        onClick={addProfile}
                      >
                        <Plus data-icon="inline-start" />
                        Add profile
                      </Button>
                      <EstimatedValue amount={money(regieTotal, currency)} />
                    </div>
                  </div>
                )}
                {pricingModel === "forfait" && fixedNumber > 0 && (
                  <div className="flex justify-end rounded-lg border border-border bg-card px-3.5 py-2.5">
                    <EstimatedValue amount={money(fixedNumber, currency)} />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {editing && (
            <Card>
              <CardContent>
                <ProjectExtensionsSection
                  projectId={editing.id}
                  numberOffset={1}
                  pricingModel={pricingModel}
                  currency={currency}
                  profiles={storedTjmProfiles(editing.tjm_profiles)}
                  projectStartDate={editing.start_date}
                  tjm={editing.tjm != null ? Number(editing.tjm) : null}
                  estimatedDays={
                    editing.estimated_days != null
                      ? Number(editing.estimated_days)
                      : null
                  }
                  fixedPrice={
                    editing.fixed_price != null
                      ? Number(editing.fixed_price)
                      : null
                  }
                  projectEndDate={editing.end_date}
                  busy={busy}
                  onChanged={onExtensionsChanged}
                  onProjectPatched={(patch) => {
                    // Keep the form field in sync: a signed extension moves
                    // the contract end date, and saving the form must not
                    // revert it to the stale draft value.
                    setEndDate(patch.end_date || "");
                    onProjectPatched(editing.id, patch);
                  }}
                />
              </CardContent>
            </Card>
          )}

          {editing && editing.pricing_model === "regie" && (
            <Card>
              <CardContent>
                <ProjectInvoices
                  projectId={editing.id}
                  onTotals={(amount) => onInvoicedHt(editing.id, amount)}
                />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <SectionTitle>Notes</SectionTitle>
              <CardDescription>
                Scope, team, renewal terms: anything the next person needs.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                name="notes"
                className="min-h-32"
                defaultValue={editing?.notes}
                maxLength={5000}
                placeholder="Scope, team, renewal terms…"
                aria-label="Notes"
              />
            </CardContent>
          </Card>
        </div>

        {editing && (
          <aside className="grid min-w-0 items-start gap-4 @3xl:grid-cols-2 @5xl:grid-cols-1">
            {staffing && (
              <ProjectTeamCard
                team={staffing.assignments
                  .map((a) => ({
                    employeeId: a.employee_id,
                    name:
                      personNameByEmployee.get(a.employee_id) || "Person",
                    line: a.pricing_line,
                    alloc: a.allocation_pct,
                    period: `${shortDate(a.start_date)} → ${
                      a.end_date ? shortDate(a.end_date) : "open"
                    }`,
                    status: a.status,
                  }))
                  .sort((a, b) => a.name.localeCompare(b.name))}
                unstaffedDays={Math.max(
                  0,
                  staffing.days - staffing.staffedDays,
                )}
              />
            )}
            <Card size="sm">
              <CardHeader>
                <SectionTitle>Consumption (CRA)</SectionTitle>
                <CardAction>
                  <a
                    className="text-[13px] whitespace-nowrap text-muted-foreground underline underline-offset-4 hover:text-foreground"
                    href="/hr/people"
                  >
                    Timesheets →
                  </a>
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-[13px] text-muted-foreground">
                    Value billed / Estimated value
                  </span>
                  <p className="num m-0 flex flex-wrap items-baseline gap-1.5">
                    <strong className="text-[26px] leading-tight font-medium tracking-[-0.03em]">
                      {consumptionBudget > 0
                        ? money(consumedValue, currency)
                        : `${fmtDays(consumedDays)} days`}
                    </strong>
                    {consumptionBudget > 0 && (
                      <span className="text-sm text-muted-foreground">
                        / {money(consumptionAmount, currency)}
                      </span>
                    )}
                  </p>
                </div>
                {consumptionBudget > 0 && (
                  <>
                    <Meter
                      pct={consumePct}
                      label="Contract days consumed"
                      over={consumePct > 100}
                    />
                    <div className="num flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted-foreground">
                      <span className="whitespace-nowrap">
                        {consumePct}% billed · {fmtDays(consumedDays)} of{" "}
                        {fmtDays(consumptionBudget)} days
                      </span>
                      <span className="whitespace-nowrap">
                        {money(
                          Math.max(consumptionAmount - consumedValue, 0),
                          currency,
                        )}{" "}
                        to go
                      </span>
                    </div>
                  </>
                )}
                {consumedDays === 0 && (
                  <p className="m-0 text-[13px] text-muted-foreground">
                    No client-project days recorded on this project yet. The
                    bar fills as employees save their CRA.
                  </p>
                )}
                {savedLineCaps.length > 0 && (
                  <div className="flex flex-col gap-1.5 border-t border-border pt-3">
                    <span className="text-[13px] text-muted-foreground">
                      {currentYear} billable caps (per profile)
                    </span>
                    {savedLineCaps.map((c) => (
                      <p
                        className="num m-0 flex flex-wrap items-baseline gap-1.5 text-sm"
                        key={c.name}
                      >
                        <strong
                          className={cn(
                            "font-medium",
                            c.consumed > c.cap && "text-destructive",
                          )}
                        >
                          {c.name || "Unnamed profile"}:{" "}
                          {fmtDays(c.consumed)} days
                        </strong>
                        <span className="text-muted-foreground">/ {fmtDays(c.cap)} days</span>
                      </p>
                    ))}
                    {savedLineCaps.some((c) => c.consumed > c.cap) && (
                      <p className="m-0 text-[13px] text-destructive">
                        A profile's annual cap is exceeded; the project is
                        flagged in the list.
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card size="sm" className="@3xl:col-span-2 @5xl:col-span-1">
              <CardContent>
                <DocumentsPanel
                  owner={{ kind: "project", id: editing.id }}
                  title="Contract documents"
                  extensions={signedExtensions.map((x) => ({
                    id: x.id,
                    label: x.label || (x.start_date ? `Extension from ${formatDay(x.start_date)}` : "Extension"),
                  }))}
                  onChanged={onDocumentsChanged}
                />
              </CardContent>
            </Card>
          </aside>
        )}
      </div>
    </form>
  );
}

/** "Estimated value" read-out under the pricing lines. */
function EstimatedValue({ amount }: { amount: string }) {
  return (
    <span className="inline-flex items-baseline gap-2.5">
      <span className="text-[13px] text-muted-foreground">Estimated value</span>
      <span className="num text-xl font-medium tracking-[-0.02em] whitespace-nowrap">
        {amount}
      </span>
    </span>
  );
}
