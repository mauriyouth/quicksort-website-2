import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Synthetic payslips only: made-up names and numbers, never a real payslip.
const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../apps/admin/package.json"));
const pdfmake = require("pdfmake");
pdfmake.setUrlAccessPolicy(() => false);
const fontDir = path.join(path.dirname(require.resolve("pdfmake/package.json")), "fonts/Roboto");
pdfmake.setLocalAccessPolicy((file) => path.resolve(file).startsWith(fontDir));
pdfmake.addFonts({ Roboto: {
  normal: path.join(fontDir, "Roboto-Regular.ttf"), bold: path.join(fontDir, "Roboto-Medium.ttf"),
  italics: path.join(fontDir, "Roboto-Italic.ttf"), bolditalics: path.join(fontDir, "Roboto-MediumItalic.ttf"),
} });

const LABELS = ["Matricule :", "N° SS :", "Iban / Rib :", "Emploi :", "Statut professionnel :", "Position :", "Coefficient :", "Entrée :", "Ancienneté :", "Convention collective :"];

// pdfkit draws each word as its own text run; non-breaking spaces keep a phrase in one run, as in real Silae PDFs.
const phrase = (text) => ({ text: text.replace(/ /g, "\u00a0") });

async function render(content) {
  const pdf = pdfmake.createPdf({ pageSize: "A4", defaultStyle: { font: "Roboto", fontSize: 9 }, content });
  return new Uint8Array(await pdf.getBuffer());
}

/** A one-page synthetic payslip laid out like Silae: label run, then values in the same order. */
export function makePayslip({ name, matricule, periodLabel }) {
  const values = [matricule, "199999999999999", "FR76 0000", "Consultant", "Cadre", "2.1", "100", "01/01/2020", "6 ans", "Syntec"];
  return render([
    phrase("BULLETIN DE PAIE"), phrase("Période :"), phrase(periodLabel), phrase(name),
    ...LABELS.map(phrase), ...values.map(phrase),
  ]);
}

/** A PDF with text but none of the Silae labels. */
export function makePlainPdf(text = "Just a letter") {
  return render([phrase(text)]);
}
