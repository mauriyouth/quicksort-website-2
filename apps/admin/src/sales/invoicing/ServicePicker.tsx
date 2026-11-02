import { useEffect, useId, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import type { ProviderProduct } from "./types";

const vatLabel = (p: ProviderProduct) => `VAT ${Math.round(Number(p.vatRate) * 1000) / 10} %`;

/**
 * Searchable Qonto service picker for the Settings → Services mapping —
 * filter-as-you-type over title and description, replacing a long <select>.
 * Picking (or clearing) calls onChange straight away; there is no form.
 * Reuses the ClientPicker styles from sales.css.
 */
export function ServicePicker({
  products,
  value,
  missingLabel,
  disabled,
  onChange,
}: {
  products: ProviderProduct[];
  value: string;
  /** Label for a linked service that no longer exists in Qonto. */
  missingLabel?: string;
  disabled?: boolean;
  onChange: (id: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const selected = products.find((p) => p.id === value);
  const chip = selected ? selected.title : value ? `${missingLabel || value} (not found in Qonto)` : "";

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? products.filter((p) => p.title.toLowerCase().includes(q) || p.description.toLowerCase().includes(q))
      : products;
  }, [products, query]);

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
    setQuery("");
    setOpen(false);
    if (id !== value) onChange(id);
  }

  return (
    <div className="client-picker" ref={rootRef}>
      <div className="client-picker-well">
        {chip && (
          <span className="client-picker-chip" title={chip}>
            {chip}
            {!disabled && (
              <button type="button" aria-label="Remove service link" onClick={() => pick("")}>
                <X size={13} />
              </button>
            )}
          </span>
        )}
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && results[highlight] ? `${listId}-${highlight}` : undefined}
          placeholder={chip ? "Change service…" : "Search a Qonto service…"}
          value={query}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setHighlight((h) => Math.min(h + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((h) => Math.max(h - 1, 0));
            } else if (e.key === "Enter" && open && results[highlight]) {
              e.preventDefault();
              pick(results[highlight].id);
              inputRef.current?.blur();
            }
          }}
        />
      </div>
      {open && !disabled && (
        <ul className="client-picker-list" role="listbox" id={listId}>
          {results.length ? (
            results.map((p, i) => (
              <li key={p.id}>
                <button
                  type="button"
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={p.id === value}
                  className={i === highlight ? "on" : ""}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => pick(p.id)}
                >
                  {p.title} · {vatLabel(p)}
                </button>
              </li>
            ))
          ) : (
            <li className="client-picker-empty">No service matches</li>
          )}
        </ul>
      )}
    </div>
  );
}
