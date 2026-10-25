// Report per domini e URL: un riquadro WHOIS e uno VirusTotal. Come per gli IP,
// un dato già mostrato (registrar, data di creazione, name server) non viene
// ripetuto nel riquadro successivo; i dati chiave sono riassunti in cima.

import type {
  DomainReport,
  Highlight,
  Lookup,
  ResolvedIps,
  Row,
  VerdictLevel,
  VirusTotalData,
  VtCertificate,
  VtDnsRecord,
  VtFlagged,
  VtPopularity,
  VtStats,
} from "../types";
import { DOMAIN_SOURCES, dataOf, resultList, resultMeta } from "./lookup";
import { countryName } from "./countries";
import { formatDate, formatDateTime } from "./report";

const isEmpty = (v: unknown): boolean =>
  v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

function row(label: string, value: unknown, opts: Pick<Row, "mono" | "highlight"> = {}): Row | null {
  return isEmpty(value) ? null : { label, value: String(value), ...opts };
}

const isRow = (r: Row | null): r is Row => r !== null;

const NO_STATS: VtStats = { malicious: 0, suspicious: 0, harmless: 0, undetected: 0, timeout: 0, total: 0 };

const sameText = (a: unknown, b: unknown): boolean =>
  !isEmpty(a) && !isEmpty(b) && String(a).toLowerCase().replace(/[.,\s]/g, "") === String(b).toLowerCase().replace(/[.,\s]/g, "");

function sameDay(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const da = new Date(a);
  const db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return false;
  return da.toISOString().slice(0, 10) === db.toISOString().slice(0, 10);
}

/** "22 years", "3 months", "12 days" */
export function span(from: string | number | Date, to: string | number | Date = new Date()): string | null {
  const a = new Date(from);
  const b = new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const days = Math.floor(Math.abs(b.getTime() - a.getTime()) / 86400000);
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  if (days >= 365) return plural(Math.floor(days / 365.25), "year");
  if (days >= 31) return plural(Math.floor(days / 30.44), "month");
  return plural(days, "day");
}

const STATUS_LABELS: Record<string, string> = {
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

function statusLabel(s: string): string {
  const key = String(s).toLowerCase().replace(/[^a-z]/g, "");
  return STATUS_LABELS[key] || s;
}

export function buildDomainReport(lookup: Lookup): DomainReport {
  const { target, results } = lookup;
  const who = dataOf(results, "domainwhois");
  const vt: VirusTotalData | null = dataOf(results, "virustotal");

  const host = target.kind === "url" ? target.host : target.value;

  // ── WHOIS ─────────────────────────────────────
  const whoisRows: (Row | null)[] = [];
  const resolves: ResolvedIps = who?.resolves || { ipv4: [], ipv6: [] };
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
  const vtRows: (Row | null)[] = [];
  let flagged: VtFlagged[] = [];
  let dnsRecords: VtDnsRecord[] = [];
  let redirects: string[] = [];
  let certificate: VtCertificate | null = null;
  let popularity: VtPopularity[] = [];
  if (vt?.found) {
    const s = vt.stats || NO_STATS;
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
      const chain = vt.redirects ?? [];
      redirects = chain.length > 1 ? chain : [];
    }
  }

  // ── Verdetto ─────────────────────────────────
  const stats = vt?.found ? vt.stats || NO_STATS : null;
  let level: VerdictLevel = "unknown";
  let title = "Not assessed";
  const reasons: string[] = [];
  if (vt && !vt.found) title = "Not in VirusTotal";
  else if (vt?.status === "queued") title = "Analysis queued";
  else if (vt && stats) {
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
  const created = who?.createdAt || vt?.createdAt;
  const highlights: Highlight[] = [
    { key: "registrar", label: "Registrar", value: who?.registrar || vt?.registrar || null, sub: who?.registrarIanaId ? `IANA ID ${who.registrarIanaId}` : null },
    {
      key: "age",
      label: "Domain age",
      value: created ? span(created) : null,
      sub: created ? `Registered ${formatDate(created)}` : null,
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
  const failed = resultList(results).filter((r) => r.status === "error");

  return {
    kind: target.kind === "url" ? "url" : "domain",
    title: host,
    subtitle: target.kind === "url" ? target.value : null,
    hostIsIp: target.kind === "url" && target.hostIsIp,
    verdict: { level, title, reasons },
    detectionScore: stats?.total ? { value: stats.malicious, suffix: `/${stats.total}`, percent: (stats.malicious / stats.total) * 100 } : null,
    reputation: vt?.found && typeof vt.reputation === "number" ? vt.reputation : null,
    highlights,
    panels: sources.map((s) => ({
      ...s,
      ...resultMeta(results[s.id]),
      rows: (s.id === "domainwhois" ? whoisRows : vtRows).filter(isRow),
    })),
    resolves,
    flagged,
    dnsRecords,
    certificate,
    popularity,
    redirects,
    vtNotFound: !!vt && !vt.found,
    vtQueued: vt?.status === "queued",
    allFailed: sources.length > 0 && failed.length === sources.length,
    sources: results,
  };
}
