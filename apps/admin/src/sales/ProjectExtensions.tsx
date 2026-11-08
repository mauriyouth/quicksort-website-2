import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { CalendarPlus, Plus, RotateCcw, Trash2 } from "lucide-react";
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
  Badge,
  Button,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  Textarea,
} from "@quicksort-sas/ui";
import { PageAlerts } from "../ui";
import { money } from "./data";
import { DateField } from "../DateField";
import {
  linesAmount,
  linesDays,
  storedPricingLines,
  type PricingLine,
} from "./pricing-lines";
import {
  cappedLineDays,
  extensionValue,
  linesCappedAmount,
  proratedBillableDays,
} from "./billable-cap";

/**
 * Extensions (renewals) of a delivery project (sales.md §14 Phase 2). Each
 * extension is an additional period with its own end date and pricing,
 * stored in sales_project_extensions; only 'signed' ones extend the
 * timeline and value shown on the projects table — signing one (or adding
 * it signed) automatically moves the project end date to the furthest
 * signed extension end date. Régie extensions carry their own pricing
 * lines (name + daily rate + end date), so a renewal can adjust rates,
 * end dates and the profile count line by line; the flat tjm/
 * estimated_days columns stay in sync (blended) so the generated amount
 * column and dashboards keep working. Managed from the project edit page.
 *
 * Visual source: "Edit Project Modal" reference — numbered extension rows
 * edited inline (new end date, added days, Signed/Proposed toggle), a
 * dashed "+ Add extension" trigger, a schedule summary, and a valuation
 * breakdown panel separating signed value from proposed.
 *
 * Signing an extension also auto-extends open confirmed/active assignments
 * on the project at the database level
 * (private.extend_assignments_on_project_extension): their end date follows
 * the furthest signed extension end, subject to the same 100% capacity
 * guard as manual staffing moves — conflicting commitments stay unchanged
 * for manual review, and nothing is ever rolled back when an extension is
 * un-signed, shortened or deleted.
 */
export type ProjectExtension = Row<"sales_project_extensions">;

export const EXTENSION_STATUS_META: Record<
  string,
  { label: string; color: string }
> = {
  planned: { label: "Proposed", color: "#f59e0b" },
  signed: { label: "Signed", color: "#22c55e" },
  cancelled: { label: "Cancelled", color: "#64748b" },
};

/** Signed extensions decide the extended end date and added value. */
export const isActiveExtension = (e: Pick<ProjectExtension, "status">) =>
  e.status === "signed";

const CURRENCY_SYMBOL: Record<string, string> = {
  EUR: "€",
  USD: "$",
  SAR: "SAR",
};
const currencySymbol = (code: string) => CURRENCY_SYMBOL[code] || code;

const shortDate = (iso: string | null | undefined) =>
  iso
    ? new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";

const toISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return toISO(d);
};

const addMonths = (iso: string, months: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setMonth(d.getMonth() + months);
  return toISO(d);
};

export async function loadProjectExtensions(projectId: string) {
  const result = await db()
    .from("sales_project_extensions")
    .select("*")
    .eq("project_id", projectId)
    .order("start_date", { ascending: true });
  if (result.error) throw result.error;
  return (result.data || []) as ProjectExtension[];
}

/** Tabular figures, no spinner arrows — the number wells of this section. */
const NUMBER_INPUT =
  "num [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

/** Quiet 13px caption over a control; a <label> unless `as="div"`. */
function Field({
  label,
  as = "label",
  wide,
  children,
}: {
  label: string;
  as?: "label" | "div";
  wide?: boolean;
  children: ReactNode;
}) {
  const Tag = as;
  return (
    <Tag className={cn("flex min-w-0 flex-col gap-1.5", wide && "col-span-full")}>
      <span className="text-[13px] text-muted-foreground">{label}</span>
      {children}
    </Tag>
  );
}

/** Signed / Proposed switch: a radiogroup drawn as the package's segmented control. */
function StatusSwitch({
  signed,
  disabled,
  onSigned,
  onProposed,
}: {
  signed: boolean;
  disabled?: boolean;
  onSigned: () => void;
  onProposed: () => void;
}) {
  const item =
    "flex-1 min-w-0 rounded-md border border-transparent text-[13px] font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-45 aria-checked:border-input/70 aria-checked:bg-background aria-checked:text-foreground aria-checked:shadow-xs dark:aria-checked:border-border";
  return (
    <div
      className="flex h-10 gap-0.5 rounded-lg bg-muted p-[3px]"
      role="radiogroup"
      aria-label="Extension status"
    >
      <button
        type="button"
        role="radio"
        aria-checked={signed}
        className={item}
        disabled={disabled}
        onClick={onSigned}
      >
        Signed
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={!signed}
        className={item}
        disabled={disabled}
        onClick={onProposed}
      >
        Proposed
      </button>
    </div>
  );
}

/** Status chip of an extension (Proposed / Signed / Cancelled). */
function ExtensionBadge({ status }: { status: string }) {
  const label = EXTENSION_STATUS_META[status]?.label ?? status;
  const variant =
    status === "signed" ? "success" : status === "planned" ? "warning" : "secondary";
  return (
    <Badge variant={variant} className="gap-1.5">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {label}
    </Badge>
  );
}

/** Sunken card of one extension (or the add form) in the chain. */
const EXT_CARD =
  "flex flex-col gap-3.5 rounded-lg border border-border bg-muted/40 px-4 py-4 md:px-[18px]";

/** Numbered disc · name · label · start date · status chip. */
function ExtensionId({ index, children }: { index: number; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2.5 text-[13px]">
      <span
        className="num flex size-[22px] flex-none items-center justify-center rounded-full bg-muted text-[11px] text-muted-foreground"
        aria-hidden="true"
      >
        {index}
      </span>
      {children}
    </div>
  );
}

/** Numeric field that commits its draft on blur/Enter, not per keystroke. */
function CommitNumber({
  value,
  onCommit,
  min,
  step,
  disabled,
}: {
  value: number | null;
  onCommit: (next: number) => void;
  min?: number;
  step?: number;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  useEffect(() => {
    setDraft(value == null ? "" : String(value));
  }, [value]);
  const commit = () => {
    const next = Number(draft);
    if (draft.trim() === "" || Number.isNaN(next)) {
      setDraft(value == null ? "" : String(value));
      return;
    }
    if (next !== value) onCommit(next);
  };
  return (
    <Input
      type="number"
      className={NUMBER_INPUT}
      min={min}
      step={step}
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

type LineDraft = {
  name: string;
  tjm: string;
  end_date: string;
  /** Full-year billable-days allowance for this line — "" when exempt. */
  cap: string;
};

/** Clean editor drafts into stored lines — rows without a rate are dropped. */
function cleanLines(drafts: LineDraft[]): PricingLine[] {
  return drafts
    .map((d) => ({
      name: d.name.trim(),
      tjm: Number(d.tjm) || 0,
      end_date: d.end_date || null,
      max_billable_days_per_year: Number(d.cap) > 0 ? Number(d.cap) : null,
    }))
    .filter((l) => l.tjm > 0);
}

/**
 * Flat columns kept in sync from the line set: total days = Σ line
 * volumes (the day budget), tjm = blended rate (display only). The
 * generated `amount` column stays a by-product of these (mean rate ×
 * days) — contract value is always recomputed per line from
 * linesCappedAmount(), caps included, never read from `amount`.
 */
function linesToFlat(
  lines: PricingLine[],
  windowStart: string | null,
  windowEnd: string | null,
) {
  const days = linesDays(lines, windowStart, windowEnd);
  const amount = linesAmount(lines, windowStart, windowEnd);
  return {
    estimated_days: days,
    tjm: days > 0 ? Math.round((amount / days) * 100) / 100 : 0,
  };
}

/**
 * Stored pricing lines of an extension. Rows always carry their own line
 * set since the 20261028 migration; the 20261029090000 backfill converted
 * pre-existing flat régie rows, so no legacy seeding is needed here.
 */
function extensionLines(
  ext: Pick<ProjectExtension, "tjm_profiles">,
): PricingLine[] {
  return storedPricingLines(ext.tjm_profiles);
}

const toDrafts = (lines: PricingLine[]): LineDraft[] =>
  lines.map((l) => ({
    name: l.name,
    tjm: String(l.tjm),
    end_date: l.end_date || "",
    cap: l.max_billable_days_per_year != null ? String(l.max_billable_days_per_year) : "",
  }));

/**
 * Per-line pricing editor — name, daily rate, end date. A line's volume is
 * the open days from the window start to its end date (capped at the
 * window end), so a renewal can adjust rates, end dates and the profile
 * count line by line. Commits on blur; date picks and row add/remove
 * commit immediately.
 */
function LinesEditor({
  lines,
  windowStart,
  windowEnd,
  currency,
  disabled,
  onCommit,
}: {
  lines: LineDraft[];
  windowStart: string | null;
  windowEnd: string | null;
  currency: string;
  disabled?: boolean;
  onCommit: (next: LineDraft[]) => void;
}) {
  // Local drafts so typing doesn't hit the database per keystroke — text
  // fields commit on blur, date picks and row add/remove commit at once.
  // Resync from the prop only when it changes for reasons other than our
  // own commit (extension reloaded, another field edited).
  const [drafts, setDrafts] = useState(lines);
  const lastCommitted = useRef(lines);
  useEffect(() => {
    if (lines !== lastCommitted.current) {
      lastCommitted.current = lines;
      setDrafts(lines);
    }
  }, [lines]);

  const commit = (next: LineDraft[]) => {
    setDrafts(next);
    lastCommitted.current = next;
    onCommit(next);
  };
  const set = (i: number, patch: Partial<LineDraft>) =>
    setDrafts((list) => list.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const grid =
    "grid grid-cols-2 items-start gap-2 @xl/lines:grid-cols-[minmax(120px,1.2fr)_minmax(110px,0.9fr)_minmax(110px,0.9fr)_minmax(90px,0.7fr)_minmax(80px,0.7fr)_32px]";
  return (
    <div className="@container/lines flex flex-col gap-2">
      <div
        className={cn(grid, "hidden px-0.5 text-xs text-muted-foreground @xl/lines:grid")}
        aria-hidden="true"
      >
        <span>Profile</span>
        <span>Rate</span>
        <span>End date</span>
        <span>Cap / year</span>
        <span className="text-right">Subtotal</span>
        <span />
      </div>
      {drafts.map((line, i) => {
        const cleaned = cleanLines([line])[0] || {
          name: "",
          tjm: 0,
          end_date: null,
        };
        const value =
          cleaned.tjm *
          cappedLineDays(cleaned, windowStart, windowEnd);
        // Live prorata caption, same rule as the contract lines.
        const capNumber = Number(line.cap) || 0;
        const capThisYear =
          capNumber > 0
            ? proratedBillableDays(
                capNumber,
                windowStart,
                cleaned.end_date ?? null,
                new Date().getFullYear(),
              )
            : null;
        return (
          <div
            className={cn(
              grid,
              "border-b border-border pb-3 last-of-type:border-0 @xl/lines:border-0 @xl/lines:pb-0",
            )}
            key={i}
          >
            <Input
              className="col-span-2 @xl/lines:col-span-1"
              aria-label={`Profile ${i + 1} name`}
              placeholder="Data Engineer"
              value={line.name}
              maxLength={100}
              disabled={disabled}
              onChange={(e) => set(i, { name: e.target.value })}
              onBlur={() => commit(drafts)}
            />
            <InputGroup>
              <InputGroupInput
                className={NUMBER_INPUT}
                aria-label={`Profile ${i + 1} daily rate`}
                type="number"
                min="0"
                step="0.01"
                value={line.tjm}
                disabled={disabled}
                onChange={(e) => set(i, { tjm: e.target.value })}
                onBlur={() => commit(drafts)}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupText className="text-[13px] whitespace-nowrap">
                  {currencySymbol(currency)} / day
                </InputGroupText>
              </InputGroupAddon>
            </InputGroup>
            <DateField
              aria-label={`Profile ${i + 1} end date`}
              value={line.end_date}
              min={windowStart || undefined}
              max={windowEnd || undefined}
              onChange={(value) =>
                commit(
                  drafts.map((l, j) =>
                    j === i ? { ...l, end_date: value } : l,
                  ),
                )
              }
            />
            <div className="flex min-w-0 flex-col gap-0.5">
              <Input
                className={NUMBER_INPUT}
                aria-label={`Profile ${i + 1} yearly billable cap`}
                type="number"
                min="0"
                step="1"
                value={line.cap}
                placeholder="e.g. 210"
                disabled={disabled}
                onChange={(e) => set(i, { cap: e.target.value })}
                onBlur={() => commit(drafts)}
              />
              {capThisYear !== null && (
                <span className="num text-[11px] whitespace-nowrap text-muted-foreground">
                  ≈ {Number.isInteger(capThisYear) ? capThisYear : capThisYear.toFixed(1)} d
                </span>
              )}
            </div>
            <div className="flex items-center justify-between gap-2 @xl/lines:contents">
            <span className="num flex h-10 items-center text-[13px] whitespace-nowrap @xl/lines:justify-end">
              {money(value, currency)}
            </span>
            <span className="flex h-10 items-center justify-end">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="hover:text-destructive"
                aria-label={`Remove profile ${i + 1}`}
                title={
                  drafts.length <= 1
                    ? "An extension needs at least one profile"
                    : "Remove profile"
                }
                disabled={disabled || drafts.length <= 1}
                onClick={() => commit(drafts.filter((_, j) => j !== i))}
              >
                <Trash2 />
              </Button>
            </span>
            </div>
          </div>
        );
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start border-dashed text-muted-foreground hover:text-foreground"
        disabled={disabled}
        onClick={() =>
          commit([
            ...drafts,
            { name: "", tjm: "", end_date: windowEnd || "", cap: "" },
          ])
        }
      >
        <Plus data-icon="inline-start" />
        Add profile
      </Button>
    </div>
  );
}

export function ProjectExtensionsSection({
  projectId,
  pricingModel,
  currency,
  profiles,
  projectStartDate,
  tjm,
  estimatedDays,
  fixedPrice,
  projectEndDate,
  busy,
  onChanged,
  onProjectPatched,
  numberOffset = 0,
}: {
  projectId: string;
  pricingModel: string;
  currency: string;
  /** The contract's initial pricing lines — prefilled into new extensions. */
  profiles: PricingLine[];
  /** Initial contract window start — its lines bill from this date. */
  projectStartDate: string | null;
  /** Project defaults prefilled into the add form. */
  tjm: number | null;
  estimatedDays: number | null;
  fixedPrice: number | null;
  projectEndDate: string | null;
  busy: boolean;
  /** Called after any mutation so the parent reloads its project snapshot. */
  onChanged: () => void;
  /** Called when the section patches the project row itself (adopt end date). */
  onProjectPatched: (patch: {
    end_date: string | null;
    updated_at: string;
  }) => void;
  /**
   * Display index of the first extension — the project page models the
   * initial contract as row 1, so its extensions start at 2.
   */
  numberOffset?: number;
}) {
  const [extensions, setExtensions] = useState<ProjectExtension[] | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<ProjectExtension | null>(null);
  // Add-form state. New extensions chain after the latest end date and
  // default to "Proposed" until they are signed, per the reference design.
  const [label, setLabel] = useState("");
  const [status, setStatus] = useState("planned");
  const [endDate, setEndDate] = useState("");
  const [extFixed, setExtFixed] = useState(
    fixedPrice != null ? String(fixedPrice) : "",
  );
  const [notes, setNotes] = useState("");
  // Régie pricing lines of the extension being added — prefilled from the
  // contract lines, each running to the extension end date by default.
  const [lineDrafts, setLineDrafts] = useState<LineDraft[]>([]);
  // Per-extension editor drafts, seeded from the stored lines so text
  // inputs commit on blur instead of per keystroke.
  const [draftsById, setDraftsById] = useState<Record<string, LineDraft[]>>({});
  const isRegie = pricingModel === "regie";

  useEffect(() => {
    let cancelled = false;
    loadProjectExtensions(projectId)
      .then((list) => {
        if (!cancelled) setExtensions(list);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Seed drafts for extensions that don't have in-flight edits yet.
  useEffect(() => {
    setDraftsById((prev) => {
      const next: Record<string, LineDraft[]> = {};
      let changed = false;
      for (const ext of extensions || []) {
        const current = prev[ext.id];
        next[ext.id] = current ?? toDrafts(extensionLines(ext));
        if (!current) changed = true;
      }
      return changed || Object.keys(next).length !== Object.keys(prev).length
        ? next
        : prev;
    });
  }, [extensions]);

  async function mutate(
    work: () => Promise<void>,
    success: string,
    /** When true, move the project end date to the furthest signed extension. */
    syncEndDate = false,
  ) {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await work();
      const list = await loadProjectExtensions(projectId);
      setExtensions(list);
      if (syncEndDate) await syncProjectEndDate(list);
      setMessage(success);
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  /**
   * Contract extension rule (sales.md §14): a signed extension extends the
   * contract, so the project end date follows the furthest signed
   * extension end date. Only ever moves forward — manual adjustments and
   * cancellations are never rolled back by a sync.
   */
  async function syncProjectEndDate(list: ProjectExtension[]) {
    let furthest: string | null = null;
    for (const e of list) {
      if (
        e.status === "signed" &&
        e.end_date &&
        (!furthest || e.end_date > furthest)
      ) {
        furthest = e.end_date;
      }
    }
    if (!furthest) return;
    if (projectEndDate && furthest <= projectEndDate) return;
    const stamp = new Date().toISOString();
    const result = await db()
      .from("sales_projects")
      .update({ end_date: furthest, updated_at: stamp })
      .eq("id", projectId)
      .select("id")
      .single();
    if (result.error) throw result.error;
    onProjectPatched({ end_date: furthest, updated_at: stamp });
  }

  /** Patch a single extension row (inline editing). */
  function update(ext: ProjectExtension, patch: Record<string, unknown>) {
    // A signed extension moving its end date extends the contract too.
    const syncs =
      ext.status === "signed" &&
      Object.prototype.hasOwnProperty.call(patch, "end_date");
    void mutate(
      async () => {
        const result = await db()
          .from("sales_project_extensions")
          .update({ ...patch, updated_at: new Date().toISOString() })
          .eq("id", ext.id)
          .select("id")
          .single();
        if (result.error) throw result.error;
      },
      "Extension updated.",
      syncs,
    );
  }

  /** Commit the pricing-line edits of one extension, flat columns in sync. */
  function commitLines(ext: ProjectExtension, drafts: LineDraft[]) {
    const cleaned = cleanLines(drafts);
    setDraftsById((prev) => ({ ...prev, [ext.id]: drafts }));
    update(ext, {
      tjm_profiles: cleaned,
      ...linesToFlat(cleaned, ext.start_date, ext.end_date),
    });
  }

  // The chain anchor for a new extension: the day after the furthest end
  // among the project and its non-cancelled extensions.
  const active = (extensions || []).filter((e) => e.status !== "cancelled");
  let chainEnd = projectEndDate;
  for (const e of active) {
    if (e.end_date && (!chainEnd || e.end_date > chainEnd))
      chainEnd = e.end_date;
  }
  const fromDate = chainEnd ? addDays(chainEnd, 1) : "";

  function openAddForm() {
    setLabel("");
    setStatus("planned");
    setNotes("");
    setExtFixed(fixedPrice != null ? String(fixedPrice) : "");
    // Suggest three months out, like the reference design; the new lines
    // run to that date by default (full extension period per line).
    const suggested = fromDate ? addMonths(fromDate, 3) : "";
    setEndDate(suggested);
    setLineDrafts(
      profiles.length
        ? profiles.map((p) => ({
            name: p.name,
            tjm: String(p.tjm),
            end_date: suggested,
            cap:
              p.max_billable_days_per_year != null
                ? String(p.max_billable_days_per_year)
                : "",
          }))
        : [
            {
              name: "",
              tjm: tjm != null ? String(tjm) : "",
              end_date: suggested,
              cap: "",
            },
          ],
    );
    setAdding(true);
  }

  const addLines = cleanLines(lineDrafts);
  const addDaysTotal = linesDays(addLines, fromDate, endDate || null);
  // Preview value: per-line rate × capped open days — the same rule the
  // project page and dashboards use once the extension is saved.
  const addAmount = linesCappedAmount(addLines, fromDate, endDate || null);

  // Not a real <form>: this section renders inside the project edit form
  // (nested forms are dropped by the parser, which would submit the project
  // instead). Submission is driven by the button click / Enter key below.
  function add(e?: FormEvent) {
    e?.preventDefault();
    if (
      !isRegie &&
      (extFixed.trim() === "" || Number.isNaN(Number(extFixed)))
    ) {
      setError("Enter a forfait amount for the extension.");
      return;
    }
    if (isRegie && (addLines.length === 0 || addDaysTotal === 0)) {
      setError(
        "Add at least one profile line with a rate and an end date inside the extension period.",
      );
      return;
    }
    const flat = isRegie
      ? linesToFlat(addLines, fromDate, endDate || null)
      : { estimated_days: null, tjm: null };
    const values = {
      project_id: projectId,
      label: label.trim(),
      pricing_model: pricingModel,
      currency,
      tjm: isRegie ? flat.tjm : null,
      estimated_days: isRegie ? flat.estimated_days : null,
      fixed_price: isRegie ? null : Number(extFixed || 0),
      tjm_profiles: isRegie ? addLines : [],
      status,
      start_date: fromDate || null,
      end_date: endDate || null,
      notes: notes.trim(),
      updated_at: new Date().toISOString(),
    };
    void mutate(
      async () => {
        const result = await db()
          .from("sales_project_extensions")
          .insert(values)
          .select("id")
          .single();
        if (result.error) throw result.error;
      },
      "Extension added.",
      status === "signed",
    );
    setAdding(false);
  }

  function setExtensionStatus(ext: ProjectExtension, next: string) {
    void mutate(
      async () => {
        const result = await db()
          .from("sales_project_extensions")
          .update({ status: next, updated_at: new Date().toISOString() })
          .eq("id", ext.id)
          .select("id")
          .single();
        if (result.error) throw result.error;
      },
      "Extension updated.",
      next === "signed",
    );
  }

  /** Delete asks first (AlertDialog); deleteExtension runs on confirm. */
  function remove(ext: ProjectExtension) {
    setDeleting(ext);
  }

  function deleteExtension(ext: ProjectExtension) {
    void mutate(async () => {
      const result = await db()
        .from("sales_project_extensions")
        .delete()
        .eq("id", ext.id)
        .select("id")
        .single();
      if (result.error) throw result.error;
    }, "Extension deleted.");
  }

  /** Push the extension end date onto the project, e.g. after a renewal. */
  function adoptEndDate(ext: ProjectExtension) {
    if (!ext.end_date) return;
    const stamp = new Date().toISOString();
    void mutate(
      async () => {
        const result = await db()
          .from("sales_projects")
          .update({ end_date: ext.end_date, updated_at: stamp })
          .eq("id", projectId)
          .select("id")
          .single();
        if (result.error) throw result.error;
        onProjectPatched({ end_date: ext.end_date, updated_at: stamp });
      },
      `Project end date moved to ${shortDate(ext.end_date)}.`,
    );
  }

  // ── Valuation breakdown (initial + extensions, signed vs proposed) ──
  const signedExts = active.filter(isActiveExtension);
  const signedDays = signedExts
    .filter((e) => e.pricing_model === "regie")
    .reduce((sum, e) => sum + Number(e.estimated_days ?? 0), 0);

  const baseAmount = isRegie
    ? // Initial contract value: per-line rate × capped open days between
      // the project dates — not the flat tjm × estimated_days product.
      linesCappedAmount(profiles, projectStartDate, projectEndDate)
    : Number(fixedPrice ?? 0);
  const profileNames = profiles.map((p) => p.name).filter(Boolean);
  const lines = active.length
    ? [
        {
          label: isRegie
            ? `Initial · ${Number(estimatedDays ?? 0)} days${profileNames.length ? ` · ${profileNames.join(", ")}` : ""}`
            : "Initial · Forfait",
          value: money(baseAmount, currency),
        },
        ...active.map((ext, i) => {
          const proposed = ext.status !== "signed";
          const suffix = proposed ? " (proposed)" : "";
          if (ext.pricing_model === "regie") {
            const names = extensionLines(ext)
              .map((l) => l.name)
              .filter(Boolean);
            return {
              label: `Extension ${i + 1}${suffix} · ${Number(ext.estimated_days ?? 0)} days${names.length ? ` · ${names.join(", ")}` : ""}`,
              value: money(extensionValue(ext), ext.currency),
            };
          }
          return {
            label: `Extension ${i + 1}${suffix} · Forfait`,
            value: money(Number(ext.amount), ext.currency),
          };
        }),
      ]
    : [];
  const signedTotal =
    baseAmount + signedExts.reduce((sum, e) => sum + extensionValue(e), 0);
  const proposedTotal = active
    .filter((e) => e.status !== "signed")
    .reduce((sum, e) => sum + extensionValue(e), 0);
  const totalLabel = proposedTotal
    ? `Signed value · +${money(proposedTotal, currency)} more if proposed extensions are signed`
    : "Estimated value";

  return (
    <div className="flex flex-col gap-3.5">
      <PageAlerts error={error} message={message} />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-[1_1_16rem] flex-col gap-1">
          <h3 className="m-0 font-heading text-xl leading-tight font-medium tracking-[-0.02em]">
            Extensions
          </h3>
          <p className="m-0 text-sm text-muted-foreground">
            Each renewal adds days and carries its own annex. Signing one moves
            the project end date automatically.
          </p>
        </div>
        {!adding && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="flex-none"
            disabled={busy || saving}
            onClick={openAddForm}
          >
            <Plus data-icon="inline-start" />
            Add extension
          </Button>
        )}
      </div>

      {extensions === null && (
        <p className="m-0 text-[13px] text-muted-foreground">Loading…</p>
      )}
      {extensions !== null && !extensions.length && !adding && (
        <p className="m-0 text-[13px] text-muted-foreground">
          No extensions yet — add one when the contract is renewed.
        </p>
      )}

      {extensions?.map((ext, i) => {
        const cancelled = ext.status === "cancelled";
        const signed = ext.status === "signed";
        const extIsRegie = ext.pricing_model === "regie";
        const canAdopt =
          signed &&
          !!ext.end_date &&
          (!projectEndDate || ext.end_date > projectEndDate);
        return (
          <div
            key={ext.id}
            className={cn(EXT_CARD, cancelled && "opacity-55")}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <ExtensionId index={i + 1 + numberOffset}>
                <span className="font-semibold">Extension {i + 1}</span>
                {ext.label && (
                  <span className="truncate text-muted-foreground">{ext.label}</span>
                )}
                <span className="text-muted-foreground">
                  From {shortDate(ext.start_date)}
                </span>
                <ExtensionBadge status={ext.status} />
              </ExtensionId>
              <div className="flex flex-wrap items-center gap-2">
                {canAdopt && (
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    disabled={saving || busy}
                    title="Move the project end date to this extension's end date"
                    onClick={() => adoptEndDate(ext)}
                  >
                    <CalendarPlus data-icon="inline-start" />
                    Extend project to {shortDate(ext.end_date)}
                  </Button>
                )}
                {cancelled ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    disabled={saving || busy}
                    onClick={() => setExtensionStatus(ext, "planned")}
                  >
                    <RotateCcw data-icon="inline-start" />
                    Restore
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="hover:text-destructive"
                    aria-label={`Delete extension ${i + 1 + numberOffset}`}
                    title="Delete extension"
                    disabled={saving || busy}
                    onClick={() => remove(ext)}
                  >
                    <Trash2 />
                  </Button>
                )}
              </div>
            </div>

            {!cancelled && (
              <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3.5">
                <Field label="New end date">
                  <DateField
                    value={ext.end_date || ""}
                    min={ext.start_date || undefined}
                    onChange={(value) =>
                      update(ext, { end_date: value || null })
                    }
                  />
                </Field>
                {extIsRegie ? (
                  <Field label="Pricing lines" as="div" wide>
                    <LinesEditor
                      lines={
                        draftsById[ext.id] ?? toDrafts(extensionLines(ext))
                      }
                      windowStart={ext.start_date}
                      windowEnd={ext.end_date}
                      currency={ext.currency}
                      disabled={saving || busy}
                      onCommit={(next) => commitLines(ext, next)}
                    />
                  </Field>
                ) : (
                  <Field label="Amount">
                    <CommitNumber
                      value={
                        ext.fixed_price != null ? Number(ext.fixed_price) : null
                      }
                      min={0}
                      step={100}
                      disabled={saving || busy}
                      onCommit={(next) => update(ext, { fixed_price: next })}
                    />
                  </Field>
                )}
                <Field label="Status" as="div">
                  <StatusSwitch
                    signed={signed}
                    disabled={saving || busy}
                    onSigned={() => !signed && setExtensionStatus(ext, "signed")}
                    onProposed={() => signed && setExtensionStatus(ext, "planned")}
                  />
                </Field>
              </div>
            )}

            {ext.notes && (
              <div className="text-[13px] whitespace-pre-wrap text-muted-foreground">
                {ext.notes}
              </div>
            )}
          </div>
        );
      })}

      {adding && (
        <div
          className={EXT_CARD}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              (e.target as HTMLElement).tagName !== "TEXTAREA"
            ) {
              e.preventDefault();
              add();
            }
          }}
        >
          <ExtensionId index={(extensions?.length || 0) + 1 + numberOffset}>
            <span className="font-semibold">New extension</span>
            {fromDate && (
              <span className="text-muted-foreground">From {shortDate(fromDate)}</span>
            )}
          </ExtensionId>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3.5">
            <Field label="Label (optional)">
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={200}
                placeholder="Renewal 2026, Phase 2…"
              />
            </Field>
            <Field label="New end date">
              <DateField
                value={endDate}
                min={fromDate || undefined}
                onChange={setEndDate}
              />
            </Field>
            {isRegie ? (
              <Field label="Pricing lines" as="div" wide>
                <LinesEditor
                  lines={lineDrafts}
                  windowStart={fromDate || null}
                  windowEnd={endDate || null}
                  currency={currency}
                  disabled={saving || busy}
                  onCommit={setLineDrafts}
                />
              </Field>
            ) : (
              <Field label="Forfait">
                <Input
                  type="number"
                  className={NUMBER_INPUT}
                  min={0}
                  step={100}
                  value={extFixed}
                  onChange={(e) => setExtFixed(e.target.value)}
                />
              </Field>
            )}
            <Field label="Status" as="div">
              <StatusSwitch
                signed={status === "signed"}
                onSigned={() => setStatus("signed")}
                onProposed={() => setStatus("planned")}
              />
            </Field>
          </div>
          <Field label="Notes">
            <Textarea
              className="min-h-16 text-sm md:text-sm"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={5000}
              placeholder="Renewal terms, indexation…"
            />
          </Field>
          {isRegie && (
            <div className="flex items-baseline justify-between gap-2 text-[13px] text-muted-foreground tabular-nums">
              <span>
                Extension value · {addLines.length} profile
                {addLines.length === 1 ? "" : "s"} · {addDaysTotal} days
              </span>
              <strong className="num font-medium text-foreground">
                {money(addAmount, currency)}
              </strong>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saving || busy}
              onClick={() => setAdding(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={saving || busy}
              onClick={() => add()}
            >
              Add extension
            </Button>
          </div>
        </div>
      )}

      {!!lines.length && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 px-4 py-4 md:px-[18px]">
          {lines.map((l, i) => (
            <div
              key={i}
              className="flex justify-between gap-4 text-[13px] text-muted-foreground"
            >
              <span>{l.label}</span>
              <span className="num whitespace-nowrap">{l.value}</span>
            </div>
          ))}
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pt-1">
            <span className="text-sm text-muted-foreground">{totalLabel}</span>
            <span className="num font-heading text-2xl font-medium tracking-[-0.02em] whitespace-nowrap">
              {money(signedTotal, currency)}
            </span>
          </div>
        </div>
      )}

      <AlertDialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete extension “{deleting?.label || "Extension"}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The renewal and its pricing lines are removed. The project end
              date and staffing are not rolled back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const target = deleting;
                setDeleting(null);
                if (target) deleteExtension(target);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
