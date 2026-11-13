/**
 * Unified section header — the same top menu on every page, rendered in the
 * AdminShell top bar. Shows the section name, a divider, then that section's
 * screens as tabs (pages without sub-screens render the name alone). The
 * active tab's 2px rule sits on the top bar's bottom hairline.
 */
import { cn } from "cn";

export type SectionTab = { id: string; href: string; label: string };

export const SALES_TABS: SectionTab[] = [
  { id: "sales-dashboard", href: "/sales", label: "Dashboard" },
  { id: "sales-pipeline", href: "/sales/pipeline", label: "Pipeline" },
  { id: "sales-clients", href: "/sales/clients", label: "Clients" },
  { id: "sales-people", href: "/sales/people", label: "Contacts" },
  { id: "sales-projects", href: "/sales/projects", label: "Projects" },
  { id: "sales-invoicing", href: "/sales/invoicing", label: "Invoicing" },
  { id: "sales-freelancer-invoices", href: "/sales/freelancer-invoices", label: "Freelancer invoices" },
];

export const HR_TABS: SectionTab[] = [
  { id: "hr-overview", href: "/hr", label: "Overview" },
  { id: "recruiting", href: "/hr/recruiting", label: "Recruiting" },
  { id: "hr-opportunities", href: "/hr/recruiting/needs", label: "Opportunities" },
  { id: "hr-people", href: "/hr/people", label: "People" },
  { id: "journeys", href: "/hr/journeys", label: "Journeys" },
  { id: "hr-documents", href: "/hr/documents", label: "Documents" },
  { id: "hr-payslips", href: "/hr/payslips", label: "Payslips" },
  { id: "jobs", href: "/hr/jobs", label: "Job posts" },
];

export const OPS_TABS: SectionTab[] = [
  { id: "operations", href: "/operations", label: "Board" },
  { id: "ops-business-plan", href: "/operations/business-plan", label: "Business plan" },
  { id: "ops-checks", href: "/operations/checks", label: "Checks" },
  { id: "ops-admin", href: "/operations/admin", label: "Admin" },
];

export function SectionHeader({
  label,
  tabs = [],
  current,
  onNavigate,
}: {
  label: string;
  tabs?: SectionTab[];
  current: string;
  onNavigate: (id: string) => void;
}) {
  return (
    <nav
      aria-label={`${label} sections`}
      className="-mb-px flex h-full items-stretch gap-6 overflow-x-auto [scrollbar-width:none]"
    >
      <span className="flex shrink-0 items-center text-sm font-medium text-foreground">{label}</span>
      {tabs.length > 0 && <span aria-hidden="true" className="my-auto h-4 w-px shrink-0 bg-border" />}
      {tabs.map((tab) => {
        const active = current === tab.id;
        return (
          <a
            key={tab.id}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center border-b-2 border-transparent px-0.5 text-sm whitespace-nowrap text-muted-foreground no-underline transition-colors hover:text-foreground",
              active && "border-foreground text-foreground",
            )}
            onClick={(event) => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              onNavigate(tab.id);
            }}
          >
            {tab.label}
          </a>
        );
      })}
    </nav>
  );
}
