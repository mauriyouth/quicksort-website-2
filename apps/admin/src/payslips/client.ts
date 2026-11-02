import { db, type DocumentRecord } from "@quicksort/hr-db";
import { uploadDocument } from "../documents/client";
import { payslipTitle } from "./read.browser";
import type { FiledPayslip, MatchEmployee, ReviewRow } from "./match";
import type { ParsedPayslip } from "./read.browser";
import { preferredEmployment, sameMatricule } from "./match";
import type { FiledPayslipDoc, StaffEmployment } from "./month";

const FREELANCE = "Freelance";
const CHUNK = 100;

/** Everything matching needs: staff (not freelancers) with their person's name, plus the payslips already filed. */
export async function loadMatchContext(): Promise<{ employees: MatchEmployee[]; filed: FiledPayslip[] }> {
  const [employees, { data: documents, error: filedError }] = await Promise.all([
    loadStaff(),
    db().from("documents").select("id,person_id,valid_from,title,sha256").eq("type_code", "PAYSLIP").eq("status", "active"),
  ]);
  if (filedError) throw filedError;
  return {
    employees,
    filed: (documents ?? []).flatMap((d) => (d.person_id && d.valid_from ? [{ id: d.id, person_id: d.person_id, valid_from: d.valid_from, title: d.title, sha256: d.sha256 }] : [])),
  };
}

/** HR → Payslips month view: staff employments and every active filed payslip. */
export async function loadPayroll(): Promise<{ staff: StaffEmployment[]; payslips: FiledPayslipDoc[] }> {
  const [staff, { data, error }] = await Promise.all([
    loadStaff(),
    db().from("documents").select("id,person_id,valid_from,title,file_name").eq("type_code", "PAYSLIP").eq("status", "active"),
  ]);
  if (error) throw error;
  return {
    staff,
    payslips: (data ?? []).flatMap((d) => (d.person_id && d.valid_from ? [{ id: d.id, person_id: d.person_id, valid_from: d.valid_from, title: d.title, file_name: d.file_name }] : [])),
  };
}

async function loadStaff(): Promise<MatchEmployee[]> {
  const { data: staff, error } = await db().from("employees")
    .select("id,person_id,matricule,status,end_date,start_date,contract_type")
    .neq("contract_type", FREELANCE);
  if (error) throw error;
  const rows = staff ?? [];

  const personIds = [...new Set(rows.map((r) => r.person_id))];
  const names = new Map<string, string>();
  for (let i = 0; i < personIds.length; i += CHUNK) {
    const { data, error: nameError } = await db().from("hr_people").select("id,full_name").in("id", personIds.slice(i, i + CHUNK));
    if (nameError) throw nameError;
    for (const p of data ?? []) names.set(p.id, p.full_name);
  }
  return rows.map((r) => ({
    id: r.id, person_id: r.person_id, matricule: r.matricule, status: r.status,
    end_date: r.end_date, start_date: r.start_date, full_name: names.get(r.person_id) ?? "",
  }));
}

/** The real matricule HR would be overwriting by filing this payslip, or null (none held, QS- default, or the same). */
export function replacedMatricule(matricule: string, employment: MatchEmployee | null): string | null {
  const held = employment?.matricule?.trim() ?? "";
  return held && !held.startsWith("QS-") && !sameMatricule(held, matricule) ? held : null;
}

/**
 * Files one reviewed payslip. When the employee's stored matricule differs from
 * the PDF's (the QS- default, a leading-zero variant such as "26", or a
 * confirmed replacement) it is set to the Silae form first.
 */
/** What filing this row for `personId` would do to payslips already on file for that person and period. */
export function filedConflict(file: ParsedPayslip, personId: string, filed: FiledPayslip[]): { identical: boolean; supersedes: string | null } {
  const validFrom = `${file.period}-01`;
  const title = payslipTitle(file.period, file.index);
  const existing = filed.filter((f) => f.person_id === personId && f.valid_from === validFrom && f.title === title);
  if (existing.some((f) => f.sha256 === file.sha256)) return { identical: true, supersedes: null };
  return { identical: false, supersedes: existing[0]?.id ?? null };
}

export async function fileReviewRow(
  row: ReviewRow,
  chosen: { personId: string; employeeIdForMatricule: string | null; overwriteConfirmed: boolean },
  employees: MatchEmployee[],
): Promise<DocumentRecord> {
  const file = row.file;
  if ("error" in file) throw new Error("An unreadable file cannot be filed.");
  const employment = employees.find((e) => e.id === chosen.employeeIdForMatricule) ?? null;
  const replaced = replacedMatricule(file.matricule, employment);
  if (replaced && !chosen.overwriteConfirmed) throw new Error(`Confirm replacing matricule ${replaced} with ${file.matricule} first.`);
  if (employment && chosen.employeeIdForMatricule && employment.matricule !== file.matricule) {
    const { error } = await db().rpc("set_employee_matricule", { employee_id: chosen.employeeIdForMatricule, matricule: file.matricule, request_id: crypto.randomUUID() });
    if (error) throw error;
  }
  return uploadDocument(
    { kind: "person", id: chosen.personId },
    new File([file.bytes as unknown as BlobPart], file.fileName, { type: "application/pdf" }),
    { typeCode: "PAYSLIP", title: payslipTitle(file.period, file.index), validFrom: `${file.period}-01`, supersedes: row.supersedes },
  );
}
