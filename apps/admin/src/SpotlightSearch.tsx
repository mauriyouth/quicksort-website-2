import { useEffect, useMemo, useRef, useState } from "react";
import {
  Briefcase,
  FolderKanban,
  GraduationCap,
  Target,
  UserCheck,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
  Kbd,
} from "@quicksort-sas/ui";

/* Loose structural shapes — real rows from @quicksort/hr-db satisfy these. */
export type SpotlightNavItem = {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  children?: { id: string; label: string; href: string }[];
};
export type SpotlightSalesContact = {
  id: string;
  name: string;
  email?: string | null;
  clientName?: string;
};
export type SpotlightCandidate = {
  id: string;
  person_id: string;
  full_name: string;
  email: string;
  stage: string;
  person_status?: string;
};
export type SpotlightEmployee = {
  id: string;
  person_id: string;
  full_name: string;
  email: string;
  stage: string;
  status?: string;
};
export type SpotlightOpportunity = {
  id: string;
  title: string;
  client_need: string;
  status: string;
};
export type SpotlightJob = {
  id: string;
  title: string;
  department: string;
  location: string;
};
export type SpotlightRequest = { id: string; tool_name: string; status: string };
export type SpotlightProject = {
  id: string;
  title: string;
  status: string;
  clientName: string;
};

type Item = {
  key: string;
  group: string;
  title: string;
  sub?: string;
  meta?: string;
  haystack: string;
  icon: LucideIcon;
  target: string;
  /** Query params that deep-link to the exact record on the target page. */
  params?: Record<string, string>;
};

const GROUP_ORDER = [
  "Contacts",
  "Employees",
  "Candidates",
  "Opportunities",
  "Projects",
  "Job posts",
  "Tool requests",
];

const norm = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Spotlight-style command palette for the admin workspace, on the
 * @quicksort-sas/ui Command (cmdk) dialog. Opens with ⌘P (or ⌘K): unified
 * results across pages and records, full keyboard navigation (↑↓ move,
 * ↵ open, esc close). Ranking stays ours (accent-insensitive, title prefix
 * first), so cmdk's own filtering is turned off.
 */
export function SpotlightSearch({
  open,
  onOpenChange,
  onNavigate,
  nav,
  salesPeople,
  candidates,
  employees = [],
  opportunities,
  jobs,
  requests,
  projects = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (id: string, params?: Record<string, string>) => void;
  nav: SpotlightNavItem[];
  salesPeople: SpotlightSalesContact[];
  candidates: SpotlightCandidate[];
  employees?: SpotlightEmployee[];
  opportunities: SpotlightOpportunity[];
  jobs: SpotlightJob[];
  requests: SpotlightRequest[];
  projects?: SpotlightProject[];
}) {
  const [query, setQuery] = useState("");
  const openRef = useRef(open);
  openRef.current = open;

  // Global hotkey: ⌘P / ⌘K toggles the palette (⌘P is the headline one —
  // we preventDefault so the browser print dialog never appears).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        !e.altKey &&
        (e.key.toLowerCase() === "p" || e.key.toLowerCase() === "k")
      ) {
        e.preventDefault();
        onOpenChange(!openRef.current);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onOpenChange]);

  // Fresh palette on every open (the dialog handles focus and scroll lock).
  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    const page = (
      id: string,
      label: string,
      parent: string | undefined,
      haystack: string,
      icon: LucideIcon,
    ) =>
      out.push({
        key: `page:${id}`,
        group: "Pages",
        title: label,
        sub: parent,
        haystack,
        icon,
        target: id,
      });

    for (const item of nav) {
      if (item.children) {
        for (const child of item.children)
          page(child.id, child.label, item.label, `${child.label} ${child.id} ${child.href}`, item.icon);
      } else {
        page(item.id, item.label, undefined, `${item.label} ${item.id} ${item.href}`, item.icon);
      }
    }
    // People = sales contacts (sales_contacts table), deep-linking to the
    // sales People page (?focus=<id>). Accounts (profiles) stay out of
    // the palette — they are a different table.
    salesPeople.forEach((p) =>
      out.push({
        key: `person:${p.id}`,
        group: "Contacts",
        title: p.name,
        sub: p.email || undefined,
        meta: "Sales",
        haystack: `${p.name} ${p.email ?? ""} ${p.clientName ?? ""}`,
        icon: Users,
        target: "sales-people",
        params: { focus: p.id },
      }),
    );
    // Employee / alumni rows are employees, not candidates — they surface
    // under "Employees" (deep-link to their employee record) instead.
    candidates
      .filter(
        (c) => c.person_status !== "employee" && c.person_status !== "alumni",
      )
      .forEach((c) =>
      out.push({
        key: `candidate:${c.id}`,
        group: "Candidates",
        title: c.full_name,
        sub: c.email,
        meta: c.stage,
        haystack: `${c.full_name} ${c.email} ${c.stage}`,
        icon: GraduationCap,
        // Person records live under /hr/people/<personId> — spotlight lands
        // on the Applications tab of the full record.
        target: "hr-people",
        params: { person: c.person_id, application: c.id },
      }),
    );
    employees.forEach((e) =>
      out.push({
        key: `employee:${e.id}`,
        group: "Employees",
        title: e.full_name,
        sub: e.email,
        meta: e.status === "ended" ? "Alumni" : e.stage,
        haystack: `${e.full_name} ${e.email} ${e.stage}`,
        icon: UserCheck,
        target: "hr-people",
        params: { person: e.person_id, employment: e.id },
      }),
    );
    opportunities.forEach((o) =>
      out.push({
        key: `opportunity:${o.id}`,
        group: "Opportunities",
        title: o.title,
        sub: o.client_need,
        meta: o.status,
        haystack: `${o.title} ${o.client_need} ${o.status}`,
        icon: Target,
        target: "opportunities",
      }),
    );
    projects.forEach((p) =>
      out.push({
        key: `project:${p.id}`,
        group: "Projects",
        title: p.title,
        sub: p.clientName,
        meta: p.status,
        haystack: `${p.title} ${p.clientName} ${p.status}`,
        icon: FolderKanban,
        target: "sales-projects",
      }),
    );
    jobs.forEach((j) =>
      out.push({
        key: `job:${j.id}`,
        group: "Job posts",
        title: j.title,
        sub: [j.department, j.location].filter(Boolean).join(" · "),
        haystack: `${j.title} ${j.department} ${j.location}`,
        icon: Briefcase,
        target: "jobs",
      }),
    );
    requests.forEach((r) =>
      out.push({
        key: `request:${r.id}`,
        group: "Tool requests",
        title: r.tool_name,
        meta: r.status,
        haystack: `${r.tool_name} ${r.status}`,
        icon: Wrench,
        target: "requests",
      }),
    );
    return out;
  }, [nav, salesPeople, candidates, employees, opportunities, projects, jobs, requests]);

  const results = useMemo(() => {
    const q = norm(query.trim());
    if (!q) {
      // Idle state: the first pages, plus the three newest records per group.
      const pages = items.filter((i) => i.group === "Pages").slice(0, 6);
      const rest = GROUP_ORDER.flatMap((g) =>
        items.filter((i) => i.group === g).slice(0, 3),
      );
      return [...pages, ...rest];
    }
    return items
      .map((item, index) => {
        const title = norm(item.title);
        const haystack = norm(item.haystack);
        const score = title.startsWith(q) ? 0 : title.includes(q) ? 1 : haystack.includes(q) ? 2 : -1;
        return { item, index, score };
      })
      .filter((r) => r.score >= 0)
      .sort((a, b) => a.score - b.score || a.index - b.index)
      .slice(0, 14)
      .map((r) => r.item);
  }, [items, query]);

  const pick = (item: Item) => {
    onOpenChange(false);
    onNavigate(item.target, item.params);
  };

  // Consecutive runs of the same group, in result order.
  const groups: { name: string; items: Item[] }[] = [];
  for (const item of results) {
    const last = groups[groups.length - 1];
    if (last?.name === item.group) last.items.push(item);
    else groups.push({ name: item.group, items: [item] });
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search workspace" description="Search pages, contacts, candidates, opportunities and projects.">
      <Command shouldFilter={false} loop>
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Search pages, contacts, candidates, opportunities, projects…"
          spellCheck={false}
          // The legacy global input:focus-visible rule (hr-ui styles) would
          // draw a lime border + ring on this borderless field.
          className="border-0 shadow-none focus-visible:border-0 focus-visible:shadow-none"
        />
        <CommandList className="max-h-[min(60vh,28rem)]">
          <CommandEmpty>
            <div className="flex flex-col gap-1">
              <span className="font-medium text-foreground">No results for “{query.trim()}”</span>
              <span>Check the spelling or search for a page, name or title</span>
            </div>
          </CommandEmpty>
          {groups.map((group, g) => (
            <CommandGroup key={`${group.name}-${g}`} heading={group.name}>
              {group.items.map((item) => (
                <CommandItem key={item.key} value={item.key} onSelect={() => pick(item)}>
                  <item.icon />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{item.title}</span>
                    {item.sub && <span className="truncate text-xs text-muted-foreground">{item.sub}</span>}
                  </span>
                  {item.meta && <CommandShortcut className="normal-case">{item.meta}</CommandShortcut>}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
        <div className="flex items-center gap-4 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><Kbd>↑↓</Kbd> Navigate</span>
          <span className="flex items-center gap-1.5"><Kbd>↵</Kbd> Open</span>
          <span className="flex items-center gap-1.5"><Kbd>esc</Kbd> Close</span>
        </div>
      </Command>
    </CommandDialog>
  );
}
