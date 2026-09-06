import { locales, splitLocale, localePath, type Locale } from './locales';
import { translate } from './translations';
import { blogPosts } from './blogPosts';


export const SITE_URL = 'https://www.quicksort.fr';
export const SOCIAL_IMAGE = `${SITE_URL}/social-preview.png`;
export type PageSeo = { path: string; title: string; description: string; name: string; type?: string; noindex?: boolean; locale?: Locale };
const englishPages: PageSeo[] = [
  { path: '/', name: 'Quicksort', title: 'Enterprise AI Agents & Engineering | Quicksort', description: 'Quicksort designs enterprise AI agents, data systems and private AI infrastructure. Explore our engineering services and discuss your use case.' },
  { path: '/ai-for-business', name: 'AI for business', title: 'Enterprise AI Agents & Copilots | Quicksort', description: 'Build custom AI agents and copilots with Quicksort. Connect enterprise data and tools through human-in-the-loop workflows and product design.', type: 'Service' },
  { path: '/data-for-ai', name: 'Data for AI', title: 'Enterprise Data Engineering for AI | Quicksort', description: 'Prepare enterprise data for AI with Quicksort. Explore data pipelines, contextual intelligence and knowledge systems for models and agents.', type: 'Service' },
  { path: '/infrastructure-for-ai', name: 'Infrastructure for AI', title: 'Private AI Infrastructure & LLM Deployment | Quicksort', description: 'Design and deploy AI infrastructure with Quicksort. Explore secure on-premise and cloud environments for LLMs, multimodal models and agent systems.', type: 'Service' },
  { path: '/voice-ai', name: 'Voice AI', title: 'Enterprise Voice AI Agents | Quicksort', description: 'Build real-time voice agents with Quicksort. Connect conversations to enterprise workflows with contextual responses and seamless human handoffs.', type: 'Service' },
  { path: '/blog', name: 'Blog', title: 'Enterprise AI Insights | Quicksort', description: 'Read Quicksort insights on human and AI collaboration, agentic systems and enterprise engineering. Explore ideas behind our approach to AI delivery.' },
  { path: '/career', name: 'Careers', title: 'AI Engineering Careers | Quicksort', description: 'Explore careers at Quicksort and help build enterprise AI systems. Discover our open roles, engineering approach and opportunities to join the team.' },
  ...blogPosts.map(post => ({ path: `/blog/${post.slug}`, name: post.title, title: `${post.title} | Quicksort`, description: post.description, type: 'BlogPosting' })),
  { path: '/design-system', name: 'Design system', title: 'Design System | Quicksort', description: 'Quicksort design tokens, typography, components and themes.', noindex: true },
  { path: '/email-signature', name: 'Email signature', title: 'Email Signature Generator | Quicksort', description: 'Create a Quicksort email signature.', noindex: true },
];
export const pages: PageSeo[] = englishPages.flatMap(page => page.noindex ? [page] : locales.map(locale => ({
  ...page, locale, path: localePath(page.path, locale), name: translate(page.name, locale),
  title: `${translate(page.title.replace(/ \| Quicksort$/, ''), locale)} | Quicksort`,
  description: translate(page.description, locale),
})));
export function alternates(page: PageSeo) {
  if (page.noindex) return [];
  return [...locales.map(lang => ({ lang, url: SITE_URL + localePath(page.path, lang) })),
    { lang: 'x-default', url: SITE_URL + localePath(page.path, 'en') }];
}
export function getPageSeo(pathname: string): PageSeo {
  const path = pathname === '/' ? '/' : pathname.replace(/\/+$/, '');
  if (/^\/(fr\/)?career\/[^/]+$/.test(path)) return {path, locale: splitLocale(path).locale, name: 'Career opportunity', title: 'Careers | Quicksort', description: 'Explore this opportunity at Quicksort.'};
  return pages.find(page => page.path === path) ?? { path, locale: splitLocale(path).locale, name: 'Page not found', title: 'Page Not Found | Quicksort', description: 'The requested page could not be found. Explore Quicksort services and insights.', noindex: true };
}
export function structuredData(page: PageSeo) {
  if (page.noindex) return null;
  const url = SITE_URL + page.path;
  const locale = page.locale || 'en';
  const basePath = splitLocale(page.path).path;
  const home = SITE_URL + localePath('/', locale);
  const organization = { '@type': 'Organization', '@id': `${SITE_URL}/#organization`, name: 'Quicksort', url: `${SITE_URL}/`, logo: `${SITE_URL}/quicksort-signature-logo-v2.png`, email: 'hello@quicksort.fr', telephone: '+33 6 30 05 99 01', address: { '@type': 'PostalAddress', streetAddress: '142 Rue Rivoli', postalCode: '75001', addressLocality: 'Paris', addressCountry: 'FR' } };
  const graph: Record<string, unknown>[] = [
    { '@type': 'WebPage', '@id': `${url}#webpage`, url, name: page.title, description: page.description, inLanguage: locale, isPartOf: { '@id': `${SITE_URL}/#website` }, about: { '@id': `${SITE_URL}/#organization` } },
  ];
  if (basePath === '/') graph.push(organization, { '@type': 'WebSite', '@id': `${SITE_URL}/#website`, url: `${SITE_URL}/`, name: 'Quicksort', publisher: { '@id': organization['@id'] }, inLanguage: [...locales] });
  else {
    const crumbs = [{ '@type': 'ListItem', position: 1, name: translate('Home', locale), item: home }];
    if (basePath.startsWith('/blog/')) crumbs.push({ '@type': 'ListItem', position: 2, name: translate('Blog', locale), item: SITE_URL + localePath('/blog', locale) });
    if (basePath.startsWith('/career/')) crumbs.push({ '@type': 'ListItem', position: 2, name: translate('Careers', locale), item: SITE_URL + localePath('/career', locale) });
    crumbs.push({ '@type': 'ListItem', position: crumbs.length + 1, name: page.name, item: url });
    graph.push({ '@type': 'BreadcrumbList', '@id': `${url}#breadcrumbs`, itemListElement: crumbs });
  }
  if (page.type === 'Service') graph.push({ '@type': 'Service', '@id': `${url}#service`, name: page.name, description: page.description, url, provider: { '@id': `${SITE_URL}/#organization` } });
  if (page.type === 'BlogPosting') graph.push({ '@type': 'BlogPosting', '@id': `${url}#article`, headline: page.name, description: page.description, mainEntityOfPage: { '@id': `${url}#webpage` }, publisher: { '@id': `${SITE_URL}/#organization` }, inLanguage: locale });
  // Do not invent a precise publication day, named author, or job posting date.
  return { '@context': 'https://schema.org', '@graph': graph };
}
