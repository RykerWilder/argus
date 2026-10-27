import { useEffect, useMemo, useState } from "react";
import { ChartSpline, List } from "lucide-react";
import IconButton from "../components/IconButton";
import { Link, useParams } from "react-router-dom";
import type { IpReport, IpReportPanel, IpTarget, ProxyOperator, ShodanService, ShodanVulnDetail, SourceId } from "../types";
import Header, { Bracket, Footer } from "../components/Header";
import LookupProgress from "../components/LookupProgress";
import WorldMap from "../components/WorldMap";
import ReportTimeline from "../components/ReportTimeline";
import ActionBar from "../components/ActionBar";
import PanelTools from "../components/PanelTools";
import { sourceLink } from "../lib/panelLinks";
import { recordSearch } from "../lib/history";
import { panelText, textLines } from "../lib/panelText";
import type { PanelTextSection } from "../lib/panelText";
import { isValidIp, normalizeIp } from "../lib/ip";
import {
  Empty,
  FitHeading,
  QuickSearch,
  Rows,
  Score,
  presentRows,
  useLookup,
  usePageTitle,
} from "../components/ResultParts";
import { buildReport } from "../lib/report";
import { sourcesFor } from "../lib/lookup";

export default function Result() {
  const { ip: rawIp } = useParams();
  const ip = normalizeIp(decodeURIComponent(rawIp || ""));
  const valid = isValidIp(ip);
  const target = useMemo<IpTarget | null>(() => (valid ? { kind: "ip", value: ip } : null), [ip, valid]);
  // se l'utente ha disattivato tutte le fonti per gli IP non c'è nulla da cercare
  const sources = target ? sourcesFor(target) : [];
  const noSources = !!target && sources.length === 0;
  const { lookup, progress } = useLookup(noSources ? null : target);
  usePageTitle(ip);

  const report = useMemo(() => (lookup ? buildReport(lookup) : null), [lookup]);

  useEffect(() => {
    if (report && !report.allPrivate) recordSearch(target, report, lookup);
  }, [report, target, lookup]);

  return (
    <div className="page page--result">
      <Header>
        <QuickSearch current={`/ip/${encodeURIComponent(ip)}`} />
      </Header>

      <main>
        {!valid ? (
          <Empty title="That isn’t an IP address" body={`“${ip}” is not a valid IPv4 or IPv6 address.`} />
        ) : noSources ? (
          <Empty
            title="All sources are turned off"
            body="Every source used for IP addresses is turned off, so there is nothing to look up."
          >
            <Bracket as={Link} to="/settings/preferences">Open preferences</Bracket>
          </Empty>
        ) : !report ? (
          <div className="result-loading">
            <LookupProgress ip={ip} progress={progress} sources={sources} />
          </div>
        ) : report.allPrivate ? (
          <Empty
            title="Nothing to report"
            body={`${ip} is a private or reserved address, so none of the public sources hold data on it.`}
          />
        ) : (
          <Report report={report} />
        )}
      </main>
      <Footer />
    </div>
  );
}

function Report({ report }: { report: IpReport }) {
  const { location, verdict } = report;
  const placeLabel = [location.city, location.region].filter((v, i, a) => v && a.indexOf(v) === i).join(", ");

  // Il riquadro più lungo tra ip-api.com e ProxyCheck.io va a destra; l'altro
  // sotto la mappa, che si allunga per pareggiare le due colonne.
  const weight = (id: SourceId) => {
    const p = report.panels.find((x) => x.id === id);
    if (!p || p.status === "error") return 2;
    return p.rows.length + (p.operator ? 8 : 0) + (p.warning ? 2 : 0);
  };
  const tallRight = weight("proxycheck") > weight("iptracker") ? "proxycheck" : "iptracker";

  return (
    <>
      <section className="result-head">
        <div className="result-head__id">
          <p className="muted">IPv{report.version} address</p>
          <FitHeading text={report.ip} className="mono" />
          <ActionBar target={{ kind: "ip", value: report.ip }} report={report} />
        </div>

        <div className={`verdict verdict--${verdict.level}`}>
          <p className="verdict__title">
            <span className="verdict__dot" aria-hidden="true" />
            {verdict.title}
          </p>
          <div className="verdict__scores">
            {report.sources.abuseipdb && <Score label="AbuseIPDB confidence" value={report.abuseScore} suffix="%" />}
            {report.sources.proxycheck && <Score label="ProxyCheck.io risk" value={report.risk} suffix="/100" />}
          </div>
          {verdict.reasons.length > 0 && <p className="verdict__reasons">{verdict.reasons.join(", ")}</p>}
        </div>
      </section>

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

      <div className={`source-grid source-grid--ip ${tallRight === "proxycheck" ? "source-grid--pc-right" : ""}`}>
        <section className="result-map" aria-label="Map">
          <WorldMap
            interactive
            countryCode={location.countryCode}
            lat={location.lat}
            lon={location.lon}
            placeLabel={placeLabel}
            label={location.country ? `World map highlighting ${location.country}` : "World map"}
          />
        </section>
        {report.panels.map((p) => (
          <SourcePanel key={p.id} panel={p} ip={report.ip} />
        ))}
      </div>

      <footer className="result-foot">
        <p className="muted result-foot__note">
          Values shown in an earlier panel are not repeated. When a source disagrees, its value is marked.
        </p>
      </footer>
    </>
  );
}

function textOf(panel: IpReportPanel, ip: string): string {
  const sections: PanelTextSection[] = [];
  const op = panel.operator;
  if (op) {
    sections.push({
      title: "Anonymizing service",
      lines: textLines([
        op.name && `Operator: ${op.name}`,
        op.anonymity && `Anonymity: ${op.anonymity}`,
        op.popularity && `Popularity: ${op.popularity}`,
        op.services?.length && `Services: ${op.services.join(", ")}`,
        op.protocols?.length && `Protocols: ${op.protocols.join(", ")}`,
      ]),
    });
  }
  if (panel.vulns?.length) {
    sections.push({
      title: "Potential vulnerabilities",
      lines: panel.vulns.map((v) =>
        [v.id, v.cvss !== null && `CVSS ${v.cvss.toFixed(1)}`, v.verified && "verified", v.ports.length > 0 && `port ${v.ports.join(", ")}`]
          .filter(Boolean)
          .join(" ") + (v.summary ? ` — ${v.summary}` : "") + (v.extra ? ` (${v.extra})` : ""),
      ),
    });
  }
  for (const s of panel.services ?? []) {
    sections.push({
      title: `Service ${serviceTitle(s)}`,
      lines: textLines([
        ...s.sections.flatMap((sec) => sec.rows.map((r) => `${sec.title} · ${r.label}: ${r.value.replace(/\n/g, ", ")}`)),
        s.vulns.length > 0 && `Potential vulnerabilities: ${s.vulns.join(", ")}`,
        ...(s.banner ? ["Banner:", ...s.banner.split(/\r?\n/).map((l) => `  ${l}`)] : []),
      ]),
    });
  }
  if (panel.categories?.length) {
    sections.push({ title: "Reported for", lines: panel.categories.map((c) => `${c.name}: ${c.count}`) });
  }
  if (panel.reports?.length) {
    sections.push({
      title: `Most recent reports (${Math.min(10, panel.reports.length)} of ${panel.reportsReceived || panel.reports.length})`,
      lines: panel.reports.slice(0, 10).map(
        (r) =>
          `${r.reportedAt} ${r.reporterId ? `#${r.reporterId}` : "anonymous"}${r.reporterCountry ? ` (${r.reporterCountry})` : ""}: ${(r.categories || []).join(", ")}${r.comment ? ` — ${r.comment.replace(/\s+/g, " ")}` : ""}`,
      ),
    });
  }
  return panelText({ source: panel.name, subject: ip, rows: panel.rows, sections, error: panel.status === "error" ? panel.error : null });
}

function SourcePanel({ panel, ip }: { panel: IpReportPanel; ip: string }) {
  const failed = panel.status === "error";
  const timeline = panel.id === "abuseipdb" && !!panel.daily?.some((d) => d.count > 0);
  const categories = panel.categories ?? [];
  const remarks = panel.remarks ?? [];
  const vulns = panel.vulns ?? [];
  const services = panel.services ?? [];
  const aside = timeline || vulns.length > 0;
  const [asList, setAsList] = useState(false);

  return (
    <section className={`panel source-panel source-panel--${panel.id} ${timeline ? "panel--span" : ""}`}>
      <header className="panel__head">
        <div>
          <h2>{panel.name}</h2>
          <p className="muted">{panel.covers}</p>
        </div>
        <div className="panel__side">
          <span className={`panel__status mono is-${panel.status}`}>
            <span className="progress__dot" aria-hidden="true" />
            {failed ? "Unavailable" : `${panel.ms} ms`}
          </span>
          <PanelTools
            name={panel.name}
            getText={() => textOf(panel, ip)}
            link={sourceLink(panel.id, { kind: "ip", value: ip })}
          >
            {timeline && !failed && (
              <IconButton
                label={asList ? "Show timeline" : "Show reports as a list"}
                icon={asList ? ChartSpline : List}
                onClick={() => setAsList((v) => !v)}
                aria-pressed={asList}
                className="icon-btn--sm"
              />
            )}
          </PanelTools>
        </div>
      </header>

      {failed ? (
        <p className="panel__error">{panel.error}</p>
      ) : (
        <>
        <div className={aside ? "source-panel__split source-panel__split--aside" : undefined}>
          <div>
            {panel.warning && <p className="panel__warning">{panel.warning}</p>}
            {panel.rows.length === 0 ? (
              <p className="panel__empty muted">{panel.emptyText ?? "Everything this source returned is already shown above."}</p>
            ) : (
              <Rows rows={panel.rows} />
            )}
            {panel.operator && <Operator op={panel.operator} />}
            {categories.length > 0 && <Categories items={categories} />}
            {remarks.length > 0 && (
              <details className="remarks">
                <summary>Registry remarks</summary>
                {remarks.map((r, i) => (
                  <pre key={i}>{r}</pre>
                ))}
              </details>
            )}
          </div>
          {timeline && (
            <ReportTimeline
              compact
              asList={asList}
              daily={panel.daily ?? []}
              reports={panel.reports ?? []}
              received={panel.reportsReceived ?? 0}
              total={panel.totalReports ?? 0}
              days={panel.reportWindow ?? 90}
            />
          )}
          {!timeline && vulns.length > 0 && <Vulnerabilities items={vulns} />}
        </div>
        {services.length > 0 && <Services items={services} />}
        </>
      )}
    </section>
  );
}

function Operator({ op }: { op: ProxyOperator }) {
  const rows = presentRows([
    { label: "Operator", value: op.name, highlight: true },
    { label: "Anonymity", value: op.anonymity },
    { label: "Popularity", value: op.popularity },
    { label: "Services", value: op.services?.join(", ") },
    { label: "Protocols", value: op.protocols?.join(", "), mono: true },
    {
      label: "Policies",
      value:
        op.policies && Object.keys(op.policies).length
          ? Object.entries(op.policies)
              .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v === true ? "yes" : v === false ? "no" : String(v)}`)
              .join("; ")
          : null,
    },
  ]);

  return (
    <div className="subsection">
      <h3>Anonymizing service</h3>
      <Rows rows={rows} />
    </div>
  );
}

const VULNS_SHOWN = 12;

function Vulnerabilities({ items }: { items: ShodanVulnDetail[] }) {
  // senza la key di Shodan ci sono solo gli ID: un elenco compatto
  const detailed = items.some((v) => v.cvss !== null || v.summary);
  // solo testo: il report non contiene link a siti di terzi
  const item = (v: ShodanVulnDetail) =>
    detailed ? (
      <li key={v.id} className="vuln">
        <p className="vuln__head">
          <span className="mono">{v.id}</span>
          {v.cvss !== null && <span className="vuln__score mono">CVSS {v.cvss.toFixed(1)}</span>}
          {v.verified && <span className="vuln__score mono">Verified</span>}
          {v.ports.length > 0 && <span className="muted">port {v.ports.join(", ")}</span>}
        </p>
        {v.summary && <p className="vuln__text muted">{v.summary}</p>}
        {v.extra && <p className="vuln__text vuln__text--small mono muted">{v.extra}</p>}
      </li>
    ) : (
      <li key={v.id} className="mono">
        {v.id}
      </li>
    );
  const list = (rows: ShodanVulnDetail[]) => <ul className={detailed ? "vuln-list" : "vulns__list"}>{rows.map(item)}</ul>;
  const rest = items.slice(VULNS_SHOWN);
  return (
    <div className="subsection vulns">
      <h3>
        <span>Potential vulnerabilities</span>
        <span className="mono">{items.length}</span>
      </h3>
      <p className="vulns__note muted">Matched from the software versions Shodan detected, not confirmed on this host.</p>
      {list(items.slice(0, VULNS_SHOWN))}
      {rest.length > 0 && (
        <details className="remarks">
          <summary>Show {rest.length} more</summary>
          {list(rest)}
        </details>
      )}
    </div>
  );
}

function serviceTitle(s: ShodanService): string {
  const where = s.port !== null ? `${s.port}${s.transport ? `/${s.transport}` : ""}` : s.transport || "";
  const what = [s.product, s.version].filter(Boolean).join(" ") || s.module || "";
  return [where, what].filter(Boolean).join(" ") || "Unknown service";
}

function Services({ items }: { items: ShodanService[] }) {
  return (
    <div className="subsection shodan-services">
      <h3>
        <span>Services</span>
        <span className="mono">{items.length}</span>
      </h3>
      <ul className="service-list">
        {items.map((s, i) => {
          const where = s.port !== null ? `${s.port}${s.transport ? `/${s.transport}` : ""}` : s.transport || "—";
          const what = [s.product, s.version].filter(Boolean).join(" ") || "Unknown service";
          return (
            <li key={`${s.port}-${s.transport}-${i}`}>
              <details className="service">
                <summary>
                  <span className="service__port mono">{where}</span>
                  <span className="service__name">{what}</span>
                  {s.module && <span className="service__tag mono">{s.module}</span>}
                  {s.vulns.length > 0 && (
                    <span className="service__tag service__tag--alert mono">
                      {s.vulns.length} {s.vulns.length === 1 ? "CVE" : "CVEs"}
                    </span>
                  )}
                  {s.timestamp && <span className="service__time muted mono">{s.timestamp}</span>}
                </summary>
                <div className="service__body">
                  {s.sections.map((sec) => (
                    <div key={sec.title} className="subsection">
                      <h3>{sec.title}</h3>
                      <Rows rows={sec.rows} />
                    </div>
                  ))}
                  {s.tags.length > 0 && (
                    <div className="subsection">
                      <h3>Tags</h3>
                      <p className="mono">{s.tags.join(", ")}</p>
                    </div>
                  )}
                  {s.vulns.length > 0 && (
                    <div className="subsection">
                      <h3>Potential vulnerabilities</h3>
                      <p className="mono service__vulns">{s.vulns.join(", ")}</p>
                    </div>
                  )}
                  {s.banner && (
                    <div className="subsection">
                      <h3>Banner</h3>
                      <pre className="banner">{s.banner}</pre>
                    </div>
                  )}
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Categories({ items }: { items: { name: string; count: number }[] }) {
  const max = Math.max(...items.map((c) => c.count));
  return (
    <div className="subsection categories">
      <h3>Reported for</h3>
      <ul>
        {items.map((c) => (
          <li key={c.name}>
            <span>{c.name}</span>
            <span className="categories__bar" aria-hidden="true">
              <span style={{ width: `${(c.count / max) * 100}%` }} />
            </span>
            <span className="mono">{c.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
