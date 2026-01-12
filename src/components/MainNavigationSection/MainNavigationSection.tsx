import { Link } from "react-router-dom";
import { useState } from "react";
import { Button } from "../ui/button";
import {
    NavigationMenu,
    NavigationMenuItem,
    NavigationMenuList,
    NavigationMenuTrigger,
    NavigationMenuContent,
    NavigationMenuLink,
} from "../ui/navigation-menu";
import {
    DatabaseIcon,
    TrendingUpIcon,
    MenuIcon,
    XIcon,
} from "lucide-react";

// Custom Infrastructure Icon component using the sync SVG
const InfrastructureIcon = ({ className }: { className?: string }) => (
    <svg width="27" height="27" viewBox="0 0 27 27" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
        <g clipPath="url(#clip0_infra)">
            <path d="M16.875 3.37444H21.6967C22.761 3.37444 23.625 4.23844 23.625 5.30269V8.99943M23.6238 19.1244C23.6238 20.3675 21.861 21.3744 19.6863 21.3744C17.5117 21.3744 15.75 20.3664 15.75 19.1244M15.75 15.7494C15.75 16.9926 17.5128 17.9994 19.6875 17.9994C21.8621 17.9994 23.625 16.9926 23.625 15.7494" stroke="currentColor" strokeWidth="1.63211" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M10.1247 23.6244H5.303C4.23876 23.6244 3.37476 22.7604 3.37476 21.6962V17.9994M15.7497 15.7494C15.7509 14.5074 17.5137 13.4994 19.6872 13.4994C21.8607 13.4994 23.6247 14.5063 23.6236 15.7494V22.4994C23.6236 23.7425 21.8607 24.7494 19.6861 24.7494C17.5115 24.7494 15.7497 23.7414 15.7497 22.4994V15.7494ZM12.0001 5.02819H8.83438C8.58575 5.02819 8.354 4.90556 8.2145 4.69969L7.535 3.70181C7.3955 3.49706 7.16375 3.37444 6.91513 3.37444H4.87438C4.04638 3.37444 3.37476 4.04606 3.37476 4.87406V10.8737C3.37476 11.7028 4.04638 12.3744 4.87438 12.3744H11.999C12.8281 12.3744 13.4997 11.7028 13.4997 10.8748V6.52781C13.4997 5.69981 12.8281 5.02819 12.0001 5.02819Z" stroke="currentColor" strokeWidth="1.63211" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        <defs>
            <clipPath id="clip0_infra">
                <rect width="26.1137" height="26.1137" fill="white" transform="scale(1.03394)" />
            </clipPath>
        </defs>
    </svg>
);

const navigationItems = [
    { label: "Home", href: "/" },
    { label: "About", href: "#" },
    { label: "Blog", href: "/blog" },
];

const servicesData = [
    {
        title: "AI for Business",
        description: "Intelligent solutions tailored for business growth and efficiency",
        icon: TrendingUpIcon,
        href: "/ai-for-business",
    },
    {
        title: "Infrastructure for AI",
        description: "Robust infrastructure designed for AI workloads and scalability",
        icon: InfrastructureIcon,
        href: "/infrastructure-for-ai",
        iconColor: "#3AE165",
    },
    {
        title: "Data for AI",
        description: "Data preparation, management, and optimization for AI systems",
        icon: DatabaseIcon,
        href: "/data-for-ai",
    },
];

export const MainNavigationSection = (): JSX.Element => {
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    return (
        <header className="sticky top-0 z-50 w-full h-20 flex flex-col items-center justify-center bg-[#141414] border-b border-white/40">
            <div className="items-center justify-between flex max-w-screen-xl px-4 sm:px-8 py-0 relative w-full flex-[0_0_auto]">
                <div className="inline-flex items-center gap-4 lg:gap-10 relative flex-[0_0_auto]">
                    <Link to="/" className="relative w-[138.22px] h-7 shrink-0">
                        <div className="absolute top-0 left-[34px] [font-family:'Inter',Helvetica] font-medium text-neutral-50 text-[22.9px] tracking-[-0.69px] leading-[normal]">
                            Quicksort
                        </div>

                        <div className="absolute top-px left-0 w-[29px] h-[27px]">
                            <div className="top-0 left-0 w-[26px] h-[26px] rounded-[12.99px] absolute bg-neutral-50" />

                            <div className="absolute top-[9px] left-[15px] w-[9px] h-[17px] bg-[#141414] rounded-[17.76px] rotate-[-47.64deg]" />

                            <div className="top-4 left-[19px] w-[9px] h-[9px] rounded-[4.39px] absolute bg-neutral-50" />
                        </div>
                    </Link>

                    {/* Desktop Navigation */}
                    <NavigationMenu className="hidden lg:flex">
                        <NavigationMenuList className="flex items-center gap-8">
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
                                <NavigationMenuTrigger className="bg-transparent hover:bg-transparent data-[state=open]:bg-transparent font-text-md-semibold font-[number:var(--text-md-semibold-font-weight)] text-[#94969c] text-[length:var(--text-md-semibold-font-size)] tracking-[var(--text-md-semibold-letter-spacing)] leading-[var(--text-md-semibold-line-height)] [font-style:var(--text-md-semibold-font-style)] hover:text-neutral-50 data-[state=open]:text-neutral-50">
                                    Services
                                </NavigationMenuTrigger>
                                <NavigationMenuContent>
                                    <div className="w-[500px] p-6 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg">
                                        <div className="flex flex-col gap-3">
                                            {servicesData.map((service, serviceIndex) => {
                                                const Icon = service.icon;
                                                return (
                                                    <Link
                                                        key={serviceIndex}
                                                        to={service.href}
                                                        className="group flex items-start gap-3 p-3 rounded-lg hover:bg-[#2a2a2a] transition-colors"
                                                    >
                                                        <div className={`flex-shrink-0 w-10 h-10 rounded-lg bg-[#2a2a2a] flex items-center justify-center transition-colors ${service.iconColor ? '' : 'group-hover:bg-[#ccff00]'}`} style={service.iconColor ? { backgroundColor: service.iconColor } : undefined}>
                                                            <Icon className={`w-5 h-5 transition-colors ${service.iconColor ? 'text-black' : 'text-[#94969c] group-hover:text-black'}`} />
                                                        </div>
                                                        <div className="flex flex-col gap-1">
                                                            <span className="text-sm font-semibold text-[#f5f5f6] group-hover:text-[#ccff00] transition-colors">
                                                                {service.title}
                                                            </span>
                                                            <span className="text-xs text-[#94969c] leading-relaxed">
                                                                {service.description}
                                                            </span>
                                                        </div>
                                                    </Link>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </NavigationMenuContent>
                            </NavigationMenuItem>
                        </NavigationMenuList>
                    </NavigationMenu>
                </div>

                <div className="gap-3 inline-flex items-center">
                    <Button className="hidden sm:inline-flex gap-1.5 px-4 py-2.5 bg-[#ccff00] rounded-lg border border-solid border-black shadow-shadows-shadow-xs font-text-md-semibold font-[number:var(--text-md-semibold-font-weight)] text-black text-[length:var(--text-md-semibold-font-size)] tracking-[var(--text-md-semibold-letter-spacing)] leading-[var(--text-md-semibold-line-height)] [font-style:var(--text-md-semibold-font-style)] hover:bg-[#b8e600]">
                        Get in touch
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="lg:hidden text-neutral-50 hover:bg-white/10"
                        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                    >
                        {mobileMenuOpen ? (
                            <XIcon className="w-6 h-6" />
                        ) : (
                            <MenuIcon className="w-6 h-6" />
                        )}
                    </Button>
                </div>
            </div>

            {/* Mobile Menu */}
            {mobileMenuOpen && (
                <div className="lg:hidden w-full bg-[#141414] border-t border-white/40">
                    <div className="flex flex-col max-w-screen-xl px-4 sm:px-8 py-6 gap-4">
                        {navigationItems.map((item, index) => (
                            <Link
                                key={index}
                                to={item.href}
                                onClick={() => setMobileMenuOpen(false)}
                                className="font-text-md-semibold font-[number:var(--text-md-semibold-font-weight)] text-[#94969c] text-[length:var(--text-md-semibold-font-size)] tracking-[var(--text-md-semibold-letter-spacing)] leading-[var(--text-md-semibold-line-height)] [font-style:var(--text-md-semibold-font-style)] hover:text-neutral-50 transition-colors py-2"
                            >
                                {item.label}
                            </Link>
                        ))}
                        <div className="flex flex-col gap-2 py-2">
                            <div className="font-text-md-semibold font-[number:var(--text-md-semibold-font-weight)] text-[#94969c] text-[length:var(--text-md-semibold-font-size)] tracking-[var(--text-md-semibold-letter-spacing)] leading-[var(--text-md-semibold-line-height)] [font-style:var(--text-md-semibold-font-style)] py-2">
                                Services
                            </div>
                            {servicesData.map((service, serviceIndex) => {
                                const Icon = service.icon;
                                return (
                                    <Link
                                        key={serviceIndex}
                                        to={service.href}
                                        onClick={() => setMobileMenuOpen(false)}
                                        className="group flex items-start gap-3 p-3 rounded-lg hover:bg-[#2a2a2a] transition-colors"
                                    >
                                        <div className={`flex-shrink-0 w-10 h-10 rounded-lg bg-[#2a2a2a] flex items-center justify-center transition-colors ${service.iconColor ? '' : 'group-hover:bg-[#ccff00]'}`} style={service.iconColor ? { backgroundColor: service.iconColor } : undefined}>
                                            <Icon className={`w-5 h-5 transition-colors ${service.iconColor ? 'text-black' : 'text-[#94969c] group-hover:text-black'}`} />
                                        </div>
                                        <div className="flex flex-col gap-1">
                                            <span className="text-sm font-semibold text-[#f5f5f6] group-hover:text-[#ccff00] transition-colors">
                                                {service.title}
                                            </span>
                                            <span className="text-xs text-[#94969c] leading-relaxed">
                                                {service.description}
                                            </span>
                                        </div>
                                    </Link>
                                );
                            })}
                        </div>
                        <Button className="w-full gap-1.5 px-4 py-2.5 bg-[#ccff00] rounded-lg border border-solid border-black shadow-shadows-shadow-xs font-text-md-semibold font-[number:var(--text-md-semibold-font-weight)] text-black text-[length:var(--text-md-semibold-font-size)] tracking-[var(--text-md-semibold-letter-spacing)] leading-[var(--text-md-semibold-line-height)] [font-style:var(--text-md-semibold-font-style)] hover:bg-[#b8e600] mt-2">
                            Get in touch
                        </Button>
                    </div>
                </div>
            )}
        </header>
    );
};
