import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, X } from "lucide-react";
import { Calendar, Popover, PopoverContent, PopoverTrigger } from "@quicksort-sas/ui";
import { cn } from "cn";
import { atNoon, isOutOfRange, parseISO, toISO } from "./date-field-calendar";

/**
 * Design-system date picker, shared across the admin app: the
 * @quicksort-sas/ui date-picker pattern (a Popover around the package
 * Calendar). When `name` is given, a hidden input keeps the `YYYY-MM-DD`
 * contract with the parent <form>, so submit handlers are unchanged.
 *
 * Supports both modes:
 *  - uncontrolled: `defaultValue` + `name` (form submissions)
 *  - controlled: `value` + `onChange` (filters, live state)
 *
 * Keyboard: Enter/Space/ArrowDown on the field opens the calendar on the
 * picked day (or today, clamped to min/max); arrows, Home/End and
 * PageUp/PageDown move inside it, Enter picks, Escape closes.
 *
 * The `date-field-root` / `date-field-trigger` class names stay as hooks for
 * hosts that size the field (e.g. the invoicing filters).
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

const DAY_FMT: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
};

const monthOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);

/** Same chrome as the package DatePicker trigger (h-10, input border, focus ring). */
const TRIGGER =
  "date-field-trigger inline-flex h-10 w-full min-w-0 items-center gap-2.5 rounded-lg border border-input bg-transparent px-3 text-left text-[15px] text-foreground transition-[border-color,box-shadow] duration-150 outline-none select-none hover:border-[color-mix(in_srgb,var(--input),var(--foreground)_35%)] focus-visible:border-foreground focus-visible:ring-2 focus-visible:ring-ring/15 data-[popup-open]:border-foreground disabled:pointer-events-none disabled:opacity-45 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground";

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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [month, setMonth] = useState<Date>(() => monthOf(selected ?? new Date()));

  useEffect(() => {
    if (isControlled) setSelected(parseISO(value || "") ?? null);
  }, [isControlled, value]);

  const minDate = useMemo(() => {
    const d = min ? parseISO(min) : null;
    return d ? atNoon(d) : null;
  }, [min]);
  const maxDate = useMemo(() => {
    const d = max ? parseISO(max) : null;
    return d ? atNoon(d) : null;
  }, [max]);

  const openPicker = () => {
    // Open on the picked day, or today, kept inside min/max.
    let anchor = atNoon(selected ?? new Date());
    if (minDate && isOutOfRange(anchor, minDate, null)) anchor = minDate;
    if (maxDate && isOutOfRange(anchor, null, maxDate)) anchor = maxDate;
    setMonth(monthOf(anchor));
    setOpen(true);
  };

  const pick = (date: Date | undefined) => {
    if (!date) return;
    const d = atNoon(date);
    setSelected(d);
    setMonth(monthOf(d));
    setOpen(false);
    onChange?.(toISO(d));
  };

  const clear = () => {
    setSelected(null);
    triggerRef.current?.focus();
    onChange?.("");
  };

  const disabledDays = [
    ...(minDate ? [{ before: minDate }] : []),
    ...(maxDate ? [{ after: maxDate }] : []),
  ];
  const clearable = !!selected && !required;

  return (
    <div className="date-field-root relative w-full min-w-0">
      {/* Keeps the form contract: YYYY-MM-DD submitted under `name`. */}
      {name && (
        <input type="hidden" name={name} value={selected ? toISO(selected) : ""} readOnly />
      )}
      <Popover open={open} onOpenChange={(next) => (next ? openPicker() : setOpen(false))}>
        <PopoverTrigger
          ref={triggerRef}
          type="button"
          aria-label={ariaLabel}
          className={cn(TRIGGER, clearable && "pr-9")}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && !open) {
              e.preventDefault();
              openPicker();
            }
          }}
        >
          <CalendarDays aria-hidden />
          <span className={cn("min-w-0 flex-1 truncate", selected ? "num" : "text-muted-foreground")}>
            {selected ? selected.toLocaleDateString(undefined, DAY_FMT) : placeholder}
          </span>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto gap-0 overflow-hidden p-0">
          <Calendar
            mode="single"
            required
            selected={selected ?? undefined}
            onSelect={pick}
            month={month}
            onMonthChange={setMonth}
            startMonth={minDate ?? undefined}
            endMonth={maxDate ?? undefined}
            disabled={disabledDays}
            weekStartsOn={1}
            autoFocus
          />
        </PopoverContent>
      </Popover>
      {clearable && (
        <button
          type="button"
          aria-label="Clear date"
          tabIndex={-1}
          onClick={clear}
          className="absolute top-1/2 right-2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}
