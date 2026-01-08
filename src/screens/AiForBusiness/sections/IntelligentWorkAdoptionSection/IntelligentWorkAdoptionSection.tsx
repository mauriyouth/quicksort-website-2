export const IntelligentWorkAdoptionSection = (): JSX.Element => {
  const features = [
    {
      title: "Multi-Agent Architectures",
      description:
        "Deploy teams of specialized agents that collaborate to solve complex problems.",
    },
    {
      title: "Deep Enterprise Integration",
      description:
        "Seamless connections with your CRMs, ERPs, and internal data lakes.",
    },
    {
      title: "Context-Aware Copilots",
      description:
        "Domain-specific assistants that retain memory and understand the nuance of your business.",
    },
    {
      title: "Human-in-the-Loop",
      description:
        "Interfaces designed for validation, feedback, and continuous model fine-tuning.",
    },
  ];

  return (
    <section className="flex flex-col items-center gap-16 px-0 py-24 w-full">
      <div className="flex flex-col lg:flex-row items-start gap-16 max-w-screen-xl px-8 py-0 w-full">
        <div className="flex flex-col max-w-[360px] items-start gap-5 flex-1">
          <div className="flex flex-col items-start gap-5 w-full">
            <img
              className="w-[47px] h-[47px]"
              alt="Featured icon"
              src="/featured-icon.svg"
            />

            <h2 className="w-full font-display-md-semibold font-[number:var(--display-md-semibold-font-weight)] text-[#f5f5f6] text-[length:var(--display-md-semibold-font-size)] tracking-[var(--display-md-semibold-letter-spacing)] leading-[var(--display-md-semibold-line-height)] [font-style:var(--display-md-semibold-font-style)]">
              AI for business
            </h2>
          </div>

          <p className="w-full font-text-md-regular font-[number:var(--text-md-regular-font-weight)] text-[#94969c] text-[length:var(--text-md-regular-font-size)] tracking-[var(--text-md-regular-letter-spacing)] leading-[var(--text-md-regular-line-height)] [font-style:var(--text-md-regular-font-style)]">
            We treat AI as a product, not just a model. Our end-to-end delivery
            focuses heavily on Product Design, ensuring your teams can
            intuitively adapt to new, high-efficiency ways of working.
          </p>
        </div>

        <div className="flex flex-wrap items-start justify-center gap-[32px_64px] flex-1">
          {features.map((feature, index) => (
            <div
              key={index}
              className="flex min-w-80 max-w-[480px] items-start gap-4 flex-1"
            >
              <div className="flex flex-col items-start gap-5 flex-1">
                <div className="flex flex-col items-start gap-2 w-full">
                  <h3 className="w-full mt-[-1.00px] font-text-xl-semibold font-[number:var(--text-xl-semibold-font-weight)] text-[#f5f5f6] text-[length:var(--text-xl-semibold-font-size)] tracking-[var(--text-xl-semibold-letter-spacing)] leading-[var(--text-xl-semibold-line-height)] [font-style:var(--text-xl-semibold-font-style)]">
                    {feature.title}
                  </h3>

                  <p className="w-full font-text-md-regular font-[number:var(--text-md-regular-font-weight)] text-[#94969c] text-[length:var(--text-md-regular-font-size)] tracking-[var(--text-md-regular-letter-spacing)] leading-[var(--text-md-regular-line-height)] [font-style:var(--text-md-regular-font-style)]">
                    {feature.description}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col items-start gap-4 max-w-screen-xl px-8 py-0 w-full">
        <h3 className="w-full mt-[-1.00px] font-text-xl-semibold font-[number:var(--text-xl-semibold-font-weight)] text-[#f5f5f6] text-[length:var(--text-xl-semibold-font-size)] tracking-[var(--text-xl-semibold-letter-spacing)] leading-[var(--text-xl-semibold-line-height)] [font-style:var(--text-xl-semibold-font-style)]">
          From workflows to work intelligence.
        </h3>

        <p className="w-full font-text-xl-regular font-[number:var(--text-xl-regular-font-weight)] text-[#94969c] text-[length:var(--text-xl-regular-font-size)] tracking-[var(--text-xl-regular-letter-spacing)] leading-[var(--text-xl-regular-line-height)] [font-style:var(--text-xl-regular-font-style)]">
          We build custom AI workspaces and agents that embed directly into your
          operations. Our systems connect people, data, and tools into
          orchestrated environments where human judgment validates agent
          reasoning — automating coordination, and decision loops.
        </p>
      </div>
    </section>
  );
};
