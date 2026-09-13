import pdfMake from "pdfmake/build/pdfmake";
import fonts from "pdfmake/build/vfs_fonts";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import { saveBlob } from "@quicksort/candidate-db";
import { matchMetrics, type CandidateResult, type Evaluation } from "./analysis";

pdfMake.addVirtualFileSystem(fonts);
const nameOf = (c: CandidateResult) => c.report.evaluation.candidateName === "Unnamed candidate" ? c.fileName : c.report.evaluation.candidateName;
const heading = (text: string): Content => ({ text, style: "section", headlineLevel: 1 });
const paragraph = (label: string, text: string): Content => ({ text: [{ text: `${label} `, bold: true }, text], margin: [0, 0, 0, 6] });

function questions(title: string, items: Evaluation["experienceQuestions"]): Content[] {
  return [heading(title), ...(!items.length ? [{ text: "No supported questions identified." }] : items.flatMap((q, i): Content[] => [
    { text: `${i + 1}. ${q.question}`, bold: true, margin: [0, 8, 0, 5] },
    paragraph("Context:", q.context), paragraph("Listen for:", q.listenFor),
  ]))];
}

function candidateContent(candidate: CandidateResult): Content[] {
  const { evaluation: e, job, analyzedAt } = candidate.report;
  const metrics = matchMetrics(e);
  return [
    { text: job.title, style: "eyebrow" },
    { text: nameOf(candidate), style: "title" },
    { text: e.headline, color: "#525b55", margin: [0, 0, 0, 12] },
    { text: `${candidate.fileName} • ${new Date(analyzedAt).toLocaleDateString("en-GB")}`, style: "small" },
    { table: { widths: ["*", "*", "*"], body: [[
      `${metrics.assessable ? `${metrics.score}%` : "Unknown"}\nDocumented match`,
      `${metrics.coverage}%\nEvidence coverage`, `${e.confidence}\nEvidence confidence`,
    ]] }, layout: "lightHorizontalLines", margin: [0, 16, 0, 12] },
    heading("Evaluation summary"), { text: e.summary },
    heading("Requirement scorecards"),
    { text: "0 = mismatch • 3 = meets • 5 = exceptional. Unknown = insufficient evidence. Documented match uses six equal categories; unknowns are not proven weaknesses.", style: "small" },
    ...e.scorecards.flatMap((s): Content[] => [
      { text: `${s.criterion}  |  ${s.score === null ? "Unknown" : `${s.score}/5`}`, bold: true, color: "#36512b", margin: [0, 12, 0, 5], headlineLevel: 1 },
      paragraph("Requirement:", s.requirement), paragraph("CV evidence:", s.evidence), paragraph("Reason:", s.rationale),
    ]),
    ...questions("Interview: validate claimed experience", e.experienceQuestions),
    ...questions("Interview: explore gaps against the job", e.gapQuestions),
    ...([["Advantages", e.advantages], ["Gaps & disadvantages", e.disadvantages], ["Risks to verify", e.risks], ["Other observations", e.aspectCritiques]] as const).flatMap(([title, findings]): Content[] => [
      heading(title), ...(!findings.length ? [{ text: "No supported findings identified." }] : findings.flatMap((f): Content[] => [
        { text: f.aspect, bold: true, margin: [0, 8, 0, 5] },
        { text: f.assessment, margin: [0, 0, 0, 6] }, paragraph("Evidence:", f.evidence), paragraph("Verify:", f.followUp),
      ])),
    ]),
  ];
}

export async function downloadEvaluationPdf(candidates: CandidateResult[], shortlist = false) {
  const selected = candidates.slice(0, 10);
  if (!selected.length) throw new Error("No reports available.");
  const content: Content[] = [];
  if (shortlist) {
    content.push({ text: "Selected profiles", style: "title" }, { text: selected[0].report.job.title, style: "eyebrow" },
      { text: `${selected.length} profiles • Full evaluations follow in shortlist order.`, margin: [0, 10, 0, 20] },
      { table: { headerRows: 1, widths: [24, "*", 66, 66], body: [
        ["Rank", "Candidate", "Match", "Coverage"].map(text => ({ text, bold: true })),
        ...selected.map((c, i) => { const m = matchMetrics(c.report.evaluation); return [String(i + 1), nameOf(c), m.assessable ? `${m.score}%` : "Unknown", `${m.coverage}%`]; }),
      ] }, layout: "lightHorizontalLines" });
  }
  selected.forEach((candidate, i) => {
    if (shortlist || i > 0) content.push({ text: "", pageBreak: "before" });
    content.push(...candidateContent(candidate));
  });
  const definition: TDocumentDefinitions = {
    pageSize: "A4", pageMargins: [42, 52, 42, 48],
    info: { title: shortlist ? "Selected profiles" : `CV evaluation — ${nameOf(selected[0])}`, author: "Quicksort" },
    defaultStyle: { font: "Roboto", fontSize: 10, lineHeight: 1.25, color: "#202822" },
    styles: { title: { fontSize: 25, bold: true, margin: [0, 6, 0, 8] }, eyebrow: { fontSize: 10, color: "#525b55" }, section: { fontSize: 14, bold: true, margin: [0, 18, 0, 8] }, small: { fontSize: 8, color: "#626b65" } },
    header: { text: "QUICKSORT  /  CV ANALYZER", fontSize: 8, color: "#626b65", margin: [42, 24, 42, 0] },
    footer: (page, pages) => ({ columns: [{ text: "Confidential • Human review required" }, { text: `${page} / ${pages}`, alignment: "right" }], fontSize: 8, color: "#626b65", margin: [42, 16, 42, 0] }),
    content,
  };
  // pdfmake 0.3 returns a Promise; its DefinitelyTyped declarations still describe 0.2 callbacks.
  const pdf = pdfMake.createPdf(definition) as unknown as { getBlob(): Promise<Blob> };
  const blob = await pdf.getBlob();
  const slug = nameOf(selected[0]).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "candidate";
  saveBlob(blob, shortlist ? "selected-profiles.pdf" : `cv-evaluation-${slug.toLowerCase()}.pdf`);
}
