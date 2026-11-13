import type { DocumentTypeRecord } from "@quicksort/hr-db";
import { Input } from "@quicksort-sas/ui";
import { SearchCombobox } from "../SearchCombobox";

type TypeOption = Pick<DocumentTypeRecord, "code" | "label">;
const typeCode = (t: TypeOption) => t.code;
const typeLabel = (t: TypeOption) => t.label;

/** Searchable type picker: typing “carte vitale” surfaces “Carte Vitale”.
 * The picked code travels through the parent state; closing the list reverts
 * stray text to the picked label. Disabled (renewals) renders the locked
 * type as read-only text. The `doc-search-anchor` class stays as a sizing
 * hook for hosts (the portal's add-a-document controls). */
export function TypeSearchField({
  types,
  value,
  disabled,
  onChange,
}: {
  types: TypeOption[];
  value: string;
  disabled?: boolean;
  onChange: (code: string) => void;
}) {
  const label = types.find((t) => t.code === value)?.label ?? "";
  if (disabled) return <Input value={label} readOnly disabled aria-label="Type" />;
  return (
    <div className="doc-search-anchor min-w-0">
      <SearchCombobox
        items={types}
        getId={typeCode}
        getLabel={typeLabel}
        matches={(t, q) => t.label.toLowerCase().includes(q) || t.code.toLowerCase().includes(q)}
        value={value}
        onPick={onChange}
        placeholder="Search a document type…"
        emptyText={(query) => `No match for "${query}".`}
        selectOnFocus
        aria-label="Type"
      />
    </div>
  );
}
