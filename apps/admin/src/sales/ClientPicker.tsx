import { useEffect, useRef } from "react";
import { SearchCombobox } from "../SearchCombobox";
import type { SalesClient } from "./data";

const clientId = (c: SalesClient) => c.id;
const clientName = (c: SalesClient) => c.name;

/**
 * Searchable client picker (the shared SearchCombobox on the package
 * Combobox), replacing a long <select> in the project/person dialogs. The
 * chosen id still travels through the form as the hidden client_id input, so
 * submit handlers just read FormData; the visible input carries the required
 * validation via setCustomValidity since hidden inputs can't.
 */
export function ClientPicker({
  clients,
  value,
  onChange,
  required,
  name = "client_id",
}: {
  clients: SalesClient[];
  value: string;
  onChange: (id: string) => void;
  required?: boolean;
  /** Form field name for the hidden input carrying the picked id — a
      second picker on the same form (e.g. an intermediary) passes its own. */
  name?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Hidden inputs are barred from constraint validation — report "select a
  // client" through the visible field instead.
  useEffect(() => {
    inputRef.current?.setCustomValidity(value || !required ? "" : "Select a client.");
  }, [value, required]);

  return (
    <>
      <SearchCombobox
        items={clients}
        getId={clientId}
        getLabel={clientName}
        matches={(c, q) => c.name.toLowerCase().includes(q)}
        value={value}
        onPick={onChange}
        onClear={() => {
          onChange("");
          inputRef.current?.focus();
        }}
        clearLabel="Clear client"
        placeholder="Search a client…"
        emptyText={() => "No client matches"}
        limit={8}
        inputRef={inputRef}
      />
      <input type="hidden" name={name} value={value} />
    </>
  );
}
