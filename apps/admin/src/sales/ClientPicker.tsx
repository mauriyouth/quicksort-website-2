import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import type { SalesClient } from "./data";

/**
 * Searchable client picker — a filter-as-you-type field with a dropdown,
 * replacing a long <select> in the project/person dialogs. The chosen id
 * still travels through the form as the hidden client_id input, so submit
 * handlers just read FormData; the visible input carries the required
 * validation via setCustomValidity since hidden inputs can't.
 */
export function ClientPicker({
  clients,
  value,
  onChange,
  required,
}: {
  clients: SalesClient[];
  value: string;
  onChange: (id: string) => void;
  required?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const selected = clients.find((c) => c.id === value);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? clients.filter((c) => c.name.toLowerCase().includes(q))
      : clients;
    return list.slice(0, 8);
  }, [clients, query]);

  // Hidden inputs are barred from constraint validation — report "select a
  // client" through the visible field instead.
  useEffect(() => {
    inputRef.current?.setCustomValidity(
      value || !required ? "" : "Select a client.",
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
    <div className="client-picker" ref={rootRef}>
      <div className="client-picker-well">
        {selected && (
          <span className="client-picker-chip">
            {selected.name}
            <button
              type="button"
              aria-label="Clear client"
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
          aria-controls="client-picker-list"
          aria-autocomplete="list"
          aria-activedescendant={
            open && results[highlight]
              ? `client-option-${results[highlight].id}`
              : undefined
          }
          placeholder="Search a client…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onFocus={() => {
            if (selected && !query) setQuery(selected.name);
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
      <input type="hidden" name="client_id" value={value} />
      {open && (
        <ul className="client-picker-list" role="listbox" id="client-picker-list">
          {results.length ? (
            results.map((c, i) => (
              <li key={c.id}>
                <button
                  type="button"
                  id={`client-option-${c.id}`}
                  role="option"
                  aria-selected={c.id === value}
                  className={i === highlight ? "on" : ""}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => pick(c.id)}
                >
                  {c.name}
                </button>
              </li>
            ))
          ) : (
            <li className="client-picker-empty">No client matches</li>
          )}
        </ul>
      )}
    </div>
  );
}
