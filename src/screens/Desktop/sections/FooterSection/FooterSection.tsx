import { Link } from "react-router-dom";
import { Button } from "../../../../components/ui/button";
import { SectionGridOverlay } from "../../../../components/SectionGridOverlay";
import { SectionSeparator } from "../../../../components/SectionSeparator";

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
  { label: "+33 6 30 05 99 01" },
  { label: "142 Rue Rivoli 75001 Paris" },
];

const decorativeRectangles = [
  { top: "top-[-25px]", borderColor: "border-white" },
  { top: "top-[5px]", borderColor: "border-[#ccff00]" },
  { top: "top-[23px]", borderColor: "border-white" },
  { top: "top-[49px]", borderColor: "border-white" },
  { top: "top-[85px]", borderColor: "border-white" },
];

export const FooterSection = (): JSX.Element => {
  return (
    <footer className="flex flex-col items-center gap-8 sm:gap-12 md:gap-16 pt-12 sm:pt-16 pb-8 sm:pb-12 px-0 relative w-full bg-[#141414]">
      <SectionGridOverlay showCenterLine={false} />
      <div className="flex flex-col lg:flex-row max-w-screen-xl items-center justify-center gap-8 sm:gap-12 lg:gap-8 px-4 sm:px-8 py-0 relative w-full z-[1]">
        <div className="flex flex-col items-start justify-center gap-8 sm:gap-10 md:gap-12 relative flex-1 w-full lg:w-auto">
          <div className="relative w-[138.22px] h-7 shrink-0">
            <div className="absolute top-0 left-[34px] [font-family:'Inter',Helvetica] font-medium text-neutral-50 text-[22.9px] tracking-[-0.69px] leading-[normal]">
              Quicksort
            </div>

            <div className="absolute top-px left-0 w-[29px] h-[27px]">
              <div className="top-0 left-0 w-[26px] h-[26px] rounded-[12.99px] absolute bg-neutral-50" />

              <div className="absolute top-[9px] left-[15px] w-[9px] h-[17px] bg-[#141414] rounded-[17.76px] rotate-[-47.64deg]" />

              <div className="top-4 left-[19px] w-[9px] h-[9px] rounded-[4.39px] absolute bg-neutral-50" />
            </div>
          </div>

          <div className="max-w-screen-md justify-center gap-3 sm:gap-4 w-full flex flex-col items-start relative">
            <h2 className="mt-[-1.00px] font-display-sm-semibold font-[number:var(--display-sm-semibold-font-weight)] text-xl sm:text-2xl md:text-[length:var(--display-sm-semibold-font-size)] tracking-[var(--display-sm-semibold-letter-spacing)] leading-[1.2] md:leading-[var(--display-sm-semibold-line-height)] relative self-stretch text-[#f5f5f6] [font-style:var(--display-sm-semibold-font-style)]">
              Let&apos;s get started on something great
            </h2>

            <p className="relative self-stretch font-text-xl-regular font-[number:var(--text-xl-regular-font-weight)] text-[#94969c] text-base sm:text-lg md:text-[length:var(--text-xl-regular-font-size)] tracking-[var(--text-xl-regular-letter-spacing)] leading-[var(--text-xl-regular-line-height)] [font-style:var(--text-xl-regular-font-style)]">
              Turn ideas into reality
            </p>
          </div>

          <div className="inline-flex items-start gap-3 relative">
            <Button className="gap-2.5 px-5 sm:px-[22px] py-3 sm:py-4 bg-[#ccff00] hover:bg-[#ccff00]/90 rounded-lg border border-solid border-black shadow-shadows-shadow-xs text-black font-text-lg-semibold font-[number:var(--text-lg-semibold-font-weight)] text-sm sm:text-[length:var(--text-lg-semibold-font-size)] tracking-[var(--text-lg-semibold-letter-spacing)] leading-[var(--text-lg-semibold-line-height)] [font-style:var(--text-lg-semibold-font-style)]">
              Get in touch
            </Button>
          </div>
        </div>

        <div className="hidden lg:block relative w-[309.55px] h-[228.48px] rotate-[-16.24deg] shrink-0">
          {decorativeRectangles.map((rect, index) => (
            <div
              key={index}
              className={`absolute ${rect.top} left-[74px] w-[162px] h-[169px] border-[1.79px] border-solid ${rect.borderColor} rotate-[-22.65deg]`}
            />
          ))}
        </div>
      </div>

      <div className="w-full flex justify-center">
        <SectionSeparator />
      </div>

      <div className="flex flex-col max-w-screen-xl items-center justify-center gap-6 sm:gap-8 px-4 sm:px-8 py-0 relative w-full z-[1]">
        <div className="flex flex-col sm:flex-row sm:flex-wrap items-center justify-between gap-4 sm:gap-6 md:gap-[24px_32px] pt-6 sm:pt-8 pb-0 px-0 relative self-stretch w-full">
          <p className="relative w-fit mt-[-1.00px] font-text-md-regular font-[number:var(--text-md-regular-font-weight)] text-[#94969c] text-sm sm:text-[length:var(--text-md-regular-font-size)] tracking-[var(--text-md-regular-letter-spacing)] leading-[var(--text-md-regular-line-height)] whitespace-nowrap [font-style:var(--text-md-regular-font-style)] order-3 sm:order-1">
            © 2026 Copyright Quicksort
          </p>

          <nav className="inline-flex flex-wrap h-auto items-start gap-3 sm:gap-4 relative order-1 sm:order-2">
            {navigationLinks.map((link, index) => (
              link.href.startsWith("/") ? (
                <Link
                  key={index}
                  to={link.href}
                  className="relative w-fit mt-[-1.00px] font-text-md-regular font-[number:var(--text-md-regular-font-weight)] text-[#94969c] text-sm sm:text-[length:var(--text-md-regular-font-size)] tracking-[var(--text-md-regular-letter-spacing)] leading-[var(--text-md-regular-line-height)] whitespace-nowrap [font-style:var(--text-md-regular-font-style)] hover:text-white transition-colors"
                >
                  {link.label}
                </Link>
              ) : (
                <a
                  key={index}
                  href={link.href}
                  className="relative w-fit mt-[-1.00px] font-text-md-regular font-[number:var(--text-md-regular-font-weight)] text-[#94969c] text-sm sm:text-[length:var(--text-md-regular-font-size)] tracking-[var(--text-md-regular-letter-spacing)] leading-[var(--text-md-regular-line-height)] whitespace-nowrap [font-style:var(--text-md-regular-font-style)] hover:text-white transition-colors"
                >
                  {link.label}
                </a>
              )
            ))}
          </nav>

          <div className="inline-flex flex-wrap h-auto items-start gap-3 sm:gap-4 relative order-2 sm:order-3">
            {contactInfo.map((info, index) => (
              <div
                key={index}
                className="relative w-fit mt-[-1.00px] [font-family:'Inter',Helvetica] font-normal text-[#94969c] text-sm sm:text-base tracking-[0] leading-4"
              >
                {info.isLink ? (
                  <a
                    href={info.href}
                    rel="noopener noreferrer"
                    target="_blank"
                    className="leading-[var(--text-md-regular-line-height)] underline font-text-md-regular [font-style:var(--text-md-regular-font-style)] font-[number:var(--text-md-regular-font-weight)] tracking-[var(--text-md-regular-letter-spacing)] text-sm sm:text-[length:var(--text-md-regular-font-size)] hover:text-white transition-colors"
                  >
                    {info.label}
                  </a>
                ) : (
                  <span className="font-text-md-regular font-[number:var(--text-md-regular-font-weight)] text-sm sm:text-[length:var(--text-md-regular-font-size)] tracking-[var(--text-md-regular-letter-spacing)] leading-[var(--text-md-regular-line-height)] whitespace-nowrap [font-style:var(--text-md-regular-font-style)]">
                    {info.label}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
};
