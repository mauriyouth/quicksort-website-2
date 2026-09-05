import { MainNavigationSection } from "@components/MainNavigationSection";
import { SiteFooter } from "@components/SiteFooter";
import { VoiceAiVisual } from "@components/VoiceAiVisual";
import { SectionGridOverlay } from "@components/SectionGridOverlay";
import { SectionSeparator } from "@components/SectionSeparator";

const voiceCapabilities = [
  {
    title: "Inbound & Outbound Voice Bots",
    description:
      "Natural conversations for service, qualification, booking, follow-ups, surveys, and operational calls.",
  },
  {
    title: "Embedded Voice Interfaces",
    description:
      "Voice-first experiences inside web, mobile, enterprise software, kiosks, and connected products.",
  },
  {
    title: "Real-Time Conversation",
    description:
      "Low-latency dialogue with interruption handling, multilingual speech, memory, and contextual responses.",
  },
  {
    title: "Human Handoffs",
    description:
      "Clear escalation paths that transfer the conversation, context, and next best action to the right person.",
  },
];

const productionCapabilities = [
  {
    title: "Connected to Business Systems",
    description:
      "Secure integrations with CRM, ERP, ticketing, scheduling, knowledge bases, and proprietary tools so conversations lead to completed work.",
  },
  {
    title: "Context, Memory & Safeguards",
    description:
      "Agents grounded in approved enterprise knowledge, with permissions, policy controls, and human oversight designed into every workflow.",
  },
  {
    title: "Production-Grade Operations",
    description:
      "Evaluation, observability, call analytics, security, and private deployment options built for reliable enterprise use.",
  },
];

export const VoiceAi = (): JSX.Element => (
  <div className="flex w-full flex-col items-center overflow-x-hidden bg-[#000000]">
    <MainNavigationSection />

    <main className="flex w-full flex-col items-center">
      <section className="relative flex w-full flex-col items-center gap-12 px-0 py-12 sm:gap-16 sm:py-16 md:py-24">
        <SectionGridOverlay showCenterLine={false} />

        <div className="relative z-[1] flex w-full max-w-screen-xl flex-col items-start gap-8 px-4 sm:px-8 lg:flex-row lg:gap-16">
          <div className="flex w-full max-w-[360px] flex-col items-start gap-5">
            <img
              src="/service-icons/voice-ai.svg"
              alt="Voice AI waveform"
              className="h-[47px] w-[47px]"
            />
            <h1 className="text-3xl font-semibold leading-tight tracking-[-0.72px] text-[#f5f5f6] sm:text-4xl">
              Voice AI
            </h1>
            <p className="text-base leading-6 text-[#94969c] sm:text-lg sm:leading-7">
              Voice bots and conversational interfaces that listen, understand,
              and act across your business.
            </p>
          </div>

          <div className="grid w-full flex-1 grid-cols-1 gap-8 sm:grid-cols-2 sm:gap-x-16">
            {voiceCapabilities.map((capability) => (
              <article key={capability.title} className="flex flex-col gap-2">
                <h2 className="text-lg font-semibold leading-7 text-[#f5f5f6] sm:text-xl">
                  {capability.title}
                </h2>
                <p className="text-sm leading-6 text-[#94969c] sm:text-base">
                  {capability.description}
                </p>
              </article>
            ))}
          </div>
        </div>

        <div className="relative z-[1] flex w-full max-w-screen-xl flex-col gap-4 px-4 sm:px-8">
          <h2 className="text-xl font-semibold leading-8 text-[#f5f5f6]">
            Not scripted phone trees. Voice agents that get work done.
          </h2>
          <p className="max-w-5xl text-base leading-7 text-[#94969c] sm:text-xl sm:leading-8">
            We design and engineer intelligent inbound and outbound voice bots,
            embedded voice interfaces, and real-time agents that understand
            context, execute workflows, and know when to involve a human.
          </p>
        </div>
      </section>

      <SectionSeparator />

      <section className="relative flex w-full flex-col items-center py-12 sm:py-16 md:py-24">
        <SectionGridOverlay showCenterLine={false} />
        <div className="relative z-[1] flex w-full max-w-screen-xl flex-col items-center gap-12 px-4 sm:px-8 lg:flex-row lg:gap-[130px]">
          <div className="flex w-full flex-1 flex-col items-start gap-8 sm:gap-12">
            <div className="flex flex-col gap-3">
              <p className="text-sm font-semibold leading-6 text-[#9B5CFF] sm:text-base">
                From conversations to completed work
              </p>
              <h2 className="text-2xl font-semibold leading-tight tracking-[-0.72px] text-[#f5f5f6] sm:text-3xl md:text-4xl">
                Voice agents connected to the business.
              </h2>
            </div>

            <div className="flex flex-col gap-6">
              {productionCapabilities.map((capability) => (
                <article key={capability.title} className="flex flex-col gap-2">
                  <h3 className="text-lg font-semibold leading-7 text-[#f5f5f6] sm:text-xl">
                    {capability.title}
                  </h3>
                  <p className="text-sm leading-6 text-[#94969c] sm:text-base">
                    {capability.description}
                  </p>
                </article>
              ))}
            </div>
          </div>

          <VoiceAiVisual className="w-full max-w-[435px] shrink-0" />
        </div>
      </section>
    </main>

    <SiteFooter />
  </div>
);
