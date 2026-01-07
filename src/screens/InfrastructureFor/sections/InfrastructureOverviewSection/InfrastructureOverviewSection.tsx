export const InfrastructureOverviewSection = (): JSX.Element => {
  const features = [
    {
      title: "Production-First Infrastructure Design",
      description:
        "Cloud-native or on-prem stacks architected for performance, isolation, and cost control — not demos.",
    },
    {
      title: "Compute-Aware Orchestration",
      description:
        "GPU/TPU workloads orchestrated with Kubernetes, Ray, and optimized runtimes like vLLM or TensorRT-LLM for predictable latency at scale.",
    },
    {
      title: "Observable Intelligence",
      description:
        "End-to-end monitoring, tracing, and evaluation pipelines using Langfuse, Prometheus, and Grafana — so model behavior is measurable, not assumed.",
    },
  ];

  return (
    <section className="flex flex-col items-center gap-16 w-full bg-[#141414]">
      <div className="flex flex-col items-center justify-center gap-20 px-0 py-24 w-full bg-[#141414]">
        <div className="flex flex-wrap items-center gap-[130px] max-w-screen-xl w-full px-8">
          <div className="flex flex-col items-start gap-12 flex-1 min-w-[300px]">
            <div className="flex flex-col items-start gap-3 w-full">
              <p className="mt-[-1.00px] font-text-md-semibold font-[number:var(--text-md-semibold-font-weight)] text-[#39e064] text-[length:var(--text-md-semibold-font-size)] tracking-[var(--text-md-semibold-letter-spacing)] leading-[var(--text-md-semibold-line-height)] [font-style:var(--text-md-semibold-font-style)]">
                Designing AI that holds in production
              </p>

              <h2 className="font-display-md-semibold font-[number:var(--display-md-semibold-font-weight)] text-[#f5f5f6] text-[length:var(--display-md-semibold-font-size)] tracking-[var(--display-md-semibold-letter-spacing)] leading-[var(--display-md-semibold-line-height)] [font-style:var(--display-md-semibold-font-style)]">
                From experimental stacks to resilient systems.
              </h2>
            </div>

            <div className="flex flex-col items-start gap-6 w-full">
              {features.map((feature, index) => (
                <div key={index} className="flex items-start gap-4 w-full">
                  <div className="flex flex-col items-start gap-5 flex-1">
                    <div className="flex flex-col items-start gap-2 pt-2.5 pb-0 px-0 w-full">
                      <h3 className="mt-[-1.00px] font-text-xl-semibold font-[number:var(--text-xl-semibold-font-weight)] text-[#f5f5f6] text-[length:var(--text-xl-semibold-font-size)] tracking-[var(--text-xl-semibold-letter-spacing)] leading-[var(--text-xl-semibold-line-height)] [font-style:var(--text-xl-semibold-font-style)]">
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
            className="w-[428px] h-[428px]"
            alt="Group"
            src="/infra-grid.svg"
          />
        </div>
      </div>
    </section>
  );
};
