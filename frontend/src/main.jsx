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

const Result = lazy(() => import("./pages/Result"));
const DomainResult = lazy(() => import("./pages/DomainResult"));
const Sources = lazy(() => import("./pages/Sources"));
const History = lazy(() => import("./pages/History"));
const EmailAnalyzer = lazy(() => import("./pages/EmailAnalyzer"));
const Settings = lazy(() => import("./pages/Settings"));
const NotFound = lazy(() => import("./pages/NotFound"));

createRoot(document.getElementById("root")).render(
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
