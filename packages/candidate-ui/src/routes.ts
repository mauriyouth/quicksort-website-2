import { useCallback, useEffect, useState } from 'react';

export type PortalRoute = { id: string; href: string };

/** Keep section navigation in browser history without reloading the app. */
export function usePortalRoute(routes: readonly PortalRoute[]) {
  const resolve = () => {
    const path = window.location.pathname.replace(/\/+$/, '') || '/';
    return path === '/' ? routes[0].id : routes.find(route => route.href === path)?.id ?? 'not-found';
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
  const navigate = useCallback((id: string) => {
    const route = routes.find(item => item.id === id);
    if (!route) return;
    if (window.location.pathname !== route.href) window.history.pushState(null, '', route.href);
    setCurrent(id);
    window.scrollTo(0, 0);
  }, [routes]);
  return [current, navigate] as const;
}
