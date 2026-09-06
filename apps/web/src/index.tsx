import '@quicksort/ui/brand.css';
import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";

const container = document.getElementById("app") as HTMLElement;
const app = (
  <StrictMode>
    <BrowserRouter><App /></BrowserRouter>
  </StrictMode>
);
if (container.hasChildNodes()) hydrateRoot(container, app);
else createRoot(container).render(app);
