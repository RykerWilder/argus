import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./styles.css";

import Home from "./pages/Home";
import Result from "./pages/Result";
import Sources from "./pages/Sources";
import History from "./pages/History";
import DomainResult from "./pages/DomainResult";
import EmailAnalyzer from "./pages/EmailAnalyzer";
import NotFound from "./pages/NotFound";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/ip/:ip" element={<Result />} />
        <Route path="/domain/:domain" element={<DomainResult kind="domain" />} />
        <Route path="/url" element={<DomainResult kind="url" />} />
        <Route path="/sources" element={<Sources />} />
        <Route path="/history" element={<History />} />
        <Route path="/tools/email-headers" element={<EmailAnalyzer />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
