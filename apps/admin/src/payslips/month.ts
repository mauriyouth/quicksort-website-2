/** One month of payroll: who was employed, and which payslips are filed for them. Pure, so it is unit-tested. */
export type StaffEmployment = { person_id: string; full_name: string; matricule: string; start_date?: string | null; end_date: string | null };
export type FiledPayslipDoc = { id: string; person_id: string; valid_from: string; title: string; file_name: string };
export type PayrollRow = { personId: string; name: string; matricule: string; employed: boolean; payslips: FiledPayslipDoc[] };

const lastDay = (period: string) => {
  const [y, m] = period.split("-").map(Number);
  return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};

const overlaps = (e: StaffEmployment, period: string) =>
  !!e.start_date && e.start_date <= lastDay(period) && (!e.end_date || e.end_date >= `${period}-01`);

const realMatricule = (m: string) => !!m && !m.startsWith("QS-");

/** `period` is "YYYY-MM". Rows are everyone employed that month plus anyone with a payslip filed for it, by name. */
export function payrollMonth(period: string, staff: StaffEmployment[], payslips: FiledPayslipDoc[]): PayrollRow[] {
  const month = payslips.filter((p) => p.valid_from.startsWith(period));
  const ids = new Set([...staff.filter((e) => overlaps(e, period)).map((e) => e.person_id), ...month.map((p) => p.person_id)]);
  return [...ids].map((personId) => {
    const rows = staff.filter((e) => e.person_id === personId);
    const during = rows.filter((e) => overlaps(e, period));
    const pick = [...during, ...rows].find((e) => realMatricule(e.matricule)) ?? during[0] ?? rows[0];
    return {
      personId,
      name: pick?.full_name || "Unknown person",
      matricule: pick?.matricule ?? "",
      employed: during.length > 0,
      payslips: month.filter((p) => p.person_id === personId).sort((a, b) => a.title.localeCompare(b.title)),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/** Most recent "YYYY-MM" with a filed payslip, or null. */
export function latestPeriod(payslips: Pick<FiledPayslipDoc, "valid_from">[]): string | null {
  return payslips.reduce<string | null>((max, p) => (!max || p.valid_from.slice(0, 7) > max ? p.valid_from.slice(0, 7) : max), null);
}

export function shiftPeriod(period: string, delta: number): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
