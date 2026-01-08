import { DataForAiIcon } from "../../../../components/DataForAiIcon";

export const DataOverviewSection = (): JSX.Element => {
  const features = [
    {
      title: "Context-First Data Modeling",
      description:
        "We structure data around decisions, not tables — capturing intent, relationships, and business semantics.",
    },
    {
      title: "Retrieval-Centric Architectures",
      description:
        "Knowledge graphs and vector layers (e.g. Neo4j, Milvus, Weaviate) designed to surface the right information at the right moment.",
    },
    {
      title: "Learning-Ready RAG Systems",
      description:
        "Context retrieval pipelines that evolve with usage, feedback, and domain drift — not frozen embeddings",
    },
  ];

  return (
    <section className="flex flex-col items-center gap-16 w-full bg-[#141414]">
      <div className="flex flex-col items-center justify-around gap-20 px-0 py-24 w-full bg-[#141414]">
        <div className="flex flex-wrap items-center gap-[130px] max-w-screen-xl px-8 py-0 w-full">
          <div className="flex flex-col items-start gap-12 flex-1 min-w-[400px]">
            <div className="flex flex-col items-start gap-3 w-full">
              <p className="font-text-md-semibold font-[number:var(--text-md-semibold-font-weight)] text-[#f14a55] text-[length:var(--text-md-semibold-font-size)] tracking-[var(--text-md-semibold-letter-spacing)] leading-[var(--text-md-semibold-line-height)] [font-style:var(--text-md-semibold-font-style)]">
                Designing data that learns
              </p>

              <h2 className="font-display-md-semibold font-[number:var(--display-md-semibold-font-weight)] text-[#f5f5f6] text-[length:var(--display-md-semibold-font-size)] tracking-[var(--display-md-semibold-letter-spacing)] leading-[var(--display-md-semibold-line-height)] [font-style:var(--display-md-semibold-font-style)]">
                From static pipelines to living intelligence.
              </h2>
            </div>

            <div className="flex flex-col items-start gap-6 w-full">
              {features.map((feature, index) => (
                <div key={index} className="flex items-start gap-4 w-full">
                  <div className="flex flex-col items-start gap-5 flex-1">
                    <div className="flex flex-col items-start gap-2 pt-2.5 pb-0 px-0 w-full">
                      <h3 className="font-text-xl-semibold font-[number:var(--text-xl-semibold-font-weight)] text-[#f5f5f6] text-[length:var(--text-xl-semibold-font-size)] tracking-[var(--text-xl-semibold-letter-spacing)] leading-[var(--text-xl-semibold-line-height)] [font-style:var(--text-xl-semibold-font-style)]">
                        {feature.title}
                      </h3>

                      <p className="font-text-md-regular font-[number:var(--text-md-regular-font-weight)] text-[#94969c] text-[length:var(--text-md-regular-font-size)] tracking-[var(--text-md-regular-letter-spacing)] leading-[var(--text-md-regular-line-height)] [font-style:var(--text-md-regular-font-style)]">
                        {feature.description}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <DataForAiIcon className="w-[435.5px] h-[387.11px]" />
        </div>
      </div>
    </section>
  );
};
