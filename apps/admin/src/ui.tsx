/**
 * Small admin patterns on top of @quicksort-sas/ui, shared by the pages
 * migrated off the hr-ui primitives (Notice, Empty, Pill).
 */
import type { ReactNode } from "react";
import {
  Alert,
  AlertDescription,
  Badge,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  buttonVariants,
} from "@quicksort-sas/ui";
import { cn } from "cn";

/** Page-level error and success messages (replaces hr-ui <Notice>). */
export function PageAlerts({ error, message }: { error?: string; message?: string }) {
  if (!error && !message) return null;
  return (
    <div className="flex flex-col gap-2" role="status">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {message && (
        <Alert variant="success">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

/** Dashed empty state for a list or panel (replaces hr-ui <Empty>). */
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <Empty className="border border-dashed border-border py-8">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        {children && <EmptyDescription>{children}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "success" | "warning" | "destructive"> = {
  published: "success",
  approved: "success",
  draft: "secondary",
  pending: "warning",
  rejected: "destructive",
  revoked: "destructive",
  owner: "default",
  admin: "outline",
};

/** Record status chip (replaces hr-ui <Pill>). */
export function StatusBadge({ status }: { status: string }) {
  return <Badge variant={STATUS_VARIANT[status] ?? "secondary"}>{status}</Badge>;
}

/** Page title block with an optional eyebrow, intro and primary action
 *  (replaces hr-ui / candidate-ui <Heading>). */
export function PageHeading({ eyebrow, title, action, children }: { eyebrow?: string; title: string; action?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex max-w-2xl flex-col gap-2">
        {eyebrow && <span className="label-mono">{eyebrow}</span>}
        <h1 className="m-0 text-3xl font-medium tracking-tight">{title}</h1>
        {children && <p className="m-0 text-sm text-muted-foreground">{children}</p>}
      </div>
      {action}
    </header>
  );
}

/** Button styling for an <a>. buttonVariants() alone leaves conflicting
 *  classes (border-transparent + border-foreground) unmerged; <Button> runs
 *  them through cn(), so links must too. */
export const linkButton = (options?: Parameters<typeof buttonVariants>[0]) => cn(buttonVariants(options));
