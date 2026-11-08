/**
 * Building blocks for the Settings panels (Account, AI configuration,
 * Google Drive), on @quicksort-sas/ui. They replace the
 * former sp-* classes from settings-page.css: a card with a ruled header
 * and a connection badge, label/hint rows, and an action footer.
 */
import type { ReactNode } from "react";
import { cn } from "cn";
import { Badge, Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@quicksort-sas/ui";

export function SettingsCard({
  title,
  description,
  action,
  footer,
  children,
}: {
  title: string;
  description?: ReactNode;
  /** Top-right of the header: connection badge, refresh, etc. */
  action?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Card aria-label={title} role="region">
      <CardHeader className="border-b border-border">
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription className="max-w-prose">{description}</CardDescription>}
        {action && <CardAction className="flex items-center gap-2">{action}</CardAction>}
      </CardHeader>
      {children && <CardContent className="flex flex-col divide-y divide-border">{children}</CardContent>}
      {footer && <CardFooter className="flex flex-wrap items-center justify-between gap-3 border-t border-border">{footer}</CardFooter>}
    </Card>
  );
}

/** Label + hint on the left, controls on the right (stacked on narrow screens). */
export function SettingsRow({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-3 py-5 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] md:gap-8">
      <div className="flex flex-col gap-1">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      <div className="flex min-w-0 flex-col gap-2">{children}</div>
    </div>
  );
}

/** Small explanatory text under a control. */
export function Hint({ children, className, role }: { children: ReactNode; className?: string; role?: string }) {
  return (
    <p role={role} className={cn("m-0 text-xs text-muted-foreground [&_a]:underline [&_strong]:font-medium [&_strong]:text-foreground", className)}>
      {children}
    </p>
  );
}

/** Connection status chip with a dot. */
export function ConnectionBadge({ tone, children }: { tone: "ok" | "danger" | "neutral"; children: ReactNode }) {
  const variant = tone === "ok" ? "success" : tone === "danger" ? "destructive" : "secondary";
  return (
    <Badge variant={variant} role="status" className="gap-1.5">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {children}
    </Badge>
  );
}
