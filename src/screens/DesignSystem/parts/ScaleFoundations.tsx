import { useState } from "react";
import { Panel, Section, Specimen, Token } from "./Specimen";

const SPACING = [
    { step: 1, px: 4 },
    { step: 2, px: 8 },
    { step: 3, px: 12 },
    { step: 4, px: 16 },
    { step: 5, px: 24 },
    { step: 6, px: 32 },
    { step: 7, px: 48 },
    { step: 8, px: 64 },
    { step: 9, px: 96 },
    { step: 10, px: 128 },
];

const RADII = [
    { name: "sm", px: 6, cls: "rounded-qs-sm", use: "Inputs, code" },
    { name: "md", px: 10, cls: "rounded-qs-md", use: "Title capsules" },
    { name: "lg", px: 16, cls: "rounded-qs-lg", use: "Cards" },
    { name: "xl", px: 20, cls: "rounded-qs-xl", use: "Hero cards" },
    { name: "pill", px: 999, cls: "rounded-qs-pill", use: "Buttons, chips" },
];

const SHADOWS = [
    { name: "qs-1", cls: "shadow-qs-1", use: "Resting card" },
    { name: "qs-2", cls: "shadow-qs-2", use: "Hovered card" },
    { name: "qs-3", cls: "shadow-qs-3", use: "Floating over imagery" },
];

const DURATIONS = [
    { name: "qs-1", ms: 120, use: "Colour and opacity" },
    { name: "qs-2", ms: 200, use: "Most UI motion" },
    { name: "qs-3", ms: 360, use: "Entering content" },
    { name: "qs-4", ms: 640, use: "Full-page transitions" },
];

const MotionDemo = () => {
    const [run, setRun] = useState(0);

    return (
        <Panel>
            <div className="flex flex-col gap-qs-5">
                {DURATIONS.map((d) => (
                    <div key={d.name} className="flex items-center gap-qs-4">
                        <div className="w-32 shrink-0">
                            <div className="text-sm font-semibold text-ink">{d.ms}ms</div>
                            <div className="text-xs text-ink-muted">{d.use}</div>
                        </div>
                        <div className="relative h-2 flex-1 overflow-hidden rounded-qs-pill bg-surface-sunken">
                            <div
                                key={`${d.name}-${run}`}
                                className="h-full w-full rounded-qs-pill bg-signal"
                                style={{
                                    animation: `qs-ds-sweep ${d.ms}ms var(--qs-ease) forwards`,
                                }}
                            />
                        </div>
                    </div>
                ))}
            </div>

            <button
                type="button"
                onClick={() => setRun((n) => n + 1)}
                className="mt-qs-5 rounded-qs-pill border border-line px-qs-4 py-qs-2 text-sm font-medium text-ink transition-colors duration-qs-2 ease-qs hover:border-line-strong"
            >
                Replay
            </button>

            <p className="mt-qs-4 text-sm leading-relaxed text-ink-2">
                One easing, everywhere: <Token>cubic-bezier(0.2, 0.8, 0.2, 1)</Token> —
                confident out, no overshoot. Fades and short translates only. No bounce,
                no spring, no parallax.
            </p>

            <style>{`
                @keyframes qs-ds-sweep {
                    from { transform: translateX(-100%); }
                    to { transform: translateX(0); }
                }
            `}</style>
        </Panel>
    );
};

export const ScaleFoundations = () => (
    <Section
        id="scale"
        eyebrow="Foundations"
        title="Space, shape and motion"
        intro="A 4px base, five radii, three shadows and one easing curve. The constraint is the point — a system with ten shadow values has no shadow system."
    >
        <Specimen title="Spacing scale" note="4px base. Everything is a step on this ladder.">
            <Panel className="flex flex-col gap-qs-3">
                {SPACING.map((s) => (
                    <div key={s.step} className="flex items-center gap-qs-4">
                        <span className="w-24 shrink-0 font-qs-mono text-[11px] text-ink-muted">
                            space-{s.step}
                        </span>
                        <span className="w-12 shrink-0 text-sm text-ink">{s.px}px</span>
                        <div
                            className="h-4 rounded-qs-sm bg-signal"
                            style={{ width: `${s.px}px` }}
                        />
                    </div>
                ))}
            </Panel>
        </Specimen>

        <div className="grid gap-qs-6 lg:grid-cols-2">
            <Specimen title="Corner radii">
                <Panel className="flex flex-wrap items-end gap-qs-5">
                    {RADII.map((r) => (
                        <div key={r.name} className="flex flex-col items-center gap-qs-2">
                            <div
                                className={`h-16 w-16 border border-line bg-surface-sunken ${r.cls}`}
                            />
                            <span className="text-xs font-semibold text-ink">{r.name}</span>
                            <span className="font-qs-mono text-[11px] text-ink-muted">
                                {r.px === 999 ? "999" : `${r.px}px`}
                            </span>
                            <span className="text-center text-[11px] leading-snug text-ink-muted">
                                {r.use}
                            </span>
                        </div>
                    ))}
                </Panel>
            </Specimen>

            <Specimen title="Elevation" note="Soft, cool, tightly clustered. Only for cards over imagery.">
                <Panel className="flex flex-wrap items-end gap-qs-6">
                    {SHADOWS.map((s) => (
                        <div key={s.name} className="flex flex-col items-center gap-qs-3">
                            <div
                                className={`h-16 w-24 rounded-qs-lg border border-line bg-surface-raised ${s.cls}`}
                            />
                            <span className="font-qs-mono text-[11px] text-ink-muted">
                                {s.name}
                            </span>
                            <span className="text-center text-[11px] leading-snug text-ink-muted">
                                {s.use}
                            </span>
                        </div>
                    ))}
                </Panel>
            </Specimen>
        </div>

        <Specimen title="Motion">
            <MotionDemo />
        </Specimen>

        <Specimen
            title="Brand grid"
            note="A 96px grid at 5% opacity behind a radial fade, with the lime halo bleeding in from the top edge. Quicksort's most recognisable background."
        >
            <div className="relative h-64 overflow-hidden rounded-qs-lg border border-line bg-surface">
                <div className="qs-halo" />
                <div className="qs-grid-bg qs-grid-mask absolute inset-0" />
                <div className="relative flex h-full items-center justify-center">
                    <p className="font-qs-display text-3xl text-ink">We craft Human + AI</p>
                </div>
            </div>
            <p className="text-sm text-ink-muted">
                <Token>.qs-grid-bg</Token> <Token>.qs-grid-mask</Token>{" "}
                <Token>.qs-halo</Token>
            </p>
        </Specimen>
    </Section>
);
