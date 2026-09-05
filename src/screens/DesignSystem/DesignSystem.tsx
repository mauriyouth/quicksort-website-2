import { useEffect } from "react";
import { MainNavigationSection } from "@components/MainNavigationSection";
import { SiteFooter } from "@components/SiteFooter";
import { ThemeToggle } from "@components/ThemeToggle";
import { useTheme } from "@lib/theme";
import { ColorFoundations } from "./parts/ColorFoundations";
import { ComponentGallery } from "./parts/ComponentGallery";
import { ScaleFoundations } from "./parts/ScaleFoundations";
import { TypeFoundations } from "./parts/TypeFoundations";
import { UsageRules } from "./parts/UsageRules";

const SECTIONS = [
    { id: "colour", label: "Colour" },
    { id: "type", label: "Type" },
    { id: "scale", label: "Space & motion" },
    { id: "components", label: "Components" },
    { id: "using", label: "Using the system" },
];

/**
 * Keep this page out of search results. It is reachable by URL for anyone
 * who needs it, but it is a reference surface, not a marketing page.
 */
const useNoIndex = () => {
    useEffect(() => {
        const meta = document.createElement("meta");
        meta.name = "robots";
        meta.content = "noindex, nofollow";
        document.head.appendChild(meta);

        const previousTitle = document.title;
        document.title = "Design System — Quicksort";

        return () => {
            document.head.removeChild(meta);
            document.title = previousTitle;
        };
    }, []);
};

export const DesignSystem = (): JSX.Element => {
    useNoIndex();
    const { theme } = useTheme();

    return (
        <main className="relative flex w-full flex-col items-center overflow-x-hidden bg-surface">
            <MainNavigationSection />

            {/* Masthead — the brand grid and halo, used as intended. */}
            <header className="relative w-full overflow-hidden border-b border-line">
                <div className="qs-halo" />
                <div className="qs-grid-bg qs-grid-mask absolute inset-0" />

                <div className="relative mx-auto w-full max-w-screen-xl px-qs-5 py-qs-9 sm:px-qs-8">
                    <p className="font-qs-sans text-xs font-medium uppercase tracking-[0.12em] text-ink-muted">
                        Quicksort
                    </p>
                    <h1 className="mt-qs-4 max-w-[18ch] font-qs-display text-4xl leading-[1.05] text-ink sm:text-6xl md:text-7xl">
                        Design system
                    </h1>
                    <p className="mt-qs-5 max-w-[58ch] text-base leading-relaxed text-ink-2 sm:text-lg">
                        The tokens, type and components behind quicksort.fr — rendered from
                        the code the site actually runs, in whichever theme you are reading
                        it in.
                    </p>

                    <div className="mt-qs-7 flex flex-wrap items-center gap-qs-4">
                        <ThemeToggle />
                        <span className="text-sm text-ink-muted">
                            Currently{" "}
                            <span className="font-semibold text-ink">{theme}</span> mode —
                            every specimen on this page follows it.
                        </span>
                    </div>
                </div>
            </header>

            {/* Section jump list */}
            <nav
                aria-label="Design system sections"
                className="sticky top-20 z-40 w-full border-b border-line bg-surface/90 backdrop-blur-md"
            >
                <div className="mx-auto flex w-full max-w-screen-xl gap-qs-5 overflow-x-auto px-qs-5 py-qs-4 sm:px-qs-8">
                    {SECTIONS.map((section) => (
                        <a
                            key={section.id}
                            href={`#${section.id}`}
                            className="whitespace-nowrap text-sm text-ink-muted transition-colors duration-qs-2 ease-qs hover:text-ink"
                        >
                            {section.label}
                        </a>
                    ))}
                </div>
            </nav>

            <div className="mx-auto w-full max-w-screen-xl px-qs-5 pb-qs-10 sm:px-qs-8">
                <ColorFoundations />
                <TypeFoundations />
                <ScaleFoundations />
                <ComponentGallery />
                <UsageRules />
            </div>

            <SiteFooter />
        </main>
    );
};
