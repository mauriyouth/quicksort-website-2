const features = [
  {
    title: "GPU/TPU orchestration",
    description: "With Kubernetes + Ray + vLLM/TensorRT-LLM",
  },
  {
    title: "Monitoring, tracing, and evaluation",
    description: "Via Langfuse + Prometheus + Grafana",
  },
  {
    title: "Model serving pipelines",
    description: "With low-latency inference and versioning",
  },
  {
    title: "MLOps frameworks",
    description: "For continuous delivery and governance",
  },
];

export const ProductionDesignFeaturesSection = (): JSX.Element => {
  return (
    <section className="flex flex-col items-center gap-16 px-0 py-24 w-full bg-[#141414]">
      <div className="flex flex-col lg:flex-row items-start lg:items-center gap-16 max-w-screen-xl px-8 py-0 w-full">
        <div className="flex flex-col max-w-[360px] items-start gap-5 flex-1">
          <div className="flex flex-col items-start gap-5 w-full">
            <div className="w-[47.33px] h-[47.33px] bg-[#227b39] rounded-[9.77px] overflow-hidden border-[none] shadow-[inset_0px_-1.97px_0px_#0a0c120d,inset_0px_0px_0px_0.99px_#0a0c122e] relative before:content-[''] before:absolute before:inset-0 before:p-[1.97px] before:rounded-[9.77px] before:[background:linear-gradient(180deg,rgba(255,255,255,0.12)_0%,rgba(255,255,255,0)_100%)] before:[-webkit-mask:linear-gradient(#fff_0_0)_content-box,linear-gradient(#fff_0_0)] before:[-webkit-mask-composite:xor] before:[mask-composite:exclude] before:z-[1] before:pointer-events-none">
              <img
                className="absolute top-[11px] left-[11px] w-[26px] h-[26px]"
                alt="Database folder"
                src="/database--folder--synchronize--sync-1.svg"
              />
            </div>

            <h2 className="font-display-md-semibold font-[number:var(--display-md-semibold-font-weight)] text-[#f5f5f6] text-[length:var(--display-md-semibold-font-size)] tracking-[var(--display-md-semibold-letter-spacing)] leading-[var(--display-md-semibold-line-height)] [font-style:var(--display-md-semibold-font-style)]">
              Infrastructure for AI
            </h2>
          </div>

          <p className="font-text-md-regular font-[number:var(--text-md-regular-font-weight)] text-[#94969c] text-[length:var(--text-md-regular-font-size)] tracking-[var(--text-md-regular-letter-spacing)] leading-[var(--text-md-regular-line-height)] [font-style:var(--text-md-regular-font-style)]">
            Run production-grade AI safely, efficiently, and at scale — in your
            infrastructure, under your control.
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

      <div className="flex flex-col items-start gap-4 max-w-screen-xl px-8 py-0 w-full">
        <h2 className="mt-[-1.00px] font-text-xl-semibold font-[number:var(--text-xl-semibold-font-weight)] text-[#f5f5f6] text-[length:var(--text-xl-semibold-font-size)] tracking-[var(--text-xl-semibold-letter-spacing)] leading-[var(--text-xl-semibold-line-height)] [font-style:var(--text-xl-semibold-font-style)]">
          Engineering the layer where intelligence runs.
        </h2>

        <p className="font-text-xl-regular font-[number:var(--text-xl-regular-font-weight)] text-[#94969c] text-[length:var(--text-xl-regular-font-size)] tracking-[var(--text-xl-regular-letter-spacing)] leading-[var(--text-xl-regular-line-height)] [font-style:var(--text-xl-regular-font-style)]">
          We design, deploy, and operate on-premise or cloud-native AI
          infrastructures optimized for LLMs, multimodal models, and agent
          systems — secure, compliant, and performance-tuned for enterprise
          workloads.
        </p>
      </div>
    </section>
  );
};
