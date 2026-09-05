import { Panel, Rule, Section, Specimen, Token } from "./Specimen";
import { toHex, useTokenValues } from "./useTokenValues";

type Swatch = {
    token: string;
    name: string;
    note: string;
    /** Tailwind class that paints the swatch, so the page eats its own cooking. */
    fill: string;
};

const SURFACES: Swatch[] = [
    { token: "surface", name: "Surface", note: "Page canvas", fill: "bg-surface" },
    { token: "surface-raised", name: "Surface raised", note: "Cards, panels, nav", fill: "bg-surface-raised" },
    { token: "surface-sunken", name: "Surface sunken", note: "Wells, chips, inset blocks", fill: "bg-surface-sunken" },
    { token: "surface-inverse", name: "Surface inverse", note: "Flipped CTA blocks", fill: "bg-surface-inverse" },
];

const TEXT: Swatch[] = [
    { token: "ink", name: "Ink", note: "Primary text", fill: "bg-ink" },
    { token: "ink-2", name: "Ink 2", note: "Secondary text, body copy", fill: "bg-ink-2" },
    { token: "ink-muted", name: "Ink muted", note: "Labels, captions", fill: "bg-ink-muted" },
    { token: "ink-faint", name: "Ink faint", note: "Meta, timestamps", fill: "bg-ink-faint" },
    { token: "ink-inverse", name: "Ink inverse", note: "Text on inverse surfaces", fill: "bg-ink-inverse" },
];

const SIGNAL: Swatch[] = [
    { token: "signal", name: "Signal Lime", note: "The one accent — as a fill", fill: "bg-signal" },
    { token: "signal-hover", name: "Signal hover", note: "Pressed and hovered lime", fill: "bg-signal-hover" },
    { token: "signal-fg", name: "Signal foreground", note: "Text sitting on lime", fill: "bg-signal-fg" },
    { token: "signal-text", name: "Signal text", note: "Lime used as text — darkens on light", fill: "bg-signal-text" },
];

const CATEGORY: Swatch[] = [
    { token: "cat-blue", name: "Blue", note: "AI for business", fill: "bg-cat-blue" },
    { token: "cat-violet", name: "Violet", note: "Voice AI", fill: "bg-cat-violet" },
    { token: "cat-pink", name: "Pink", note: "Engineering roles", fill: "bg-cat-pink" },
    { token: "cat-red", name: "Red", note: "Data for AI", fill: "bg-cat-red" },
    { token: "cat-green", name: "Green", note: "Infrastructure", fill: "bg-cat-green" },
];

const LINES: Swatch[] = [
    { token: "line", name: "Line", note: "Default hairline", fill: "bg-line" },
    { token: "line-strong", name: "Line strong", note: "Emphasised edge", fill: "bg-line-strong" },
    { token: "line-faint", name: "Line faint", note: "Barely-there divider", fill: "bg-line-faint" },
    { token: "hairline", name: "Hairline", note: "Section rules, grid overlay", fill: "bg-line-hair" },
];

const SwatchGrid = ({ swatches }: { swatches: Swatch[] }) => {
    const values = useTokenValues(swatches.map((s) => s.token));

    return (
        <div className="grid grid-cols-2 gap-qs-4 sm:grid-cols-3 lg:grid-cols-4">
            {swatches.map((swatch) => (
                <div key={swatch.token} className="flex flex-col gap-qs-3">
                    {/* Every swatch carries a hairline: without one, the
                        near-black chips vanish on dark and the near-white
                        chips vanish on light. */}
                    <div
                        className={`h-24 w-full rounded-qs-lg border border-line ${swatch.fill}`}
                    />
                    <div className="flex flex-col gap-1">
                        <span className="text-sm font-semibold text-ink">{swatch.name}</span>
                        <span className="font-qs-mono text-[11px] text-ink-muted">
                            {values[swatch.token] ? toHex(values[swatch.token]) : "—"}
                        </span>
                        <span className="text-xs leading-snug text-ink-muted">{swatch.note}</span>
                        <Token>--qs-{swatch.token}</Token>
                    </div>
                </div>
            ))}
        </div>
    );
};

export const ColorFoundations = () => (
    <Section
        id="colour"
        eyebrow="Foundations"
        title="Colour"
        intro={
            <>
                Every value below is read from the live stylesheet at render time, so a
                swatch cannot drift from what the site ships. Switch the theme and the
                hexes update in place.
            </>
        }
    >
        <Specimen
            title="Surfaces"
            note="Four levels of ground. Anything deeper than sunken means the layout is working too hard."
        >
            <SwatchGrid swatches={SURFACES} />
        </Specimen>

        <Specimen
            title="Text"
            note="Five steps, in descending emphasis. Body copy is Ink 2; Ink is reserved for headings and anything that must be read first."
        >
            <SwatchGrid swatches={TEXT} />
        </Specimen>

        <Specimen
            title="Signal Lime"
            note="The single brand accent. One lime element per composition — a second one halves the value of the first."
        >
            <SwatchGrid swatches={SIGNAL} />
            <Panel className="mt-qs-2">
                <p className="text-sm leading-relaxed text-ink-2">
                    Lime is legible as a <span className="font-semibold text-ink">fill</span>{" "}
                    in both themes, always with Ink on top. As{" "}
                    <span className="font-semibold text-ink">text</span> it is not: #CCFF00
                    on Seasalt measures roughly 1.1:1. That is why{" "}
                    <Token>--qs-signal-text</Token> exists and darkens to a deep olive in
                    light mode, while <Token>--qs-signal</Token> stays lime.
                </p>
                <div className="mt-qs-4 flex flex-wrap items-center gap-qs-4">
                    <span className="rounded-qs-pill bg-signal px-qs-4 py-qs-2 text-sm font-medium text-signal-fg">
                        Lime as a fill →
                    </span>
                    <span className="text-sm font-semibold text-signal-text">
                        Lime as text →
                    </span>
                </div>
            </Panel>
        </Specimen>

        <Specimen
            title="Category hues"
            note="A documented exception to the single-accent rule. These identify service lines and job families, where colour carries meaning the accent cannot. They darken in light mode to hold contrast on Seasalt. Never use one decoratively."
        >
            <SwatchGrid swatches={CATEGORY} />
        </Specimen>

        <Specimen title="Lines" note="Hairlines only. The system has no heavy borders.">
            <SwatchGrid swatches={LINES} />
        </Specimen>

        <Specimen title="Rules">
            <ul className="flex flex-col gap-qs-3">
                <Rule kind="do">
                    reach for a semantic token — <Token>bg-surface</Token>,{" "}
                    <Token>text-ink-muted</Token>, <Token>border-line</Token>.
                </Rule>
                <Rule kind="do">
                    add a token to <Token>tailwind.css</Token> when the colour you need is
                    genuinely missing.
                </Rule>
                <Rule kind="dont">
                    write a hex in a component. If it is worth using twice it is worth a
                    name.
                </Rule>
                <Rule kind="dont">
                    introduce a second accent. More colour means tinted neutrals, not a new
                    hue.
                </Rule>
            </ul>
        </Specimen>
    </Section>
);
