import { useCallback, useEffect, useState } from 'react';

export type PortalRoute = { id: string; href: string };

/** Keep section navigation in browser history without reloading the app. */
export function usePortalRoute(routes: readonly PortalRoute[]) {
  const resolve = () => {
    const path = window.location.pathname.replace(/\/+$/, '') || '/';
    if (path === '/') return routes[0].id;
    // Exact match first; then the longest section prefix owns its detail
    // URLs (e.g. "/sales/clients/:id" resolves to the "/sales/clients" page,
    // not the shorter "/sales" landing).
    const exact = routes.find(route => route.href === path);
    if (exact) return exact.id;
    const prefix = routes
      .filter(route => path.startsWith(route.href + '/'))
      .sort((a, b) => b.href.length - a.href.length)[0];
    return prefix?.id ?? 'not-found';
  };
  const [current, setCurrent] = useState(resolve);
  useEffect(() => {
    if (window.location.pathname === '/') {
      window.history.replaceState(null, '', routes[0].href + window.location.search + window.location.hash);
    }
    const update = () => setCurrent(resolve());
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, [routes]);
  const navigate = useCallback((id: string, href?: string) => {
    const route = routes.find(item => item.id === id);
    if (!route) return;
    // Deep links pass their full path (e.g. "/hr/people/<id>/cra"); plain
    // navigation falls back to the section href.
    const target = href ?? route.href;
    if (window.location.pathname + window.location.search + window.location.hash !== target)
      window.history.pushState(null, '', target);
    setCurrent(id);
    window.scrollTo(0, 0);
  }, [routes]);
  return [current, navigate] as const;
}
