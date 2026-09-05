import { Panel, Rule, Section, Specimen, Token } from "./Specimen";

export const UsageRules = () => (
    <Section
        id="using"
        eyebrow="Practice"
        title="Using the system"
        intro="Three layers, and components only ever touch the third. That is the whole contract."
    >
        <Specimen title="How a colour reaches the screen">
            <Panel className="flex flex-col gap-qs-5">
                {[
                    {
                        n: "01",
                        title: "Brand primitives",
                        body: "The raw palette: Rich Black, Dim Gray, Timberwolf, Seasalt, Signal Lime. Never referenced by a component.",
                    },
                    {
                        n: "02",
                        title: "Semantic tokens",
                        body: "surface, ink, line, signal. These flip between themes. Defined once in tailwind.css, for both themes, side by side.",
                    },
                    {
                        n: "03",
                        title: "Tailwind names",
                        body: "bg-surface, text-ink-muted, border-line. What you actually write. Opacity modifiers work: text-ink/40.",
                    },
                ].map((layer) => (
                    <div key={layer.n} className="flex gap-qs-5">
                        <span className="font-qs-mono text-sm text-signal-text">{layer.n}</span>
                        <div className="flex flex-col gap-qs-1">
                            <span className="text-sm font-semibold text-ink">{layer.title}</span>
                            <span className="max-w-[70ch] text-sm leading-relaxed text-ink-muted">
                                {layer.body}
                            </span>
                        </div>
                    </div>
                ))}
            </Panel>
        </Specimen>

        <Specimen title="Adding a token">
            <Panel>
                <p className="text-sm leading-relaxed text-ink-2">
                    Add the dark value to <Token>:root</Token> and the light value to{" "}
                    <Token>[data-theme=&quot;light&quot;]</Token> in{" "}
                    <Token>tailwind.css</Token>, then expose it under a name in{" "}
                    <Token>tailwind.config.js</Token>. Solid colours are stored as{" "}
                    <span className="text-ink">space-separated RGB triplets</span> so
                    Tailwind can apply opacity modifiers; each has a plain colour var
                    alongside it for hand-written CSS and inline styles.
                </p>
                <pre className="mt-qs-4 overflow-x-auto rounded-qs-md border border-line bg-surface-sunken p-qs-4 font-qs-mono text-[12px] leading-relaxed text-ink-2">
{`:root                  { --qs-surface-rgb: 0 0 0; }
[data-theme="light"]   { --qs-surface-rgb: 250 250 250; }

// tailwind.config.js
surface: "rgb(var(--qs-surface-rgb) / <alpha-value>)"`}
                </pre>
            </Panel>
        </Specimen>

        <Specimen title="Theming">
            <ul className="flex flex-col gap-qs-3">
                <Rule kind="do">
                    let tokens do the work. A component written against{" "}
                    <Token>bg-surface</Token> already supports both themes.
                </Rule>
                <Rule kind="do">
                    use <Token>text-on-fill</Token> for text sitting on a saturated fill. It stays white because the fill stays saturated.
                </Rule>
                <Rule kind="dont">
                    reach for Tailwind&apos;s <Token>dark:</Token> variant. Two class sets
                    per element is how a theme falls out of sync.
                </Rule>
                <Rule kind="dont">
                    assume dark. Check both themes before shipping. The toggle in the
                    header is here for exactly that.
                </Rule>
            </ul>
        </Specimen>

        <Specimen title="Known substitutions" note="Flagged, not hidden.">
            <Panel className="flex flex-col gap-qs-4 text-sm leading-relaxed text-ink-2">
                <p>
                    <span className="font-semibold text-ink">Helvetica Neue Medium</span>: used once in the source Figma file, on the &ldquo;Brand Colours&rdquo;
                    capsule. No license-safe web copy, so the stack falls through to Inter
                    Medium.
                </p>
                <p>
                    <span className="font-semibold text-ink">Icons</span>: the identity
                    file contains no icon set. Lucide stands in at 1.5px stroke, which
                    matches the mark&apos;s geometry better than a heavier or filled family.
                </p>
                <p>
                    <span className="font-semibold text-ink">Category hues</span>: the
                    brand doc says never introduce a second accent. The service and job
                    colours predate the system and carry real meaning, so they are kept and
                    documented rather than quietly dropped.
                </p>
            </Panel>
        </Specimen>
    </Section>
);
