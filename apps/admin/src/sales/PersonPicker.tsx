import { useEffect, useRef } from "react";
import { SearchCombobox } from "../SearchCombobox";
import type { Person } from "../hr/domain";

const personId = (p: Person) => p.id;
const personName = (p: Person) => p.full_name;

/**
 * Searchable person picker (the shared SearchCombobox on the package
 * Combobox), replacing a long <select> when linking a talent-pool person to
 * an opportunity. The chosen id still travels through the form as the hidden
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
  const inputRef = useRef<HTMLInputElement>(null);

  // Hidden inputs are barred from constraint validation — report "select a
  // person" through the visible field instead.
  useEffect(() => {
    inputRef.current?.setCustomValidity(value || !required ? "" : "Select a person.");
  }, [value, required]);

  return (
    <>
      <SearchCombobox
        items={people}
        getId={personId}
        getLabel={personName}
        matches={(p, q) =>
          p.full_name.toLowerCase().includes(q) ||
          p.headline.toLowerCase().includes(q) ||
          p.location.toLowerCase().includes(q)
        }
        renderItem={(p) => (
          <span className="flex min-w-0 flex-col">
            <span className="truncate">{p.full_name}</span>
            {(p.headline || p.location) && (
              <span className="truncate text-xs text-muted-foreground">
                {[p.headline, p.location].filter(Boolean).join(" · ")}
              </span>
            )}
          </span>
        )}
        value={value}
        onPick={onChange}
        onClear={() => {
          onChange("");
          inputRef.current?.focus();
        }}
        clearLabel="Clear person"
        placeholder="Search the talent pool…"
        emptyText={() => "No one in the talent pool matches"}
        limit={8}
        inputRef={inputRef}
      />
      <input type="hidden" name="person_id" value={value} />
    </>
  );
}
