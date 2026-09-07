import { ThemeProvider } from './lib/theme';
import { LocaleProvider, LocaleLink as Link, useLocale } from './lib/i18n';
import { splitLocale } from './lib/locales';
import { Routes, Route, useLocation } from "react-router-dom";
import { Seo } from "./components/Seo";
import { ScrollToTop } from "./components/ScrollToTop";
import { Desktop } from "./screens/Desktop";
import { AiForBusiness } from "./screens/AiForBusiness";
import { Blog } from "./screens/Blog";
import { BlogPostDetail } from "./screens/BlogPostDetail";
import { DataForAi } from "./screens/DataForAi";
import { Carreer } from "./screens/Carreer";
import { JobDetail } from "./screens/JobDetail";
import { InfrastructureFor } from "./screens/InfrastructureFor";
import { VoiceAi } from "./screens/VoiceAi";
import { EmailSignature } from "./screens/EmailSignature";

export const App = () => <ThemeProvider><LocaleProvider><AppContent /></LocaleProvider></ThemeProvider>;
const AppContent = () => {
  const location = useLocation();
  const { t, locale } = useLocale();
  const path = splitLocale(location.pathname).path;
  return (
    <>
      <Seo />
      <ScrollToTop />
      <Routes key={locale} location={{ ...location, pathname: path }}>
        <Route path="/" element={<Desktop />} />
        <Route path="/ai-for-business" element={<AiForBusiness />} />
        <Route path="/blog" element={<Blog />} />
        <Route path="/blog/:slug" element={<BlogPostDetail />} />
        <Route path="/data-for-ai" element={<DataForAi />} />
        <Route path="/career" element={<Carreer />} />
        <Route path="/career/:slug" element={<JobDetail />} />
        <Route path="/infrastructure-for-ai" element={<InfrastructureFor />} />
        <Route path="/voice-ai" element={<VoiceAi />} />
        <Route path="/email-signature" element={<EmailSignature />} />
        <Route path="*" element={<main className="min-h-screen bg-surface text-ink px-8 py-24"><h1 className="text-4xl mb-6">{t("Page not found")}</h1><p className="mb-6">{t("The page you requested could not be found.")}</p><Link className="underline" to="/">{t("Back to Quicksort")}</Link></main>} />
      </Routes>
    </>
  );
};
