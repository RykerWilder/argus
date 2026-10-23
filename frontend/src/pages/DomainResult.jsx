import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import Header, { Bracket, Footer } from "../components/Header";
import ToolsMenu from "../components/ToolsMenu";
import LookupProgress from "../components/LookupProgress";
import ActionBar from "../components/ActionBar";
import PanelTools from "../components/PanelTools";
import { sourceLink } from "../lib/panelLinks";
import { recordSearch } from "../lib/history";
import { panelText } from "../lib/panelText";
import Anatomy from "../components/Anatomy";
import {
  Empty,
  FitHeading,
  QuickSearch,
  Rows,
  Score,
  useLookup,
  usePageTitle,
} from "../components/ResultParts";
import { buildDomainReport } from "../lib/domainReport";
import { sourcesFor } from "../lib/lookup";
import { classify, resultPath } from "../lib/target";
import { formatDate } from "../lib/report";

// Risultati per domini (/domain/:domain) e URL (/url?target=...).
export default function DomainResult({ kind }) {
  const { domain } = useParams();
  const [params] = useSearchParams();
  const raw = kind === "domain" ? decodeURIComponent(domain || "") : params.get("target") || "";

  const target = useMemo(() => {
    const t = classify(raw);
    return t.kind === kind ? t : null;
  }, [raw, kind]);
  const { lookup, progress } = useLookup(target);
  usePageTitle(target ? (target.kind === "url" ? target.host : target.value) : raw);

  const report = useMemo(() => (lookup?.target ? buildDomainReport(lookup) : null), [lookup]);

  useEffect(() => {
    if (report) recordSearch(target, report, lookup);
  }, [report, target, lookup]);
  const current = target ? resultPath(target) : null;

  return (
    <div className="page page--result">
      <Header>
        <QuickSearch current={current} />
        <ToolsMenu className="nav-link--hide-sm" />
        <Link to="/history" className="nav-link nav-link--hide-sm">History</Link>
        <Link to="/sources" className="nav-link nav-link--hide-sm">Sources</Link>
        <Bracket as={Link} to="/">New search</Bracket>
      </Header>

      <main>
        {!target ? (
          <Empty
            title={kind === "domain" ? "That isn’t a domain" : "That isn’t a valid URL"}
            body={`“${raw}” could not be read as a ${kind === "domain" ? "domain name" : "http or https URL"}.`}
          />
        ) : !report ? (
          <div className="result-loading">
            <LookupProgress label={target.value} progress={progress} sources={sourcesFor(target)} />
          </div>
        ) : (
          <Report report={report} target={target} />
        )}
      </main>
      <Footer />
    </div>
  );
}

function domainPanelText(p, report, target) {
  const sections = [];
  if (p.id === "domainwhois") {
    const ips = [...(report.resolves?.ipv4 || []), ...(report.resolves?.ipv6 || [])];
    if (ips.length) sections.push({ title: "Resolves to", lines: ips });
  } else if (p.id === "virustotal") {
    if (report.flagged.length) sections.push({ title: "Engines flagging it", lines: report.flagged.map((f) => `${f.engine}: ${f.result || f.category}`) });
    if (report.redirects.length) sections.push({ title: "Redirect chain", lines: report.redirects.map((u, i) => `${i + 1}. ${u}`) });
    if (report.dnsRecords.length) sections.push({ title: "DNS records", lines: report.dnsRecords.map((r) => `${r.type} ${r.value}`) });
    const c = report.certificate;
    if (c) sections.push({ title: "HTTPS certificate", lines: [c.subject && `Issued to: ${c.subject}`, c.issuer && `Issuer: ${c.issuer}`, c.validFrom && `Valid from: ${c.validFrom}`, c.validTo && `Valid until: ${c.validTo}`].filter(Boolean) });
    if (report.popularity.length) sections.push({ title: "Popularity rank", lines: report.popularity.map((x) => `${x.source}: #${x.rank}`) });
  }
  const notFound = p.id === "virustotal" && report.vtNotFound ? "VirusTotal has no record of this domain yet." : null;
  return panelText({
    source: p.name,
    subject: target.value,
    rows: p.rows,
    sections,
    error: p.status === "error" ? p.error : notFound,
  });
}

function Report({ report, target }) {
  const { verdict } = report;
  return (
    <>
      <section className="result-head">
        <div className="result-head__id">
          <p className="muted">{report.kind === "url" ? "URL" : "Domain"}</p>
          <FitHeading text={report.title} />
          <ActionBar target={target} report={report} />
        </div>

        <div className={`verdict verdict--${verdict.level}`}>
          <p className="verdict__title">
            <span className="verdict__dot" aria-hidden="true" />
            {verdict.title}
          </p>
          <div className="verdict__scores">
            <Score
              label="VirusTotal detections"
              value={report.detectionScore?.value ?? null}
              suffix={report.detectionScore?.suffix}
              percent={report.detectionScore?.percent}
            />
            <Score
              label="VirusTotal reputation"
              value={report.reputation}
              suffix=""
              percent={report.reputation !== null ? Math.min(100, Math.abs(report.reputation)) : 0}
            />
          </div>
          {verdict.reasons.length > 0 && <p className="verdict__reasons">{verdict.reasons.join(", ")}</p>}
          {report.vtQueued && (
            <p className="verdict__reasons">
              VirusTotal had never seen this URL. It has been submitted: search for it again in a minute for the full result.
            </p>
          )}
        </div>
      </section>

      <Anatomy target={target} />

      <section className="highlights" aria-label="Key facts">
        {report.highlights.map((h) => (
          <div
            key={h.key}
            className={`highlight highlight--${h.key} ${h.detected ? "is-alert" : ""} ${h.value ? "" : "is-empty"}`}
          >
            <span className="highlight__label">{h.label}</span>
            <span className="highlight__value">{h.value || "Not available"}</span>
            {h.sub && <span className="highlight__sub">{h.sub}</span>}
          </div>
        ))}
      </section>

      <div className="source-grid">
        {report.panels.map((p) => (
          <section key={p.id} className={`panel source-panel source-panel--${p.id}`}>
            <header className="panel__head">
              <div>
                <h2>{p.name}</h2>
                <p className="muted">{p.covers}</p>
              </div>
              <div className="panel__side">
                <span className={`panel__status mono is-${p.status}`}>
                  <span className="progress__dot" aria-hidden="true" />
                  {p.status === "error" ? "Unavailable" : `${p.ms} ms`}
                </span>
                <PanelTools
                  name={p.name}
                  getText={() => domainPanelText(p, report, target)}
                  link={sourceLink(p.id, target)}
                />
              </div>
            </header>

            {p.status === "error" ? (
              <p className="panel__error">{p.error}</p>
            ) : p.id === "virustotal" && report.vtNotFound ? (
              <p className="panel__empty muted">VirusTotal has no record of this domain yet.</p>
            ) : (
              <>
                {p.rows.length > 0 && <Rows rows={p.rows} />}
                {p.id === "domainwhois" && <Resolves resolves={report.resolves} />}
                {p.id === "virustotal" && <VirusTotalDetails report={report} />}
              </>
            )}
          </section>
        ))}
        {report.hostIsIp && (
          <section className="panel source-panel">
            <header className="panel__head">
              <div>
                <h2>Host</h2>
                <p className="muted">This URL points straight to an IP address, so there is no domain to look up.</p>
              </div>
            </header>
            <Bracket as={Link} to={resultPath({ kind: "ip", value: report.title })}>
              Open the IP report for <span className="mono">{report.title}</span>
            </Bracket>
          </section>
        )}
      </div>

      <footer className="result-foot">
        <p className="muted result-foot__note">
          Values shown in an earlier panel are not repeated.
        </p>
      </footer>
    </>
  );
}

// Indirizzi IP del dominio, ognuno apre il report IP di Argus.
function Resolves({ resolves }) {
  const ips = [...(resolves?.ipv4 || []), ...(resolves?.ipv6 || [])];
  if (!ips.length) return null;
  return (
    <div className="subsection">
      <h3>Resolves to</h3>
      <ul className="ip-links">
        {ips.map((ip) => (
          <li key={ip}>
            <Bracket as={Link} to={resultPath({ kind: "ip", value: ip })}>
              <span className="mono">{ip}</span>
            </Bracket>
          </li>
        ))}
      </ul>
    </div>
  );
}

function VirusTotalDetails({ report }) {
  return (
    <>
      {report.flagged.length > 0 && <Flagged items={report.flagged} />}
      {report.redirects.length > 0 && (
        <div className="subsection">
          <h3>Redirect chain</h3>
          <ol className="redirects mono">
            {report.redirects.map((u, i) => (
              <li key={`${u}-${i}`}>{u}</li>
            ))}
          </ol>
        </div>
      )}
      {report.certificate && (
        <div className="subsection">
          <h3>HTTPS certificate</h3>
          <Rows
            rows={[
              { label: "Issued to", value: report.certificate.subject, mono: true },
              { label: "Issuer", value: report.certificate.issuer },
              { label: "Valid from", value: formatDate(report.certificate.validFrom) },
              { label: "Valid until", value: formatDate(report.certificate.validTo) },
            ].filter((r) => r.value)}
          />
        </div>
      )}
      {report.popularity.length > 0 && (
        <div className="subsection">
          <h3>Popularity rank</h3>
          <Rows rows={report.popularity.map((p) => ({ label: p.source, value: `#${p.rank.toLocaleString("en-US")}`, mono: true }))} />
        </div>
      )}
      {report.dnsRecords.length > 0 && <DnsRecords records={report.dnsRecords} />}
    </>
  );
}

function Flagged({ items }) {
  const [open, setOpen] = useState(false);
  const shown = open ? items : items.slice(0, 8);
  return (
    <div className="subsection">
      <h3>Engines flagging it</h3>
      <ul className="flagged">
        {shown.map((f) => (
          <li key={f.engine} className={`is-${f.category}`}>
            <span>{f.engine}</span>
            <span className="mono">{f.result || f.category}</span>
          </li>
        ))}
      </ul>
      {items.length > 8 && (
        <Bracket type="button" onClick={() => setOpen((o) => !o)}>
          {open ? "Show fewer" : `Show all ${items.length}`}
        </Bracket>
      )}
    </div>
  );
}

// Record DNS nascosti all'inizio: il pulsante espande la scheda e li mostra.
function DnsRecords({ records }) {
  const [open, setOpen] = useState(false);
  const grouped = Object.entries(
    records.reduce((acc, r) => {
      (acc[r.type] ||= []).push(r.value);
      return acc;
    }, {}),
  );
  const types = grouped.map(([t]) => t).join(", ");
  return (
    <div className="subsection disclosure">
      <button
        type="button"
        className="disclosure__toggle"
        aria-expanded={open}
        aria-controls="vt-dns-records"
        onClick={() => setOpen((o) => !o)}
      >
        <span>
          {open ? "Hide DNS records" : "Show DNS records"}
          <span className="muted"> {records.length} ({types})</span>
        </span>
        <ChevronDown size={18} strokeWidth={1.75} aria-hidden="true" className="disclosure__chevron" />
      </button>
      <div id="vt-dns-records" className={`disclosure__body ${open ? "is-open" : ""}`} inert={!open ? "" : undefined}>
        <div className="disclosure__inner">
          <Rows rows={grouped.map(([type, values]) => ({ label: type, value: values.join("\n"), mono: true }))} />
        </div>
      </div>
    </div>
  );
}
