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

const navigationItems = [
  { label: "Home", href: "/" },
  { label: "About", href: "#" },
  { label: "Blog", href: "/blog" },
];

export const NavigationMenuSection = (): JSX.Element => {
  return (
    <div className="w-full">
      <header className="h-20 justify-center bg-transparent flex flex-col w-full items-center">
        <div className="flex max-w-screen-xl items-center justify-between px-8 py-0 w-full">
          <div className="inline-flex items-center gap-10">
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
                {navigationItems.map((item, index) => (
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
                  <NavigationMenuTrigger className="inline-flex items-center justify-center gap-2 font-text-md-semibold font-[number:var(--text-md-semibold-font-weight)] text-[#94969c] text-[length:var(--text-md-semibold-font-size)] tracking-[var(--text-md-semibold-letter-spacing)] leading-[var(--text-md-semibold-line-height)] [font-style:var(--text-md-semibold-font-style)] hover:text-neutral-50 transition-colors bg-transparent border-0 p-0 shadow-none">
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

          <div className="gap-3 inline-flex items-center">
            <Button className="gap-1.5 px-4 py-2.5 bg-[#ccff00] rounded-lg border border-solid border-black shadow-shadows-shadow-xs font-text-md-semibold font-[number:var(--text-md-semibold-font-weight)] text-black text-[length:var(--text-md-semibold-font-size)] tracking-[var(--text-md-semibold-letter-spacing)] leading-[var(--text-md-semibold-line-height)] [font-style:var(--text-md-semibold-font-style)] hover:bg-[#b8e600]">
              Get in touch
            </Button>
          </div>
        </div>
      </header>
    </div>
  );
};
