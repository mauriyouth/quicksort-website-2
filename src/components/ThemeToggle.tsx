import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "@lib/theme";
import { cn } from "@lib/utils";

type ThemeToggleProps = {
    className?: string;
};

/**
 * Light/dark switch. Shows the theme you would get by pressing it, which
 * is the convention people already expect from a single-button toggle.
 */
export const ThemeToggle = ({ className }: ThemeToggleProps) => {
    const { theme, toggleTheme } = useTheme();
    const nextTheme = theme === "dark" ? "light" : "dark";

    return (
        <button
            type="button"
            onClick={toggleTheme}
            aria-label={`Switch to ${nextTheme} mode`}
            title={`Switch to ${nextTheme} mode`}
            className={cn(
                "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-qs-pill",
                "border border-line text-ink-muted",
                "transition-colors duration-qs-2 ease-qs",
                "hover:border-line-strong hover:text-ink",
                className,
            )}
        >
            {theme === "dark" ? (
                <SunIcon className="h-[18px] w-[18px]" strokeWidth={1.5} />
            ) : (
                <MoonIcon className="h-[18px] w-[18px]" strokeWidth={1.5} />
            )}
        </button>
    );
};
