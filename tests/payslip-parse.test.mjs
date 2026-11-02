import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { makePayslip, makePlainPdf } from "./fixtures/payslips/make-payslip.mjs";
import { parsePayslipText } from "../apps/admin/src/payslips/parse.ts";
import { payslipTitle, readPayslipDrop } from "../apps/admin/src/payslips/read.ts";

const { zipSync } = createRequire(new URL("../apps/admin/package.json", import.meta.url))("fflate");
const enc = (s) => new TextEncoder().encode(s);

test("reads matricule, period and index from a Silae payslip", async () => {
  const bytes = await makePayslip({ name: "TEST Ada", matricule: "00026", periodLabel: "Octobre 2026" });
  const [p] = await readPayslipDrop([{ name: "TEST_ADA_10_2026_1.pdf", bytes }]);
  assert.equal(p.matricule, "00026"); assert.equal(p.period, "2026-10"); assert.equal(p.index, 1);
  assert.equal(p.nameFromFile, "TEST ADA"); assert.match(p.sha256, /^[0-9a-f]{64}$/);
});

test("a zip of payslips is unpacked, junk entries are reported, paths are flattened", async () => {
  const a = await makePayslip({ name: "TEST Ada", matricule: "00026", periodLabel: "Octobre 2026" });
  const b = await makePayslip({ name: "TEST Bob", matricule: "00027", periodLabel: "Octobre 2026" });
  const zip = zipSync({ "drop/TEST_ADA_10_2026_1.pdf": a, "TEST_BOB_10_2026_1.pdf": b, "notes.txt": enc("hello"), "../evil.pdf": a });
  const rows = await readPayslipDrop([{ name: "drop.zip", bytes: zip }]);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.filter((r) => "matricule" in r).map((r) => r.fileName).sort(), ["TEST_ADA_10_2026_1.pdf", "TEST_BOB_10_2026_1.pdf"]);
  assert.deepEqual(rows.find((r) => "error" in r), { fileName: "notes.txt", error: "Not a PDF" });
});

test("a PDF without the Silae labels is unreadable and does not stop the others", async () => {
  const plain = await makePlainPdf();
  const good = await makePayslip({ name: "TEST Ada", matricule: "00026", periodLabel: "Octobre 2026" });
  const rows = await readPayslipDrop([{ name: "plain_10_2026_1.pdf", bytes: plain }, { name: "TEST_ADA_10_2026_1.pdf", bytes: good }]);
  assert.match(rows[0].error, /Not a Silae payslip/);
  assert.equal(rows[1].matricule, "00026");
});

test("file name period must agree with the payslip period", async () => {
  const bytes = await makePayslip({ name: "TEST Ada", matricule: "00026", periodLabel: "Octobre 2026" });
  const [row] = await readPayslipDrop([{ name: "TEST_ADA_09_2026_1.pdf", bytes }]);
  assert.match(row.error, /09\/2026/);
});

test("parsePayslipText skips blanks and ignores the 15-digit SS number", () => {
  const items = ["Période :", " ", "", "Octobre 2026", "Matricule :", "N° SS :", " ", "199999999999999", "00026"];
  assert.deepEqual(parsePayslipText(items, "A_B_10_2026_2.pdf"), { fileName: "A_B_10_2026_2.pdf", matricule: "00026", period: "2026-10", index: 2, nameFromFile: "A B" });
});

test("parsePayslipText reads older Silae PDFs whose text comes word by word", () => {
  const items = ["Période", " ", ":", " ", "Janvier", " ", "2021", "", "QUICKSORT", "Matricule", " ", ":", "N°", " ", "SS", " ", ":", "Emploi", " ", ":", "", "00002", "190059938020959"];
  assert.deepEqual(parsePayslipText(items, "OTHMANE_BLIAL_01_2021_1.pdf"), { fileName: "OTHMANE_BLIAL_01_2021_1.pdf", matricule: "00002", period: "2021-01", index: 1, nameFromFile: "OTHMANE BLIAL" });
});

test("parsePayslipText accepts the extra _n mySilae adds to downloaded file names", () => {
  const items = ["Période :", "Octobre 2026", "Matricule :", "00025"];
  assert.equal(parsePayslipText(items, "TEZIER_CLAIRE_10_2026_1_1.pdf").index, 1);
  assert.equal(parsePayslipText(items, "TEZIER_CLAIRE_10_2026_1_1.pdf").nameFromFile, "TEZIER CLAIRE");
  assert.equal(parsePayslipText(items, "MUSTAFAYEV_MURAD_10_2026_2_1.pdf").index, 2);
});

test("limits: 201 files, an 11 MB file, a zip expanding past 100 MB are refused with a clear message", async () => {
  const pdfLike = enc("%PDF-1.4");
  await assert.rejects(readPayslipDrop(Array.from({ length: 201 }, (_, i) => ({ name: `f${i}.pdf`, bytes: pdfLike }))), /200 files/);
  const big = new Uint8Array(11 * 1024 * 1024); big.set(pdfLike);
  const [row] = await readPayslipDrop([{ name: "big_10_2026_1.pdf", bytes: big }]);
  assert.match(row.error, /10 MB/);
  const zippedBig = zipSync({ "big_10_2026_1.pdf": big });
  const [zrow] = await readPayslipDrop([{ name: "z.zip", bytes: zippedBig }]);
  assert.match(zrow.error, /10 MB/);
  const chunk = new Uint8Array(9 * 1024 * 1024); chunk.set(pdfLike);
  const files = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`p${i}.pdf`, chunk]));
  await assert.rejects(readPayslipDrop([{ name: "huge.zip", bytes: zipSync(files) }]), /100 MB/);
});

test("payslipTitle", () => {
  assert.equal(payslipTitle("2026-10", 1), "Bulletin de paie Octobre 2026");
  assert.equal(payslipTitle("2026-08", 2), "Bulletin de paie Août 2026 (2)");
});
