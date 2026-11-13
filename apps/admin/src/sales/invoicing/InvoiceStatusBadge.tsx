import { AlertCircle, Check, Clock } from "lucide-react";
import { Badge } from "@quicksort-sas/ui";

type Variant = "outline" | "secondary" | "success" | "warning" | "destructive";

/**
 * Invoice status chip for the labels format.ts produces (invoiceRowLabel /
 * invoiceStatusLabel), plus "To invoice" for a CRA month with no invoice.
 */
export function InvoiceStatusBadge({ label }: { label: string }) {
  const key = label.split(" ")[0].toLowerCase();
  const notInQonto = label.startsWith("Draft (");
  const variant: Variant = notInQonto ? "warning"
    : key === "paid" ? "success"
    : key === "overdue" ? "destructive"
    : key === "validated" ? "outline"
    : key === "to" ? "secondary"
    : "outline";
  return (
    <Badge variant={variant} className={key === "draft" && !notInQonto ? "border-dashed" : key === "canceled" ? "border-dashed text-muted-foreground" : undefined}>
      {key === "paid" ? <Check data-icon="inline-start" aria-hidden="true" />
        : key === "validated" ? <Clock data-icon="inline-start" aria-hidden="true" />
        : key === "overdue" ? <AlertCircle data-icon="inline-start" aria-hidden="true" />
        : key === "to" ? <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
        : null}
      {label}
    </Badge>
  );
}
