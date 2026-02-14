import { ArrowRightIcon, TrendingUpIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@components/ui/card";
import { SectionGridOverlay } from "@components/SectionGridOverlay";
import { SectionSeparator } from "@components/SectionSeparator";

// Custom Infrastructure Icon component - inline SVG for hover color support
const InfrastructureIcon = ({ className }: { className?: string }) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 26 26"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
  >
    <g clipPath="url(#clip0_infra)">
      <g clipPath="url(#clip1_infra)">
        <path
          d="M13.2022 11.9007V18.3871M13.2022 18.3871C12.0076 18.3871 11.0401 19.3547 11.0401 20.5493C11.0401 21.7439 12.0076 22.7114 13.2022 22.7114C14.3968 22.7114 15.3644 21.7439 15.3644 20.5493C15.3644 19.3547 14.3968 18.3871 13.2022 18.3871ZM20.7697 22.7114C19.5751 22.7114 18.6076 21.7439 18.6076 20.5493C18.6076 19.3547 19.5751 18.3871 20.7697 18.3871C21.9643 18.3871 22.9319 19.3547 22.9319 20.5493C22.9319 21.7439 21.9643 22.7114 20.7697 22.7114ZM5.63471 22.7114C4.44013 22.7114 3.47257 21.7439 3.47257 20.5493C3.47257 19.3547 4.44013 18.3871 5.63471 18.3871C6.8293 18.3871 7.79686 19.3547 7.79686 20.5493C7.79686 21.7439 6.8293 22.7114 5.63471 22.7114Z"
          stroke="currentColor"
          strokeWidth="1.59948"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M5.63489 18.3863V16.2242C5.63489 15.6274 6.11921 15.1431 6.71596 15.1431H19.6888C20.2856 15.1431 20.7699 15.6274 20.7699 16.2242V18.3863M5.63489 4.87293C5.63489 3.37997 9.02297 2.17025 13.2024 2.17025C17.3818 2.17025 20.7699 3.37997 20.7699 4.87293V9.19722C20.7699 10.6902 17.3818 11.8999 13.2024 11.8999C9.02297 11.8999 5.63489 10.6902 5.63489 9.19722V4.87293Z"
          stroke="currentColor"
          strokeWidth="1.59948"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M20.7699 4.87315C20.7699 6.36611 17.3818 7.57583 13.2024 7.57583C9.02297 7.57583 5.63489 6.36611 5.63489 4.87315"
          stroke="currentColor"
          strokeWidth="1.59948"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </g>
    <defs>
      <clipPath id="clip0_infra">
        <rect width="25.6452" height="25.6452" fill="white" transform="scale(1.01384)" />
      </clipPath>
      <clipPath id="clip1_infra">
        <rect width="25.5916" height="25.5916" fill="white" transform="translate(0.229574 0.0079206) scale(1.01384)" />
      </clipPath>
    </defs>
  </svg>
);

// Custom Data for AI Icon component - inline SVG for hover color support
const DataForAiIcon = ({ className }: { className?: string }) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 27 27"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
  >
    <g clipPath="url(#clip0_data)">
      <path
        d="M16.875 3.37444H21.6967C22.761 3.37444 23.625 4.23844 23.625 5.30269V8.99943M23.6238 19.1244C23.6238 20.3675 21.861 21.3744 19.6863 21.3744C17.5117 21.3744 15.75 20.3664 15.75 19.1244M15.75 15.7494C15.75 16.9926 17.5128 17.9994 19.6875 17.9994C21.8621 17.9994 23.625 16.9926 23.625 15.7494"
        stroke="currentColor"
        strokeWidth="1.63211"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10.1247 23.6244H5.303C4.23876 23.6244 3.37476 22.7604 3.37476 21.6962V17.9994M15.7497 15.7494C15.7509 14.5074 17.5137 13.4994 19.6872 13.4994C21.8607 13.4994 23.6247 14.5063 23.6236 15.7494V22.4994C23.6236 23.7425 21.8607 24.7494 19.6861 24.7494C17.5115 24.7494 15.7497 23.7414 15.7497 22.4994V15.7494ZM12.0001 5.02819H8.83438C8.58575 5.02819 8.354 4.90556 8.2145 4.69969L7.535 3.70181C7.3955 3.49706 7.16375 3.37444 6.91513 3.37444H4.87438C4.04638 3.37444 3.37476 4.04606 3.37476 4.87406V10.8737C3.37476 11.7028 4.04638 12.3744 4.87438 12.3744H11.999C12.8281 12.3744 13.4997 11.7028 13.4997 10.8748V6.52781C13.4997 5.69981 12.8281 5.02819 12.0001 5.02819Z"
        stroke="currentColor"
        strokeWidth="1.63211"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
    <defs>
      <clipPath id="clip0_data">
        <rect width="26.1137" height="26.1137" fill="white" transform="scale(1.03394)" />
      </clipPath>
    </defs>
  </svg>
);

const serviceCards = [
  {
    icon: TrendingUpIcon,
    title: "AI for business",
    description:
      "We build custom AI workspaces and agents that embed directly into your operations. Our systems connect people, data, and tools into orchestrated environments where human judgment validates agent reasoning — automating coordination, and decision loops.",
    bgColor: "bg-[#101010]",
    iconBg: "bg-[#309eff]",
    href: "/ai-for-business",
  },
  {
    icon: DataForAiIcon,
    title: "Data for AI",
    description:
      "We transform fragmented enterprise data into structured, contextual intelligence ready for AI consumption — enabling models and agents to reason, learn, and act with precision.",
    bgColor: "bg-[#101010]",
    iconBg: "bg-[#FF303E]",
    href: "/data-for-ai",
  },
  {
    icon: InfrastructureIcon,
    title: "Infrastructure for AI",
    description:
      "We design, deploy, and operate on-premise or cloud-native AI infrastructures optimized for LLMs, multimodal models, and agent systems — secure, compliant, and performance-tuned for enterprise workloads.",
    bgColor: "bg-[#101010]",
    iconBg: "bg-[#3AE165]",
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
    <section className="relative flex flex-col items-center gap-8 sm:gap-12 md:gap-16 px-0 py-4 sm:py-6 md:py-8 w-full bg-[#141414]">
      <SectionGridOverlay showCenterLine={false} />
      <div className="flex flex-col max-w-screen-xl items-start gap-6 sm:gap-8 px-4 sm:px-8 py-0 w-full relative z-[1]">
        <div className="flex flex-col items-start gap-6 sm:gap-8 w-full">
          <div className="flex flex-col items-start gap-4 sm:gap-5 w-full">
            <div className="flex flex-col items-start gap-3 w-full">
              <h2 className="font-display-md-semibold font-[number:var(--display-md-semibold-font-weight)] text-2xl sm:text-3xl md:text-[length:var(--display-md-semibold-font-size)] tracking-[var(--display-md-semibold-letter-spacing)] leading-[1.2] md:leading-[var(--display-md-semibold-line-height)] text-[#f5f5f6] [font-style:var(--display-md-semibold-font-style)]">
                Our Services
              </h2>
            </div>

            <p className="font-text-xl-regular font-[number:var(--text-xl-regular-font-weight)] text-[#94969c] text-base sm:text-lg md:text-[length:var(--text-xl-regular-font-size)] tracking-[var(--text-xl-regular-letter-spacing)] leading-[var(--text-xl-regular-line-height)] [font-style:var(--text-xl-regular-font-style)]">
              Right-sized innovation. Real systems. Compounding value.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-col max-w-screen-xl items-start gap-8 sm:gap-12 md:gap-16 px-4 sm:px-8 py-0 w-full relative z-[1]">
        <div className="flex flex-col sm:grid sm:grid-cols-2 lg:grid-cols-3 items-stretch gap-4 sm:gap-6 w-full">
          {serviceCards.map((card, index) => {
            const Icon = card.icon;
            return (
              <Link
                key={index}
                to={card.href || "#"}
                className="flex flex-1 min-w-0 w-full h-full group"
              >
                <Card className="flex-col w-full gap-4 sm:gap-6 p-4 sm:p-6 flex-1 h-full bg-[#101010] border-0 rounded-none transition-colors duration-300 group-hover:bg-[#1c1c1c]">
                  <CardContent className="flex flex-col gap-4 sm:gap-6 p-0 h-full">
                    <div
                      className={`flex-shrink-0 w-[47px] h-[47px] ${card.iconBg} rounded-lg flex items-center justify-center transition-colors duration-300 group-hover:bg-[#ccff00]`}
                    >
                      <Icon className="w-5 h-5 text-white transition-colors duration-300 group-hover:text-black" />
                    </div>

                    <div className="flex flex-col items-start gap-4 sm:gap-5 w-full flex-1">
                      <div className="flex flex-col items-start gap-2 w-full">
                        <h3 className="font-text-xl-semibold font-[number:var(--text-xl-semibold-font-weight)] text-white text-lg sm:text-xl md:text-[length:var(--text-xl-semibold-font-size)] tracking-[var(--text-xl-semibold-letter-spacing)] leading-[var(--text-xl-semibold-line-height)] [font-style:var(--text-xl-semibold-font-style)] transition-colors duration-300 group-hover:text-[#ccff00]">
                          {card.title}
                        </h3>

                        <p className="text-[#94969c] font-text-md-regular font-[number:var(--text-md-regular-font-weight)] text-sm sm:text-[length:var(--text-md-regular-font-size)] tracking-[var(--text-md-regular-letter-spacing)] leading-[var(--text-md-regular-line-height)] [font-style:var(--text-md-regular-font-style)]">
                          {card.description}
                        </p>
                      </div>

                      <div className="inline-flex items-center justify-center gap-2 cursor-pointer mt-auto">
                        <span className="font-text-md-semibold font-[number:var(--text-md-semibold-font-weight)] text-[#cecfd2] text-sm sm:text-[length:var(--text-md-semibold-font-size)] tracking-[var(--text-md-semibold-letter-spacing)] leading-[var(--text-md-semibold-line-height)] whitespace-nowrap [font-style:var(--text-md-semibold-font-style)] transition-colors duration-300 group-hover:text-[#ccff00]">
                          See more
                        </span>
                        <ArrowRightIcon className="w-5 h-5 text-[#cecfd2] transition-colors duration-300 group-hover:text-[#ccff00]" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>

      <SectionSeparator />

      <div className="flex flex-col items-center justify-center gap-12 sm:gap-16 md:gap-20 px-0 py-4 sm:py-6 md:py-8 w-full relative z-[1]">
        <div className="flex flex-col lg:flex-row max-w-screen-xl items-start justify-center gap-12 sm:gap-16 lg:gap-[130px] px-4 sm:px-8 py-0 w-full">
          <div className="flex flex-col max-w-full lg:max-w-[720px] lg:w-[480px] items-start gap-8 sm:gap-12 w-full">
            <div className="flex flex-col max-w-screen-md gap-3 items-start w-full">
              <div className="font-text-md-semibold font-[number:var(--text-md-semibold-font-weight)] text-[#ccff00] text-sm sm:text-[length:var(--text-md-semibold-font-size)] tracking-[var(--text-md-semibold-letter-spacing)] leading-[var(--text-md-semibold-line-height)] [font-style:var(--text-md-semibold-font-style)]">
                Technology Expertise
              </div>

              <h3 className="font-display-md-semibold font-[number:var(--display-md-semibold-font-weight)] text-2xl sm:text-3xl md:text-[length:var(--display-md-semibold-font-size)] tracking-[var(--display-md-semibold-letter-spacing)] leading-[1.2] md:leading-[var(--display-md-semibold-line-height)] text-[#f5f5f6] [font-style:var(--display-md-semibold-font-style)]">
                Advanced AI Capabilities
              </h3>
            </div>

            <div className="flex flex-col max-w-full lg:max-w-[560px] items-start gap-4 sm:gap-6 w-full">
              {advancedCapabilities.map((capability, index) => (
                <div
                  key={index}
                  className="min-w-0 max-w-full lg:max-w-[560px] gap-4 w-full flex items-start"
                >
                  <div className="flex flex-col items-start gap-4 sm:gap-5 flex-1">
                    <div className="flex flex-col items-start gap-2 pt-2.5 pb-0 px-0 w-full">
                      <h4 className="font-text-xl-semibold font-[number:var(--text-xl-semibold-font-weight)] text-[#f5f5f6] text-lg sm:text-xl md:text-[length:var(--text-xl-semibold-font-size)] tracking-[var(--text-xl-semibold-letter-spacing)] leading-[var(--text-xl-semibold-line-height)] [font-style:var(--text-xl-semibold-font-style)]">
                        {capability.title}
                      </h4>

                      <p className="text-[#94969c] font-text-md-regular font-[number:var(--text-md-regular-font-weight)] text-sm sm:text-[length:var(--text-md-regular-font-size)] tracking-[var(--text-md-regular-letter-spacing)] leading-[var(--text-md-regular-line-height)] [font-style:var(--text-md-regular-font-style)]">
                        {capability.description}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col max-w-full lg:max-w-[720px] lg:w-[480px] items-start gap-8 sm:gap-12 w-full">
            <div className="flex flex-col max-w-screen-md gap-3 items-start w-full">
              <div className="font-text-md-semibold font-[number:var(--text-md-semibold-font-weight)] text-[#ccff00] text-sm sm:text-[length:var(--text-md-semibold-font-size)] tracking-[var(--text-md-semibold-letter-spacing)] leading-[var(--text-md-semibold-line-height)] [font-style:var(--text-md-semibold-font-style)]">
                Technology Expertise
              </div>

              <h3 className="font-display-md-semibold font-[number:var(--display-md-semibold-font-weight)] text-2xl sm:text-3xl md:text-[length:var(--display-md-semibold-font-size)] tracking-[var(--display-md-semibold-letter-spacing)] leading-[1.2] md:leading-[var(--display-md-semibold-line-height)] text-[#f5f5f6] [font-style:var(--display-md-semibold-font-style)]">
                Integration Expertise
              </h3>
            </div>

            <div className="flex flex-col max-w-full lg:max-w-[560px] items-start gap-4 sm:gap-6 w-full">
              {integrationExpertise.map((expertise, index) => (
                <div
                  key={index}
                  className="min-w-0 max-w-full lg:max-w-[560px] gap-4 w-full flex items-start"
                >
                  <div className="flex flex-col items-start gap-4 sm:gap-5 flex-1">
                    <div className="flex flex-col items-start gap-2 pt-2.5 pb-0 px-0 w-full">
                      <h4 className="font-text-xl-semibold font-[number:var(--text-xl-semibold-font-weight)] text-[#f5f5f6] text-lg sm:text-xl md:text-[length:var(--text-xl-semibold-font-size)] tracking-[var(--text-xl-semibold-letter-spacing)] leading-[var(--text-xl-semibold-line-height)] [font-style:var(--text-xl-semibold-font-style)]">
                        {expertise.title}
                      </h4>

                      <p className="text-[#94969c] font-text-md-regular font-[number:var(--text-md-regular-font-weight)] text-sm sm:text-[length:var(--text-md-regular-font-size)] tracking-[var(--text-md-regular-letter-spacing)] leading-[var(--text-md-regular-line-height)] [font-style:var(--text-md-regular-font-style)]">
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
      <SectionSeparator />
    </section>
  );
};
