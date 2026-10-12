import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";

/**
 * Design-system date picker, shared across the admin app.
 *
 * Renders a field that matches `.qs-input` (border, radius, padding, focus
 * ring) and opens a token-styled calendar popover. When `name` is given, a
 * hidden input keeps the `YYYY-MM-DD` contract with the parent <form>, so
 * submit handlers are unchanged.
 *
 * Supports both modes:
 *  - uncontrolled: `defaultValue` + `name` (form submissions)
 *  - controlled: `value` + `onChange` (filters, live state)
 */

type Props = {
  /** Form field name. When omitted, no hidden input is rendered. */
  name?: string;
  /** Initial `YYYY-MM-DD` value (uncontrolled mode). */
  defaultValue?: string | null;
  /** Controlled `YYYY-MM-DD` value. When provided, the parent owns the date. */
  value?: string;
  required?: boolean;
  placeholder?: string;
  /** Earliest selectable day, `YYYY-MM-DD`. Earlier days are disabled. */
  min?: string;
  /** Latest selectable day, `YYYY-MM-DD`. Later days are disabled. */
  max?: string;
  /** Called with the picked `YYYY-MM-DD` value (or "" when cleared). */
  onChange?: (value: string) => void;
  /** Accessible label for the trigger button. */
  "aria-label"?: string;
};

function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseISO(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const atNoon = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);

const MONTH_FMT: Intl.DateTimeFormatOptions = { month: "long", year: "numeric" };
const DAY_FMT: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
};

/** Monday-first calendar cells for the visible month, 6 weeks padded. */
function buildCells(view: Date): Date[] {
  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7; // Mon=0 … Sun=6
  const start = new Date(view.getFullYear(), view.getMonth(), 1 - lead, 12);
  return Array.from(
    { length: 42 },
    (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
  );
}

const shiftDays = (d: Date, days: number) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);

export function DateField({
  name,
  defaultValue,
  value,
  required,
  placeholder = "Pick a date",
  min,
  max,
  onChange,
  "aria-label": ariaLabel,
}: Props) {
  const isControlled = value !== undefined;
  const [selected, setSelected] = useState<Date | null>(
    () => parseISO((isControlled ? value : defaultValue) || "") ?? null,
  );
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<Date>(
    () => selected ?? new Date(),
  );
  // Roving-tabindex focus date inside the grid (tracked, not derived from
  // the DOM, so arrow keys stay correct across month transitions).
  const [focusDate, setFocusDate] = useState<Date | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isControlled) setSelected(parseISO(value || "") ?? null);
  }, [isControlled, value]);

  const today = useMemo(() => atNoon(new Date()), []);
  const cells = useMemo(() => buildCells(view), [view]);
  const weekdays = useMemo(
    // Column headers anchored on a known Monday.
    () =>
      Array.from({ length: 7 }, (_, i) =>
        new Date(2024, 0, 1 + i).toLocaleDateString(undefined, {
          weekday: "short",
        }),
      ),
    [],
  );

  const minDate = useMemo(() => {
    if (!min) return null;
    const d = parseISO(min);
    return d ? atNoon(d) : null;
  }, [min]);
  const maxDate = useMemo(() => {
    if (!max) return null;
    const d = parseISO(max);
    return d ? atNoon(d) : null;
  }, [max]);

  const clampDate = (d: Date): Date => {
    if (minDate && d < minDate) return minDate;
    if (maxDate && d > maxDate) return maxDate;
    return d;
  };

  const isDisabled = (d: Date) =>
    (minDate !== null && d < minDate) || (maxDate !== null && d > maxDate);

  /** True when the given month (0-based) contains at least one enabled day. */
  const monthEnabled = (year: number, month: number) => {
    const first = new Date(year, month, 1, 12);
    const last = new Date(year, month + 1, 0, 12);
    return (
      (minDate === null || last >= minDate) &&
      (maxDate === null || first <= maxDate)
    );
  };

  const canPrev = monthEnabled(view.getFullYear(), view.getMonth() - 1);
  const canNext = monthEnabled(view.getFullYear(), view.getMonth() + 1);

  // Close on click outside.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // When the grid re-renders (month shift, open), move focus to the cell
  // matching focusDate.
  useEffect(() => {
    if (!open || !focusDate) return;
    const cell = gridRef.current?.querySelector<HTMLButtonElement>(
      `[data-date="${toISO(focusDate)}"]`,
    );
    cell?.focus();
  }, [open, focusDate, view]);

  const shiftMonth = (delta: number) => {
    const year = view.getFullYear();
    const month = view.getMonth() + delta;
    if (!monthEnabled(year, month)) return;
    setView(new Date(year, month, 1));
  };

  const openPicker = () => {
    const anchor = clampDate(selected ?? today);
    setView(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
    setFocusDate(anchor);
    setOpen(true);
  };

  const pick = (date: Date) => {
    const d = atNoon(date);
    setSelected(d);
    setView(new Date(d.getFullYear(), d.getMonth(), 1));
    setOpen(false);
    triggerRef.current?.focus();
    onChange?.(toISO(d));
  };

  const clear = () => {
    setSelected(null);
    triggerRef.current?.focus();
    onChange?.("");
  };

  const moveFocus = (from: Date, delta: number) => {
    let next = shiftDays(from, delta);
    // Skip over disabled days, like a native date input does.
    let guard = 0;
    while (isDisabled(atNoon(next)) && guard < 62) {
      next = shiftDays(next, delta);
      guard += 1;
    }
    if (next.getMonth() !== view.getMonth()) {
      setView(new Date(next.getFullYear(), next.getMonth(), 1));
    }
    setFocusDate(next);
  };

  const onDayKeyDown = (e: React.KeyboardEvent, date: Date) => {
    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        moveFocus(date, -1);
        break;
      case "ArrowRight":
        e.preventDefault();
        moveFocus(date, 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        moveFocus(date, -7);
        break;
      case "ArrowDown":
        e.preventDefault();
        moveFocus(date, 7);
        break;
      case "Home":
        e.preventDefault();
        moveFocus(date, -((date.getDay() + 6) % 7));
        break;
      case "End":
        e.preventDefault();
        moveFocus(date, 6 - ((date.getDay() + 6) % 7));
        break;
      case "PageUp":
        e.preventDefault();
        shiftMonth(-1);
        break;
      case "PageDown":
        e.preventDefault();
        shiftMonth(1);
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        pick(date);
        break;
      default:
        break;
    }
  };

  return (
    <div className="date-field-root" ref={rootRef}>
      {/* Keeps the form contract: YYYY-MM-DD submitted under `name`. */}
      {name && (
        <input
          type="hidden"
          name={name}
          value={selected ? toISO(selected) : ""}
          readOnly
        />
      )}
      <div className={`date-field${selected ? "" : " is-empty"}`}>
        <button
          ref={triggerRef}
          type="button"
          className="date-field-trigger"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={ariaLabel}
          onClick={() => (open ? setOpen(false) : openPicker())}
          onKeyDown={(e) => {
            if ((e.key === "ArrowDown" || e.key === "Enter") && !open) {
              e.preventDefault();
              openPicker();
            }
          }}
        >
          <span className="date-field-value">
            {selected
              ? selected.toLocaleDateString(undefined, DAY_FMT)
              : placeholder}
          </span>
          <CalendarDays size={16} aria-hidden />
        </button>
        {selected && !required && (
          <button
            type="button"
            className="date-field-clear"
            aria-label="Clear date"
            tabIndex={-1}
            onClick={clear}
          >
            <X size={13} aria-hidden />
          </button>
        )}
      </div>

      {open && (
        <div
          className="date-popover"
          role="dialog"
          aria-modal="false"
          aria-label={view.toLocaleDateString(undefined, MONTH_FMT)}
        >
          <div className="date-popover-head">
            <button
              type="button"
              className="date-nav"
              aria-label="Previous month"
              disabled={!canPrev}
              onClick={() => shiftMonth(-1)}
            >
              <ChevronLeft size={15} aria-hidden />
            </button>
            <div className="date-month" aria-live="polite">
              {view.toLocaleDateString(undefined, MONTH_FMT)}
            </div>
            <button
              type="button"
              className="date-nav"
              aria-label="Next month"
              disabled={!canNext}
              onClick={() => shiftMonth(1)}
            >
              <ChevronRight size={15} aria-hidden />
            </button>
          </div>
          <div className="date-weekdays">
            {weekdays.map((w, i) => (
              <span key={`${w}-${i}`} aria-hidden>
                {w}
              </span>
            ))}
          </div>
          <div className="date-grid" role="grid" ref={gridRef}>
            {cells.map((date) => (
              <button
                key={toISO(date)}
                type="button"
                data-date={toISO(date)}
                role="gridcell"
                tabIndex={focusDate && sameDay(date, focusDate) ? 0 : -1}
                disabled={isDisabled(date)}
                aria-selected={selected ? sameDay(date, selected) : undefined}
                aria-current={sameDay(date, today) ? "date" : undefined}
                className={[
                  "date-day",
                  date.getMonth() === view.getMonth() ? "" : "is-out",
                  selected && sameDay(date, selected) ? "is-selected" : "",
                  sameDay(date, today) ? "is-today" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => pick(date)}
                onKeyDown={(e) => onDayKeyDown(e, date)}
              >
                {date.getDate()}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
