import * as React from "react";
import { cn } from "@lib/utils";

type Tone = "dark" | "light";

export const DsCard = ({
  variant = "dark",
  className,
  children,
}: {
  variant?: "dark" | "light" | "signal";
  className?: string;
  children: React.ReactNode;
}): JSX.Element => {
  const base = "relative overflow-hidden rounded-lg p-[18px]";
  const styles =
    variant === "light"
      ? "bg-white text-fg-1 border border-[color:var(--qs-border)]"
      : "bg-ink text-seasalt border border-border-inv";
  return (
    <div className={cn(base, styles, className)}>
      {variant === "signal" && (
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-[-40px] h-20 w-[90%] -translate-x-1/2 rounded-full"
          style={{ background: "var(--qs-lime)", opacity: 0.35, filter: "blur(8px)" }}
        />
      )}
      <div className="relative">{children}</div>
    </div>
  );
};

export const DsCardEyebrow = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn("font-mono text-[11px] uppercase tracking-[0.12em] text-dim-gray", className)}>{children}</div>
);

export const DsCardTitle = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn("mt-2 font-display text-[22px] leading-[1.1]", className)}>{children}</div>
);

export const DsCardBody = ({ children, tone = "dark", className }: { children: React.ReactNode; tone?: Tone; className?: string }) => (
  <p className={cn("mt-2.5 font-sans text-sm leading-[1.5]", tone === "light" ? "text-fg-2" : "text-fg-inv-2", className)}>{children}</p>
);
