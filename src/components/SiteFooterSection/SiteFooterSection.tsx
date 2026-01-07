import { Link } from "react-router-dom";
import { Button } from "../ui/button";

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
    { label: "+33 6 30 05 99 01", href: "#", isLink: false },
    { label: "142 Rue Rivoli 75001 Paris", href: "#", isLink: false },
];

export const SiteFooterSection = (): JSX.Element => {
    return (
        <footer className="flex flex-col items-center gap-16 pt-16 pb-12 px-0 w-full bg-[#141414]">
            <div className="flex items-center justify-center gap-8 max-w-screen-xl px-8 py-0 w-full">
                <div className="flex flex-col items-center justify-center gap-12 flex-1">
                    <Link to="/" className="relative w-[138.22px] h-7">
                        <div className="absolute top-0 left-[34px] [font-family:'Inter',Helvetica] font-medium text-neutral-50 text-[22.9px] tracking-[-0.69px] leading-[normal]">
                            Quicksort
                        </div>

                        <div className="absolute top-px left-0 w-[29px] h-[27px]">
                            <div className="top-0 left-0 w-[26px] h-[26px] rounded-[12.99px] absolute bg-neutral-50" />

                            <div className="absolute top-[9px] left-[15px] w-[9px] h-[17px] bg-[#141414] rounded-[17.76px] rotate-[-47.64deg]" />

                            <div className="top-4 left-[19px] w-[9px] h-[9px] rounded-[4.39px] absolute bg-neutral-50" />
                        </div>
                    </Link>

                    <div className="flex flex-col max-w-screen-md items-center justify-center gap-4 w-full">
                        <h2 className="self-stretch mt-[-1.00px] font-display-sm-semibold font-[number:var(--display-sm-semibold-font-weight)] text-[#f5f5f6] text-[length:var(--display-sm-semibold-font-size)] text-center tracking-[var(--display-sm-semibold-letter-spacing)] leading-[var(--display-sm-semibold-line-height)] [font-style:var(--display-sm-semibold-font-style)]">
                            Let&apos;s get started on something great
                        </h2>

                        <p className="text-center self-stretch font-text-xl-regular font-[number:var(--text-xl-regular-font-weight)] text-[#94969c] text-[length:var(--text-xl-regular-font-size)] tracking-[var(--text-xl-regular-letter-spacing)] leading-[var(--text-xl-regular-line-height)] [font-style:var(--text-xl-regular-font-style)]">
                            Turn ideas into reality
                        </p>
                    </div>

                    <div className="inline-flex items-start gap-3">
                        <Button className="gap-2.5 px-[22px] py-4 bg-[#ccff00] hover:bg-[#b8e600] rounded-lg border border-solid border-black shadow-shadows-shadow-xs">
                            <span className="font-text-lg-semibold font-[number:var(--text-lg-semibold-font-weight)] text-black text-[length:var(--text-lg-semibold-font-size)] tracking-[var(--text-lg-semibold-letter-spacing)] leading-[var(--text-lg-semibold-line-height)] [font-style:var(--text-lg-semibold-font-style)]">
                                Get in touch
                            </span>
                        </Button>
                    </div>
                </div>
            </div>

            <div className="flex flex-col items-center justify-center gap-8 max-w-screen-xl px-8 py-0 w-full">
                <div className="flex flex-wrap items-center justify-between gap-[24px_32px] pt-8 pb-0 px-0 self-stretch w-full border-t [border-top-style:solid] border-[#1f242f]">
                    <p className="w-fit mt-[-1.00px] font-text-md-regular font-[number:var(--text-md-regular-font-weight)] text-[#94969c] text-[length:var(--text-md-regular-font-size)] tracking-[var(--text-md-regular-letter-spacing)] leading-[var(--text-md-regular-line-height)] whitespace-nowrap [font-style:var(--text-md-regular-font-style)]">
                        © {new Date().getFullYear()} Copyright Quicksort
                    </p>

                    <nav className="inline-flex h-6 items-start gap-4">
                        {navigationLinks.map((link, index) => (
                            link.href.startsWith("/") ? (
                                <Link
                                    key={index}
                                    to={link.href}
                                    className="w-fit mt-[-1.00px] font-text-md-regular font-[number:var(--text-md-regular-font-weight)] text-[#94969c] text-[length:var(--text-md-regular-font-size)] tracking-[var(--text-md-regular-letter-spacing)] leading-[var(--text-md-regular-line-height)] whitespace-nowrap [font-style:var(--text-md-regular-font-style)] hover:text-neutral-50 transition-colors"
                                >
                                    {link.label}
                                </Link>
                            ) : (
                                <a
                                    key={index}
                                    href={link.href}
                                    className="w-fit mt-[-1.00px] font-text-md-regular font-[number:var(--text-md-regular-font-weight)] text-[#94969c] text-[length:var(--text-md-regular-font-size)] tracking-[var(--text-md-regular-letter-spacing)] leading-[var(--text-md-regular-line-height)] whitespace-nowrap [font-style:var(--text-md-regular-font-style)] hover:text-neutral-50 transition-colors"
                                >
                                    {link.label}
                                </a>
                            )
                        ))}
                    </nav>

                    <div className="inline-flex h-6 items-start gap-4">
                        {contactInfo.map((info, index) => (
                            <div
                                key={index}
                                className="w-fit mt-[-1.00px] font-text-md-regular font-[number:var(--text-md-regular-font-weight)] text-[#94969c] text-[length:var(--text-md-regular-font-size)] tracking-[var(--text-md-regular-letter-spacing)] leading-[var(--text-md-regular-line-height)] whitespace-nowrap [font-style:var(--text-md-regular-font-style)]"
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
