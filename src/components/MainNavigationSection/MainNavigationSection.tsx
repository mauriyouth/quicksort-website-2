import { Link } from "react-router-dom";
import { Button } from "../ui/button";
import {
    NavigationMenu,
    NavigationMenuItem,
    NavigationMenuList,
    NavigationMenuTrigger,
    NavigationMenuContent,
} from "../ui/navigation-menu";

const navigationItems = [
    { label: "Home", href: "/" },
    { label: "About", href: "#" },
    { label: "Blog", href: "/blog" },
];

export const MainNavigationSection = (): JSX.Element => {
    return (
        <div className="relative w-full h-20">
            <header className="flex flex-col w-full h-20 items-center justify-center relative bg-transparent">
                <div className="items-center justify-between flex max-w-screen-xl px-8 py-0 relative w-full flex-[0_0_auto]">
                    <div className="inline-flex items-center gap-10 relative flex-[0_0_auto]">
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

                        <NavigationMenu>
                            <NavigationMenuList className="flex items-center gap-8">
                                {navigationItems.map((item, index) => (
                                    <NavigationMenuItem key={index}>
                                        <Link
                                            to={item.href}
                                            className="inline-flex items-center justify-center gap-2 font-text-md-semibold font-[number:var(--text-md-semibold-font-weight)] text-[#94969c] text-[length:var(--text-md-semibold-font-size)] tracking-[var(--text-md-semibold-letter-spacing)] leading-[var(--text-md-semibold-line-height)] [font-style:var(--text-md-semibold-font-style)] hover:text-neutral-50 transition-colors"
                                        >
                                            {item.label}
                                        </Link>
                                    </NavigationMenuItem>
                                ))}

                                <NavigationMenuItem>
                                    <NavigationMenuTrigger className="inline-flex items-center justify-center gap-2 font-text-md-semibold font-[number:var(--text-md-semibold-font-weight)] text-[#94969c] text-[length:var(--text-md-semibold-font-size)] tracking-[var(--text-md-semibold-letter-spacing)] leading-[var(--text-md-semibold-line-height)] [font-style:var(--text-md-semibold-font-style)] hover:text-neutral-50 transition-colors bg-transparent border-0 p-0">
                                        Services
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

                    <Button className="gap-1.5 px-4 py-2.5 inline-flex items-center justify-center relative flex-[0_0_auto] bg-[#ccff00] rounded-lg overflow-hidden border border-solid border-black shadow-shadows-shadow-xs hover:bg-[#b8e600]">
                        <span className="inline-flex items-center justify-center px-0.5 py-0 relative flex-[0_0_auto]">
                            <span className="relative w-fit mt-[-1.00px] font-text-md-semibold font-[number:var(--text-md-semibold-font-weight)] text-black text-[length:var(--text-md-semibold-font-size)] tracking-[var(--text-md-semibold-letter-spacing)] leading-[var(--text-md-semibold-line-height)] whitespace-nowrap [font-style:var(--text-md-semibold-font-style)]">
                                Get in touch
                            </span>
                        </span>
                    </Button>
                </div>
            </header>
        </div>
    );
};
