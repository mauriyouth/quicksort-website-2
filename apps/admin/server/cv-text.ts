import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * Plain text of every page of a resume PDF, read on our server so the file
 * itself never leaves it (Kimi only receives the text). Scanned CVs have no
 * text layer and come back (nearly) empty — callers decide what to do then.
 */
export async function extractPdfText(pdf: Uint8Array, maxChars: number): Promise<string> {
  const doc = await getDocument({ data: pdf.slice(), isEvalSupported: false }).promise;
  try {
    const pages: string[] = [];
    let length = 0;
    for (let number = 1; number <= doc.numPages && length < maxChars; number++) {
      const content = await (await doc.getPage(number)).getTextContent();
      const text = content.items
        .map(item => ("str" in item ? item.str + (item.hasEOL ? "\n" : " ") : ""))
        .join("")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      pages.push(text);
      length += text.length;
    }
    return pages.join("\n\n").slice(0, maxChars).trim();
  } finally {
    await doc.destroy();
  }
}
