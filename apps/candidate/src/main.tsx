import React from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/react";
import App from "./App";
import "@quicksort/candidate-ui/styles.css";
const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {publishableKey ? <ClerkProvider publishableKey={publishableKey} afterSignOutUrl="/" appearance={{options:{unsafe_disableDevelopmentModeWarnings:true},variables:{colorPrimary:"#ffffff",colorPrimaryForeground:"#000000",colorBackground:"#101010",colorForeground:"#ffffff",colorMutedForeground:"#a3a3a3",colorInput:"#191919",colorInputForeground:"#ffffff",borderRadius:"0.5rem"}}}><App /></ClerkProvider> : <main className="loading" role="alert">Sign-in setup is in progress. Please contact Quicksort.</main>}
  </React.StrictMode>,
);
