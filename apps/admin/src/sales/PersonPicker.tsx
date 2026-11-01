import { useEffect, useId, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import type { Person } from "../hr/domain";

/**
 * Searchable person picker — a filter-as-you-type field with a dropdown,
 * replacing a long <select> when linking a talent-pool person to an
 * opportunity. The chosen id still travels through the form as the hidden
 * person_id input, so submit handlers just read FormData; the visible input
 * carries the required validation via setCustomValidity since hidden inputs
 * can't.
 */
export function PersonPicker({
  people,
  value,
  onChange,
  required,
}: {
  people: Person[];
  value: string;
  onChange: (id: string) => void;
  required?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const selected = people.find((p) => p.id === value);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? people.filter(
          (p) =>
            p.full_name.toLowerCase().includes(q) ||
            p.headline.toLowerCase().includes(q) ||
            p.location.toLowerCase().includes(q),
        )
      : people;
    return list.slice(0, 8);
  }, [people, query]);

  // Hidden inputs are barred from constraint validation — report "select a
  // person" through the visible field instead.
  useEffect(() => {
    inputRef.current?.setCustomValidity(
      value || !required ? "" : "Select a person.",
    );
  }, [value, required]);

  // Close the dropdown on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function pick(id: string) {
    onChange(id);
    setQuery("");
    setOpen(false);
    inputRef.current?.focus();
  }

  return (
    <div className="person-picker" ref={rootRef}>
      <div className="person-picker-well">
        {selected && (
          <span className="person-picker-chip">
            {selected.full_name}
            <button
              type="button"
              aria-label="Clear person"
              onClick={() => {
                onChange("");
                setQuery("");
                inputRef.current?.focus();
              }}
            >
              <X size={13} />
            </button>
          </span>
        )}
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && results[highlight]
              ? `${listId}-option-${results[highlight].id}`
              : undefined
          }
          placeholder="Search the talent pool…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onFocus={() => {
            if (selected && !query) setQuery(selected.full_name);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              // Don't let the dialog's own Escape handler close the whole popup.
              e.stopPropagation();
              setOpen(false);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlight((h) => Math.min(h + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((h) => Math.max(h - 1, 0));
            } else if (e.key === "Enter" && open && results[highlight]) {
              e.preventDefault();
              pick(results[highlight].id);
            }
          }}
        />
      </div>
      <input type="hidden" name="person_id" value={value} />
      {open && (
        <ul className="person-picker-list" role="listbox" id={listId}>
          {results.length ? (
            results.map((p, i) => (
              <li key={p.id}>
                <button
                  type="button"
                  id={`${listId}-option-${p.id}`}
                  role="option"
                  aria-selected={p.id === value}
                  className={i === highlight ? "on" : ""}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => pick(p.id)}
                >
                  <span className="person-picker-option">
                    <span>{p.full_name}</span>
                    {(p.headline || p.location) && (
                      <span className="person-picker-option-meta">
                        {[p.headline, p.location].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))
          ) : (
            <li className="person-picker-empty">No one in the talent pool matches</li>
          )}
        </ul>
      )}
    </div>
  );
}
