import { useState } from "react";
import { type Job, type Row } from "@quicksort/hr-db";
import { Tabs, TabsList, TabsTrigger } from "@quicksort-sas/ui";
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
      <Tabs value={view} onValueChange={(next) => setView(next as AnalyzerView)} className="mb-6">
        <TabsList variant="line" aria-label="CV analyzer views" className="h-10 w-full justify-start gap-5 overflow-x-auto border-b border-border">
          {VIEWS.map((v) => (
            <TabsTrigger key={v.key} value={v.key} className="flex-none group-data-horizontal/tabs:after:bottom-0">
              {v.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div hidden={view !== "analyze"}>
        <CvAnalyzer jobs={jobs} documents={documents} people={people} />
      </div>
      {view === "history" && <AnalysisHistory />}
    </>
  );
}
