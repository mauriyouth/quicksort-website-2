import { ChevronDownIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "../../../../components/ui/button";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "../../../../components/ui/navigation-menu";

const navItems = [
  { label: "Home", href: "/" },
  { label: "About", href: "#" },
  { label: "Blog", href: "/blog" },
];

export const HeroIntroSection = (): JSX.Element => {
  return (
    <section className="flex flex-col items-center relative w-full bg-[#141414]">
      <div className="relative w-full h-20 z-[2]">
        <header className="flex flex-col w-full h-20 items-center justify-center relative bg-transparent">
          <div className="flex max-w-screen-xl items-center justify-between px-8 py-0 relative w-full">
            <div className="inline-flex items-center gap-10 relative">
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

              <NavigationMenu>
                <NavigationMenuList className="gap-8">
                  {navItems.map((item, index) => (
                    <NavigationMenuItem key={index}>
                      {item.href.startsWith("/") ? (
                        <Link
                          to={item.href}
                          className="inline-flex items-center justify-center gap-2 font-text-md-semibold font-[number:var(--text-md-semibold-font-weight)] text-[#94969c] text-[length:var(--text-md-semibold-font-size)] tracking-[var(--text-md-semibold-letter-spacing)] leading-[var(--text-md-semibold-line-height)] [font-style:var(--text-md-semibold-font-style)] hover:text-neutral-50 transition-colors"
                        >
                          {item.label}
                        </Link>
                      ) : (
                        <NavigationMenuLink
                          href={item.href}
                          className="inline-flex items-center justify-center gap-2 font-text-md-semibold font-[number:var(--text-md-semibold-font-weight)] text-[#94969c] text-[length:var(--text-md-semibold-font-size)] tracking-[var(--text-md-semibold-letter-spacing)] leading-[var(--text-md-semibold-line-height)] [font-style:var(--text-md-semibold-font-style)] hover:text-neutral-50 transition-colors"
                        >
                          {item.label}
                        </NavigationMenuLink>
                      )}
                    </NavigationMenuItem>
                  ))}
                  <NavigationMenuItem>
                    <NavigationMenuTrigger className="inline-flex items-center justify-center gap-2 font-text-md-semibold font-[number:var(--text-md-semibold-font-weight)] text-[#94969c] text-[length:var(--text-md-semibold-font-size)] tracking-[var(--text-md-semibold-letter-spacing)] leading-[var(--text-md-semibold-line-height)] [font-style:var(--text-md-semibold-font-style)] hover:text-neutral-50 transition-colors bg-transparent">
                      Services
                      <ChevronDownIcon className="w-5 h-5" />
                    </NavigationMenuTrigger>
                    <NavigationMenuContent>
                      <div className="w-[200px] p-4 bg-[#101010] border border-[#1f242f] rounded-md shadow-lg">
                        <Link
                          to="/ai-for-business"
                          className="block p-2 text-[#94969c] hover:text-white hover:bg-[#1f242f] rounded-md transition-colors"
                        >
                          AI for business
                        </Link>
                        <Link
                          to="/data-for-ai"
                          className="block p-2 text-[#94969c] hover:text-white hover:bg-[#1f242f] rounded-md transition-colors"
                        >
                          Data for AI
                        </Link>
                        <Link
                          to="/infrastructure-for-ai"
                          className="block p-2 text-[#94969c] hover:text-white hover:bg-[#1f242f] rounded-md transition-colors"
                        >
                          Infrastructure for AI
                        </Link>
                      </div>
                    </NavigationMenuContent>
                  </NavigationMenuItem>
                </NavigationMenuList>
              </NavigationMenu>
            </div>

            <div className="gap-3 inline-flex items-center relative">
              <Button className="gap-1.5 px-4 py-2.5 bg-[#ccff00] hover:bg-[#b8e600] rounded-lg border border-solid border-black shadow-shadows-shadow-xs text-black font-text-md-semibold font-[number:var(--text-md-semibold-font-weight)] text-[length:var(--text-md-semibold-font-size)] tracking-[var(--text-md-semibold-letter-spacing)] leading-[var(--text-md-semibold-line-height)] [font-style:var(--text-md-semibold-font-style)]">
                Get in touch
              </Button>
            </div>
          </div>
        </header>
      </div>

      <div className="h-[757px] px-0 py-24 z-[1] flex items-start justify-center relative w-full">
        <div className="flex max-w-screen-xl w-full items-center justify-between relative">
          <div className="flex max-w-screen-xl h-[515px] items-end gap-8 px-8 py-0 relative flex-1 grow">
            <div className="flex flex-col items-start gap-12 relative flex-1 self-stretch grow">
              <div className="flex flex-col max-w-screen-lg items-start gap-6 relative w-full">
                <h1 className="mt-[-1.00px] [font-family:'Hanken_Grotesk',Helvetica] font-medium text-6xl tracking-[-1.20px] leading-[72px] relative self-stretch text-[#f5f5f6]">
                  We Craft Human + AI Collaboration.
                </h1>

                <p className="relative self-stretch font-text-xl-regular font-[number:var(--text-xl-regular-font-weight)] text-[#94969c] text-[length:var(--text-xl-regular-font-size)] tracking-[var(--text-xl-regular-letter-spacing)] leading-[var(--text-xl-regular-line-height)] [font-style:var(--text-xl-regular-font-style)]">
                  We design and engineer agentic systems where humans
                  orchestrate AI agents — connecting data, tools, and memory to
                  transform how organizations think, decide, and deliver value.
                </p>
              </div>

              <div className="inline-flex items-start gap-3 relative">
                <Button className="gap-2.5 px-[22px] py-4 bg-[#ccff00] hover:bg-[#b8e600] rounded-lg border border-solid border-black shadow-shadows-shadow-xs text-black font-text-lg-semibold font-[number:var(--text-lg-semibold-font-weight)] text-[length:var(--text-lg-semibold-font-size)] tracking-[var(--text-lg-semibold-letter-spacing)] leading-[var(--text-lg-semibold-line-height)] [font-style:var(--text-lg-semibold-font-style)]">
                  Get in touch
                </Button>
              </div>
            </div>
          </div>

          <img
            className="relative max-w-screen-xl w-[536px] h-[518.63px] mb-[-3.63px]"
            alt="Container"
            src="/container-3.svg"
          />
        </div>
      </div>

      <img
        className="absolute top-0 left-[calc(50.00%_-_720px)] w-[1440px] h-[837px] z-0"
        alt="Background pattern"
        src="/background-pattern.svg"
      />
    </section>
  );
};
