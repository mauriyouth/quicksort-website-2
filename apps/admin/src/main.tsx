import React from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/react";
import App from "./App";
import { installSaveShortcut } from "./save-shortcut";
import "./index.css";
import "@quicksort/hr-ui/styles.css";
import "./admin-theme.css";
installSaveShortcut();
// @quicksort-sas/ui switches palettes on the `dark` class; the admin (and the
// shared ThemeToggle) switch on data-theme. Keep the class in step with it.
const root = document.documentElement;
const syncDarkClass = () => root.classList.toggle("dark", root.getAttribute("data-theme") === "dark");
syncDarkClass();
new MutationObserver(syncDarkClass).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {publishableKey ? <ClerkProvider publishableKey={publishableKey} afterSignOutUrl="/" appearance={{options:{unsafe_disableDevelopmentModeWarnings:true},variables:{colorPrimary:"#CCFF00",colorPrimaryForeground:"#141414",colorBackground:"#1D1D1B",colorForeground:"#ECE8DF",colorMutedForeground:"#B5B0A7",colorInput:"#141413",colorInputForeground:"#ECE8DF",borderRadius:"0.125rem",fontFamily:"\"Host Grotesk Variable\", \"Host Grotesk\", system-ui, sans-serif"}}}><App /></ClerkProvider> : <main className="loading" role="alert">Sign-in is not configured: set <code>VITE_CLERK_PUBLISHABLE_KEY</code> in <code>.env.local</code> (see <code>.env.example</code>) and restart the dev server.</main>}
  </React.StrictMode>,
);
