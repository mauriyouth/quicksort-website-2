import { SearchCombobox } from "../../SearchCombobox";
import type { ProviderProduct } from "./types";

const vatLabel = (p: ProviderProduct) => `VAT ${Math.round(Number(p.vatRate) * 1000) / 10} %`;
const productId = (p: ProviderProduct) => p.id;
const productTitle = (p: ProviderProduct) => p.title;

/**
 * Searchable Qonto service picker for the Settings → Services mapping —
 * filter-as-you-type over title and description (the shared SearchCombobox
 * on the package Combobox), replacing a long <select>. Picking (or clearing)
 * calls onChange straight away; there is no form.
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
  const known = products.some((p) => p.id === value);
  return (
    <SearchCombobox
      items={products}
      getId={productId}
      getLabel={productTitle}
      selectedLabel={value && !known ? `${missingLabel || value} (not found in Qonto)` : undefined}
      matches={(p, q) => p.title.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)}
      renderItem={(p) => `${p.title} · ${vatLabel(p)}`}
      value={value}
      onPick={(id) => {
        if (id !== value) onChange(id);
      }}
      onClear={() => {
        if (value) onChange("");
      }}
      clearLabel="Remove service link"
      placeholder={value ? "Change service…" : "Search a Qonto service…"}
      emptyText={() => "No service matches"}
      disabled={disabled}
    />
  );
}
