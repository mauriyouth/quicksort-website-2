import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";
import { CircleHelp, type LucideIcon } from "lucide-react";

/* React wrappers for the .qs-* classes in components.css.
   Import "@quicksort/design-system/components.css" once in the app. */

export function cn(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ── Button ─────────────────────────────────────────────────── */
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
  size?: "md" | "sm";
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn("qs-btn", `qs-btn--${variant}`, size === "sm" && "qs-btn--sm", className)}
      {...rest}
    />
  );
}

/* ── Surfaces ───────────────────────────────────────────────── */
export function Card({
  interactive = false,
  className,
  children,
  ...rest
}: {
  interactive?: boolean;
  className?: string;
  children: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLDivElement>, "className" | "children">) {
  return (
    <div
      className={cn("qs-card", interactive && "qs-card--interactive", className)}
      {...rest}
    >
      {children}
    </div>
  );
}

export function Panel({
  dark = false,
  className,
  children,
  ...rest
}: {
  dark?: boolean;
  className?: string;
  children: ReactNode;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "className" | "children">) {
  return (
    <div className={cn("qs-panel", dark && "qs-panel--dark", className)} {...rest}>
      {children}
    </div>
  );
}

/* ── Pill ───────────────────────────────────────────────────── */
export function Pill({
  tone = "neutral",
  className,
  children,
}: {
  tone?: "neutral" | "accent" | "outline";
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={cn("qs-pill", tone !== "neutral" && `qs-pill--${tone}`, className)}>
      {children}
    </span>
  );
}

/* ── Stat ───────────────────────────────────────────────────── */
export function Stat({
  label,
  value,
  detail,
  icon: Icon,
  className,
}: {
  label: string;
  value: number | string;
  detail: string;
  icon: LucideIcon;
  className?: string;
}) {
  return (
    <div className={cn("qs-stat", className)}>
      <div className="qs-stat-top">
        {label}
        <Icon size={18} />
      </div>
      <strong className="qs-stat-value">
        {typeof value === "number" ? value.toString().padStart(2, "0") : value}
      </strong>
      <small className="qs-stat-detail">{detail}</small>
    </div>
  );
}

/* ── Notice ─────────────────────────────────────────────────── */
export function Notice({
  error = false,
  className,
  children,
}: {
  error?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn("qs-notice", error && "qs-notice--error", className)}
      role={error ? "alert" : "status"}
    >
      {children}
    </div>
  );
}

/* ── Empty state ────────────────────────────────────────────── */
export function Empty({
  title,
  action,
  className,
  children,
}: {
  title: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("qs-empty", className)}>
      <CircleHelp size={28} />
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}

/* ── Fields ─────────────────────────────────────────────────── */
export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("qs-input", className)} {...rest} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn("qs-input", className)} {...rest} />;
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("qs-field", className)}>
      {label}
      {children}
      {error ? (
        <span className="qs-field-error">{error}</span>
      ) : hint ? (
        <span className="qs-field-hint">{hint}</span>
      ) : null}
    </label>
  );
}

/* ── List row ───────────────────────────────────────────────── */
export function ListRow({
  children,
  actions,
  className,
}: {
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("qs-list-row", className)}>
      <div style={{ minWidth: 0 }}>{children}</div>
      {actions ? <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{actions}</div> : null}
    </div>
  );
}
