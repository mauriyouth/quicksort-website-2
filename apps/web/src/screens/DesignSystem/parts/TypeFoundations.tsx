import { Panel, Rule, Section, Specimen, Token } from "./Specimen";

/**
 * The scale the site actually ships. Each row uses the same Tailwind font
 * class a component would use, so the specimen is the real thing rather
 * than an approximation of it.
 */
const SCALE = [
    { label: "Display lg", cls: "font-display-lg-semibold text-[length:var(--display-lg-semibold-font-size)] font-[number:var(--display-lg-semibold-font-weight)] tracking-[var(--display-lg-semibold-letter-spacing)] leading-[var(--display-lg-semibold-line-height)]", spec: "Hanken Grotesk 600 · 48/60", sample: "Human + AI" },
    { label: "Display md", cls: "font-display-md-semibold text-[length:var(--display-md-semibold-font-size)] font-[number:var(--display-md-semibold-font-weight)] tracking-[var(--display-md-semibold-letter-spacing)] leading-[var(--display-md-semibold-line-height)]", spec: "Hanken Grotesk 600 · 36/44", sample: "We craft collaboration" },
    { label: "Display sm", cls: "font-display-sm-semibold text-[length:var(--display-sm-semibold-font-size)] font-[number:var(--display-sm-semibold-font-weight)] tracking-[var(--display-sm-semibold-letter-spacing)] leading-[var(--display-sm-semibold-line-height)]", spec: "Hanken Grotesk 600 · 30/38", sample: "Infrastructure for AI" },
    { label: "Display xs", cls: "font-display-xs-semibold text-[length:var(--display-xs-semibold-font-size)] font-[number:var(--display-xs-semibold-font-weight)] tracking-[var(--display-xs-semibold-letter-spacing)] leading-[var(--display-xs-semibold-line-height)]", spec: "Hanken Grotesk 600 · 24/32", sample: "Knowledge graphs" },
    { label: "Text xl", cls: "font-text-xl-regular text-[length:var(--text-xl-regular-font-size)] leading-[var(--text-xl-regular-line-height)]", spec: "Inter 400 · 20/30", sample: "The palette blends professionalism with forward-thinking energy." },
    { label: "Text lg", cls: "font-text-lg-semibold text-[length:var(--text-lg-semibold-font-size)] font-[number:var(--text-lg-semibold-font-weight)] leading-[var(--text-lg-semibold-line-height)]", spec: "Inter 600 · 18/28", sample: "Buttons and prominent labels" },
    { label: "Text md", cls: "font-text-md-regular text-[length:var(--text-md-regular-font-size)] leading-[var(--text-md-regular-line-height)]", spec: "Inter 400 · 16/24", sample: "Short subject, verb, benefit. Every sentence earns its keep." },
    { label: "Text sm", cls: "font-text-sm-semibold text-[length:var(--text-sm-semibold-font-size)] font-[number:var(--text-sm-semibold-font-weight)] leading-[var(--text-sm-semibold-line-height)]", spec: "Inter 600 · 14/20", sample: "Deployment across on-premises and cloud" },
    { label: "Eyebrow", cls: "font-qs-sans text-xs font-medium uppercase tracking-[0.12em]", spec: "Inter 500 · 13px · tracking 0.12em", sample: "Brand colours" },
    { label: "Mono", cls: "font-qs-mono text-sm", spec: "JetBrains Mono · 14px", sample: "--qs-signal: #CCFF00;" },
];

const WEIGHTS = [
    { weight: 300, name: "Light" },
    { weight: 400, name: "Regular" },
    { weight: 500, name: "Medium" },
    { weight: 600, name: "Semibold" },
    { weight: 700, name: "Bold" },
];

export const TypeFoundations = () => (
    <Section
        id="type"
        eyebrow="Foundations"
        title="Type"
        intro={
            <>
                Two families. <span className="text-ink">Hanken Grotesk</span> carries the
                display voice, every heading on the site. Everything a person reads at
                length, and all UI, is <span className="text-ink">Inter</span>. JetBrains
                Mono appears only where a value is meant to be copied. The scale below is
                rendered with the same classes a component would use.
            </>
        }
    >
        <Specimen title="Scale">
            <Panel className="flex flex-col divide-y divide-line">
                {SCALE.map((step) => (
                    <div
                        key={step.label}
                        className="flex flex-col gap-qs-2 py-qs-5 first:pt-0 last:pb-0 md:flex-row md:items-baseline md:gap-qs-6"
                    >
                        <div className="flex w-40 shrink-0 flex-col gap-1">
                            <span className="text-sm font-semibold text-ink">{step.label}</span>
                            <span className="text-xs leading-snug text-ink-muted">{step.spec}</span>
                        </div>
                        <p className={`${step.cls} min-w-0 text-ink`}>{step.sample}</p>
                    </div>
                ))}
            </Panel>
        </Specimen>

        <div className="grid gap-qs-6 lg:grid-cols-2">
            <Specimen title="Hanken Grotesk (display)">
                <Panel className="flex flex-col gap-qs-4">
                    {WEIGHTS.map((w) => (
                        <div key={w.weight} className="flex items-baseline justify-between gap-qs-4">
                            <span
                                className="font-qs-display text-2xl text-ink"
                                style={{ fontWeight: w.weight }}
                            >
                                Quicksort
                            </span>
                            <span className="font-qs-mono text-[11px] text-ink-muted">
                                {w.weight} {w.name}
                            </span>
                        </div>
                    ))}
                </Panel>
            </Specimen>

            <Specimen title="Inter (UI and body)">
                <Panel className="flex flex-col gap-qs-4">
                    {WEIGHTS.map((w) => (
                        <div key={w.weight} className="flex items-baseline justify-between gap-qs-4">
                            <span
                                className="font-qs-sans text-2xl text-ink"
                                style={{ fontWeight: w.weight }}
                            >
                                Quicksort
                            </span>
                            <span className="font-qs-mono text-[11px] text-ink-muted">
                                {w.weight} {w.name}
                            </span>
                        </div>
                    ))}
                </Panel>
            </Specimen>
        </div>

        <Specimen title="Voice">
            <Panel>
                <p className="font-qs-display text-2xl leading-snug text-ink sm:text-3xl">
                    &ldquo;Rich Black → evokes trust and balance, grounding the brand in
                    clarity.&rdquo;
                </p>
                <p className="mt-qs-4 text-sm leading-relaxed text-ink-2">
                    Declarative and confident, with an editorial lift. Title Case on
                    headings, sentence case everywhere else, never full stops in micro
                    labels. The arrow <span className="text-signal-text">→</span> is part of
                    the voice: it signals cause and effect. No emoji, ever.
                </p>
            </Panel>
        </Specimen>

        <Specimen title="Rules">
            <ul className="flex flex-col gap-qs-3">
                <Rule kind="do">
                    use a named step like <Token>font-display-md-semibold</Token> or{" "}
                    <Token>font-text-md-regular</Token>, and let it carry the family,
                    weight, tracking and leading together.
                </Rule>
                <Rule kind="do">
                    set a bare family with <Token>font-qs-display</Token>,{" "}
                    <Token>font-qs-sans</Token> or <Token>font-qs-mono</Token> when you
                    need a size the scale does not have.
                </Rule>
                <Rule kind="do">
                    keep measure under about 70 characters. Long lines are the fastest way
                    to make good type unreadable.
                </Rule>
                <Rule kind="dont">
                    set body copy in Hanken Grotesk. It is a display face; at 16px it loses
                    the tension that makes it worth using.
                </Rule>
                <Rule kind="dont">
                    invent a step. Five display sizes and four text sizes cover this site. A tenth is a sign the layout, not the scale, needs work.
                </Rule>
                <Rule kind="dont">use SHOUTY CAPS outside the eyebrow style.</Rule>
            </ul>
        </Specimen>
    </Section>
);
