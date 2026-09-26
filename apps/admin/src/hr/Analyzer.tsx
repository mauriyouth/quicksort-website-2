import { useState } from "react";
import { type Job, type Row } from "@quicksort/hr-db";
import { CvAnalyzer } from "../CvAnalyzer";
import { AnalysisHistory } from "../AnalysisHistory";

type AnalyzerView = "analyze" | "history";
const VIEWS: { key: AnalyzerView; label: string }[] = [
  { key: "analyze", label: "Analyze CVs" },
  { key: "history", label: "Analysis history" },
];

/**
 * CV analyzer — one tab, two views. Analyze runs batches against a job post
 * (or a single profile) and downloads the shortlist PDF; History browses past
 * runs with full reports. The analyzer stays mounted (hidden) while History is
 * open so an in-flight batch survives the switch.
 */
export function Analyzer({
  jobs,
  documents,
  people,
}: {
  jobs: Job[];
  documents: Row<"candidate_documents">[];
  people: Row<"profiles">[];
}) {
  const [view, setView] = useState<AnalyzerView>("analyze");
  return (
    <>
      <nav className="view-menu" aria-label="CV analyzer views">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            aria-pressed={view === v.key}
            className={view === v.key ? "active" : ""}
            onClick={() => setView(v.key)}
          >
            {v.label}
          </button>
        ))}
      </nav>
      <div hidden={view !== "analyze"}>
        <CvAnalyzer jobs={jobs} documents={documents} people={people} />
      </div>
      {view === "history" && <AnalysisHistory />}
    </>
  );
}
