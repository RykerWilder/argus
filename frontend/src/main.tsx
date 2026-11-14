import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
// Self-hosted fonts: the files come with the build, no request to Google.
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles/index.css";

// The home page is in the main bundle: it is the first page seen. The others are
// downloaded only when needed (code splitting per route).
import Home from "./pages/Home";
import { migrateLegacyKeys } from "./lib/user/account";
import { loadPreferences } from "./lib/user/settings";

// API keys that earlier versions kept in the browser move to the server (once only)
migrateLegacyKeys().catch(() => undefined);

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

// When the browser is idle it downloads the other pages ahead of time (a few tens of kB),
// so changing page does not wait for the network. With data saver on, nothing is
// downloaded ahead.
function preloadPages() {
  // `connection` (Network Information API) is not in all browsers nor in the DOM types
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

// Search preferences live on the server: they are loaded before rendering, so the first
// search already respects them. If they do not arrive (error, delay) it starts with the
// defaults: everything on.
async function start(root: HTMLElement) {
  await loadPreferences().catch(() => undefined);
  createRoot(root).render(
    <StrictMode>
      <BrowserRouter>
        {/* While a page's chunk arrives the background stays, without flashes */}
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
}

void start(rootElement);
