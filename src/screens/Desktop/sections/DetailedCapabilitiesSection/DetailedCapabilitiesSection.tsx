import { ArrowRightIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "../../../../components/ui/card";

const serviceCards = [
  {
    icon: "/featured-icon.svg",
    title: "AI for business",
    description:
      "We build custom AI workspaces and agents that embed directly into your operations. Our systems connect people, data, and tools into orchestrated environments where human judgment validates agent reasoning — automating coordination, and decision loops.",
    bgColor: "bg-[#101010]",
    href: "/ai-for-business",
  },
  {
    icon: "/database--folder--synchronize--sync-1.svg",
    title: "Data for AI",
    description:
      "We transform fragmented enterprise data into structured, contextual intelligence ready for AI consumption — enabling models and agents to reason, learn, and act with precision.",
    bgColor: "bg-[#101010]",
    iconBg: "bg-[#b12a33]",
    href: "/data-for-ai",
  },
  {
    icon: "/database--folder--synchronize--sync-1-1.svg",
    title: "Infrastructure for AI",
    description:
      "We design, deploy, and operate on-premise or cloud-native AI infrastructures optimized for LLMs, multimodal models, and agent systems — secure, compliant, and performance-tuned for enterprise workloads.",
    bgColor: "bg-[#101010]",
    iconBg: "bg-[#227b39]",
    href: "/infrastructure-for-ai",
  },
];

const advancedCapabilities = [
  {
    title: "Large Language Models",
    description:
      "Design, fine-tuning, and deployment of production-ready LLMs — from RAG architectures to custom model pipelines built for reliability, security, and scale.",
  },
  {
    title: "Computer Vision",
    description:
      "End-to-end visual intelligence systems, including image processing, object detection, and recognition models integrated into real-world workflows.",
  },
  {
    title: "Agentic AI",
    description:
      "Autonomous AI systems capable of reasoning, planning, and executing complex tasks — seamlessly orchestrating tools, APIs, and code to drive real outcomes.",
  },
  {
    title: "Natural Language Processing",
    description:
      "Advanced NLP solutions for document understanding, content generation, and conversational interfaces tailored to enterprise use cases.",
  },
];

const integrationExpertise = [
  {
    title: "Enterprise Systems",
    description:
      "Deep integration with CRM, ERP, databases, and business intelligence platforms to connect AI directly to core business operations.",
  },
  {
    title: "Third-Party APIs",
    description:
      "Secure and reliable connections to payment providers, communication tools, and external data sources — designed for scale and resilience.",
  },
  {
    title: "Development & Platform Tooling",
    description:
      "Production-grade engineering foundations including CI/CD pipelines, observability, automated testing, and security best practices.",
  },
  {
    title: "Data & Infrastructure",
    description:
      "Real-time data processing, vector databases, and knowledge graphs powering high-performance, context-aware AI systems.",
  },
];

export const DetailedCapabilitiesSection = (): JSX.Element => {
  return (
    <section className="flex flex-col items-center gap-16 px-0 py-24 w-full bg-[#141414]">
      <div className="flex flex-col max-w-screen-xl items-start gap-8 px-8 py-0 w-full">
        <div className="flex flex-col items-start gap-8 w-full">
          <div className="flex flex-col items-start gap-5 w-full">
            <div className="flex flex-col items-start gap-3 w-full">
              <h2 className="font-display-md-semibold font-[number:var(--display-md-semibold-font-weight)] text-[length:var(--display-md-semibold-font-size)] tracking-[var(--display-md-semibold-letter-spacing)] leading-[var(--display-md-semibold-line-height)] text-[#f5f5f6] [font-style:var(--display-md-semibold-font-style)]">
                Our Services
              </h2>
            </div>

            <p className="font-text-xl-regular font-[number:var(--text-xl-regular-font-weight)] text-[#94969c] text-[length:var(--text-xl-regular-font-size)] tracking-[var(--text-xl-regular-letter-spacing)] leading-[var(--text-xl-regular-line-height)] [font-style:var(--text-xl-regular-font-style)]">
              Right-sized innovation. Real systems. Compounding value.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-col max-w-screen-xl items-start gap-16 px-8 py-0 w-full">
        <div className="flex flex-wrap items-start gap-6 w-full">
          {serviceCards.map((card, index) => (
            <Card
              key={index}
              className="flex-col min-w-[280px] gap-6 p-6 flex-1 bg-[#101010] border-0 rounded-none"
            >
              <CardContent className="flex flex-col gap-6 p-0">
                {index === 0 ? (
                  <img
                    className="w-[47px] h-[47px]"
                    alt="Featured icon"
                    src={card.icon}
                  />
                ) : (
                  <div
                    className={`w-[47.33px] h-[47.33px] ${card.iconBg} rounded-[9.77px] shadow-[inset_0px_-1.97px_0px_#0a0c120d,inset_0px_0px_0px_0.99px_#0a0c122e] overflow-hidden border-[none] relative before:content-[''] before:absolute before:inset-0 before:p-[1.97px] before:rounded-[9.77px] before:[background:linear-gradient(180deg,rgba(255,255,255,0.12)_0%,rgba(255,255,255,0)_100%)] before:[-webkit-mask:linear-gradient(#fff_0_0)_content-box,linear-gradient(#fff_0_0)] before:[-webkit-mask-composite:xor] before:[mask-composite:exclude] before:z-[1] before:pointer-events-none`}
                  >
                    <img
                      className="absolute top-[11px] left-[11px] w-[26px] h-[26px]"
                      alt="Database folder"
                      src={card.icon}
                    />
                  </div>
                )}

                <div className="flex flex-col items-start gap-5 w-full">
                  <div className="flex flex-col items-start gap-2 w-full">
                    <h3 className="font-text-xl-semibold font-[number:var(--text-xl-semibold-font-weight)] text-white text-[length:var(--text-xl-semibold-font-size)] tracking-[var(--text-xl-semibold-letter-spacing)] leading-[var(--text-xl-semibold-line-height)] [font-style:var(--text-xl-semibold-font-style)]">
                      {card.title}
                    </h3>

                    <p className="text-[#94969c] font-text-md-regular font-[number:var(--text-md-regular-font-weight)] text-[length:var(--text-md-regular-font-size)] tracking-[var(--text-md-regular-letter-spacing)] leading-[var(--text-md-regular-line-height)] [font-style:var(--text-md-regular-font-style)]">
                      {card.description}
                    </p>
                  </div>

                  <Link
                    to={card.href || "#"}
                    className="inline-flex items-center justify-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
                  >
                    <span className="font-text-md-semibold font-[number:var(--text-md-semibold-font-weight)] text-[#cecfd2] text-[length:var(--text-md-semibold-font-size)] tracking-[var(--text-md-semibold-letter-spacing)] leading-[var(--text-md-semibold-line-height)] whitespace-nowrap [font-style:var(--text-md-semibold-font-style)]">
                      See more
                    </span>
                    <ArrowRightIcon className="w-5 h-5 text-[#cecfd2]" />
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <div className="flex flex-col items-center justify-center gap-20 px-0 py-24 w-full bg-[#141414]">
        <div className="flex flex-wrap max-w-screen-xl items-start justify-center gap-[130px] px-8 py-0 w-full">
          <div className="flex flex-col max-w-[720px] w-[480px] items-start gap-12">
            <div className="flex flex-col max-w-screen-md gap-3 items-start w-full">
              <div className="font-text-md-semibold font-[number:var(--text-md-semibold-font-weight)] text-[#ccff00] text-[length:var(--text-md-semibold-font-size)] tracking-[var(--text-md-semibold-letter-spacing)] leading-[var(--text-md-semibold-line-height)] [font-style:var(--text-md-semibold-font-style)]">
                Technology Expertise
              </div>

              <h3 className="font-display-md-semibold font-[number:var(--display-md-semibold-font-weight)] text-[length:var(--display-md-semibold-font-size)] tracking-[var(--display-md-semibold-letter-spacing)] leading-[var(--display-md-semibold-line-height)] text-[#f5f5f6] [font-style:var(--display-md-semibold-font-style)]">
                Advanced AI Capabilities
              </h3>
            </div>

            <div className="flex flex-col max-w-[560px] items-start gap-6 w-full">
              {advancedCapabilities.map((capability, index) => (
                <div
                  key={index}
                  className="min-w-80 max-w-[560px] gap-4 w-full flex items-start"
                >
                  <div className="flex flex-col items-start gap-5 flex-1">
                    <div className="flex flex-col items-start gap-2 pt-2.5 pb-0 px-0 w-full">
                      <h4 className="font-text-xl-semibold font-[number:var(--text-xl-semibold-font-weight)] text-[#f5f5f6] text-[length:var(--text-xl-semibold-font-size)] tracking-[var(--text-xl-semibold-letter-spacing)] leading-[var(--text-xl-semibold-line-height)] [font-style:var(--text-xl-semibold-font-style)]">
                        {capability.title}
                      </h4>

                      <p className="text-[#94969c] font-text-md-regular font-[number:var(--text-md-regular-font-weight)] text-[length:var(--text-md-regular-font-size)] tracking-[var(--text-md-regular-letter-spacing)] leading-[var(--text-md-regular-line-height)] [font-style:var(--text-md-regular-font-style)]">
                        {capability.description}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col max-w-[720px] w-[480px] items-start gap-12">
            <div className="flex flex-col max-w-screen-md gap-3 items-start w-full">
              <div className="font-text-md-semibold font-[number:var(--text-md-semibold-font-weight)] text-[#ccff00] text-[length:var(--text-md-semibold-font-size)] tracking-[var(--text-md-semibold-letter-spacing)] leading-[var(--text-md-semibold-line-height)] [font-style:var(--text-md-semibold-font-style)]">
                Technology Expertise
              </div>

              <h3 className="font-display-md-semibold font-[number:var(--display-md-semibold-font-weight)] text-[length:var(--display-md-semibold-font-size)] tracking-[var(--display-md-semibold-letter-spacing)] leading-[var(--display-md-semibold-line-height)] text-[#f5f5f6] [font-style:var(--display-md-semibold-font-style)]">
                Integration Expertise
              </h3>
            </div>

            <div className="flex flex-col max-w-[560px] items-start gap-6 w-full">
              {integrationExpertise.map((expertise, index) => (
                <div
                  key={index}
                  className="min-w-80 max-w-[560px] gap-4 w-full flex items-start"
                >
                  <div className="flex flex-col items-start gap-5 flex-1">
                    <div className="flex flex-col items-start gap-2 pt-2.5 pb-0 px-0 w-full">
                      <h4 className="font-text-xl-semibold font-[number:var(--text-xl-semibold-font-weight)] text-[#f5f5f6] text-[length:var(--text-xl-semibold-font-size)] tracking-[var(--text-xl-semibold-letter-spacing)] leading-[var(--text-xl-semibold-line-height)] [font-style:var(--text-xl-semibold-font-style)]">
                        {expertise.title}
                      </h4>

                      <p className="text-[#94969c] font-text-md-regular font-[number:var(--text-md-regular-font-weight)] text-[length:var(--text-md-regular-font-size)] tracking-[var(--text-md-regular-letter-spacing)] leading-[var(--text-md-regular-line-height)] [font-style:var(--text-md-regular-font-style)]">
                        {expertise.description}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
