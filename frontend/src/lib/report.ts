// Costruisce il report: un riquadro per ogni sorgente, nell'ordine di IP_SOURCES.
// Un dato già mostrato da una sorgente precedente non viene ripetuto; se una
// sorgente successiva riporta un valore diverso, la riga compare con la nota
// "differs from …". I dati chiave (posizione, ISP, tipo di connessione, VPN)
// sono evidenziati e riassunti in cima.

import type {
  AbuseReport,
  Cidr,
  DailyCount,
  Highlight,
  IpConnection,
  IpLocation,
  IpReport,
  IpReportPanel,
  Lookup,
  ProxyDetections,
  ProxyLocation,
  ProxyNetwork,
  Row,
  ShodanVulnDetail,
  SourceError,
  SourceId,
  Verdict,
  VerdictLevel,
} from "../types";
import { countryName } from "./countries";
import { IP_SOURCES, SOURCE_NAMES, dataOf, resultList, resultMeta } from "./lookup";

const isEmpty = (v: unknown): boolean =>
  v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

const looseKey = (v: unknown): string =>
  String(v)
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\s+(inc|llc|ltd|gmbh|srl|spa|sa|bv|corp|corporation|limited|co)$/g, "")
    .trim();

export function normalizeAsn(v: unknown): string | null {
  if (isEmpty(v)) return null;
  const m = String(v).match(/(\d+)/);
  return m ? `AS${m[1]}` : null;
}

export function formatDate(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined || isEmpty(v)) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined || isEmpty(v)) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function utcOffset(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "";
  const sign = seconds < 0 ? "−" : "+";
  const abs = Math.abs(seconds);
  const h = Math.floor(abs / 3600);
  const m = Math.round((abs % 3600) / 60);
  return ` (UTC${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""})`;
}

// Nomi di luoghi: sorgenti diverse scrivono lo stesso posto in modi diversi
// ("City of London" / "London", "Frankfurt am Main" / "Frankfurt",
// "New York City" / "New York"). Si normalizza e si considera uguale anche
// quando un nome inizia con l'altro a parole intere (ma "York" ≠ "New York").
const PLACE_NOISE =
  /\b(the|city of|metropolitan city of|greater|municipality of|comune di|citta metropolitana di|provincia di|province of|county of|region of|city|county|province|region|district)\b/g;

export function placeKey(v: unknown): string {
  return String(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(PLACE_NOISE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function samePlace(a: string, b: string): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 3 && `${long} `.startsWith(`${short} `);
}

const yesNo = (v: boolean | null | undefined): string | null => (v === null || v === undefined ? null : v ? "Yes" : "No");
const formatCountry = (code: string | null | undefined): string | null =>
  code ? `${countryName(code)} (${String(code).toUpperCase()})` : null;
const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));

/** "47.3769, 8.5417" e la stessa posizione arrotondata (per confrontare fonti diverse). */
function coordinates(latValue: unknown, lonValue: unknown): { text: string; cmp: string } | null {
  const lat = num(latValue);
  const lon = num(lonValue);
  if (lat === null || lon === null) return null;
  return { text: `${lat.toFixed(4)}, ${lon.toFixed(4)}`, cmp: `${lat.toFixed(1)},${lon.toFixed(1)}` };
}

/**
 * Software di un host in forma leggibile, da un CPE ("cpe:/a:apache:http_server:2.4.41"
 * oppure "cpe:2.3:a:apache:http_server:2.4.41:*:…" → "apache http server 2.4.41").
 */
export function cpeLabel(cpe: string): string {
  const fields = cpe.startsWith("cpe:2.3:") ? cpe.split(":").slice(3) : cpe.replace(/^cpe:\/?/, "").split(":").slice(1);
  const clean = (v: string): string => {
    let text = v;
    try {
      text = decodeURIComponent(v);
    } catch {
      // sequenza % non valida: si tiene il testo com'è
    }
    return text.replace(/_/g, " ").trim();
  };
  const [vendor, product, version] = fields.map(clean).map((f) => (f === "-" || f === "*" ? "" : f));
  const parts = [vendor === product ? "" : vendor, product, version].filter(Boolean);
  return parts.length ? parts.join(" ") : cpe;
}

/** Quante righe di hostname e software si mostrano prima di riassumere il resto. */
const SHODAN_ROW_LIMIT = 8;

interface SeenValue {
  norm: string;
  source: string;
}

interface AddOptions {
  /** Dato condiviso tra fonti: la seconda volta che compare non si ripete. */
  key?: string;
  /** Valore da confrontare, se diverso da quello mostrato. */
  cmp?: unknown;
  mono?: boolean;
  highlight?: boolean;
  same?: (a: string, b: string) => boolean;
}

// Righe di un riquadro, con deduplica tra riquadri tramite `key`.
function panelBuilder(seen: Map<string, SeenValue>, sourceId: SourceId) {
  const rows: Row[] = [];
  const add = (label: string, value: unknown, { key, cmp, mono, highlight, same }: AddOptions = {}) => {
    if (isEmpty(value)) return;
    const row: Row = { label, value: String(value), mono: !!mono, highlight: !!highlight };
    if (key) {
      const norm = cmp !== undefined ? String(cmp) : looseKey(value);
      const prev = seen.get(key);
      if (prev && (same ? same(prev.norm, norm) : prev.norm === norm)) return;
      if (prev) row.differs = prev.source;
      else seen.set(key, { norm, source: SOURCE_NAMES[sourceId] });
    }
    rows.push(row);
  };
  return { rows, add };
}

// Conteggio giornaliero (UTC) se il backend non lo fornisce.
function dailyFromReports(reports: AbuseReport[], days: number): DailyCount[] {
  const counts = new Map<string, number>();
  for (const r of reports) {
    const d = new Date(r.reportedAt);
    if (Number.isNaN(d.getTime())) continue;
    const key = d.toISOString().slice(0, 10);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const today = new Date();
  const out: DailyCount[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i))
      .toISOString()
      .slice(0, 10);
    out.push({ date, count: counts.get(date) || 0 });
  }
  return out;
}

export function buildReport(lookup: Lookup): IpReport {
  const { results } = lookup;
  const ip = lookup.ip ?? "";
  const geo = dataOf(results, "iptracker");
  const pc = dataOf(results, "proxycheck");
  const abuse = dataOf(results, "abuseipdb");
  const shodan = dataOf(results, "shodan");

  const L: IpLocation = geo?.location ?? {};
  const C: IpConnection = geo?.connection ?? {};
  const PL: ProxyLocation = pc?.location ?? {};
  const PN: ProxyNetwork = pc?.network ?? {};
  const PD: ProxyDetections = pc?.detections ?? {};

  const seen = new Map<string, SeenValue>();

  // CIDR: prefisso BGP annunciato (Team Cymru, dal backend ip-api) oppure, se
  // manca, il range che riporta ProxyCheck.io. Per ora non è mostrato nella
  // pagina ma resta negli export.
  let cidr: Cidr | null = null;
  const network = geo?.network;
  if (network?.cidr) {
    cidr = { ...network };
  } else if (PN.range && /\/\d+$/.test(PN.range)) {
    cidr = { cidr: PN.range, source: "ProxyCheck.io" };
  }
  // dati propri di ciascun riquadro, oltre a nome, stato e righe
  const panels: Partial<Record<SourceId, Partial<IpReportPanel>>> = {};

  // ── ip-api.com ────────────────────────────────
  {
    const p = panelBuilder(seen, "iptracker");
    if (geo) {
      p.add("Country", formatCountry(L.countryCode), { key: "country", cmp: L.countryCode?.toUpperCase(), highlight: true });
      p.add("Region", L.region, { key: "region", cmp: L.region && placeKey(L.region), same: samePlace, highlight: true });
      p.add("City", L.city, { key: "city", cmp: L.city && placeKey(L.city), same: samePlace, highlight: true });
      p.add("District", L.district);
      p.add("Postal code", L.zip, { mono: true });
      const where = coordinates(L.lat, L.lon);
      if (where) p.add("Coordinates", where.text, { key: "coords", cmp: where.cmp, mono: true });
      p.add("Time zone", L.timezone && `${L.timezone}${utcOffset(L.utcOffset)}`, { key: "timezone", cmp: L.timezone?.toLowerCase() });
      p.add("Continent", L.continent);
      p.add("Currency", L.currency, { mono: true });
      p.add("ISP", C.isp, { key: "isp", highlight: true });
      p.add("Organization", C.org, { key: "org" });
      p.add("Autonomous system", C.asn && [C.asn, C.asName].filter(Boolean).join("  "), { key: "asn", cmp: normalizeAsn(C.asn), mono: true });
      p.add("Reverse DNS", C.reverse, { key: "hostname", cmp: C.reverse?.toLowerCase(), mono: true });
      p.add("Mobile connection", yesNo(C.isMobile));
      p.add("Proxy or VPN flag", yesNo(C.isProxy));
      p.add("Hosting or data center", yesNo(C.isHosting), { key: "hosting" });
    }
    panels.iptracker = { rows: p.rows };
  }

  // ── ProxyCheck.io ─────────────────────────────
  const operator = pc?.operator ?? null;
  {
    const p = panelBuilder(seen, "proxycheck");
    if (pc) {
      // il nome del provider è nella sezione "Anonymizing service" più sotto
      p.add("VPN", yesNo(PD.vpn), { highlight: true });
      p.add("Proxy", yesNo(PD.proxy));
      p.add("Tor exit node", yesNo(PD.tor), { key: "tor" });
      p.add("Hosting or data center", yesNo(PD.hosting), { key: "hosting" });
      const other = [PD.scraper && "Scraper", PD.compromised && "Compromised host"].filter(Boolean);
      p.add("Other detections", other.length ? other.join(", ") : "None");
      p.add("Risk score", num(pc.risk) !== null ? `${num(pc.risk)} / 100` : null, { mono: true });
      p.add("Detection confidence", num(pc.confidence) !== null ? `${num(pc.confidence)}%` : null, { mono: true });
      p.add("First seen anonymizing", formatDate(pc.firstSeen));
      p.add("Last seen anonymizing", formatDate(pc.lastSeen));
      p.add("Attacks recorded", pc.totalAttacks ? String(pc.totalAttacks) : null, { mono: true });
      p.add("Network type", PN.type);
      p.add("Provider", PN.provider, { key: "isp" });
      p.add("Organization", PN.organisation, { key: "org" });
      p.add("Autonomous system", normalizeAsn(PN.asn), { key: "asn", cmp: normalizeAsn(PN.asn), mono: true });
      p.add("Network range", PN.range, { key: "range", cmp: PN.range?.replace(/\s/g, ""), mono: true });
      p.add("Hostname", PN.hostname, { key: "hostname", cmp: PN.hostname?.toLowerCase(), mono: true });
      p.add("Country", formatCountry(PL.countryCode), { key: "country", cmp: PL.countryCode?.toUpperCase(), highlight: true });
      p.add("Region", PL.region, { key: "region", cmp: PL.region && placeKey(PL.region), same: samePlace, highlight: true });
      p.add("City", PL.city, { key: "city", cmp: PL.city && placeKey(PL.city), same: samePlace, highlight: true });
      const where = coordinates(PL.lat, PL.lon);
      if (where) p.add("Coordinates", where.text, { key: "coords", cmp: where.cmp, mono: true });
      p.add("Time zone", PL.timezone, { key: "timezone", cmp: PL.timezone?.toLowerCase() });
      if (pc.deviceEstimate && typeof pc.deviceEstimate === "object") {
        p.add("Device estimate", Object.entries(pc.deviceEstimate).map(([k, v]) => `${v} ${k}`).join(", "));
      }
    }
    panels.proxycheck = { rows: p.rows, operator, warning: pc?.warning || null };
  }

  // ── AbuseIPDB ─────────────────────────────────
  {
    const p = panelBuilder(seen, "abuseipdb");
    if (abuse) {
      p.add("Connection type", abuse.usageType, { highlight: true });
      p.add("Abuse confidence", `${abuse.abuseScore ?? 0}%`, { mono: true });
      p.add("Reports", `${abuse.totalReports} from ${abuse.numDistinctUsers} ${abuse.numDistinctUsers === 1 ? "reporter" : "reporters"}`);
      p.add("Last reported", formatDateTime(abuse.lastReportedAt));
      p.add("Allowlisted", yesNo(abuse.isWhitelisted));
      p.add("Tor exit node", yesNo(abuse.isTor), { key: "tor" });
      p.add("ISP", abuse.isp, { key: "isp", highlight: true });
      p.add("Domain", abuse.domain, { mono: true });
      for (const h of abuse.hostnames || []) {
        p.add("Hostname", h, { key: "hostname", cmp: h.toLowerCase(), mono: true });
      }
      p.add("Country", formatCountry(abuse.countryCode), { key: "country", cmp: abuse.countryCode?.toUpperCase(), highlight: true });
    }
    panels.abuseipdb = {
      rows: p.rows,
      categories: abuse?.categories || [],
      reports: abuse?.reports || [],
      reportWindow: abuse?.maxAgeInDays || 90,
      daily: abuse ? abuse.daily || dailyFromReports(abuse.reports || [], abuse.maxAgeInDays || 90) : [],
      reportsReceived: abuse?.reportsReceived ?? abuse?.reports?.length ?? 0,
      totalReports: abuse?.totalReports ?? 0,
    };
  }

  // ── Shodan ────────────────────────────────────
  {
    const p = panelBuilder(seen, "shodan");
    // senza la key di Shodan arrivano solo gli ID delle CVE, con la key anche i dettagli
    const vulns: ShodanVulnDetail[] = shodan?.vulnDetails?.length
      ? shodan.vulnDetails
      : (shodan?.vulns ?? []).map((id) => ({ id, cvss: null, summary: null, verified: null, ports: [], extra: null }));
    if (shodan?.found) {
      const SL = shodan.location;
      p.add("Open ports", shodan.ports.join(", "), { mono: true, highlight: true });
      p.add("Organization", shodan.org, { key: "org" });
      p.add("ISP", shodan.isp, { key: "isp" });
      p.add("Autonomous system", normalizeAsn(shodan.asn), { key: "asn", cmp: normalizeAsn(shodan.asn), mono: true });
      p.add("Operating system", shodan.os);
      // un IP può avere molti hostname: una sola riga, senza quello già mostrato da un'altra fonte
      const known = seen.get("hostname")?.norm;
      const names = shodan.hostnames.filter((h) => h.toLowerCase() !== known);
      p.add(names.length === 1 ? "Hostname" : "Hostnames", names.slice(0, SHODAN_ROW_LIMIT).join("\n"), { mono: true });
      if (names.length > SHODAN_ROW_LIMIT) p.add("More hostnames", String(names.length - SHODAN_ROW_LIMIT), { mono: true });
      // i risultati salvati in cache prima dell'aggiunta della key non hanno questo campo
      p.add("Domains", (shodan.domains ?? []).slice(0, SHODAN_ROW_LIMIT).join("\n"), { mono: true });
      p.add("Tags", shodan.tags.join(", "));
      if (SL) {
        p.add("Country", formatCountry(SL.countryCode), { key: "country", cmp: SL.countryCode?.toUpperCase() });
        // Shodan dà il codice della regione ("CA"), le altre fonti il nome: non si confrontano
        p.add("Region code", SL.region);
        p.add("City", SL.city, { key: "city", cmp: SL.city && placeKey(SL.city), same: samePlace });
        p.add("Postal code", SL.postalCode, { mono: true });
        const where = coordinates(SL.lat, SL.lon);
        if (where) p.add("Coordinates", where.text, { key: "coords", cmp: where.cmp, mono: true });
      }
      p.add("Last update", shodan.lastUpdate);
      const software = [...new Set(shodan.cpes.map(cpeLabel))];
      p.add("Software", software.slice(0, SHODAN_ROW_LIMIT).join("\n"));
      if (software.length > SHODAN_ROW_LIMIT) p.add("More software", String(software.length - SHODAN_ROW_LIMIT), { mono: true });
      p.add("Potential CVEs", vulns.length ? String(vulns.length) : null, { mono: true, highlight: true });
      for (const r of shodan.extra ?? []) p.add(r.label, r.value, { mono: r.mono });
    }
    panels.shodan = {
      rows: p.rows,
      vulns,
      services: shodan?.services ?? [],
      warning: shodan?.warning || null,
      emptyText: shodan && !shodan.found ? "Shodan has no data on this address: it has not seen any open ports or services." : undefined,
    };
  }

  // ── Dati chiave in evidenza ──────────────────
  const countryCode = (L.countryCode || PL.countryCode || abuse?.countryCode || "").toUpperCase() || null;
  const lat = num(L.lat) ?? num(PL.lat);
  const lon = num(L.lon) ?? num(PL.lon);
  const city = L.city || PL.city || null;
  const region = L.region || PL.region || null;
  const country = L.country || PL.country || countryName(countryCode) || null;

  const isp = C.isp || abuse?.isp || PN.provider || null;
  const ispSource = C.isp ? "iptracker" : abuse?.isp ? "abuseipdb" : "proxycheck";
  const asn = normalizeAsn(C.asn || PN.asn);

  let connection: { value: string; source: SourceId } | null = null;
  if (abuse?.usageType) connection = { value: abuse.usageType, source: "abuseipdb" };
  else if (geo && C.isMobile) connection = { value: "Mobile network", source: "iptracker" };
  else if (PN.type) connection = { value: PN.type, source: "proxycheck" };
  const connectionKind = /mobile/i.test(connection?.value || "")
    ? "mobile"
    : /fixed line/i.test(connection?.value || "")
      ? "fixed"
      : null;

  const torDetected = !!(PD.tor || abuse?.isTor);
  const proxyDetected = !!(PD.proxy || C.isProxy);
  let vpn: { value: string; sub: string; detected: boolean } | null;
  if (pc && PD.vpn) vpn = { value: operator?.name || "VPN detected", sub: operator?.name ? "VPN detected" : "Provider not identified", detected: true };
  else if (torDetected) vpn = { value: "Tor exit node", sub: "Traffic exits the Tor network here", detected: true };
  else if (proxyDetected) vpn = { value: "Proxy", sub: PD.proxy ? "Detected by ProxyCheck.io" : "Flagged by ip-api.com", detected: true };
  else if (pc || geo) vpn = { value: "No VPN detected", sub: pc ? "Checked by ProxyCheck.io" : "Checked by ip-api.com", detected: false };
  else vpn = null;

  const highlights: Highlight[] = [
    {
      key: "location",
      label: "Location",
      value: [city, region].filter((v, i, a) => v && a.indexOf(v) === i).join(", ") || country || null,
      sub: city || region ? country : null,
    },
    { key: "isp", label: "ISP", value: isp, sub: isp ? [asn, SOURCE_NAMES[ispSource]].filter(Boolean).join("  ") : null },
    {
      key: "connection",
      label: "Connection type",
      value: connection?.value || null,
      sub: connection ? `From ${SOURCE_NAMES[connection.source]}` : null,
      kind: connectionKind,
    },
    { key: "vpn", label: "VPN", value: vpn?.value || null, sub: vpn?.sub || null, detected: vpn?.detected },
  ];

  // ── Verdetto ─────────────────────────────────
  const abuseScore = abuse ? abuse.abuseScore ?? 0 : null;
  const risk = pc && num(pc.risk) !== null ? num(pc.risk) : null;
  const reasons: string[] = [];
  if (abuseScore) reasons.push(`Abuse confidence ${abuseScore}%`);
  if (torDetected) reasons.push("Tor exit node");
  if (PD.vpn) reasons.push(operator?.name ? `VPN (${operator.name})` : "VPN");
  if (proxyDetected) reasons.push("Proxy");
  if (PD.compromised) reasons.push("Compromised host");
  if (risk !== null && risk >= 34) reasons.push(`ProxyCheck.io risk ${risk}`);

  let level: VerdictLevel = "unknown";
  if (abuse || pc) {
    if ((abuseScore ?? 0) >= 75 || (risk ?? 0) >= 67 || torDetected || PD.compromised) level = "high";
    else if ((abuseScore ?? 0) >= 25 || (risk ?? 0) >= 34 || PD.vpn || proxyDetected) level = "medium";
    else level = "low";
  }
  const titles: Record<VerdictLevel, string> = {
    high: "High risk", medium: "Suspicious", low: "No threats found", unknown: "Not assessed",
  };
  const verdict: Verdict = { level, title: titles[level], reasons };

  const failed = resultList(results).filter((r): r is SourceError => r.status === "error");
  const queried = IP_SOURCES.filter((s) => results[s.id]);
  const allPrivate = queried.length > 0 && failed.length === queried.length && failed.every((f) => f.code === 422);

  return {
    ip,
    version: ip.includes(":") ? 6 : 4,
    location: { countryCode, country, city, region, lat, lon },
    cidr,
    highlights,
    verdict,
    abuseScore,
    risk,
    panels: queried.map((s): IpReportPanel => ({
      ...s,
      ...resultMeta(results[s.id]),
      rows: [],
      ...panels[s.id],
    })),
    allPrivate,
    sources: results,
  };
}
