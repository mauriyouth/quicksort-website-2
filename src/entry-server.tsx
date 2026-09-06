import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { App } from './App';
export { pages, alternates, getPageSeo, structuredData, SITE_URL, SOCIAL_IMAGE } from './lib/seo';
export function render(path: string) {
  return renderToString(<StaticRouter location={path}><App /></StaticRouter>);
}
