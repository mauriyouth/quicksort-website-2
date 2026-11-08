/**
 * Admin workspace shell, built on @quicksort-sas/ui: a collapsible sidebar
 * (icons-only when collapsed, a sheet on mobile) and a sticky top bar that
 * carries the section header and the theme switch. Replaces the shared
 * hr-ui <Shell> for both the admin workspace and the employee portal
 * (HrPortal); the other apps keep theirs.
 *
 * Page content still renders inside `.content` (max-width, padding) so pages
 * not yet migrated to components keep their layout.
 */
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { useClerk } from "@clerk/react";
import { LogOut, Moon, Search, Sun } from "lucide-react";
import {
  Button,
  Kbd,
  QuicksortLogo,
  QuicksortMark,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "@quicksort-sas/ui";
import { Empty, Notice, getTheme, setTheme, type ShellNavItem } from "@quicksort/hr-ui";
import { errorMessage } from "@quicksort/hr-db";

const COLLAPSED_KEY = "qs-shell-collapsed";

/** Plain left-click → client-side navigation; modified clicks keep the link. */
function routeClick(event: MouseEvent<HTMLAnchorElement>, go: () => void) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  go();
}

export function AdminShell({
  portal,
  email,
  nav,
  current,
  onNavigate,
  header,
  onSearch,
  children,
}: {
  portal: string;
  email: string;
  nav: ShellNavItem[];
  current: string;
  onNavigate: (id: string) => void;
  /** Rendered in the sticky top bar (the page's SectionHeader). */
  header?: ReactNode;
  /** Shows the workspace search entry in the sidebar when set. */
  onSearch?: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(COLLAPSED_KEY) !== "1"; } catch { return true; }
  });
  function changeOpen(next: boolean) {
    setOpen(next);
    try { localStorage.setItem(COLLAPSED_KEY, next ? "0" : "1"); } catch { /* not persisted */ }
  }
  return (
    <SidebarProvider open={open} onOpenChange={changeOpen}>
      <AdminSidebar portal={portal} email={email} nav={nav} current={current} onNavigate={onNavigate} onSearch={onSearch} />
      <SidebarInset className="admin-workspace min-w-0">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <SidebarTrigger className="-ml-1 text-muted-foreground" />
          <div className="min-w-0 flex-1 self-stretch">{header}</div>
          <ThemeSwitch />
        </header>
        {/* my-0: legacy .content uses `margin: auto`, which would centre short
            pages vertically inside the flex-column inset. */}
        <main className="content admin-content my-0 w-full">
          {current === "not-found" ? (
            <Empty title="Page not found" action={<a href={nav[0].href}>Return to your workspace</a>}>
              Choose a section from the navigation.
            </Empty>
          ) : (
            children
          )}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

function AdminSidebar({
  portal,
  email,
  nav,
  current,
  onNavigate,
  onSearch,
}: {
  portal: string;
  email: string;
  nav: ShellNavItem[];
  current: string;
  onNavigate: (id: string) => void;
  onSearch?: () => void;
}) {
  const clerk = useClerk();
  const { isMobile, setOpenMobile } = useSidebar();
  const [error, setError] = useState("");
  function go(id: string) {
    onNavigate(id);
    if (isMobile) setOpenMobile(false);
  }
  async function signOut() {
    try { await clerk.signOut(); } catch (err) { setError(errorMessage(err)); }
  }
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-3 px-3 pt-4">
        <a
          href="https://www.quicksort.fr"
          aria-label="Quicksort home"
          className="flex h-8 items-center px-1 text-sidebar-foreground"
        >
          <QuicksortLogo className="group-data-[collapsible=icon]:hidden" />
          <QuicksortMark className="hidden h-5 group-data-[collapsible=icon]:block" />
        </a>
        {onSearch && (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton variant="outline" tooltip="Search (⌘P)" onClick={onSearch} className="text-muted-foreground">
                <Search />
                <span className="flex-1">Search</span>
                <Kbd className="group-data-[collapsible=icon]:hidden">⌘P</Kbd>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="label-mono">{portal} workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {nav.map((item) => {
                const active = current === item.id || !!item.children?.some((child) => child.id === current);
                return (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      isActive={active}
                      tooltip={item.label}
                      render={
                        <a
                          href={item.href}
                          aria-current={active ? "page" : undefined}
                          onClick={(event) => routeClick(event, () => go(item.id))}
                        />
                      }
                    >
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarSeparator className="data-horizontal:w-auto" />
      <SidebarFooter className="pb-4">
        {error && <Notice error>{error}</Notice>}
        <p className="truncate px-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden" title={email}>
          {email}
        </p>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Sign out" onClick={signOut}>
              <LogOut />
              <span>Sign out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

/** Light/dark switch. Writes data-theme (main.tsx mirrors it to `.dark`). */
function ThemeSwitch() {
  const [theme, setThemeState] = useState(() => getTheme());
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setThemeState(getTheme()));
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  const next = theme === "dark" ? "light" : "dark";
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      onClick={() => setTheme(next)}
      className="text-muted-foreground"
    >
      {theme === "dark" ? <Sun /> : <Moon />}
    </Button>
  );
}
