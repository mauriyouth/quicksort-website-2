import { useEffect, useRef, useState } from "react";
import type { DocumentTypeRecord } from "@quicksort/hr-db";

/** Searchable type picker: typing “carte vitale” surfaces “Carte Vitale”.
 * The picked code travels through the parent state; blur reverts stray text
 * to the picked label. Disabled (renewals) renders the locked type as text. */
export function TypeSearchField({
  types,
  value,
  disabled,
  onChange,
}: {
  types: Pick<DocumentTypeRecord, "code" | "label">[];
  value: string;
  disabled?: boolean;
  onChange: (code: string) => void;
}) {
  const labelOf = (code: string) => types.find(t => t.code === code)?.label ?? "";
  const [query, setQuery] = useState(labelOf(value));
  const [filtering, setFiltering] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const needle = query.trim().toLowerCase();
  const matches = filtering && needle
    ? types.filter(t => t.label.toLowerCase().includes(needle) || t.code.toLowerCase().includes(needle))
    : types;
  const pickType = (code: string) => {
    onChange(code);
    setQuery(labelOf(code));
    setFiltering(false);
    setOpen(false);
  };

  // Follow an external value change (preset from a checklist entry) unless the user is mid-filter.
  useEffect(() => {
    if (!filtering) setQuery(labelOf(value));
  }, [value, types]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open) listRef.current?.children[highlight]?.scrollIntoView({ block: "nearest" });
  }, [open, highlight]);

  if (disabled) return <input value={labelOf(value)} readOnly disabled aria-label="Type" />;

  return (
    <div className="doc-search-anchor">
      <input
        type="text"
        role="combobox"
        aria-label="Type"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls="doc-type-listbox"
        value={query}
        placeholder="Search a document type…"
        autoComplete="off"
        onFocus={e => {
          e.currentTarget.select();
          setHighlight(Math.max(0, matches.findIndex(t => t.code === value)));
          setOpen(true);
        }}
        onChange={e => {
          setQuery(e.target.value);
          setFiltering(true);
          setHighlight(0);
          setOpen(true);
        }}
        onBlur={() => {
          setOpen(false);
          setFiltering(false);
          setQuery(labelOf(value));
        }}
        onKeyDown={e => {
          if (e.key === "Escape" && open) {
            e.stopPropagation();
            setOpen(false);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setHighlight(index => Math.min(index + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight(index => Math.max(index - 1, 0));
          } else if (e.key === "Enter" && open && matches[highlight]) {
            e.preventDefault();
            pickType(matches[highlight].code);
          }
        }}
      />
      {open && (
        <ul className="doc-search-list" id="doc-type-listbox" role="listbox" ref={listRef}>
          {matches.length ? matches.map((t, index) => (
            <li key={t.code} role="option" aria-selected={t.code === value} className={index === highlight ? "on" : ""}
              onMouseDown={e => {
                e.preventDefault();
                pickType(t.code);
              }}
              onMouseEnter={() => setHighlight(index)}>
              {t.label}
            </li>
          )) : <li className="doc-search-empty">No match for “{query.trim()}”.</li>}
        </ul>
      )}
    </div>
  );
}
