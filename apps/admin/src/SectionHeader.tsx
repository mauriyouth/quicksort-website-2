/**
 * Unified section header — the same top menu on every page. Shows the
 * section name, a divider, then that section's screens as large tabs
 * (pages without sub-screens render the name alone). Links carry no text
 * underline; the active tab's 2px border sits on the hairline below the
 * row, which spans the full workspace width (see section-header.css).
 * Replaces the former per-section Sales/Hr/Ops headers and the shell's
 * breadcrumb top bar, so every route looks identical.
 */

import { ThemeToggle } from "@quicksort/hr-ui";
import "./section-header.css";

export type SectionTab = { id: string; href: string; label: string };

export const SALES_TABS: SectionTab[] = [
  { id: "sales-dashboard", href: "/sales", label: "Dashboard" },
  { id: "sales-pipeline", href: "/sales/pipeline", label: "Pipeline" },
  { id: "sales-clients", href: "/sales/clients", label: "Clients" },
  { id: "sales-people", href: "/sales/people", label: "People" },
  { id: "opportunities", href: "/sales/opportunities", label: "Opportunities" },
];

export const HR_TABS: SectionTab[] = [
  { id: "pipeline", href: "/hr/pipeline", label: "Pipeline" },
  { id: "jobs", href: "/hr/jobs", label: "Job posts" },
  { id: "employees", href: "/hr/employees", label: "Employees" },
  { id: "analyzer", href: "/hr/cv-analyzer", label: "CV analyzer" },
  { id: "contracts", href: "/hr/contracts", label: "Contracts" },
];

export const OPS_TABS: SectionTab[] = [
  { id: "operations", href: "/operations", label: "Board" },
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
    <nav className="section-header" aria-label={`${label} sections`}>
      <span className="section-header-label">{label}</span>
      {tabs.length > 0 && (
        <span className="section-header-divider" aria-hidden="true" />
      )}
      {tabs.map((tab) => (
        <a
          key={tab.id}
          href={tab.href}
          className={current === tab.id ? "active" : ""}
          aria-current={current === tab.id ? "page" : undefined}
          onClick={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            onNavigate(tab.id);
          }}
        >
          {tab.label}
        </a>
      ))}
      <span className="section-header-spacer" aria-hidden="true" />
      <span className="section-header-actions">
        <ThemeToggle size="sm" />
      </span>
    </nav>
  );
}
