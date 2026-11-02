export type ParsedPayslip = { fileName: string; matricule: string; period: string; index: number; nameFromFile: string; sha256: string; bytes: Uint8Array };
export type UnreadablePayslip = { fileName: string; error: string };

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const PERIOD = new RegExp(`^(${MONTHS.join("|")}) (\\d{4})$`, "i");
// mySilae downloads append another `_n` (NAME_MM_YYYY_n_1.pdf); it is ignored.
const FILE_NAME = /^(.+?)_(\d{2})_(\d{4})_(\d+)(?:_\d+)?\.pdf$/i;

const clean = (item: string) => item.replace(/\u00a0/g, " ").trim();

// Older Silae PDFs give their text word by word ("Matricule", ":" / "Janvier", "2021"),
// so a label or value may span two consecutive non-blank items.
const firstAfter = (rawItems: string[], label: string, pattern: RegExp) => {
  const items = rawItems.map(clean).filter(Boolean);
  const pair = (i: number) => (i + 1 < items.length ? `${items[i]} ${items[i + 1]}` : null);
  let start = -1;
  for (let i = 0; i < items.length && start < 0; i++) {
    if (items[i] === label) start = i + 1;
    else if (pair(i) === label) start = i + 2;
  }
  if (start < 0) return null;
  for (let i = start; i < items.length; i++) {
    if (pattern.test(items[i])) return items[i];
    const joined = pair(i);
    if (joined && pattern.test(joined)) return joined;
  }
  return null;
};

const monthLabel = (month: number) => MONTHS[month - 1].charAt(0).toUpperCase() + MONTHS[month - 1].slice(1);

export function payslipTitle(period: string, index: number): string {
  const [year, month] = period.split("-").map(Number);
  return `Bulletin de paie ${monthLabel(month)} ${year}${index > 1 ? ` (${index})` : ""}`;
}

export function parsePayslipText(items: string[], fileName: string): Omit<ParsedPayslip, "sha256" | "bytes"> | { error: string } {
  const matricule = firstAfter(items, "Matricule :", /^\d{1,10}$/);
  const periodText = firstAfter(items, "Période :", PERIOD);
  if (!matricule || !periodText) return { error: "Not a Silae payslip, or the PDF has no text." };
  const fileMatch = FILE_NAME.exec(fileName);
  if (!fileMatch) return { error: "File name must look like NAME_MM_YYYY_n.pdf." };
  const [, rawName, fileMonth, fileYear, fileIndex] = fileMatch;
  const [, monthName, year] = PERIOD.exec(periodText)!;
  const month = MONTHS.indexOf(monthName.toLowerCase()) + 1;
  if (Number(fileMonth) !== month || fileYear !== year) {
    return { error: `Period in file name (${fileMonth}/${fileYear}) differs from the payslip (${periodText}).` };
  }
  return { fileName, matricule, period: `${year}-${String(month).padStart(2, "0")}`, index: Number(fileIndex), nameFromFile: rawName.replace(/_/g, " ") };
}
