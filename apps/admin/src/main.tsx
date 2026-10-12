import React from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/react";
import App from "./App";
import "@quicksort/hr-ui/styles.css";
import "./admin-theme.css";
import "./date-field.css";
const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {publishableKey ? <ClerkProvider publishableKey={publishableKey} afterSignOutUrl="/" appearance={{options:{unsafe_disableDevelopmentModeWarnings:true},variables:{colorPrimary:"#CCFF00",colorPrimaryForeground:"#000710",colorBackground:"#141414",colorForeground:"#FAFAFA",colorMutedForeground:"#8E8E8E",colorInput:"#1E1E1E",colorInputForeground:"#FAFAFA",borderRadius:"0.625rem"}}}><App /></ClerkProvider> : <main className="loading" role="alert">Sign-in is not configured: set <code>VITE_CLERK_PUBLISHABLE_KEY</code> in <code>.env.local</code> (see <code>.env.example</code>) and restart the dev server.</main>}
  </React.StrictMode>,
);
