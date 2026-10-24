// Report per domini e URL: un riquadro WHOIS e uno VirusTotal. Come per gli IP,
// un dato già mostrato (registrar, data di creazione, name server) non viene
// ripetuto nel riquadro successivo; i dati chiave sono riassunti in cima.

import { DOMAIN_SOURCES } from "./lookup";
import { countryName } from "./countries";
import { formatDate, formatDateTime } from "./report";

const isEmpty = (v) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

function row(label, value, opts = {}) {
  return isEmpty(value) ? null : { label, value: String(value), ...opts };
}

const sameText = (a, b) =>
  !isEmpty(a) && !isEmpty(b) && String(a).toLowerCase().replace(/[.,\s]/g, "") === String(b).toLowerCase().replace(/[.,\s]/g, "");

function sameDay(a, b) {
  if (!a || !b) return false;
  const da = new Date(a);
  const db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return false;
  return da.toISOString().slice(0, 10) === db.toISOString().slice(0, 10);
}

/** "22 years", "3 months", "12 days" */
export function span(from, to = new Date()) {
  const a = new Date(from);
  const b = new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const days = Math.floor(Math.abs(b - a) / 86400000);
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  if (days >= 365) return plural(Math.floor(days / 365.25), "year");
  if (days >= 31) return plural(Math.floor(days / 30.44), "month");
  return plural(days, "day");
}

const STATUS_LABELS = {
  clienttransferprohibited: "Transfer locked",
  clientdeleteprohibited: "Delete locked",
  clientupdateprohibited: "Update locked",
  clientrenewprohibited: "Renew locked",
  servertransferprohibited: "Transfer locked by registry",
  serverdeleteprohibited: "Delete locked by registry",
  serverupdateprohibited: "Update locked by registry",
  clienthold: "On hold",
  serverhold: "On hold by registry",
  pendingdelete: "Pending delete",
  redemptionperiod: "Redemption period",
  active: "Active",
  ok: "Active",
};

function statusLabel(s) {
  const key = String(s).toLowerCase().replace(/[^a-z]/g, "");
  return STATUS_LABELS[key] || s;
}

export function buildDomainReport(lookup) {
  const { target, results } = lookup;
  const ok = (id) => (results[id]?.status === "ok" ? results[id].data : null);
  const who = ok("domainwhois");
  const vt = ok("virustotal");

  const host = target.kind === "url" ? target.host : target.value;

  // ── WHOIS ─────────────────────────────────────
  const whoisRows = [];
  const resolves = who?.resolves || { ipv4: [], ipv6: [] };
  if (who) {
    const created = who.createdAt;
    const expires = who.expiresAt;
    const expired = expires && new Date(expires) < new Date();
    whoisRows.push(
      row("Registered domain", who.domain !== host ? who.domain : null, { mono: true }),
      row("Registrar", who.registrar, { highlight: true }),
      row("Registrar IANA ID", who.registrarIanaId, { mono: true }),
      row("Registered on", created && `${formatDate(created)} (${span(created)} ago)`, { highlight: true }),
      row("Expires on", expires && `${formatDate(expires)} (${expired ? `expired ${span(expires)} ago` : `in ${span(expires)}`})`, { highlight: true }),
      row("Last updated", formatDate(who.updatedAt)),
      row("Status", (who.status || []).map(statusLabel).filter((v, i, a) => a.indexOf(v) === i).join(", ")),
      row("Name servers", (who.nameServers || []).join("\n"), { mono: true }),
      row("DNSSEC", who.dnssec === true ? "Signed" : who.dnssec === false ? "Not signed" : null),
      row("Registrant", who.registrant?.organization),
      row("Registrant country", who.registrant?.country && (countryName(who.registrant.country) || who.registrant.country)),
      row("Abuse contact", [...(who.abuse?.emails || []), ...(who.abuse?.phones || [])].join("\n"), { mono: true }),
      row("WHOIS server", who.whoisServer, { mono: true }),
    );
  }

  // ── VirusTotal ────────────────────────────────
  const vtRows = [];
  let flagged = [];
  let dnsRecords = [];
  let redirects = [];
  let certificate = null;
  let popularity = [];
  if (vt?.found) {
    const s = vt.stats || {};
    flagged = vt.flagged || [];
    vtRows.push(
      row("Detections", s.total ? `${s.malicious} malicious, ${s.suspicious} suspicious out of ${s.total} engines` : null, {
        highlight: s.malicious > 0 || s.suspicious > 0,
      }),
      row("Harmless", s.total ? `${s.harmless} engines` : null),
      row("Undetected", s.total ? `${s.undetected} engines` : null),
      row("Reputation", vt.reputation !== null && vt.reputation !== undefined ? String(vt.reputation) : null, { mono: true }),
      row("Community votes", vt.votes ? `${vt.votes.malicious} malicious, ${vt.votes.harmless} harmless` : null),
      row("Categories", (vt.categories || []).join(", ")),
      row("Tags", (vt.tags || []).join(", "), { mono: true }),
      row("Last analysis", formatDateTime(vt.lastAnalysisAt)),
    );
    if (vt.type === "domain") {
      // già nel riquadro WHOIS? allora non si ripete
      if (!sameText(vt.registrar, who?.registrar)) vtRows.push(row("Registrar", vt.registrar));
      if (!sameDay(vt.createdAt, who?.createdAt)) vtRows.push(row("Created", formatDate(vt.createdAt)));
      const ns = new Set((who?.nameServers || []).map((n) => n.toLowerCase().replace(/\.$/, "")));
      dnsRecords = (vt.dnsRecords || []).filter(
        (r) => !(r.type === "NS" && ns.has(String(r.value).toLowerCase().replace(/\.$/, ""))),
      );
      certificate = vt.certificate || null;
      popularity = vt.popularity || [];
    } else {
      vtRows.push(
        row("Final URL", vt.finalUrl && vt.finalUrl !== target.value ? vt.finalUrl : null, { mono: true }),
        row("Page title", vt.title),
        row("HTTP status", vt.httpStatus, { mono: true }),
        row("Times submitted", vt.timesSubmitted),
        row("First submitted", formatDate(vt.firstSubmittedAt)),
      );
      redirects = vt.redirects?.length > 1 ? vt.redirects : [];
    }
  }

  // ── Verdetto ─────────────────────────────────
  const stats = vt?.found ? vt.stats || {} : null;
  let level = "unknown";
  let title = "Not assessed";
  const reasons = [];
  if (vt && !vt.found) title = "Not in VirusTotal";
  else if (vt?.status === "queued") title = "Analysis queued";
  else if (stats) {
    if (stats.malicious >= 3) [level, title] = ["high", "Malicious"];
    else if (stats.malicious > 0 || stats.suspicious > 0) [level, title] = ["medium", "Suspicious"];
    else [level, title] = ["low", "No threats found"];
    if (stats.malicious) reasons.push(`${stats.malicious} ${stats.malicious === 1 ? "engine flags" : "engines flag"} it as malicious`);
    if (stats.suspicious) reasons.push(`${stats.suspicious} as suspicious`);
    if (vt.votes?.malicious) reasons.push(`${vt.votes.malicious} malicious community ${vt.votes.malicious === 1 ? "vote" : "votes"}`);
    if (typeof vt.reputation === "number" && vt.reputation < 0) reasons.push(`reputation ${vt.reputation}`);
  }

  // ── Dati chiave ──────────────────────────────
  const expired = who?.expiresAt && new Date(who.expiresAt) < new Date();
  const highlights = [
    { key: "registrar", label: "Registrar", value: who?.registrar || vt?.registrar || null, sub: who?.registrarIanaId ? `IANA ID ${who.registrarIanaId}` : null },
    {
      key: "age",
      label: "Domain age",
      value: who?.createdAt || vt?.createdAt ? span(who?.createdAt || vt?.createdAt) : null,
      sub: who?.createdAt || vt?.createdAt ? `Registered ${formatDate(who?.createdAt || vt?.createdAt)}` : null,
    },
    {
      key: "expires",
      label: "Expires",
      value: who?.expiresAt ? formatDate(who.expiresAt) : null,
      sub: who?.expiresAt ? (expired ? `Expired ${span(who.expiresAt)} ago` : `In ${span(who.expiresAt)}`) : null,
      detected: !!expired,
    },
    {
      key: "detections",
      label: "Detections",
      value: stats?.total ? `${stats.malicious} / ${stats.total}` : vt && !vt.found ? "No record" : vt?.status === "queued" ? "Queued" : null,
      sub: stats?.total ? (stats.malicious ? "Engines flagging it as malicious" : "No engine flags it as malicious") : null,
      detected: !!stats?.malicious,
    },
  ];

  // solo le fonti interrogate in questa ricerca (alcune possono essere disattivate)
  const sources = DOMAIN_SOURCES.filter((s) => results[s.id]);
  const failed = Object.values(results).filter((r) => r.status === "error");

  return {
    kind: target.kind,
    title: host,
    subtitle: target.kind === "url" ? target.value : null,
    hostIsIp: !!target.hostIsIp,
    verdict: { level, title, reasons },
    detectionScore: stats?.total ? { value: stats.malicious, suffix: `/${stats.total}`, percent: (stats.malicious / stats.total) * 100 } : null,
    reputation: vt?.found && typeof vt.reputation === "number" ? vt.reputation : null,
    highlights,
    panels: sources.map((s) => ({
      ...s,
      status: results[s.id]?.status,
      error: results[s.id]?.error,
      ms: results[s.id]?.ms,
      rows: (s.id === "domainwhois" ? whoisRows : vtRows).filter(Boolean),
    })),
    resolves,
    flagged,
    dnsRecords,
    certificate,
    popularity,
    redirects,
    vtNotFound: vt && !vt.found,
    vtQueued: vt?.status === "queued",
    allFailed: sources.length > 0 && failed.length === sources.length,
    sources: results,
  };
}
