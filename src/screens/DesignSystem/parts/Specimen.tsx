import type { ReactNode } from "react";
import { cn } from "@lib/utils";

/** A top-level section of the style guide, with a scroll anchor. */
export const Section = ({
    id,
    eyebrow,
    title,
    intro,
    children,
}: {
    id: string;
    eyebrow: string;
    title: string;
    intro?: ReactNode;
    children: ReactNode;
}) => (
    <section id={id} className="scroll-mt-28 border-t border-line py-qs-9">
        <p className="font-qs-sans text-xs font-medium uppercase tracking-[0.12em] text-ink-muted">
            {eyebrow}
        </p>
        <h2 className="mt-qs-3 font-qs-display text-3xl leading-[1.1] text-ink sm:text-4xl md:text-5xl">
            {title}
        </h2>
        {intro ? (
            <p className="mt-qs-4 max-w-[62ch] text-base leading-relaxed text-ink-2">
                {intro}
            </p>
        ) : null}
        <div className="mt-qs-7 flex flex-col gap-qs-8">{children}</div>
    </section>
);

/** A labelled block inside a section. */
export const Specimen = ({
    title,
    note,
    children,
    className,
}: {
    title: string;
    note?: ReactNode;
    children: ReactNode;
    className?: string;
}) => (
    <div className={cn("flex flex-col gap-qs-4", className)}>
        <div className="flex flex-col gap-qs-1">
            <h3 className="font-qs-sans text-sm font-semibold tracking-tight text-ink">
                {title}
            </h3>
            {note ? (
                <p className="max-w-[68ch] text-sm leading-relaxed text-ink-muted">{note}</p>
            ) : null}
        </div>
        {children}
    </div>
);

/** The surface every specimen sits on — a hairline card on the page canvas. */
export const Panel = ({
    children,
    className,
}: {
    children: ReactNode;
    className?: string;
}) => (
    <div
        className={cn(
            "rounded-qs-lg border border-line bg-surface-raised p-qs-5 sm:p-qs-6",
            className,
        )}
    >
        {children}
    </div>
);

/** Monospace token name, for anything a developer would copy. */
export const Token = ({ children }: { children: ReactNode }) => (
    <code className="rounded-qs-sm border border-line bg-surface-sunken px-1.5 py-0.5 font-qs-mono text-[11px] text-ink-2">
        {children}
    </code>
);

/** A rule the system asserts — do / don't, stated plainly. */
export const Rule = ({
    kind,
    children,
}: {
    kind: "do" | "dont";
    children: ReactNode;
}) => (
    <li className="flex gap-qs-3 text-sm leading-relaxed text-ink-2">
        <span
            aria-hidden
            className={cn(
                "mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full",
                kind === "do" ? "bg-signal" : "bg-cat-red",
            )}
        />
        <span>
            <span className="font-semibold text-ink">
                {kind === "do" ? "Do" : "Don't"}
            </span>{" "}
            — {children}
        </span>
    </li>
);
