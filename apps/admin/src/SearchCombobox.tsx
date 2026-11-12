import { useMemo, useState, type ReactNode, type Ref } from "react";
import { X } from "lucide-react";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  InputGroupAddon,
  InputGroupButton,
} from "@quicksort-sas/ui";
import { cn } from "cn";

/**
 * Single-pick search field on the @quicksort-sas/ui Combobox, shared by the
 * admin pickers (client, person, Qonto service, document type).
 *
 * The input shows the picked item's label; typing filters the list, arrows
 * move, Enter or a click picks, Escape closes. Typing never changes the
 * value on its own: closing the list (blur, Escape, outside click) puts the
 * picked label back, and only a pick or the clear button changes the value.
 * Escape on a closed list is left to the host (e.g. a dialog closes) instead
 * of Base UI's default of clearing the value.
 */
export function SearchCombobox<T>({
  items,
  getId,
  getLabel,
  matches,
  value,
  selectedLabel,
  onPick,
  onClear,
  clearLabel,
  renderItem,
  placeholder,
  emptyText,
  limit,
  disabled,
  inputRef,
  selectOnFocus,
  className,
  "aria-label": ariaLabel,
}: {
  items: T[];
  getId: (item: T) => string;
  /** Text shown in the input once the item is picked. */
  getLabel: (item: T) => string;
  /** `query` is trimmed and lower-cased. */
  matches: (item: T, query: string) => boolean;
  /** Picked id, "" for none. */
  value: string;
  /** Overrides the input text for the picked value (e.g. an id missing from `items`). */
  selectedLabel?: string;
  onPick: (id: string) => void;
  /** When given (and a value is picked), an × button clears it. */
  onClear?: () => void;
  clearLabel?: string;
  /** Option content; defaults to the label. */
  renderItem?: (item: T) => ReactNode;
  placeholder?: string;
  emptyText: (query: string) => ReactNode;
  /** Show at most this many matches. */
  limit?: number;
  disabled?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  /** Select the input text on focus, so typing replaces the picked label. */
  selectOnFocus?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const byId = useMemo(() => new Map(items.map((item) => [getId(item), item])), [items, getId]);
  const ids = useMemo(() => items.map(getId), [items, getId]);
  // null: not searching, the input shows the picked label and lists everything.
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const picked = byId.get(value);
  const label = selectedLabel ?? (picked ? getLabel(picked) : "");
  const needle = (query ?? "").trim().toLowerCase();
  const labelOf = (id: string) => {
    if (id === value) return label;
    const item = byId.get(id);
    return item ? getLabel(item) : "";
  };

  return (
    <Combobox<string>
      items={ids}
      value={value || null}
      onValueChange={(id, details) => {
        // Emptying the text or Escape must not drop the pick (see above).
        if (details.reason === "input-clear" || details.reason === "escape-key") return;
        setQuery(null);
        if (id) onPick(id);
      }}
      inputValue={query ?? label}
      onInputValueChange={(next, details) => {
        if (details.reason === "input-change" || details.reason === "input-clear") setQuery(next);
      }}
      open={open && !disabled}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery(null);
      }}
      itemToStringLabel={labelOf}
      filter={(id) => {
        const item = byId.get(id);
        return !!item && (!needle || matches(item, needle));
      }}
      limit={limit}
      autoHighlight
      disabled={disabled}
    >
      <ComboboxInput
        ref={inputRef}
        aria-label={ariaLabel}
        className={cn("w-full", className)}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        showTrigger={!(onClear && value && !disabled)}
        onFocus={selectOnFocus ? (e) => e.currentTarget.select() : undefined}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !open) e.preventBaseUIHandler();
          // A pick must not reach host key handlers (form submit on Enter).
          if (e.key === "Enter" && open) e.stopPropagation();
        }}
      >
        {onClear && value && !disabled && (
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-xs"
              variant="ghost"
              aria-label={clearLabel}
              onClick={() => {
                setQuery(null);
                onClear();
              }}
            >
              <X />
            </InputGroupButton>
          </InputGroupAddon>
        )}
      </ComboboxInput>
      <ComboboxContent>
        <ComboboxEmpty>{emptyText((query ?? "").trim())}</ComboboxEmpty>
        <ComboboxList>
          {(id: string) => {
            const item = byId.get(id)!;
            return (
              <ComboboxItem key={id} value={id}>
                {renderItem ? renderItem(item) : getLabel(item)}
              </ComboboxItem>
            );
          }}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
