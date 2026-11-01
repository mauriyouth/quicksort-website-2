import { payslipTitle, type ParsedPayslip, type UnreadablePayslip } from "./parse.ts";

export type MatchEmployee = { id: string; person_id: string; matricule: string; status: string; end_date: string | null; full_name: string; start_date?: string | null };
export type FiledPayslip = { id: string; person_id: string; valid_from: string; title: string; sha256: string | null };
export type ReviewStatus = "matched" | "confirm" | "unknown" | "unreadable" | "already-filed" | "changed" | "duplicate";
export type ReviewRow = {
  file: ParsedPayslip | UnreadablePayslip;
  status: ReviewStatus;
  personId: string | null;
  employeeIdForMatricule: string | null;
  supersedes: string | null;
  warning: string | null;
  /** Name printed on the payslip (nameFromFile); "" for unreadable files. */
  printedName: string;
};

export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

export function sameMatricule(a: string, b: string): boolean {
  const x = a.trim();
  const y = b.trim();
  if (/^\d+$/.test(x) && /^\d+$/.test(y)) return x.replace(/^0+/, "") === y.replace(/^0+/, "");
  return x === y;
}

function sameName(a: string, b: string): boolean {
  const wa = normalizeName(a).split(" ").filter(Boolean);
  const wb = normalizeName(b).split(" ").filter(Boolean);
  if (!wa.length || !wb.length) return false;
  const [small, big] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  const pool = [...big];
  return small.every((w) => {
    const i = pool.indexOf(w);
    if (i < 0) return false;
    pool.splice(i, 1);
    return true;
  });
}

const isReadable = (f: ParsedPayslip | UnreadablePayslip): f is ParsedPayslip => !("error" in f);

export function matchPayslips(files: Array<ParsedPayslip | UnreadablePayslip>, employees: MatchEmployee[], filed: FiledPayslip[]): ReviewRow[] {
  const byPerson = new Map<string, MatchEmployee[]>();
  for (const e of employees) byPerson.set(e.person_id, [...(byPerson.get(e.person_id) ?? []), e]);

  // Open row (status <> 'ended'), else the latest by start_date.
  const preferredRow = (personId: string): MatchEmployee | null => {
    const rows = byPerson.get(personId) ?? [];
    return rows.find((r) => r.status !== "ended") ?? [...rows].sort((a, b) => (b.start_date ?? "").localeCompare(a.start_date ?? ""))[0] ?? null;
  };
  const personName = (personId: string) => preferredRow(personId)?.full_name ?? personId;
  const nameMatches = (personId: string, printed: string) => (byPerson.get(personId) ?? []).some((r) => sameName(r.full_name, printed));

  const seen = new Set<string>();
  return files.map((file): ReviewRow => {
    if (!isReadable(file)) {
      return { file, status: "unreadable", personId: null, employeeIdForMatricule: null, supersedes: null, warning: null, printedName: "" };
    }
    const row = (status: ReviewStatus, personId: string | null, warning: string | null = null, supersedes: string | null = null): ReviewRow => ({
      file, status, personId, employeeIdForMatricule: personId ? (preferredRow(personId)?.id ?? null) : null, supersedes, warning, printedName: file.nameFromFile,
    });

    const holders = [...new Set(employees.filter((e) => sameMatricule(e.matricule, file.matricule)).map((e) => e.person_id))];
    const nameHits = [...byPerson.keys()].filter((id) => nameMatches(id, file.nameFromFile));
    let result: ReviewRow;
    if (holders.length === 1) {
      const id = holders[0];
      result = nameMatches(id, file.nameFromFile)
        ? row("matched", id)
        : row("confirm", id, `Matricule ${file.matricule} belongs to ${personName(id)}, but the payslip is printed for ${file.nameFromFile}.`);
    } else if (holders.length > 1) {
      result = row("confirm", null, `Matricule ${file.matricule} is held by several people: ${holders.map(personName).join(", ")}.`);
    } else if (nameHits.length === 1) {
      const id = nameHits[0];
      const held = preferredRow(id)?.matricule ?? "";
      const warning = held && !held.startsWith("QS-") && !sameMatricule(held, file.matricule)
        ? `${personName(id)} already has matricule ${held}; the payslip says ${file.matricule}.`
        : null;
      result = row("confirm", id, warning);
    } else {
      result = row("unknown", null);
    }

    const key = `${file.matricule}|${file.period}|${file.index}`;
    if (seen.has(key)) return { ...result, status: "duplicate", supersedes: null };
    seen.add(key);

    if ((result.status === "matched" || result.status === "confirm") && result.personId) {
      const validFrom = `${file.period}-01`;
      const title = payslipTitle(file.period, file.index);
      const existing = filed.filter((f) => f.person_id === result.personId && f.valid_from === validFrom && f.title === title);
      if (existing.some((f) => f.sha256 === file.sha256)) return { ...result, status: "already-filed" };
      if (existing.length) return { ...result, status: "changed", supersedes: existing[0].id };
    }
    return result;
  });
}
