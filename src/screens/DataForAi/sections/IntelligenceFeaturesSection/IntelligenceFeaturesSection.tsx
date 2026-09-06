import { useLocale } from '@lib/i18n';
export const IntelligenceFeaturesSection = (): JSX.Element => {
  const { t, localize } = useLocale();
  const features = [
    {
      title: "Data that Scales",
      description:
        "Seamless integration of knowledge graphs and vector databases like Neo4j, Milvus, and Weaviate.",
    },
    {
      title: "Context-Aware Retrieval & RAG",
      description:
        "High-precision context retrieval and RAG pipelines tailored to domain-specific memory.",
    },
    {
      title: "Governance & Explainable AI",
      description:
        "End-to-end lineage, semantic enrichment, and governance for transparent, traceable AI decisions.",
    },
    {
      title: "Active Learning Loops",
      description: "Systems that capture human feedback to continuously refine model performance and domain accuracy.",
    },
  ];

  return (
    <section className="flex flex-col items-center gap-16 px-0 py-24 w-full bg-surface">
      <div className="flex flex-col lg:flex-row items-start gap-16 max-w-screen-xl px-8 py-0 w-full">
        <div className="flex flex-col max-w-[360px] items-start gap-5 flex-1">
          <div className="flex flex-col items-start gap-5 w-full">
            <div className="relative w-[47.33px] h-[47.33px] bg-cat-red rounded-[9.77px] overflow-hidden border-[none] shadow-[inset_0px_-1.97px_0px_#0a0c120d,inset_0px_0px_0px_0.99px_#0a0c122e] before:content-[''] before:absolute before:inset-0 before:p-[1.97px] before:rounded-[9.77px] before:[background:linear-gradient(180deg,rgba(255,255,255,0.12)_0%,rgba(255,255,255,0)_100%)] before:[-webkit-mask:linear-gradient(#fff_0_0)_content-box,linear-gradient(#fff_0_0)] before:[-webkit-mask-composite:xor] before:[mask-composite:exclude] before:z-[1] before:pointer-events-none">
              <img
                className="absolute top-[11px] left-[11px] w-[26px] h-[26px]"
                alt=""
                src="/database--folder--synchronize--sync-1.svg"
              />
            </div>

            <h2 className="w-full font-display-md-semibold font-[number:var(--display-md-semibold-font-weight)] text-ink text-[length:var(--display-md-semibold-font-size)] tracking-[var(--display-md-semibold-letter-spacing)] leading-[var(--display-md-semibold-line-height)] [font-style:var(--display-md-semibold-font-style)]">{t("\n              Data for AI\n            ")}</h2>
          </div>

          <p className="w-full font-text-md-regular font-[number:var(--text-md-regular-font-weight)] text-ink-muted text-[length:var(--text-md-regular-font-size)] tracking-[var(--text-md-regular-letter-spacing)] leading-[var(--text-md-regular-line-height)] [font-style:var(--text-md-regular-font-style)]">{t("\n            Empower your agents and copilots with the right context: the data\n            fabric that makes intelligence actionable.\n          ")}</p>
        </div>

        <div className="flex flex-wrap items-start justify-center gap-[32px_64px] flex-1">
          {features.map((feature, index) => (
            <div
              key={index}
              className="flex min-w-80 max-w-[480px] items-start gap-4 flex-1"
            >
              <div className="flex flex-col items-start gap-5 flex-1">
                <div className="flex flex-col items-start gap-2 w-full">
                  <h3 className="w-full mt-[-1.00px] font-text-xl-semibold font-[number:var(--text-xl-semibold-font-weight)] text-ink text-[length:var(--text-xl-semibold-font-size)] tracking-[var(--text-xl-semibold-letter-spacing)] leading-[var(--text-xl-semibold-line-height)] [font-style:var(--text-xl-semibold-font-style)]">
                    {t(feature.title)}
                  </h3>

                  <p className="w-full font-text-md-regular font-[number:var(--text-md-regular-font-weight)] text-ink-muted text-[length:var(--text-md-regular-font-size)] tracking-[var(--text-md-regular-letter-spacing)] leading-[var(--text-md-regular-line-height)] [font-style:var(--text-md-regular-font-style)]">
                    {t(feature.description)}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col items-start gap-4 max-w-screen-xl px-8 py-0 w-full">
        <h2 className="w-full mt-[-1.00px] font-text-xl-semibold font-[number:var(--text-xl-semibold-font-weight)] text-ink text-[length:var(--text-xl-semibold-font-size)] tracking-[var(--text-xl-semibold-letter-spacing)] leading-[var(--text-xl-semibold-line-height)] [font-style:var(--text-xl-semibold-font-style)]">{t("\n          Context is the new compute.\n        ")}</h2>

        <p className="w-full font-text-xl-regular font-[number:var(--text-xl-regular-font-weight)] text-ink-muted text-[length:var(--text-xl-regular-font-size)] tracking-[var(--text-xl-regular-letter-spacing)] leading-[var(--text-xl-regular-line-height)] [font-style:var(--text-xl-regular-font-style)]">{t("\n          We transform fragmented enterprise data into structured, contextual\n          intelligence ready for AI consumption, enabling models and agents to\n          reason, learn, and act with precision.\n        ")}</p>
      </div>
    </section>
  );
};
