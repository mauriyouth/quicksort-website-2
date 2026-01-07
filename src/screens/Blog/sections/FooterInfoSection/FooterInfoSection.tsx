import { Button } from "../../../../components/ui/button";

const navigationLinks = [
  { label: "Careers", href: "#" },
  { label: "Our Mission", href: "#" },
  { label: "Our Process", href: "#" },
  { label: "Blog", href: "#" },
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

export const FooterInfoSection = (): JSX.Element => {
  return (
    <footer className="flex flex-col items-center gap-16 pt-16 pb-12 px-0 relative w-full bg-[#141414]">
      <div className="flex max-w-screen-xl items-center justify-center gap-8 px-8 py-0 relative w-full">
        <div className="flex flex-col items-center justify-center gap-12 relative flex-1">
          <div className="relative w-[138.22px] h-7">
            <div className="absolute top-0 left-[34px] [font-family:'Inter',Helvetica] font-medium text-neutral-50 text-[22.9px] tracking-[-0.69px] leading-[normal]">
              Quicksort
            </div>

            <div className="absolute top-px left-0 w-[29px] h-[27px]">
              <div className="top-0 left-0 w-[26px] h-[26px] rounded-[12.99px] absolute bg-neutral-50" />

              <div className="absolute top-[9px] left-[15px] w-[9px] h-[17px] bg-[#141414] rounded-[17.76px] rotate-[-47.64deg]" />

              <div className="top-4 left-[19px] w-[9px] h-[9px] rounded-[4.39px] absolute bg-neutral-50" />
            </div>
          </div>

          <div className="flex flex-col max-w-screen-md items-center justify-center gap-4 relative w-full">
            <h2 className="relative self-stretch mt-[-1.00px] font-display-sm-semibold font-[number:var(--display-sm-semibold-font-weight)] text-[#f5f5f6] text-[length:var(--display-sm-semibold-font-size)] text-center tracking-[var(--display-sm-semibold-letter-spacing)] leading-[var(--display-sm-semibold-line-height)] [font-style:var(--display-sm-semibold-font-style)]">
              Let&apos;s get started on something great
            </h2>

            <p className="text-center relative self-stretch font-text-xl-regular font-[number:var(--text-xl-regular-font-weight)] text-[#94969c] text-[length:var(--text-xl-regular-font-size)] tracking-[var(--text-xl-regular-letter-spacing)] leading-[var(--text-xl-regular-line-height)] [font-style:var(--text-xl-regular-font-style)]">
              Turn ideas into reality
            </p>
          </div>

          <div className="inline-flex items-start gap-3 relative">
            <Button className="gap-2.5 px-[22px] py-4 bg-[#ccff00] rounded-lg border border-solid border-black shadow-shadows-shadow-xs hover:bg-[#ccff00]/90">
              <span className="font-text-lg-semibold font-[number:var(--text-lg-semibold-font-weight)] text-black text-[length:var(--text-lg-semibold-font-size)] tracking-[var(--text-lg-semibold-letter-spacing)] leading-[var(--text-lg-semibold-line-height)] [font-style:var(--text-lg-semibold-font-style)]">
                Get in touch
              </span>
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-col max-w-screen-xl items-center justify-center gap-8 px-8 py-0 relative w-full">
        <div className="flex flex-wrap items-center justify-between gap-[24px_32px] pt-8 pb-0 px-0 relative self-stretch w-full border-t [border-top-style:solid] border-[#1f242f]">
          <p className="relative w-fit mt-[-1.00px] font-text-md-regular font-[number:var(--text-md-regular-font-weight)] text-[#94969c] text-[length:var(--text-md-regular-font-size)] tracking-[var(--text-md-regular-letter-spacing)] leading-[var(--text-md-regular-line-height)] whitespace-nowrap [font-style:var(--text-md-regular-font-style)]">
            © 2026 Copyright Quicksort
          </p>

          <nav className="inline-flex h-6 items-start gap-4 relative">
            {navigationLinks.map((link, index) => (
              <a
                key={index}
                href={link.href}
                className="relative w-fit mt-[-1.00px] font-text-md-regular font-[number:var(--text-md-regular-font-weight)] text-[#94969c] text-[length:var(--text-md-regular-font-size)] tracking-[var(--text-md-regular-letter-spacing)] leading-[var(--text-md-regular-line-height)] whitespace-nowrap [font-style:var(--text-md-regular-font-style)] hover:text-[#f5f5f6] transition-colors"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="inline-flex h-6 items-start gap-4 relative">
            {contactInfo.map((info, index) => (
              <div
                key={index}
                className="relative w-fit mt-[-1.00px] [font-family:'Inter',Helvetica] font-normal text-[#94969c] text-base tracking-[0] leading-4"
              >
                {info.isLink ? (
                  <a
                    href={info.href}
                    rel="noopener noreferrer"
                    target="_blank"
                    className="leading-[var(--text-md-regular-line-height)] underline font-text-md-regular [font-style:var(--text-md-regular-font-style)] font-[number:var(--text-md-regular-font-weight)] tracking-[var(--text-md-regular-letter-spacing)] text-[length:var(--text-md-regular-font-size)] hover:text-[#f5f5f6] transition-colors"
                  >
                    {info.label}
                  </a>
                ) : (
                  <span className="leading-[var(--text-md-regular-line-height)] font-text-md-regular [font-style:var(--text-md-regular-font-style)] font-[number:var(--text-md-regular-font-weight)] tracking-[var(--text-md-regular-letter-spacing)] text-[length:var(--text-md-regular-font-size)]">
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
