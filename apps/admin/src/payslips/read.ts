import { unzipSync } from "fflate";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { parsePayslipText, type ParsedPayslip, type UnreadablePayslip } from "./parse.ts";

export { payslipTitle } from "./parse.ts";
export type { ParsedPayslip, UnreadablePayslip } from "./parse.ts";

export const MAX_FILES = 200;
export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_ZIP_BYTES = 100 * 1024 * 1024;
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;
const isPdf = (bytes: Uint8Array) => PDF_MAGIC.every((byte, i) => bytes[i] === byte);
const isZip = (name: string, bytes: Uint8Array) => /\.zip$/i.test(name) || (bytes[0] === 0x50 && bytes[1] === 0x4b);

async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function pageOneText(bytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  try {
    const content = await (await pdf.getPage(1)).getTextContent();
    return content.items.map((item) => ("str" in item ? item.str : ""));
  } finally {
    await pdf.destroy();
  }
}

async function readPdf(fileName: string, bytes: Uint8Array): Promise<ParsedPayslip | UnreadablePayslip> {
  if (!isPdf(bytes)) return { fileName, error: "Not a PDF" };
  if (bytes.length > MAX_PDF_BYTES) return { fileName, error: "PDF is larger than the 10 MB limit." };
  let items: string[];
  try { items = await pageOneText(bytes); } catch { return { fileName, error: "The PDF could not be read." }; }
  const parsed = parsePayslipText(items, fileName);
  if ("error" in parsed) return { fileName, error: parsed.error };
  return { ...parsed, sha256: await sha256(bytes), bytes };
}

function unpack(file: { name: string; bytes: Uint8Array }): { name: string; bytes: Uint8Array; error?: string }[] {
  if (!isZip(file.name, file.bytes)) return [file];
  let total = 0;
  const tooBig = new Set<string>();
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(file.bytes, {
      filter: (entry) => {
        if (entry.name.endsWith("/") || entry.name.split(/[\\/]/).includes("..") || /^([\\/]|[a-zA-Z]:)/.test(entry.name)) return false;
        if (entry.originalSize > MAX_PDF_BYTES) { tooBig.add(entry.name); return false; }
        total += entry.originalSize;
        if (total > MAX_ZIP_BYTES) throw new Error("The zip expands to more than the 100 MB limit.");
        return true;
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("100 MB")) throw error;
    return [{ name: file.name, bytes: file.bytes, error: "The zip could not be opened." }];
  }
  return [
    ...Object.entries(unzipped).map(([name, bytes]) => ({ name: baseName(name), bytes })),
    ...[...tooBig].map((name) => ({ name: baseName(name), bytes: new Uint8Array(), error: "PDF is larger than the 10 MB limit." })),
  ];
}

/** Reads uploaded PDFs and zips of PDFs. Per-file problems come back as rows; whole-drop limits throw. */
export async function readPayslipDrop(files: { name: string; bytes: Uint8Array }[]): Promise<(ParsedPayslip | UnreadablePayslip)[]> {
  if (files.length > MAX_FILES) throw new Error(`Too many files: a drop is limited to ${MAX_FILES} files.`);
  const entries = files.flatMap(unpack);
  if (entries.length > MAX_FILES) throw new Error(`Too many files: a drop is limited to ${MAX_FILES} files.`);
  const rows: (ParsedPayslip | UnreadablePayslip)[] = [];
  for (const entry of entries) {
    rows.push(entry.error ? { fileName: entry.name, error: entry.error } : await readPdf(entry.name, entry.bytes));
  }
  return rows;
}
