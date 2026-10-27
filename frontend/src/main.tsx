import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
// Font self-hosted: i file arrivano con il build, nessuna richiesta a Google.
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles.css";

// La home è nel bundle principale: è la prima pagina che si vede. Le altre
// vengono scaricate solo quando servono (code splitting per route).
import Home from "./pages/Home";
import { pruneApiKeys } from "./lib/settings";

pruneApiKeys();

const loaders = {
  Result: () => import("./pages/Result"),
  DomainResult: () => import("./pages/DomainResult"),
  Sources: () => import("./pages/Sources"),
  History: () => import("./pages/History"),
  EmailAnalyzer: () => import("./pages/EmailAnalyzer"),
  Settings: () => import("./pages/Settings"),
  NotFound: () => import("./pages/NotFound"),
};

const Result = lazy(loaders.Result);
const DomainResult = lazy(loaders.DomainResult);
const Sources = lazy(loaders.Sources);
const History = lazy(loaders.History);
const EmailAnalyzer = lazy(loaders.EmailAnalyzer);
const Settings = lazy(loaders.Settings);
const NotFound = lazy(loaders.NotFound);

// Quando il browser è libero scarica in anticipo le altre pagine (poche decine
// di kB), così il cambio di pagina non aspetta la rete. Con il risparmio dati
// attivo non si scarica nulla in anticipo.
function preloadPages() {
  // `connection` (Network Information API) non è in tutti i browser né nei tipi del DOM
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return;
  const whenIdle: (fn: () => void) => unknown =
    "requestIdleCallback" in window ? (fn) => window.requestIdleCallback(fn) : (fn) => setTimeout(fn, 1500);
  whenIdle(() => Object.values(loaders).forEach((load) => load().catch(() => {})));
}
if (document.readyState === "complete") preloadPages();
else window.addEventListener("load", preloadPages, { once: true });

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing #root element in index.html");

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      {/* Mentre il chunk di una pagina arriva resta lo sfondo, senza lampi */}
      <Suspense fallback={<span className="sr-only" role="status">Loading…</span>}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/ip/:ip" element={<Result />} />
          <Route path="/domain/:domain" element={<DomainResult kind="domain" />} />
          <Route path="/url" element={<DomainResult kind="url" />} />
          <Route path="/sources" element={<Sources />} />
          <Route path="/history" element={<History />} />
          <Route path="/tools/email-headers" element={<EmailAnalyzer />} />
          <Route path="/settings" element={<Navigate to="/settings/preferences" replace />} />
          <Route path="/settings/security" element={<Settings section="security" />} />
          <Route path="/settings/preferences" element={<Settings section="preferences" />} />
          <Route path="/settings/api-keys" element={<Settings section="api-keys" />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </StrictMode>,
);
