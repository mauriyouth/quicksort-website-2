import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Briefcase,
  FileText,
  FolderKanban,
  GraduationCap,
  Search,
  Target,
  UserCheck,
  Users,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import "./spotlight.css";

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
export type SpotlightContract = { id: string; title: string };
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
  "Contracts",
  "Tool requests",
];

const norm = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Spotlight-style command palette for the admin workspace.
 * Opens with ⌘P (or ⌘K), like the macOS Spotlight bar: a centered modal
 * over a blurred backdrop, unified results across pages and records,
 * full keyboard navigation (↑↓ move, ↵ open, esc close).
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
  contracts,
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
  contracts: SpotlightContract[];
  requests: SpotlightRequest[];
  projects?: SpotlightProject[];
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
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
      } else if (e.key === "Escape" && openRef.current) {
        onOpenChange(false);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onOpenChange]);

  // Fresh palette on every open, and lock body scroll while it is up.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = previous;
    };
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
    contracts.forEach((c) =>
      out.push({
        key: `contract:${c.id}`,
        group: "Contracts",
        title: c.title,
        haystack: c.title,
        icon: FileText,
        target: "contracts",
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
  }, [nav, salesPeople, candidates, employees, opportunities, projects, jobs, contracts, requests]);

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

  useEffect(() => {
    setActive(0);
  }, [query]);

  // Keep the highlighted row visible while arrowing through the list.
  useEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector(`[data-idx="${active}"]`);
    if (list && el instanceof HTMLElement) {
      if (el.offsetTop < list.scrollTop)
        list.scrollTop = el.offsetTop - 4;
      else if (el.offsetTop + el.offsetHeight > list.scrollTop + list.clientHeight)
        list.scrollTop = el.offsetTop + el.offsetHeight - list.clientHeight + 4;
    }
  }, [active, results]);

  if (!open) return null;

  const pick = (item: Item) => {
    onOpenChange(false);
    onNavigate(item.target, item.params);
  };
  const hasQuery = query.trim().length > 0;

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    const n = results.length;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(n ? (active + 1) % n : 0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(n ? (active - 1 + n) % n : 0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[active]) pick(results[active]);
    } else if (e.key === "Tab") {
      // Keep focus in the field — the palette is a single-focus dialog.
      e.preventDefault();
    }
  }

  let lastGroup = "";
  return (
    <div
      className="spotlight-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div className="spotlight" role="dialog" aria-modal="true" aria-label="Search workspace">
        <div className="spotlight-field">
          <Search size={18} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Search pages, contacts, candidates, opportunities, projects…"
            spellCheck={false}
          />
          {hasQuery ? (
            <button
              type="button"
              className="spotlight-clear"
              aria-label="Clear search"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
            >
              <X size={15} />
            </button>
          ) : (
            <kbd>⌘P</kbd>
          )}
        </div>

        <div className="spotlight-list" ref={listRef}>
          {results.map((item, i) => {
            const header =
              item.group !== lastGroup ? (
                <div className="spotlight-group">{item.group}</div>
              ) : null;
            lastGroup = item.group;
            return (
              <Fragment key={item.key}>
                {header}
                <button
                  type="button"
                  key={item.key}
                  data-idx={i}
                  className={`spotlight-item${i === active ? " active" : ""}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(item)}
                >
                  <span className="tile">
                    <item.icon size={16} />
                  </span>
                  <span className="text">
                    <span className="title">{item.title}</span>
                    {item.sub && <span className="sub">{item.sub}</span>}
                  </span>
                  {item.meta && <span className="meta">{item.meta}</span>}
                  <ArrowRight size={14} className="enter" />
                </button>
              </Fragment>
            );
          })}
          {results.length === 0 && (
            <div className="spotlight-empty">
              <strong>No results for “{query.trim()}”</strong>
              <span>Check the spelling or search for a page, name or title</span>
            </div>
          )}
        </div>

        <div className="spotlight-footer">
          <span className="spotlight-hint">
            <kbd>↑↓</kbd> Navigate
          </span>
          <span className="spotlight-hint">
            <kbd>↵</kbd> Open
          </span>
          <span className="spotlight-hint">
            <kbd>esc</kbd> Close
          </span>
        </div>
      </div>
    </div>
  );
}
