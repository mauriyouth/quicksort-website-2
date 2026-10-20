import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import { CalendarPlus, Plus, RotateCcw, Trash2 } from "lucide-react";
import { db, errorMessage, type Row } from "@quicksort/hr-db";
import { Notice } from "@quicksort/hr-ui";
import { money } from "./data";
import { DateField } from "../DateField";
import {
  lineDays,
  linesAmount,
  linesDays,
  storedPricingLines,
  type PricingLine,
} from "./pricing-lines";
import { proratedBillableDays } from "./billable-cap";
import "./project-extensions.css";

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
    <input
      type="number"
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
 * Flat columns kept in sync from the line set, so the generated `amount`
 * column (tjm × estimated_days) and the day budgets on dashboards stay
 * correct: total days = Σ line volumes, tjm = blended rate.
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
  return (
    <div className="pe-lines">
      <div className="pe-lines-head" aria-hidden="true">
        <span>Profile</span>
        <span>Rate</span>
        <span>End date</span>
        <span>Cap / year</span>
        <span className="pe-right">Subtotal</span>
        <span />
      </div>
      {drafts.map((line, i) => {
        const cleaned = cleanLines([line])[0] || {
          name: "",
          tjm: 0,
          end_date: null,
        };
        const value = cleaned.tjm * lineDays(cleaned, windowStart, windowEnd);
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
          <div className="pe-lines-row" key={i}>
            <input
              aria-label={`Profile ${i + 1} name`}
              placeholder="Data Engineer"
              value={line.name}
              maxLength={100}
              disabled={disabled}
              onChange={(e) => set(i, { name: e.target.value })}
              onBlur={() => commit(drafts)}
            />
            <span className="pe-affix">
              <input
                aria-label={`Profile ${i + 1} daily rate`}
                type="number"
                min="0"
                step="10"
                value={line.tjm}
                disabled={disabled}
                onChange={(e) => set(i, { tjm: e.target.value })}
                onBlur={() => commit(drafts)}
              />
              <span className="pe-affix-suffix">
                {currencySymbol(currency)} / day
              </span>
            </span>
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
            <div className="pj-cap-cell">
              <input
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
                <span className="pj-cap-prorata">
                  ≈ {Number.isInteger(capThisYear) ? capThisYear : capThisYear.toFixed(1)} d
                </span>
              )}
            </div>
            <span className="pe-lines-subtotal">{money(value, currency)}</span>
            <button
              type="button"
              className="pe-icon-btn"
              aria-label={`Remove profile ${i + 1}`}
              title={
                drafts.length <= 1
                  ? "An extension needs at least one profile"
                  : "Remove profile"
              }
              disabled={disabled || drafts.length <= 1}
              onClick={() => commit(drafts.filter((_, j) => j !== i))}
            >
              <Trash2 size={14} />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className="pe-lines-add"
        disabled={disabled}
        onClick={() =>
          commit([
            ...drafts,
            { name: "", tjm: "", end_date: windowEnd || "", cap: "" },
          ])
        }
      >
        <Plus size={13} />
        Add profile
      </button>
    </div>
  );
}

export function ProjectExtensionsSection({
  projectId,
  pricingModel,
  currency,
  profiles,
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
  const addAmount = linesAmount(addLines, fromDate, endDate || null);

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

  function remove(ext: ProjectExtension) {
    const name = ext.label || "Extension";
    if (!confirm(`Delete extension “${name}”?`)) return;
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
    ? Number(tjm ?? 0) * Number(estimatedDays ?? 0)
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
              value: money(Number(ext.amount), ext.currency),
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
    baseAmount + signedExts.reduce((sum, e) => sum + Number(e.amount), 0);
  const proposedTotal = active
    .filter((e) => e.status !== "signed")
    .reduce((sum, e) => sum + Number(e.amount), 0);
  const totalLabel = proposedTotal
    ? `Signed value · +${money(proposedTotal, currency)} more if proposed extensions are signed`
    : "Estimated value";

  return (
    <div className="pe-section">
      <Notice error>{error}</Notice>
      <Notice>{message}</Notice>

      <div className="pe-head">
        <div className="pe-head-text">
          <h3 className="pe-title">Extensions</h3>
          <p className="pe-desc">
            Each renewal adds days and carries its own annex. Signing one moves
            the project end date automatically.
          </p>
        </div>
        {!adding && (
          <button
            type="button"
            className="pe-add"
            disabled={busy || saving}
            onClick={openAddForm}
          >
            <Plus size={15} />
            Add extension
          </button>
        )}
      </div>

      {extensions === null && <p className="pe-muted">Loading…</p>}
      {extensions !== null && !extensions.length && !adding && (
        <p className="pe-muted">
          No extensions yet — add one when the contract is renewed.
        </p>
      )}

      {extensions?.map((ext, i) => {
        const cancelled = ext.status === "cancelled";
        const signed = ext.status === "signed";
        const extIsRegie = ext.pricing_model === "regie";
        const statusMeta = EXTENSION_STATUS_META[ext.status] || {
          label: ext.status,
          color: "#8E8E8E",
        };
        const canAdopt =
          signed &&
          !!ext.end_date &&
          (!projectEndDate || ext.end_date > projectEndDate);
        return (
          <div
            key={ext.id}
            className={`pe-ext${cancelled ? " is-cancelled" : ""}`}
          >
            <div className="pe-ext-head">
              <div className="pe-ext-id">
                <span className="pe-ext-index" aria-hidden="true">
                  {i + 1 + numberOffset}
                </span>
                <span className="pe-ext-name">Extension {i + 1}</span>
                {ext.label && <span className="pe-ext-label">{ext.label}</span>}
                <span className="pe-ext-from">
                  From {shortDate(ext.start_date)}
                </span>
                <span
                  className="pe-ext-badge"
                  style={{ "--ext-color": statusMeta.color } as CSSProperties}
                >
                  <span
                    className="pe-ext-badge-dot"
                    style={{ background: statusMeta.color }}
                    aria-hidden="true"
                  />
                  {statusMeta.label}
                </span>
              </div>
              <div className="pe-ext-actions">
                {canAdopt && (
                  <button
                    type="button"
                    className="pe-adopt"
                    disabled={saving || busy}
                    title="Move the project end date to this extension's end date"
                    onClick={() => adoptEndDate(ext)}
                  >
                    <CalendarPlus size={14} />
                    Extend project to {shortDate(ext.end_date)}
                  </button>
                )}
                {cancelled ? (
                  <button
                    type="button"
                    className="pe-restore"
                    disabled={saving || busy}
                    onClick={() => setExtensionStatus(ext, "planned")}
                  >
                    <RotateCcw size={13} />
                    Restore
                  </button>
                ) : (
                  <button
                    type="button"
                    className="pe-icon-btn"
                    aria-label={`Delete extension ${i + 1 + numberOffset}`}
                    title="Delete extension"
                    disabled={saving || busy}
                    onClick={() => remove(ext)}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            </div>

            {!cancelled && (
              <div className="pe-ext-grid">
                <label className="pe-field">
                  <span className="pe-label">New end date</span>
                  <DateField
                    value={ext.end_date || ""}
                    min={ext.start_date || undefined}
                    onChange={(value) =>
                      update(ext, { end_date: value || null })
                    }
                  />
                </label>
                {extIsRegie ? (
                  <div className="pe-field pe-field-wide">
                    <span className="pe-label">Pricing lines</span>
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
                  </div>
                ) : (
                  <label className="pe-field">
                    <span className="pe-label">Amount</span>
                    <CommitNumber
                      value={
                        ext.fixed_price != null ? Number(ext.fixed_price) : null
                      }
                      min={0}
                      step={100}
                      disabled={saving || busy}
                      onCommit={(next) => update(ext, { fixed_price: next })}
                    />
                  </label>
                )}
                <div className="pe-field">
                  <span className="pe-label">Status</span>
                  <div
                    className="pe-seg"
                    role="radiogroup"
                    aria-label="Extension status"
                  >
                    <button
                      type="button"
                      role="radio"
                      aria-checked={signed}
                      className={signed ? "on" : ""}
                      disabled={saving || busy}
                      onClick={() =>
                        !signed && setExtensionStatus(ext, "signed")
                      }
                    >
                      Signed
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={!signed}
                      className={!signed ? "on" : ""}
                      disabled={saving || busy}
                      onClick={() =>
                        signed && setExtensionStatus(ext, "planned")
                      }
                    >
                      Proposed
                    </button>
                  </div>
                </div>
              </div>
            )}

            {ext.notes && <div className="pe-ext-notes">{ext.notes}</div>}
          </div>
        );
      })}

      {adding && (
        <div
          className="pe-form"
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
          <div className="pe-ext-head">
            <div className="pe-ext-id">
              <span className="pe-ext-index" aria-hidden="true">
                {(extensions?.length || 0) + 1 + numberOffset}
              </span>
              <span className="pe-ext-name">New extension</span>
              {fromDate && (
                <span className="pe-ext-from">From {shortDate(fromDate)}</span>
              )}
            </div>
          </div>
          <div className="pe-ext-grid">
            <label className="pe-field">
              <span className="pe-label">Label (optional)</span>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={200}
                placeholder="Renewal 2026, Phase 2…"
              />
            </label>
            <label className="pe-field">
              <span className="pe-label">New end date</span>
              <DateField
                value={endDate}
                min={fromDate || undefined}
                onChange={setEndDate}
              />
            </label>
            {isRegie ? (
              <div className="pe-field pe-field-wide">
                <span className="pe-label">Pricing lines</span>
                <LinesEditor
                  lines={lineDrafts}
                  windowStart={fromDate || null}
                  windowEnd={endDate || null}
                  currency={currency}
                  disabled={saving || busy}
                  onCommit={setLineDrafts}
                />
              </div>
            ) : (
              <label className="pe-field">
                <span className="pe-label">Forfait</span>
                <input
                  type="number"
                  min={0}
                  step={100}
                  value={extFixed}
                  onChange={(e) => setExtFixed(e.target.value)}
                />
              </label>
            )}
            <div className="pe-field">
              <span className="pe-label">Status</span>
              <div
                className="pe-seg"
                role="radiogroup"
                aria-label="Extension status"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={status === "signed"}
                  className={status === "signed" ? "on" : ""}
                  onClick={() => setStatus("signed")}
                >
                  Signed
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={status !== "signed"}
                  className={status !== "signed" ? "on" : ""}
                  onClick={() => setStatus("planned")}
                >
                  Proposed
                </button>
              </div>
            </div>
          </div>
          <label className="pe-field">
            <span className="pe-label">Notes</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={5000}
              placeholder="Renewal terms, indexation…"
            />
          </label>
          {isRegie && (
            <div className="pe-value">
              <span>
                Extension value · {addLines.length} profile
                {addLines.length === 1 ? "" : "s"} · {addDaysTotal} days
              </span>
              <strong>{money(addAmount, currency)}</strong>
            </div>
          )}
          <div className="pe-form-actions">
            <button
              type="button"
              className="pe-btn pe-btn-ghost"
              disabled={saving || busy}
              onClick={() => setAdding(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="pe-btn pe-btn-primary"
              disabled={saving || busy}
              onClick={() => add()}
            >
              Add extension
            </button>
          </div>
        </div>
      )}

      {!!lines.length && (
        <div className="pe-panel">
          {lines.map((l, i) => (
            <div key={i} className="pe-panel-line">
              <span>{l.label}</span>
              <span>{l.value}</span>
            </div>
          ))}
          <div className="pe-panel-total">
            <span className="pe-panel-total-label">{totalLabel}</span>
            <span className="pe-panel-total-amount">
              {money(signedTotal, currency)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
