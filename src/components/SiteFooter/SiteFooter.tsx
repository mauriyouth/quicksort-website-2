import { Link } from "react-router-dom";
import { Button } from "../ui/button";
import { SectionGridOverlay } from "../SectionGridOverlay";
import { SectionSeparator } from "../SectionSeparator";

const navigationLinks = [
    { label: "AI for Business", href: "/ai-for-business" },
    { label: "Data for AI", href: "/data-for-ai" },
    { label: "Infrastructure for AI", href: "/infrastructure-for-ai" },
    { label: "Careers", href: "/career" },
    { label: "Blog", href: "/blog" },
];

const contactInfo = [
    {
        label: "hello@quicksort.fr",
        href: "mailto:hello@quicksort.fr",
        isLink: true,
    },
    { label: "+33 6 30 05 99 01", isLink: false },
    { label: "142 Rue Rivoli 75001 Paris", isLink: false },
];

const decorativeRectangles = [
    { top: "top-[-25px]", borderColor: "border-white" },
    { top: "top-[5px]", borderColor: "border-[#ccff00]" },
    { top: "top-[23px]", borderColor: "border-white" },
    { top: "top-[49px]", borderColor: "border-white" },
    { top: "top-[85px]", borderColor: "border-white" },
];

interface SiteFooterProps {
    /** 
     * Variant of the footer layout
     * - "centered": Logo, headline, and CTA are centered (default)
     * - "homepage": Left-aligned content with decorative rectangles and grid overlay
     */
    variant?: "centered" | "homepage";
    /**
     * Whether to show the decorative grid overlay (only applies to homepage variant)
     */
    showGridOverlay?: boolean;
    /**
     * Whether to show the section separator
     */
    showSeparator?: boolean;
}

export const SiteFooter = ({
    variant = "centered",
    showGridOverlay = true,
    showSeparator = true,
}: SiteFooterProps): JSX.Element => {
    const isHomepage = variant === "homepage";

    return (
        <footer
            className={`flex flex-col items-center w-full bg-[#141414] ${isHomepage
                    ? "gap-8 sm:gap-12 md:gap-16 pt-12 sm:pt-16 pb-8 sm:pb-12 px-0 relative"
                    : "gap-16 pt-16 pb-12 px-0"
                }`}
        >
            {/* Grid Overlay - only for homepage variant */}
            {isHomepage && showGridOverlay && <SectionGridOverlay showCenterLine={false} />}

            {/* Main Content */}
            <div
                className={`flex max-w-screen-xl w-full ${isHomepage
                        ? "flex-col lg:flex-row items-center justify-center gap-8 sm:gap-12 lg:gap-8 px-4 sm:px-8 py-0 relative z-[1]"
                        : "items-center justify-center gap-8 px-8 py-0"
                    }`}
            >
                <div
                    className={`flex flex-col justify-center ${isHomepage
                            ? "items-start gap-8 sm:gap-10 md:gap-12 relative flex-1 w-full lg:w-auto"
                            : "items-center gap-12 flex-1"
                        }`}
                >
                    {/* Logo */}
                    <Link
                        to="/"
                        className={`relative w-[138.22px] h-7 ${isHomepage ? "shrink-0" : ""}`}
                    >
                        <div className="absolute top-0 left-[34px] [font-family:'Inter',Helvetica] font-medium text-neutral-50 text-[22.9px] tracking-[-0.69px] leading-[normal]">
                            Quicksort
                        </div>
                        <div className="absolute top-px left-0 w-[29px] h-[27px]">
                            <div className="top-0 left-0 w-[26px] h-[26px] rounded-[12.99px] absolute bg-neutral-50" />
                            <div className="absolute top-[9px] left-[15px] w-[9px] h-[17px] bg-[#141414] rounded-[17.76px] rotate-[-47.64deg]" />
                            <div className="top-4 left-[19px] w-[9px] h-[9px] rounded-[4.39px] absolute bg-neutral-50" />
                        </div>
                    </Link>

                    {/* Headline & Subheadline */}
                    <div
                        className={`flex flex-col max-w-screen-md w-full ${isHomepage
                                ? "justify-center gap-3 sm:gap-4 items-start relative"
                                : "items-center justify-center gap-4"
                            }`}
                    >
                        <h2
                            className={`font-display-sm-semibold font-[number:var(--display-sm-semibold-font-weight)] text-[#f5f5f6] tracking-[var(--display-sm-semibold-letter-spacing)] [font-style:var(--display-sm-semibold-font-style)] ${isHomepage
                                    ? "mt-[-1.00px] text-xl sm:text-2xl md:text-[length:var(--display-sm-semibold-font-size)] leading-[1.2] md:leading-[var(--display-sm-semibold-line-height)] relative self-stretch"
                                    : "self-stretch mt-[-1.00px] text-[length:var(--display-sm-semibold-font-size)] text-center leading-[var(--display-sm-semibold-line-height)]"
                                }`}
                        >
                            Let&apos;s design your AI transformation
                        </h2>

                        <p
                            className={`font-text-xl-regular font-[number:var(--text-xl-regular-font-weight)] text-[#94969c] tracking-[var(--text-xl-regular-letter-spacing)] leading-[var(--text-xl-regular-line-height)] [font-style:var(--text-xl-regular-font-style)] ${isHomepage
                                    ? "relative self-stretch text-base sm:text-lg md:text-[length:var(--text-xl-regular-font-size)]"
                                    : "text-center self-stretch text-[length:var(--text-xl-regular-font-size)]"
                                }`}
                        >
                            Strategic partnerships built on elite talent and proven delivery
                        </p>
                    </div>

                    {/* CTA Button */}
                    <div className="inline-flex items-start gap-3">
                        <a href="mailto:hello@quicksort.fr">
                            <Button
                                className={`gap-2.5 bg-[#ccff00] hover:bg-[#ccff00]/90 rounded-lg border border-solid border-black shadow-shadows-shadow-xs ${isHomepage
                                        ? "px-5 sm:px-[22px] py-3 sm:py-4 text-black font-text-lg-semibold font-[number:var(--text-lg-semibold-font-weight)] text-sm sm:text-[length:var(--text-lg-semibold-font-size)] tracking-[var(--text-lg-semibold-letter-spacing)] leading-[var(--text-lg-semibold-line-height)] [font-style:var(--text-lg-semibold-font-style)]"
                                        : "px-[22px] py-4"
                                    }`}
                            >
                                {!isHomepage && (
                                    <span className="font-text-lg-semibold font-[number:var(--text-lg-semibold-font-weight)] text-black text-[length:var(--text-lg-semibold-font-size)] tracking-[var(--text-lg-semibold-letter-spacing)] leading-[var(--text-lg-semibold-line-height)] [font-style:var(--text-lg-semibold-font-style)]">
                                        Get in touch
                                    </span>
                                )}
                                {isHomepage && "Get in touch"}
                            </Button>
                        </a>
                    </div>
                </div>

                {/* Decorative Rectangles - only for homepage variant */}
                {isHomepage && (
                    <div className="hidden lg:block relative w-[309.55px] h-[228.48px] rotate-[-16.24deg] shrink-0">
                        {decorativeRectangles.map((rect, index) => (
                            <div
                                key={index}
                                className={`absolute ${rect.top} left-[74px] w-[162px] h-[169px] border-[1.79px] border-solid ${rect.borderColor} rotate-[-22.65deg]`}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* Separator - only for homepage variant */}
            {isHomepage && showSeparator && (
                <div className="w-full flex justify-center">
                    <SectionSeparator />
                </div>
            )}

            {/* Bottom Section with Nav & Contact */}
            <div
                className={`flex flex-col max-w-screen-xl items-center justify-center w-full ${isHomepage
                        ? "gap-6 sm:gap-8 px-4 sm:px-8 py-0 relative z-[1]"
                        : "gap-8 px-8 py-0"
                    }`}
            >
                <div
                    className={`flex items-center justify-between self-stretch w-full ${isHomepage
                            ? "flex-col sm:flex-row sm:flex-wrap gap-4 sm:gap-6 md:gap-[24px_32px] pt-6 sm:pt-8 pb-0 px-0 relative"
                            : "flex-wrap gap-[24px_32px] pt-8 pb-0 px-0 border-t [border-top-style:solid] border-[#1f242f]"
                        }`}
                >
                    {/* Copyright */}
                    <p
                        className={`w-fit mt-[-1.00px] font-text-md-regular font-[number:var(--text-md-regular-font-weight)] text-[#94969c] tracking-[var(--text-md-regular-letter-spacing)] leading-[var(--text-md-regular-line-height)] whitespace-nowrap [font-style:var(--text-md-regular-font-style)] ${isHomepage
                                ? "relative text-sm sm:text-[length:var(--text-md-regular-font-size)] order-3 sm:order-1"
                                : "text-[length:var(--text-md-regular-font-size)]"
                            }`}
                    >
                        © {new Date().getFullYear()} Copyright Quicksort
                    </p>

                    {/* Navigation Links */}
                    <nav
                        className={`inline-flex items-start ${isHomepage
                                ? "flex-wrap h-auto gap-3 sm:gap-4 relative order-1 sm:order-2"
                                : "h-6 gap-4"
                            }`}
                    >
                        {navigationLinks.map((link, index) =>
                            link.href.startsWith("/") ? (
                                <Link
                                    key={index}
                                    to={link.href}
                                    className={`w-fit mt-[-1.00px] font-text-md-regular font-[number:var(--text-md-regular-font-weight)] text-[#94969c] tracking-[var(--text-md-regular-letter-spacing)] leading-[var(--text-md-regular-line-height)] whitespace-nowrap [font-style:var(--text-md-regular-font-style)] hover:text-neutral-50 transition-colors ${isHomepage
                                            ? "relative text-sm sm:text-[length:var(--text-md-regular-font-size)]"
                                            : "text-[length:var(--text-md-regular-font-size)]"
                                        }`}
                                >
                                    {link.label}
                                </Link>
                            ) : (
                                <a
                                    key={index}
                                    href={link.href}
                                    className={`w-fit mt-[-1.00px] font-text-md-regular font-[number:var(--text-md-regular-font-weight)] text-[#94969c] tracking-[var(--text-md-regular-letter-spacing)] leading-[var(--text-md-regular-line-height)] whitespace-nowrap [font-style:var(--text-md-regular-font-style)] hover:text-neutral-50 transition-colors ${isHomepage
                                            ? "relative text-sm sm:text-[length:var(--text-md-regular-font-size)]"
                                            : "text-[length:var(--text-md-regular-font-size)]"
                                        }`}
                                >
                                    {link.label}
                                </a>
                            )
                        )}
                    </nav>

                    {/* Contact Info */}
                    <div
                        className={`inline-flex items-start ${isHomepage
                                ? "flex-wrap h-auto gap-3 sm:gap-4 relative order-2 sm:order-3"
                                : "h-6 gap-4"
                            }`}
                    >
                        {contactInfo.map((info, index) => (
                            <div
                                key={index}
                                className={`w-fit mt-[-1.00px] font-text-md-regular font-[number:var(--text-md-regular-font-weight)] text-[#94969c] tracking-[var(--text-md-regular-letter-spacing)] leading-[var(--text-md-regular-line-height)] whitespace-nowrap [font-style:var(--text-md-regular-font-style)] ${isHomepage
                                        ? "relative text-sm sm:text-[length:var(--text-md-regular-font-size)]"
                                        : "text-[length:var(--text-md-regular-font-size)]"
                                    }`}
                            >
                                {info.isLink ? (
                                    <a
                                        href={info.href}
                                        rel="noopener noreferrer"
                                        target="_blank"
                                        className="underline hover:text-neutral-50 transition-colors"
                                    >
                                        {info.label}
                                    </a>
                                ) : (
                                    info.label
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </footer>
    );
};
