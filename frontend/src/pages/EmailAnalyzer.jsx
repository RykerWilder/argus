import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Braces, ChevronDown, Copy, ExternalLink, FileText, Paperclip, Search, Upload, X } from "lucide-react";
import Header, { Bracket, Footer } from "../components/Header";
import IconButton from "../components/IconButton";
import WorldMap from "../components/WorldMap";
import { postJson } from "../lib/api";
import { copyText } from "../lib/clipboard";
import { download } from "../lib/exporters";
import { classify, resultPath } from "../lib/target";
import { countryName } from "../lib/countries";
import { AUTH_EXPLAIN, explainHeader } from "../lib/emailHeaders";
import { duration, emailFileName, emailSummaryText, emailToJSON, emailToMarkdown } from "../lib/emailExport";
import { isServiceEnabled } from "../lib/settings";

// Email header analyzer (/tools/email-headers).
// L'email (header incollati, .eml o .msg) va al backend solo per l'analisi e
// non viene salvata da nessuna parte: né sul server, né nella cronologia, né
// nello storage del browser. L'ultimo report resta solo in memoria finché la
// scheda è aperta, così tornando indietro da un report IP lo si ritrova.

const MAX_FILE = 25 * 1024 * 1024;
// nginx aspetta il backend fino a 60 secondi
const ANALYZE_TIMEOUT = 65_000;
let lastReport = null;

const TIME_FMT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
});
const fmtTime = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : TIME_FMT.format(d);
};
const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",", 2)[1] || "");
    r.onerror = () => reject(new Error("The file could not be read."));
    r.readAsDataURL(file);
  });
}

function pathFor(value) {
  const t = classify(value);
  return t.kind === "invalid" ? null : resultPath(t);
}

export default function EmailAnalyzer() {
  const [report, setReport] = useState(lastReport);
  const [text, setText] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef(null);
  const dragDepth = useRef(0);

  useEffect(() => {
    document.title = "Email header analyzer · Argus";
    return () => {
      document.title = "Argus";
    };
  }, []);

  function pickFile(f) {
    if (!f) return;
    if (f.size > MAX_FILE) {
      setError("The file is larger than 25 MB.");
      return;
    }
    setError(null);
    setFile(f);
  }

  async function analyze() {
    if (busy) return;
    if (!file && !text.trim()) {
      setError("Paste the email headers or choose an .eml or .msg file.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const input = file ? { filename: file.name, content: await readAsBase64(file) } : { text };
      // le posizioni dei server vengono da ip-api.com: se è disattivato non si interroga
      const body = { ...input, geolocate: isServiceEnabled("iptracker") };
      const data = await postJson("/api/email/analyze", body, { timeout: ANALYZE_TIMEOUT });
      lastReport = data;
      setReport(data);
      setText("");
      setFile(null);
      window.scrollTo({ top: 0 });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    lastReport = null;
    setReport(null);
    setError(null);
  }

  const dropHandlers = {
    onDragEnter: (e) => {
      e.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    },
    onDragOver: (e) => e.preventDefault(),
    onDragLeave: () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDragging(false);
    },
    onDrop: (e) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const f = e.dataTransfer.files?.[0];
      if (f) pickFile(f);
      else {
        const dropped = e.dataTransfer.getData("text");
        if (dropped) setText(dropped);
      }
    },
  };

  return (
    <div className="page page--tool">
      <Header
        actions={report && <Bracket type="button" onClick={reset}>New analysis</Bracket>}
      />

      <main>
        {report ? (
          <Report report={report} />
        ) : (
          <section className="mail-tool" aria-labelledby="mail-title">
            <h1 id="mail-title" className="mail-tool__title">Email header analyzer</h1>
            <p className="muted mail-tool__lead">
              Paste the headers, or drop an <span className="mono">.eml</span> or <span className="mono">.msg</span> file.
              Nothing is stored: the message is analyzed and then discarded.
            </p>

            <div className={`mail-input ${dragging ? "is-dragging" : ""} ${error ? "has-error" : ""}`} {...dropHandlers}>
              {file ? (
                <div className="mail-input__file">
                  <Paperclip size={20} strokeWidth={1.75} aria-hidden="true" />
                  <span className="mono">{file.name}</span>
                  <span className="muted mono">{fmtSize(file.size)}</span>
                  <button type="button" className="mail-input__remove" onClick={() => setFile(null)} aria-label="Remove file" title="Remove file">
                    <X size={16} strokeWidth={1.75} aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <>
                  <label htmlFor="mail-text" className="sr-only">Email headers</label>
                  <textarea
                    id="mail-text"
                    value={text}
                    onChange={(e) => {
                      setText(e.target.value);
                      if (error) setError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) analyze();
                    }}
                    placeholder="Paste the email headers here…"
                    spellCheck="false"
                    autoComplete="off"
                    className="mono"
                    disabled={busy}
                  />
                </>
              )}
              {dragging && (
                <div className="mail-input__drop" aria-hidden="true">
                  <Upload size={28} strokeWidth={1.5} />
                  Drop the .eml or .msg file
                </div>
              )}
              <div className="mail-input__bar">
                <input
                  ref={fileInput}
                  type="file"
                  accept=".eml,.msg,.txt,message/rfc822,application/vnd.ms-outlook"
                  hidden
                  onChange={(e) => {
                    pickFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                <button type="button" className="btn btn--ghost btn--compact" onClick={() => fileInput.current?.click()} disabled={busy}>
                  <Upload size={16} strokeWidth={1.75} aria-hidden="true" />
                  Choose .eml or .msg
                </button>
                <span className="mail-input__or muted">or drag it here</span>
                <button type="button" className="btn btn--solid btn--compact" onClick={analyze} disabled={busy}>
                  {busy ? "Analyzing…" : "Analyze"}
                  {!busy && <span className="btn__square" aria-hidden="true" />}
                </button>
              </div>
            </div>
            {error && (
              <p className="search__error" role="alert">
                {error}
              </p>
            )}

            <details className="mail-help">
              <summary>
                Where to find the headers <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
              </summary>
              <dl>
                <div>
                  <dt>Gmail</dt>
                  <dd>Open the message, ⋮ → <em>Show original</em>, then <em>Copy to clipboard</em> or <em>Download original</em> (.eml).</dd>
                </div>
                <div>
                  <dt>Outlook (new / web)</dt>
                  <dd>Open the message, … → <em>View</em> → <em>View message source</em>. Or drag the message to your desktop to get an .msg / .eml file.</dd>
                </div>
                <div>
                  <dt>Outlook (classic, Windows)</dt>
                  <dd><em>File</em> → <em>Properties</em> → <em>Internet headers</em>, or drag the message out of Outlook to save it as .msg.</dd>
                </div>
                <div>
                  <dt>Apple Mail</dt>
                  <dd><em>View</em> → <em>Message</em> → <em>All Headers</em>, or <em>File</em> → <em>Save As</em> → Raw Message Source.</dd>
                </div>
                <div>
                  <dt>Thunderbird</dt>
                  <dd><em>View</em> → <em>Message Source</em> (Ctrl+U), or <em>File</em> → <em>Save As</em> → .eml.</dd>
                </div>
              </dl>
            </details>
          </section>
        )}
      </main>
      <Footer />
    </div>
  );
}

// ── Report ─────────────────────────────────────────────────

function Report({ report }) {
  const s = report.summary;
  const v = report.verdict;
  const origin = report.origin;
  const originGeo = origin ? report.geo?.[origin.ip] : null;
  const replyDiffers = report.findings.some((f) => f.title.startsWith("Reply-To"));
  const fromName = s.from?.name && s.from.name !== s.from.address ? s.from.name : null;

  const highlights = [
    { key: "from", label: "Sender", value: s.from?.address || s.from?.name, sub: fromName },
    {
      key: "reply",
      label: "Reply-To",
      value: s.replyTo.length ? s.replyTo.map((r) => r.address).join(", ") : s.from ? "Same as sender" : null,
      sub: s.returnPath?.address ? `Return-Path ${s.returnPath.address}` : null,
      alert: replyDiffers,
    },
    {
      key: "origin",
      label: "Origin IP",
      value: origin?.ip,
      to: origin?.ip ? pathFor(origin.ip) : null,
      sub: originGeo ? [originGeo.city, countryName(originGeo.countryCode) || originGeo.country].filter(Boolean).join(", ") + (originGeo.isp ? ` · ${originGeo.isp}` : "") : origin?.source !== "Received" ? origin?.source : null,
    },
    {
      key: "route",
      label: "Delivery",
      value: report.hops.length ? `${report.hops.length} hop${report.hops.length === 1 ? "" : "s"}${report.transitSeconds !== null ? ` · ${duration(report.transitSeconds)}` : ""}` : null,
      sub: fmtTime(s.dateIso) || s.date,
    },
  ];

  return (
    <>
      <section className="result-head">
        <div className="result-head__id">
          <p className="muted">
            Email · {report.source === "msg" ? "Outlook .msg" : report.source === "eml" ? "full message (.eml)" : "pasted headers"}
          </p>
          <h1 className="mail-subject">{s.subject || "(no subject)"}</h1>
          <p className="mail-from muted">
            {s.from ? (
              <>
                from <span className="mono">{s.from.name ? `${s.from.name} <${s.from.address || ""}>` : s.from.address}</span>
              </>
            ) : (
              "No From header"
            )}
          </p>
          <EmailActions report={report} />
        </div>

        <div className={`verdict verdict--${v.level}`}>
          <p className="verdict__title">
            <span className="verdict__dot" aria-hidden="true" />
            {v.title}
          </p>
          <p className="verdict__basis muted">Based on the checks recorded in the headers by the receiving servers.</p>
          {v.reasons.length > 0 && <p className="verdict__reasons">{v.reasons.join(", ")}</p>}
        </div>
      </section>

      {report.notes.map((n) => (
        <p key={n} className="panel__warning mail-note">{n}</p>
      ))}

      <section className="highlights" aria-label="Key facts">
        {highlights.map((h) => (
          <div key={h.key} className={`highlight ${h.alert ? "is-alert" : ""} ${h.value ? "" : "is-empty"}`}>
            <span className="highlight__label">{h.label}</span>
            {h.to ? (
              <Link to={h.to} className="highlight__value highlight__link" title={`Open the Argus report for ${h.value}`}>
                {h.value}
              </Link>
            ) : (
              <span className="highlight__value">{h.value || "Not available"}</span>
            )}
            {h.sub && <span className="highlight__sub">{h.sub}</span>}
          </div>
        ))}
      </section>

      <div className="source-grid mail-grid">
        <Authentication auth={report.authentication} spam={report.spam} />
        <Route report={report} />
        {report.attachments.length > 0 && <Attachments attachments={report.attachments} />}
        <AllHeaders headers={report.headers} />
      </div>

      <footer className="result-foot">
        <p className="muted result-foot__note">
          Authentication results are the ones written by the receiving servers, not checked again. Server locations come
          from ip-api.com. The message was not stored.
        </p>
      </footer>
    </>
  );
}

function EmailActions({ report }) {
  const [done, setDone] = useState(null);
  const [status, setStatus] = useState("");
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const flash = (msg, which) => {
    setStatus(msg);
    setDone(which);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setStatus("");
      setDone(null);
    }, 1800);
  };
  return (
    <div className="actions">
      <IconButton
        label="Copy summary"
        icon={Copy}
        done={done === "copy"}
        onClick={async () => flash((await copyText(emailSummaryText(report))) ? "Summary copied" : "Copy failed", "copy")}
      />
      <IconButton
        label="Export Markdown"
        icon={FileText}
        onClick={() => {
          download(emailToMarkdown(report), emailFileName(report, "md"), "text/markdown;charset=utf-8");
          flash("Exported Markdown");
        }}
      />
      <IconButton
        label="Export JSON"
        icon={Braces}
        onClick={() => {
          download(emailToJSON(report), emailFileName(report, "json"), "application/json");
          flash("Exported JSON");
        }}
      />
      <span className="actions__status mono" role="status" aria-live="polite">
        {status}
      </span>
    </div>
  );
}

const RESULT_CLASS = (r) =>
  r === "pass" ? "is-pass" : ["fail", "hardfail"].includes(r) ? "is-fail" : r ? "is-weak" : "is-none";

function Authentication({ auth, spam }) {
  const rows = [
    {
      key: "spf",
      name: "SPF",
      m: auth.spf,
      detail: auth.spf && [auth.spf.props?.["smtp.mailfrom"] && `envelope ${auth.spf.props["smtp.mailfrom"]}`, auth.spf.props?.["client-ip"] && `IP ${auth.spf.props["client-ip"]}`].filter(Boolean).join(" · "),
    },
    {
      key: "dkim",
      name: "DKIM",
      m: auth.dkim,
      detail: auth.dkim
        ? [auth.dkim.props?.["header.d"] || auth.dkim.props?.["header.i"], auth.dkim.props?.["header.s"] && `selector ${auth.dkim.props["header.s"]}`].filter(Boolean).join(" · ")
        : auth.signatures.length
          ? `signed by ${auth.signatures.map((x) => x.domain).join(", ")} (result not recorded)`
          : null,
    },
    {
      key: "dmarc",
      name: "DMARC",
      m: auth.dmarc,
      detail: auth.dmarc && [auth.dmarc.props?.["header.from"], auth.dmarc.policy?.p && `policy ${auth.dmarc.policy.p}`, auth.dmarc.props?.action && `action ${auth.dmarc.props.action}`].filter(Boolean).join(" · "),
    },
    { key: "arc", name: "ARC", m: auth.arc, detail: auth.arc?.server ? `sealed by ${auth.arc.server}` : null },
    { key: "compauth", name: "Microsoft compauth", m: auth.compauth, detail: auth.compauth?.props?.reason ? `reason ${auth.compauth.props.reason}` : null },
  ].filter((r) => r.m || r.key !== "compauth");
  const servers = [...new Set(auth.results.map((r) => r.server).filter(Boolean))];

  return (
    <section className="panel mail-auth">
      <header className="panel__head">
        <div>
          <h2>Authentication</h2>
          <p className="muted">{servers.length ? `As recorded by ${servers.join(", ")}` : "As recorded in the headers"}</p>
        </div>
      </header>
      <ul className="auth-list">
        {rows.map((r) => (
          <li key={r.key} className="auth-row">
            <span className="auth-row__name" title={AUTH_EXPLAIN[r.key]}>
              {r.name}
            </span>
            <span className={`auth-badge mono ${RESULT_CLASS(r.m?.result)}`}>{r.m?.result || "not found"}</span>
            <span className="auth-row__detail">
              {r.detail && <span className="mono">{r.detail}</span>}
              {r.m?.comment && <span className="muted">{r.m.comment}</span>}
              {!r.m && !r.detail && <span className="muted">{AUTH_EXPLAIN[r.key]}</span>}
            </span>
          </li>
        ))}
      </ul>
      {spam.length > 0 && (
        <div className="subsection">
          <h3>Spam filters</h3>
          <ul className="auth-list">
            {spam.map((x) => (
              <li key={x.engine} className="auth-row">
                <span className="auth-row__name">{x.engine}</span>
                <span className={`auth-badge mono ${x.spam ? "is-fail" : "is-pass"}`}>{x.spam ? "spam" : "not spam"}</span>
                <span className="auth-row__detail">
                  <span className="mono">{x.value}</span>
                  {x.detail && <span className="muted">{x.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Route({ report }) {
  const { hops, geo } = report;
  const stops = useMemo(() => {
    const out = [];
    for (const h of hops) {
      const ip = h.from?.ip;
      const g = ip ? geo?.[ip] : null;
      if (!g || !Number.isFinite(g.lat)) continue;
      const prev = out[out.length - 1];
      if (prev && Math.abs(prev.lat - g.lat) < 0.01 && Math.abs(prev.lon - g.lon) < 0.01) {
        prev.hops.push(h.index);
        prev.label = `${prev.hops[0]}–${h.index}`;
        prev.title = `Hops ${prev.hops.join(", ")}: ${[g.city, g.country].filter(Boolean).join(", ")}`;
        continue;
      }
      out.push({
        lat: g.lat,
        lon: g.lon,
        countryCode: g.countryCode,
        hops: [h.index],
        label: String(h.index),
        title: `Hop ${h.index}: ${ip} · ${[g.city, g.country].filter(Boolean).join(", ")}`,
      });
    }
    return out;
  }, [hops, geo]);

  const places = stops.map((st) => {
    const g = geo?.[hops.find((h) => h.index === st.hops[0])?.from?.ip] || {};
    return { label: st.label, place: [g.city, g.countryCode].filter(Boolean).join(", ") || "unknown" };
  });

  return (
    <section className="panel mail-route">
      <header className="panel__head">
        <div>
          <h2>Route</h2>
          <p className="muted">Where the servers that handled the message are, in order</p>
        </div>
        {report.transitSeconds !== null && <span className="panel__status mono">Total {duration(report.transitSeconds)}</span>}
      </header>
      {stops.length > 0 ? (
        <>
          <div className="result-map mail-route__map">
            <WorldMap interactive route={stops} label={`Map of the ${stops.length} locations on the route`} />
          </div>
          <ol className="route-legend mono">
            {places.map((p) => (
              <li key={p.label}>
                <span className="route-legend__n">{p.label}</span>
                {p.place}
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p className="panel__empty muted">
          {hops.length === 0 ? "There are no Received headers, so the route is unknown." : "No public server on the route could be located."}
        </p>
      )}
    </section>
  );
}

function Attachments({ attachments }) {
  return (
    <section className="panel panel--span mail-attachments">
      <header className="panel__head">
        <div>
          <h2>Attachments</h2>
          <p className="muted">Hashes computed on the server; the files were not stored or opened</p>
        </div>
      </header>
      <ul className="att-list">
        {attachments.map((a) => (
          <li key={a.sha256 + a.filename} className="att">
            <div className="att__name">
              <Paperclip size={16} strokeWidth={1.75} aria-hidden="true" />
              <span>{a.filename}</span>
              <span className="muted mono">
                {a.contentType ? `${a.contentType} · ` : ""}
                {fmtSize(a.size)}
              </span>
            </div>
            <dl className="att__hashes">
              {[["SHA-256", a.sha256], ["SHA-1", a.sha1], ["MD5", a.md5]].map(([k, h]) => (
                <div key={k}>
                  <dt className="mono">{k}</dt>
                  <dd className="mono">{h}</dd>
                </div>
              ))}
            </dl>
            <div className="att__tools">
              <HashCopy value={a.sha256} />
              <IconButton
                label="Look up on VirusTotal"
                icon={ExternalLink}
                href={`https://www.virustotal.com/gui/file/${a.sha256}`}
                className="icon-btn--sm"
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function HashCopy({ value }) {
  const [done, setDone] = useState(false);
  return (
    <IconButton
      label="Copy SHA-256"
      icon={Copy}
      done={done}
      className="icon-btn--sm"
      onClick={async () => {
        if (await copyText(value)) {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }
      }}
    />
  );
}

function AllHeaders({ headers }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? headers.filter((h) => h.name.toLowerCase().includes(needle) || h.value.toLowerCase().includes(needle)) : headers;
  }, [headers, q]);
  return (
    <section className="panel panel--span mail-headers">
      <header className="panel__head">
        <div>
          <h2>All headers</h2>
          <p className="muted">{headers.length} headers, in the order they appear in the message</p>
        </div>
        <button type="button" className="mail-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "Hide" : "Show"}
          <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </header>
      {open && (
        <>
          <label className="mail-headers__search">
            <Search size={16} strokeWidth={1.75} aria-hidden="true" />
            <span className="sr-only">Filter headers</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter headers" spellCheck="false" />
          </label>
          <dl className="header-table">
            {shown.map((h, i) => {
              const help = explainHeader(h.name);
              return (
                <div key={i} className="header-table__row">
                  <dt className="mono" title={help || undefined}>
                    {h.name}
                    {help && <span className="header-table__help">{help}</span>}
                  </dt>
                  <dd className="mono">{h.value}</dd>
                </div>
              );
            })}
          </dl>
          {shown.length === 0 && <p className="panel__empty muted">No header matches “{q}”.</p>}
        </>
      )}
    </section>
  );
}
