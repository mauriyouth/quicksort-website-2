import { ArrowUpRightIcon, ClockIcon, MapPinIcon } from "lucide-react";
import { Badge } from "@components/ui/badge";
import { Button } from "@components/ui/button";
import { Card, CardContent } from "@components/ui/card";
import { Separator } from "@components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@components/ui/tabs";
import { ThemeToggle } from "@components/ThemeToggle";
import { Panel, Section, Specimen, Token } from "./Specimen";

/**
 * Everything here renders the components the site actually ships. Nothing
 * is re-implemented for the gallery, so this page cannot fall out of date
 * with production — if a primitive changes, this changes with it.
 */
export const ComponentGallery = () => (
    <Section
        id="components"
        eyebrow="Components"
        title="The kit"
        intro="These are the live components, imported from the same modules the marketing pages use. If one of them looks wrong here, it is wrong on the site."
    >
        <Specimen
            title="Buttons"
            note={
                <>
                    One component, four brand variants, the identity bundle&apos;s four
                    buttons under this codebase&apos;s names: <Token>signal</Token> is
                    Accent, <Token>inverse</Token> is Primary, <Token>outline</Token> is
                    Secondary, <Token>quiet</Token> is Ghost. The lime CTA is the primary
                    action and appears at most once per view. Every button on the site
                    is this component. If you find yourself writing padding, radius or
                    a font class at a call site, the size you want is missing.
                </>
            }
        >
            <Panel className="flex flex-wrap items-center gap-qs-4">
                <Button variant="signal" size="qs">Get in touch</Button>
                <Button variant="inverse" size="qs">Get started →</Button>
                <Button variant="outline" size="qs">Read the docs</Button>
                <Button variant="quiet" size="qs">Learn more →</Button>
                <Button variant="signal" size="qs" disabled>Disabled</Button>
            </Panel>
        </Specimen>

        <Specimen
            title="Sizes"
            note={
                <>
                    Padding and type travel together, so a size is one decision rather
                    than six classes. <Token>qs-sm</Token> in the header,{" "}
                    <Token>qs-hero</Token> in the hero and footer (it steps down on
                    small screens), <Token>qs</Token> everywhere else,{" "}
                    <Token>qs-lg</Token> for a page&apos;s single terminal action.
                </>
            }
        >
            <Panel className="flex flex-wrap items-center gap-qs-4">
                <Button variant="signal" size="qs-sm">qs-sm</Button>
                <Button variant="signal" size="qs">qs</Button>
                <Button variant="signal" size="qs-hero">qs-hero</Button>
                <Button variant="signal" size="qs-lg">qs-lg</Button>
            </Panel>
        </Specimen>

        <Specimen
            title="Shape: the one departure from the brand bundle"
            note="Worth knowing about, rather than quietly resolving one way or the other."
        >
            <Panel>
                <p className="text-sm leading-relaxed text-ink-2">
                    The identity bundle specifies pill buttons (999px). The site ships
                    <Token>rounded-lg</Token> (8px), and that is the shape the system
                    documents. The running site wins over the exported prototype. The
                    pill radius is still a token (<Token>rounded-qs-pill</Token>) and is
                    used for chips and the theme toggle, where it is right.
                </p>
                <p className="mt-qs-3 text-sm leading-relaxed text-ink-2">
                    Radius is the <em>only</em> thing that departs. Fill, border, hover,
                    press, focus and disabled all follow the bundle: the accent button
                    carries no border and no shadow, hover shifts the fill by ~8%, press
                    darkens 12% without shrinking, and focus is a 2px Signal Lime ring
                    offset 2px. Type is the site&apos;s own scale rather than the
                    bundle&apos;s preview card, which is a prototype, not a spec.
                </p>
                <div className="mt-qs-4 flex flex-wrap items-center gap-qs-4">
                    <Button variant="signal" size="qs">What ships: 8px</Button>
                    <Button variant="signal" size="qs" className="rounded-qs-pill">
                        Bundle&apos;s pill: 999px
                    </Button>
                </div>
            </Panel>
        </Specimen>

        <Specimen
            title="shadcn variants"
            note="Kept so the ui/ primitives keep working, and re-pointed at the token layer. Prefer a brand variant for anything user-facing."
        >
            <Panel className="flex flex-wrap items-center gap-qs-4">
                <Button>Default</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="outline">Outline</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="destructive">Destructive</Button>
                <Button variant="link">Link</Button>
            </Panel>
        </Specimen>

        <Specimen title="Badges and chips">
            <Panel className="flex flex-wrap items-center gap-qs-4">
                <Badge>Default</Badge>
                <Badge variant="secondary">Secondary</Badge>
                <Badge variant="outline">Outline</Badge>
                <span className="inline-flex items-center gap-2 rounded-qs-pill border border-cat-pink-deep bg-cat-pink-tint px-qs-3 py-1 text-xs font-semibold text-cat-pink-tint-fg">
                    <span className="h-1.5 w-1.5 rounded-full bg-cat-pink" />
                    Engineering
                </span>
                <span className="inline-flex items-center gap-2 rounded-qs-pill bg-signal px-qs-3 py-1 text-xs font-semibold text-signal-fg">
                    Hiring
                </span>
            </Panel>
        </Specimen>

        <Specimen title="Cards">
            <div className="grid gap-qs-5 md:grid-cols-2">
                <Card className="border border-line bg-surface-raised">
                    <CardContent className="flex flex-col gap-qs-4 p-qs-6">
                        <div className="flex h-12 w-12 items-center justify-center rounded-qs-md bg-cat-blue">
                            <ArrowUpRightIcon className="h-5 w-5 text-on-fill" strokeWidth={1.5} />
                        </div>
                        <h4 className="text-lg font-semibold text-ink">AI for business</h4>
                        <p className="text-sm leading-relaxed text-ink-muted">
                            Custom copilots and workspace solutions, built on your data and
                            deployed where your data already lives.
                        </p>
                    </CardContent>
                </Card>

                <div className="relative overflow-hidden rounded-qs-lg border border-line bg-surface">
                    <div className="qs-halo" />
                    <div className="qs-grid-bg qs-grid-mask absolute inset-0" />
                    <div className="relative flex flex-col gap-qs-4 p-qs-6">
                        <p className="text-xs font-medium uppercase tracking-[0.12em] text-ink-muted">
                            Signal card
                        </p>
                        <h4 className="font-qs-display text-2xl leading-tight text-ink">
                            One lime element per composition
                        </h4>
                        <p className="text-sm leading-relaxed text-ink-2">
                            The halo and the grid do the work. The accent stays for the thing
                            you want clicked.
                        </p>
                    </div>
                </div>
            </div>
        </Specimen>

        <Specimen title="Form fields">
            <Panel className="grid gap-qs-5 md:grid-cols-2">
                <label className="flex flex-col gap-qs-2">
                    <span className="text-sm font-medium text-ink">Work email</span>
                    <input
                        type="email"
                        placeholder="you@company.com"
                        className="rounded-qs-md border border-line bg-surface px-qs-4 py-qs-3 text-sm text-ink placeholder:text-ink-faint focus:border-line-strong focus:outline-none"
                    />
                </label>
                <label className="flex flex-col gap-qs-2">
                    <span className="text-sm font-medium text-ink">Team size</span>
                    <select className="rounded-qs-md border border-line bg-surface px-qs-4 py-qs-3 text-sm text-ink focus:border-line-strong focus:outline-none">
                        <option>1–10</option>
                        <option>11–200</option>
                        <option>200+</option>
                    </select>
                </label>
                <label className="flex flex-col gap-qs-2 md:col-span-2">
                    <span className="text-sm font-medium text-ink">What are you building?</span>
                    <textarea
                        rows={3}
                        placeholder="A copilot over our internal knowledge base…"
                        className="resize-y rounded-qs-md border border-line bg-surface px-qs-4 py-qs-3 text-sm text-ink placeholder:text-ink-faint focus:border-line-strong focus:outline-none"
                    />
                </label>
            </Panel>
        </Specimen>

        <Specimen title="Tabs">
            <Panel>
                <Tabs defaultValue="data">
                    <TabsList>
                        <TabsTrigger value="data">Data for AI</TabsTrigger>
                        <TabsTrigger value="infra">Infrastructure</TabsTrigger>
                        <TabsTrigger value="voice">Voice AI</TabsTrigger>
                    </TabsList>
                    <TabsContent value="data" className="pt-qs-4 text-sm text-ink-2">
                        Knowledge graphs, retrieval and evaluation, the groundwork that makes
                        a model useful on your own material.
                    </TabsContent>
                    <TabsContent value="infra" className="pt-qs-4 text-sm text-ink-2">
                        Deployment across on-premises infrastructure and the major clouds.
                    </TabsContent>
                    <TabsContent value="voice" className="pt-qs-4 text-sm text-ink-2">
                        Low-latency speech interfaces for the places a keyboard does not fit.
                    </TabsContent>
                </Tabs>
            </Panel>
        </Specimen>

        <Specimen title="List rows" note="The pattern behind job listings and blog indexes.">
            <Panel className="flex flex-col">
                {[
                    { title: "Senior AI & ML Engineer", place: "Paris", type: "Permanent (CDI)" },
                    { title: "Forward Deployed Engineer", place: "Paris", type: "Permanent (CDI)" },
                ].map((row, i) => (
                    <div key={row.title}>
                        {i > 0 ? <Separator className="my-qs-5" /> : null}
                        <div className="group flex flex-wrap items-center justify-between gap-qs-4">
                            <div className="flex flex-col gap-qs-2">
                                <span className="text-base font-semibold text-ink">{row.title}</span>
                                <div className="flex flex-wrap items-center gap-qs-4 text-xs text-ink-muted">
                                    <span className="inline-flex items-center gap-1.5">
                                        <MapPinIcon className="h-3.5 w-3.5" strokeWidth={1.5} />
                                        {row.place}
                                    </span>
                                    <span className="inline-flex items-center gap-1.5">
                                        <ClockIcon className="h-3.5 w-3.5" strokeWidth={1.5} />
                                        {row.type}
                                    </span>
                                </div>
                            </div>
                            <ArrowUpRightIcon
                                className="h-5 w-5 text-ink-muted transition-colors duration-qs-2 ease-qs group-hover:text-signal-text"
                                strokeWidth={1.5}
                            />
                        </div>
                    </div>
                ))}
            </Panel>
        </Specimen>

        <Specimen
            title="Theme toggle"
            note={<>The control in the site header. Reads <Token>localStorage</Token>, writes <Token>data-theme</Token> on the document.</>}
        >
            <Panel className="flex items-center gap-qs-4">
                <ThemeToggle />
                <span className="text-sm text-ink-muted">
                    Dark is the default. The choice is remembered across visits and tabs.
                </span>
            </Panel>
        </Specimen>
    </Section>
);
