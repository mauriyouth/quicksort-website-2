import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { alternates, getPageSeo, SITE_URL, SOCIAL_IMAGE, structuredData } from '../lib/seo';

export function Seo() {
  const { pathname } = useLocation();
  useEffect(() => {
    const page = getPageSeo(pathname);
    document.title = page.title;
    document.documentElement.lang = page.locale || 'en';
    document.documentElement.dir = 'ltr';
    document.head.querySelectorAll('link[hreflang]').forEach(link => link.remove());
    for (const {lang, url} of alternates(page)) {
      const link = document.createElement('link'); link.rel = 'alternate'; link.hreflang = lang; link.href = url; document.head.append(link);
    }
    function meta(key: string, content: string, property = false) {
      const attr = property ? 'property' : 'name';
      let element = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
      if (!element) { element = document.createElement('meta'); element.setAttribute(attr, key); document.head.append(element); }
      element.content = content;
    }
    meta('description', page.description);
    meta('robots', page.noindex ? 'noindex, follow' : 'index, follow');
    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) { canonical = document.createElement('link'); canonical.rel = 'canonical'; document.head.append(canonical); }
    canonical.href = SITE_URL + page.path;
    meta('og:title', page.title, true); meta('og:description', page.description, true);
    meta('og:url', SITE_URL + page.path, true); meta('og:type', page.type === 'BlogPosting' ? 'article' : 'website', true);
    meta('og:site_name', 'Quicksort', true); meta('og:locale', ({en:'en_US',fr:'fr_FR'})[page.locale || 'en'], true);
    meta('og:image', SOCIAL_IMAGE, true); meta('og:image:alt', 'Quicksort - Human + AI collaboration', true);
    meta('twitter:card', 'summary_large_image'); meta('twitter:title', page.title);
    meta('twitter:description', page.description); meta('twitter:image', SOCIAL_IMAGE);
    let script = document.head.querySelector<HTMLScriptElement>('#seo-schema');
    const data = structuredData(page);
    if (!data) script?.remove();
    else { if (!script) { script = document.createElement('script'); script.id = 'seo-schema'; script.type = 'application/ld+json'; document.head.append(script); } script.textContent = JSON.stringify(data); }
  }, [pathname]);
  return null;
}
