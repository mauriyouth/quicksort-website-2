import { Slot } from "@radix-ui/react-slot";
import { type VariantProps, cva } from "class-variance-authority";
import * as React from "react";
import { cn } from "@lib/utils";

/**
 * The one button. Brand variants (`signal`, `inverse`, `outline`, `quiet`)
 * are what the marketing site uses; the stock shadcn variants are kept so
 * the ui/ primitives keep working.
 *
 * Sizes prefixed `qs-` carry the brand's padding and type together, because
 * on this site the two always travel as a pair. Reach for a `qs-` size with
 * a brand variant, and never re-specify padding, radius or font at the call
 * site — that is how six near-identical copies of one button appeared in the
 * first place.
 *
 * The brand variants are the identity bundle's four buttons under this
 * codebase's names: `signal` is Accent, `inverse` is Primary, `outline` is
 * Secondary, `quiet` is Ghost. States follow the bundle's States section —
 * hover shifts the fill ~8%, press darkens 12% with no shrink, focus is a
 * 2px Signal Lime ring offset 2px. Radius is the one deliberate departure:
 * the bundle draws pills, the site ships 8px. See the design-system page.
 *
 * Focus is deliberately *not* styled here. `:focus-visible` in tailwind.css
 * already draws the bundle's 2px Signal Lime outline at 2px offset on every
 * interactive element. A local ring would have to paint its own offset
 * colour, which is wrong the moment a button sits on a card rather than the
 * page canvas — an `outline-offset` gap stays transparent and is always
 * right. Do not add `focus-visible:outline-none` back.
 *
 * The bundle also asks disabled buttons for `cursor: not-allowed` *and* no
 * hover. Those conflict — `pointer-events-none` is what suppresses hover,
 * and it also stops the cursor painting. No-hover wins; the class is kept
 * so the intent survives if that ever changes.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors duration-qs-2 ease-qs active:brightness-[0.88] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // ── Brand ────────────────────────────────────────────────────
        /** The primary call to action. At most one per view. */
        signal:
          "bg-signal text-signal-fg hover:bg-signal-hover",
        /** Neutral counterpart to signal — flips with the theme. */
        inverse:
          "bg-surface-inverse text-ink-inverse hover:bg-surface-inverse-hover",
        /** Quiet, text-only action. */
        quiet:
          "text-ink-2 hover:text-ink hover:bg-transparent",

        // ── shadcn ───────────────────────────────────────────────────
        default:
          "bg-primary text-primary-foreground shadow hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        outline:
          "border border-line-strong bg-transparent text-ink hover:bg-surface-sunken",
        secondary:
          "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-signal-text underline-offset-4 hover:underline",
      },
      size: {
        // ── Brand sizes: padding + type, always together ─────────────
        /** Header and compact placements. */
        "qs-sm":
          "h-auto rounded-lg gap-1.5 px-4 py-2.5 font-text-md-semibold font-[number:var(--text-md-semibold-font-weight)] text-[length:var(--text-md-semibold-font-size)] tracking-[var(--text-md-semibold-letter-spacing)] leading-[var(--text-md-semibold-line-height)] [font-style:var(--text-md-semibold-font-style)]",
        /** The default call to action. */
        qs: "h-auto rounded-lg gap-2.5 px-[22px] py-4 font-text-lg-semibold font-[number:var(--text-lg-semibold-font-weight)] text-[length:var(--text-lg-semibold-font-size)] tracking-[var(--text-lg-semibold-letter-spacing)] leading-[var(--text-lg-semibold-line-height)] [font-style:var(--text-lg-semibold-font-style)]",
        /** Hero and footer — steps down on small screens. */
        "qs-hero":
          "h-auto rounded-lg gap-2.5 px-5 sm:px-[22px] py-3 sm:py-4 font-text-lg-semibold font-[number:var(--text-lg-semibold-font-weight)] text-sm sm:text-[length:var(--text-lg-semibold-font-size)] tracking-[var(--text-lg-semibold-letter-spacing)] leading-[var(--text-lg-semibold-line-height)] [font-style:var(--text-lg-semibold-font-style)]",
        /** Wide, for a page's single terminal action. */
        "qs-lg":
          "h-auto rounded-lg gap-2.5 px-8 py-4 font-text-lg-semibold font-[number:var(--text-lg-semibold-font-weight)] text-[length:var(--text-lg-semibold-font-size)] tracking-[var(--text-lg-semibold-letter-spacing)] leading-[var(--text-lg-semibold-line-height)] [font-style:var(--text-lg-semibold-font-style)]",

        // ── shadcn sizes ─────────────────────────────────────────────
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
