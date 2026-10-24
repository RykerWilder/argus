import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Trash2 } from "lucide-react";
import Header, { Bracket, Footer } from "../components/Header";
import IconButton from "../components/IconButton";
import { HISTORY_EVENT, clearHistory, deleteHistoryEntry, fetchHistory } from "../lib/history";
import { classify, resultPath } from "../lib/target";
import { defang } from "../lib/defang";

// Ultime ricerche (IP, domini e URL) salvate in questo browser.

const KINDS = [
  { id: null, label: "All" },
  { id: "ip", label: "IP" },
  { id: "domain", label: "Domains" },
  { id: "url", label: "URLs" },
];
const KIND_LABEL = { ip: "IP", domain: "Domain", url: "URL" };

const DATE_FMT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
});

function ago(iso) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

function pathOf(entry) {
  const t = classify(entry.value);
  return t.kind === "invalid" ? null : resultPath(t);
}

export default function History() {
  const [kind, setKind] = useState(null);
  const [data, setData] = useState(null); // { entries, counts }
  const [error, setError] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const load = useCallback(() => {
    setError(null);
    fetchHistory(kind)
      .then(setData)
      .catch((e) => setError(e.message || "The history could not be loaded."));
  }, [kind]);

  useEffect(() => {
    load();
    // aggiornamento se la cronologia cambia in questa o in un'altra scheda
    const onChange = () => load();
    const onStorage = (e) => {
      if (!e.key || e.key.startsWith("argus:history")) load();
    };
    window.addEventListener(HISTORY_EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(HISTORY_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [load]);

  useEffect(() => {
    document.title = "History · Argus";
    return () => {
      document.title = "Argus";
    };
  }, []);

  const total = useMemo(() => Object.values(data?.counts || {}).reduce((a, b) => a + b, 0), [data]);

  async function remove(id) {
    setData((d) => d && { ...d, entries: d.entries.filter((e) => e.id !== id) });
    try {
      await deleteHistoryEntry(id);
    } finally {
      load();
    }
  }

  async function clearAll() {
    if (!confirmClear) {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 4000);
      return;
    }
    setConfirmClear(false);
    await clearHistory().catch(() => {});
    load();
  }

  return (
    <div className="page page--history">
      <Header />

      <main className="history">
        <div className="history__head">
          <div>
            <h1>History</h1>
            <p className="muted">Your latest IP, domain and URL searches, saved in this browser only.</p>
          </div>
          {total > 0 && (
            <Bracket type="button" onClick={clearAll} className={confirmClear ? "is-danger" : ""}>
              {confirmClear ? "Click again to clear everything" : "Clear history"}
            </Bracket>
          )}
        </div>

        <div className="history__filters" role="group" aria-label="Filter by type">
          {KINDS.map((k) => {
            const n = k.id ? data?.counts?.[k.id] || 0 : total;
            return (
              <button
                key={k.label}
                type="button"
                className={`chip ${kind === k.id ? "is-active" : ""}`}
                aria-pressed={kind === k.id}
                onClick={() => setKind(k.id)}
              >
                {k.label}
                <span className="mono">{n}</span>
              </button>
            );
          })}
        </div>

        {error ? (
          <p className="panel__error">{error}</p>
        ) : !data ? (
          <p className="muted">Loading…</p>
        ) : data.entries.length === 0 ? (
          <div className="history__empty">
            <p>{kind ? `No ${KIND_LABEL[kind].toLowerCase()} searches yet.` : "No searches yet."}</p>
            <Bracket as={Link} to="/">Search an IP, domain or URL</Bracket>
          </div>
        ) : (
          <ol className="history__list">
            {data.entries.map((e) => {
              const path = pathOf(e);
              return (
                <li key={e.id} className={`history__item is-${e.verdictLevel || "unknown"}`}>
                  <span className="history__kind mono">{KIND_LABEL[e.kind]}</span>
                  <div className="history__main">
                    {path ? (
                      <Link to={path} className="history__value mono" title={`Open the report for ${defang({ kind: e.kind, value: e.value })}`}>
                        {e.value}
                      </Link>
                    ) : (
                      <span className="history__value mono">{e.value}</span>
                    )}
                    {e.summary && <span className="history__summary muted">{e.summary}</span>}
                  </div>
                  <span className="history__verdict">
                    <span className="history__dot" aria-hidden="true" />
                    {e.verdictTitle || "Not assessed"}
                  </span>
                  <span className="history__when" title={DATE_FMT.format(new Date(e.lastSearchedAt))}>
                    {ago(e.lastSearchedAt)}
                    {e.times > 1 && <span className="muted mono"> · {e.times}×</span>}
                  </span>
                  <IconButton label="Remove from history" icon={Trash2} onClick={() => remove(e.id)} className="icon-btn--sm history__remove" />
                </li>
              );
            })}
          </ol>
        )}
      </main>
      <Footer />
    </div>
  );
}
