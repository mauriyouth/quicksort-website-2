import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from "react";

export type Theme = "dark" | "light";

/** Kept in sync with the inline bootstrap script in index.html. */
export const THEME_STORAGE_KEY = "qs-theme";

/** Dark is the Quicksort default — the brand's native surface. */
export const DEFAULT_THEME: Theme = "dark";

type ThemeContextValue = {
    theme: Theme;
    setTheme: (theme: Theme) => void;
    toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const isTheme = (value: unknown): value is Theme =>
    value === "dark" || value === "light";

/**
 * Read the theme the bootstrap script already committed to the document.
 * Reading from the DOM rather than storage keeps React's first render in
 * agreement with the painted page, so there is never a flash.
 */
const readInitialTheme = (): Theme => {
    if (typeof document === "undefined") return DEFAULT_THEME;

    const fromDocument = document.documentElement.dataset.theme;
    if (isTheme(fromDocument)) return fromDocument;

    try {
        const stored = localStorage.getItem(THEME_STORAGE_KEY);
        if (isTheme(stored)) return stored;
    } catch {
        // Private browsing or blocked storage — fall through to the default.
    }

    return DEFAULT_THEME;
};

/**
 * Apply a theme to the document. Suppresses the global colour transition
 * for one frame so the whole page swaps at once instead of a few hundred
 * elements crossfading raggedly.
 */
const applyTheme = (theme: Theme) => {
    const root = document.documentElement;
    const { body } = document;

    body?.classList.add("qs-theme-switching");
    root.dataset.theme = theme;

    requestAnimationFrame(() => {
        requestAnimationFrame(() => body?.classList.remove("qs-theme-switching"));
    });

    try {
        localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
        // Not being able to remember the choice is not worth breaking over.
    }
};

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
    const [theme, setThemeState] = useState<Theme>(readInitialTheme);

    const setTheme = useCallback((next: Theme) => {
        setThemeState(next);
        applyTheme(next);
    }, []);

    const toggleTheme = useCallback(() => {
        setThemeState((current) => {
            const next: Theme = current === "dark" ? "light" : "dark";
            applyTheme(next);
            return next;
        });
    }, []);

    // Keep other tabs in step with the choice made here.
    useEffect(() => {
        const onStorage = (event: StorageEvent) => {
            if (event.key !== THEME_STORAGE_KEY || !isTheme(event.newValue)) return;
            setThemeState(event.newValue);
            document.documentElement.dataset.theme = event.newValue;
        };

        window.addEventListener("storage", onStorage);
        return () => window.removeEventListener("storage", onStorage);
    }, []);

    const value = useMemo(
        () => ({ theme, setTheme, toggleTheme }),
        [theme, setTheme, toggleTheme],
    );

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = (): ThemeContextValue => {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error("useTheme must be used inside a ThemeProvider");
    }
    return context;
};
