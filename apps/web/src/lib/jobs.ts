// Job data - in a real app this would come from an API or CMS
export const jobsData: Record<string, {
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
