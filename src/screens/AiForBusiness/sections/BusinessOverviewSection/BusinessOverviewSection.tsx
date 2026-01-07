export const BusinessOverviewSection = (): JSX.Element => {
  const features = [
    {
      title: "Explainable Agent Behavior",
      description:
        "Clear reasoning, traceability, and decision visibility so users understand why an agent acts — not just what it outputs.",
    },
    {
      title: "Progressive Autonomy Design",
      description:
        "Agents evolve from assistive → collaborative → autonomous, at a pace aligned with team maturity and risk tolerance.",
    },
    {
      title: "Adoption-First Product Design",
      description:
        "Onboarding, feedback loops, and interaction patterns designed to make AI a habit — not a disruption.",
    },
  ];

  return (
    <section className="flex flex-col items-center gap-16 w-full bg-[#141414]">
      <div className="flex flex-col items-center justify-center gap-20 px-0 py-24 w-full bg-[#141414]">
        <div className="flex flex-wrap items-center gap-[130px] max-w-screen-xl w-full px-8">
          <div className="flex flex-col items-start gap-12 flex-1 min-w-[300px]">
            <div className="flex flex-col items-start gap-3 w-full">
              <p className="font-text-md-semibold font-[number:var(--text-md-semibold-font-weight)] text-[#309eff] text-[length:var(--text-md-semibold-font-size)] tracking-[var(--text-md-semibold-letter-spacing)] leading-[var(--text-md-semibold-line-height)] [font-style:var(--text-md-semibold-font-style)]">
                From AI capability to everyday leverage
              </p>

              <h2 className="font-display-md-semibold font-[number:var(--display-md-semibold-font-weight)] text-[#f5f5f6] text-[length:var(--display-md-semibold-font-size)] tracking-[var(--display-md-semibold-letter-spacing)] leading-[var(--display-md-semibold-line-height)] [font-style:var(--display-md-semibold-font-style)]">
                Designing intelligent work adoption
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

          <img
            className="w-[430.76px] h-[420.75px]"
            alt="Topology"
            src="/topology-1.png"
          />
        </div>
      </div>
    </section>
  );
};
