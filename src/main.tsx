import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { applySettings, useSettings } from "./stores/settings";
import "./styles/globals.css";

// Re-apply settings at React mount to ensure consistency with the
// localStorage-driven inline pre-paint script in index.html.
applySettings(useSettings.getState());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
