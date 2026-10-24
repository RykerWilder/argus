// Costruisce il report: un riquadro per ogni sorgente, nell'ordine di SOURCES.
// Un dato già mostrato da una sorgente precedente non viene ripetuto; se una
// sorgente successiva riporta un valore diverso, la riga compare con la nota
// "differs from …". I dati chiave (posizione, ISP, tipo di connessione, VPN)
// sono evidenziati e riassunti in cima.

import { countryName } from "./countries";
import { ACTIVE_SOURCES, SOURCE_NAMES } from "./lookup";

const isEmpty = (v) =>
  v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

const looseKey = (v) =>
  String(v)
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\s+(inc|llc|ltd|gmbh|srl|spa|sa|bv|corp|corporation|limited|co)$/g, "")
    .trim();

export function normalizeAsn(v) {
  if (isEmpty(v)) return null;
  const m = String(v).match(/(\d+)/);
  return m ? `AS${m[1]}` : null;
}

export function formatDate(v) {
  if (isEmpty(v)) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(v) {
  if (isEmpty(v)) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function utcOffset(seconds) {
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

export function placeKey(v) {
  return String(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(PLACE_NOISE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function samePlace(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 3 && `${long} `.startsWith(`${short} `);
}

const yesNo = (v) => (v === null || v === undefined ? null : v ? "Yes" : "No");
const formatCountry = (code) => (code ? `${countryName(code)} (${String(code).toUpperCase()})` : null);
const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

// Righe di un riquadro, con deduplica tra riquadri tramite `key`.
function panelBuilder(seen, sourceId) {
  const rows = [];
  const add = (label, value, { key, cmp, mono, highlight, same } = {}) => {
    if (isEmpty(value)) return;
    const row = { label, value: String(value), mono: !!mono, highlight: !!highlight };
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
function dailyFromReports(reports, days) {
  const counts = new Map();
  for (const r of reports) {
    const d = new Date(r.reportedAt);
    if (Number.isNaN(d.getTime())) continue;
    const key = d.toISOString().slice(0, 10);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const today = new Date();
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i))
      .toISOString()
      .slice(0, 10);
    out.push({ date, count: counts.get(date) || 0 });
  }
  return out;
}

export function buildReport(lookup) {
  const { ip, results } = lookup;
  const ok = (id) => (results[id]?.status === "ok" ? results[id].data : null);
  const geo = ok("iptracker");
  const pc = ok("proxycheck");
  const abuse = ok("abuseipdb");
  const who = ok("whois");

  const L = geo?.location || {};
  const C = geo?.connection || {};
  const PL = pc?.location || {};
  const PN = pc?.network || {};
  const PD = pc?.detections || {};
  const WN = who?.network || {};

  const seen = new Map();

  // CIDR: prefisso BGP annunciato (Team Cymru, dal backend ip-api) oppure, se
  // manca, il range che riporta ProxyCheck.io. Per ora non è mostrato nella
  // pagina ma resta negli export.
  let cidr = null;
  if (geo?.network?.cidr) {
    cidr = { ...geo.network };
  } else if (PN.range && /\/\d+$/.test(PN.range)) {
    cidr = { cidr: PN.range, source: "ProxyCheck.io" };
  }
  const panels = {};

  // ── ip-api.com ────────────────────────────────
  {
    const p = panelBuilder(seen, "iptracker");
    if (geo) {
      p.add("Country", formatCountry(L.countryCode), { key: "country", cmp: L.countryCode?.toUpperCase(), highlight: true });
      p.add("Region", L.region, { key: "region", cmp: L.region && placeKey(L.region), same: samePlace, highlight: true });
      p.add("City", L.city, { key: "city", cmp: L.city && placeKey(L.city), same: samePlace, highlight: true });
      p.add("District", L.district);
      p.add("Postal code", L.zip, { mono: true });
      if (num(L.lat) !== null && num(L.lon) !== null) {
        p.add("Coordinates", `${num(L.lat).toFixed(4)}, ${num(L.lon).toFixed(4)}`, {
          key: "coords", cmp: `${num(L.lat).toFixed(1)},${num(L.lon).toFixed(1)}`, mono: true,
        });
      }
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
  const operator = pc?.operator || null;
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
      if (num(PL.lat) !== null && num(PL.lon) !== null) {
        p.add("Coordinates", `${num(PL.lat).toFixed(4)}, ${num(PL.lon).toFixed(4)}`, {
          key: "coords", cmp: `${num(PL.lat).toFixed(1)},${num(PL.lon).toFixed(1)}`, mono: true,
        });
      }
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

  // ── RDAP WHOIS ────────────────────────────────
  {
    const p = panelBuilder(seen, "whois");
    if (who) {
      p.add("Network block", WN.cidr, { key: "range", cmp: WN.cidr?.replace(/\s/g, ""), mono: true });
      p.add("Address range", WN.startAddress && WN.endAddress ? `${WN.startAddress} – ${WN.endAddress}` : null, { mono: true });
      p.add("Network name", WN.name, { mono: true });
      p.add("Handle", WN.handle, { mono: true });
      p.add("Allocation type", WN.type);
      p.add("Registered to", who.registrant?.name, { key: "org" });
      p.add("Registry", who.registry);
      p.add("Registered in", formatCountry(WN.country || who.asnCountry));
      p.add("Registered on", formatDate(WN.registered));
      p.add("Last changed", formatDate(WN.lastChanged));
      p.add("Parent network", WN.parentHandle, { mono: true });
      p.add("Autonomous system", who.asn && [normalizeAsn(who.asn), who.asnDescription].filter(Boolean).join("  "), {
        key: "asn", cmp: normalizeAsn(who.asn), mono: true,
      });
      p.add("Abuse contact", [...(who.abuse?.emails || []), ...(who.abuse?.phones || [])].join("\n"), { mono: true });
    }
    panels.whois = { rows: p.rows, remarks: WN.remarks || [] };
  }

  // ── Dati chiave in evidenza ──────────────────
  const countryCode = (L.countryCode || PL.countryCode || abuse?.countryCode || "").toUpperCase() || null;
  const lat = num(L.lat) ?? num(PL.lat);
  const lon = num(L.lon) ?? num(PL.lon);
  const city = L.city || PL.city || null;
  const region = L.region || PL.region || null;
  const country = L.country || PL.country || countryName(countryCode);

  const isp = C.isp || abuse?.isp || PN.provider || null;
  const ispSource = C.isp ? "iptracker" : abuse?.isp ? "abuseipdb" : "proxycheck";
  const asn = normalizeAsn(C.asn || PN.asn || who?.asn);

  let connection = null;
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
  let vpn;
  if (pc && PD.vpn) vpn = { value: operator?.name || "VPN detected", sub: operator?.name ? "VPN detected" : "Provider not identified", detected: true };
  else if (torDetected) vpn = { value: "Tor exit node", sub: "Traffic exits the Tor network here", detected: true };
  else if (proxyDetected) vpn = { value: "Proxy", sub: PD.proxy ? "Detected by ProxyCheck.io" : "Flagged by ip-api.com", detected: true };
  else if (pc || geo) vpn = { value: "No VPN detected", sub: pc ? "Checked by ProxyCheck.io" : "Checked by ip-api.com", detected: false };
  else vpn = null;

  const highlights = [
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
  const reasons = [];
  if (abuseScore) reasons.push(`Abuse confidence ${abuseScore}%`);
  if (torDetected) reasons.push("Tor exit node");
  if (PD.vpn) reasons.push(operator?.name ? `VPN (${operator.name})` : "VPN");
  if (proxyDetected) reasons.push("Proxy");
  if (PD.compromised) reasons.push("Compromised host");
  if (risk !== null && risk >= 34) reasons.push(`ProxyCheck.io risk ${risk}`);

  let level = "unknown";
  if (abuse || pc) {
    if ((abuseScore ?? 0) >= 75 || (risk ?? 0) >= 67 || torDetected || PD.compromised) level = "high";
    else if ((abuseScore ?? 0) >= 25 || (risk ?? 0) >= 34 || PD.vpn || proxyDetected) level = "medium";
    else level = "low";
  }
  const verdict = {
    level,
    title: { high: "High risk", medium: "Suspicious", low: "No threats found", unknown: "Not assessed" }[level],
    reasons,
  };

  const failed = Object.values(results).filter((r) => r.status === "error");
  const queried = ACTIVE_SOURCES.filter((s) => results[s.id]);
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
    panels: queried.map((s) => ({
      ...s,
      status: results[s.id]?.status,
      error: results[s.id]?.error,
      ms: results[s.id]?.ms,
      ...panels[s.id],
    })),
    allPrivate,
    sources: results,
  };
}
