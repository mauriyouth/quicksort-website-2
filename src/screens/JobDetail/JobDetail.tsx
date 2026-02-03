import { useParams, Link } from "react-router-dom";
import { ArrowLeftIcon, MapPinIcon, BriefcaseIcon, DollarSignIcon, ClockIcon } from "lucide-react";
import { Button } from "@components/ui/button";
import { MainNavigationSection } from "@components/MainNavigationSection";
import { SiteFooter } from "@components/SiteFooter";

// Job data - in a real app this would come from an API or CMS
const jobsData: Record<string, {
    title: string;
    location: string;
    contractType: string;
    experience: string;
    salary: string;
    companyDescription: string;
    mission: string;
    projectExamples: string[];
    trainingRnD: string;
    profileRequirements: string[];
    coreValues: string[];
    closingStatement: string;
}> = {
    "senior-ai-ml-engineer": {
        title: "Senior AI & ML Engineer",
        location: "Paris",
        contractType: "Permanent (CDI)",
        experience: "5+ years",
        salary: "€60-90K based on profile",
        companyDescription: "We help organizations deploy reliable, custom, high-impact AI solutions quickly. At Quicksort, we design internal AI agents that are secure and adapted to the most demanding industries: finance, legal, compliance. Our team consists of AI and machine learning experts who combine a rigorous scientific approach with lean methodology to design custom, reliable solutions that are directly operational in production.",
        mission: "As a Senior AI & ML Engineer, you will design and deploy autonomous AI agents that transform our clients' business processes.",
        projectExamples: [
            "Development and production deployment of ML and RAG pipelines.",
            "Development of conversational agents large knowledge base.",
            "Business process copilots (legal, financial analysis...) and Agentic workflows.",
            "Model deployment and management in cloud or on-premise environments, with a focus on performance optimization and Observability."
        ],
        trainingRnD: "In addition to day to day projects, you contribute to R&D projects to enrich our internal products and libraries, accelerating our projects.",
        profileRequirements: [
            "5+ years of experience on production Machine Learning projects.",
            "Mastery of ML pipelines, from design to production.",
            "Excellent Python skills and development best practices.",
            "Deep understanding of modern AI architectures (transformers...).",
            "Familiarity with pipelines evaluations and Observability.",
            "Understanding of Large Language Model deployment challenges and the LLMOps ecosystem.",
            "Practical knowledge of Linux, Kubernetes, Docker.",
            "Experience in technical mentoring."
        ],
        coreValues: [
            "Bias for action.",
            "Excellence.",
            "Leave your ego aside."
        ],
        closingStatement: "We strongly believe AI will permeate every vertical, so let's have fun and build together awesome copilots..."
    }
};

export const JobDetail = (): JSX.Element => {
    const { slug } = useParams<{ slug: string }>();
    const job = slug ? jobsData[slug] : undefined;

    if (!job) {
        return (
            <main className="flex flex-col w-full items-center relative bg-[#141414] min-h-screen overflow-x-hidden">
                <MainNavigationSection />
                <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
                    <h1 className="text-2xl font-bold text-[#f5f5f6] mb-4">Job Not Found</h1>
                    <Link to="/career">
                        <Button variant="outline">Back to Careers</Button>
                    </Link>
                </div>
                <SiteFooter />
            </main>
        );
    }

    return (
        <main className="flex flex-col w-full items-center relative bg-[#141414] min-h-screen overflow-x-hidden">
            <img
                className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-[1440px] h-[722px] pointer-events-none"
                alt="Background pattern"
                src="/background-pattern.svg"
            />

            <MainNavigationSection />

            <article className="flex flex-col max-w-4xl w-full px-4 sm:px-8 py-12 sm:py-16 md:py-24 relative z-10">
                {/* Back navigation */}
                <div className="mb-8">
                    <Link to="/career">
                        <Button
                            variant="ghost"
                            className="gap-2 inline-flex items-center justify-center h-auto p-0 hover:bg-transparent mb-6"
                        >
                            <ArrowLeftIcon className="w-4 h-4 sm:w-5 sm:h-5 text-[#94969c]" />
                            <span className="font-text-sm-semibold font-[number:var(--text-sm-semibold-font-weight)] text-[#94969c] text-xs sm:text-[length:var(--text-sm-semibold-font-size)] tracking-[var(--text-sm-semibold-letter-spacing)] leading-[var(--text-sm-semibold-line-height)] [font-style:var(--text-sm-semibold-font-style)]">
                                Back to Careers
                            </span>
                        </Button>
                    </Link>
                </div>

                {/* Job header */}
                <header className="mb-10">
                    <h1 className="font-display-lg-semibold font-[number:var(--display-lg-semibold-font-weight)] text-[#f5f5f6] text-3xl sm:text-4xl md:text-5xl tracking-[var(--display-lg-semibold-letter-spacing)] leading-[1.2] md:leading-[var(--display-lg-semibold-line-height)] [font-style:var(--display-lg-semibold-font-style)] mb-6">
                        {job.title}
                    </h1>

                    {/* Job meta info */}
                    <div className="flex flex-wrap gap-4 sm:gap-6">
                        <div className="inline-flex items-center gap-2 text-[#94969c]">
                            <MapPinIcon className="w-5 h-5" />
                            <span className="text-sm sm:text-base">{job.location}</span>
                        </div>
                        <div className="inline-flex items-center gap-2 text-[#94969c]">
                            <BriefcaseIcon className="w-5 h-5" />
                            <span className="text-sm sm:text-base">{job.contractType}</span>
                        </div>
                        <div className="inline-flex items-center gap-2 text-[#94969c]">
                            <ClockIcon className="w-5 h-5" />
                            <span className="text-sm sm:text-base">{job.experience}</span>
                        </div>
                        <div className="inline-flex items-center gap-2 text-[#94969c]">
                            <DollarSignIcon className="w-5 h-5" />
                            <span className="text-sm sm:text-base">{job.salary}</span>
                        </div>
                    </div>
                </header>

                {/* Who are we */}
                <section className="mb-10">
                    <h2 className="text-[#f5f5f6] text-xl sm:text-2xl font-semibold mb-4">Who are we?</h2>
                    <p className="text-[#94969c] text-base sm:text-lg leading-relaxed">
                        {job.companyDescription}
                    </p>
                </section>

                {/* Your Mission */}
                <section className="mb-10">
                    <h2 className="text-[#f5f5f6] text-xl sm:text-2xl font-semibold mb-4">Your Mission</h2>
                    <p className="text-[#94969c] text-base sm:text-lg leading-relaxed">
                        {job.mission}
                    </p>
                </section>

                {/* Project Examples */}
                <section className="mb-10">
                    <h2 className="text-[#f5f5f6] text-xl sm:text-2xl font-semibold mb-4">Project Examples</h2>
                    <ul className="space-y-3">
                        {job.projectExamples.map((example, index) => (
                            <li key={index} className="flex items-start gap-3 text-[#94969c] text-base sm:text-lg leading-relaxed">
                                <span className="text-[#ccff00] mt-1.5">•</span>
                                {example}
                            </li>
                        ))}
                    </ul>
                </section>

                {/* Training and R&D */}
                <section className="mb-10">
                    <h2 className="text-[#f5f5f6] text-xl sm:text-2xl font-semibold mb-4">Training and R&D</h2>
                    <p className="text-[#94969c] text-base sm:text-lg leading-relaxed">
                        {job.trainingRnD}
                    </p>
                </section>

                {/* Profile Sought */}
                <section className="mb-10">
                    <h2 className="text-[#f5f5f6] text-xl sm:text-2xl font-semibold mb-4">Profile Sought</h2>
                    <ul className="space-y-3">
                        {job.profileRequirements.map((requirement, index) => (
                            <li key={index} className="flex items-start gap-3 text-[#94969c] text-base sm:text-lg leading-relaxed">
                                <span className="text-[#ccff00] mt-1.5">•</span>
                                {requirement}
                            </li>
                        ))}
                    </ul>
                </section>

                {/* Core Values */}
                <section className="mb-10">
                    <h2 className="text-[#f5f5f6] text-xl sm:text-2xl font-semibold mb-4">Some of our core values</h2>
                    <ul className="space-y-3">
                        {job.coreValues.map((value, index) => (
                            <li key={index} className="flex items-start gap-3 text-[#94969c] text-base sm:text-lg leading-relaxed">
                                <span className="text-[#ccff00] mt-1.5">•</span>
                                {value}
                            </li>
                        ))}
                    </ul>
                </section>

                {/* Closing statement */}
                <section className="mb-10 p-6 bg-[#1f242f]/50 rounded-xl border border-[#1f242f]">
                    <p className="text-[#cecfd2] text-lg sm:text-xl leading-relaxed italic">
                        {job.closingStatement}
                    </p>
                </section>

                {/* Apply CTA */}
                <div className="flex justify-center">
                    <a href="mailto:hello@quicksort.fr">
                        <Button className="gap-2.5 px-8 py-4 bg-[#ccff00] rounded-lg border border-solid border-black shadow-shadows-shadow-xs hover:bg-[#ccff00]/90 h-auto">
                            <span className="font-text-lg-semibold font-[number:var(--text-lg-semibold-font-weight)] text-black text-[length:var(--text-lg-semibold-font-size)] tracking-[var(--text-lg-semibold-letter-spacing)] leading-[var(--text-lg-semibold-line-height)] [font-style:var(--text-lg-semibold-font-style)]">
                                Apply Now
                            </span>
                        </Button>
                    </a>
                </div>
            </article>

            <SiteFooter />
        </main>
    );
};
