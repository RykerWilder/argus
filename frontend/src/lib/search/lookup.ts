// Queries in parallel the sources suited to the lookup type (IP, domain or URL) and
// reports progress.

import type {
  Lookup,
  LookupResults,
  ResultStatus,
  Source,
  SourceData,
  SourceDataMap,
  SourceId,
  SourceResult,
  Target,
} from "../../types";
import { ApiError, postJson } from "../api";
import { isServiceEnabled } from "../user/settings";

// IP addresses
export const IP_SOURCES: Source[] = [
  { id: "iptracker", name: "ip-api.com", covers: "Location and connection" },
  { id: "proxycheck", name: "ProxyCheck.io", covers: "VPN, proxy and Tor detection" },
  { id: "abuseipdb", name: "AbuseIPDB", covers: "Abuse reports and connection type" },
  { id: "shodan", name: "Shodan", covers: "Open ports, services and known CVEs" },
];

// Domains and URLs
export const DOMAIN_SOURCES: Source[] = [
  { id: "domainwhois", endpoint: "domain-whois", name: "WHOIS", covers: "Registration, name servers and DNS" },
  { id: "virustotal", endpoint: "virustotal", name: "VirusTotal", covers: "Verdicts from 90+ security engines" },
];

export const SOURCE_NAMES = Object.fromEntries(
  [...IP_SOURCES, ...DOMAIN_SOURCES].map((s) => [s.id, s.name]),
) as Record<SourceId, string>;

/** The results present, without the sources not queried. */
export function resultList(results: LookupResults): SourceResult[] {
  return Object.values(results).filter((r): r is SourceResult => r !== undefined);
}

/** (source, result) pairs for the sources queried only. */
export function resultEntries(results: LookupResults): [SourceId, SourceResult][] {
  return (Object.entries(results) as [SourceId, SourceResult | undefined][]).filter(
    (e): e is [SourceId, SourceResult] => e[1] !== undefined,
  );
}

/** The body of a source's response, or null if it did not answer (or returned an error). */
export function dataOf<K extends SourceId>(results: LookupResults, id: K): SourceDataMap[K] | null {
  const r = results[id];
  return r?.status === "ok" ? (r.data as SourceDataMap[K]) : null;
}

/** Status, error and response time of a source, as they appear in the report panels. */
export function resultMeta(r: SourceResult | undefined): { status: ResultStatus; error?: string; ms?: number } {
  if (!r) return { status: "pending" };
  if (r.status === "pending") return { status: "pending" };
  return { status: r.status, error: r.status === "error" ? r.error : undefined, ms: r.ms };
}

// The sources to query for `target`: those suited to the lookup type that the user has
// not turned off in Settings (Settings > Preferences).
export function sourcesFor(target: Target): Source[] {
  let sources = DOMAIN_SOURCES;
  if (target.kind === "ip") sources = IP_SOURCES;
  // domain WHOIS makes no sense if the URL points to an IP address
  else if (target.kind === "url" && target.hostIsIp) sources = DOMAIN_SOURCES.filter((s) => s.id !== "domainwhois");
  return sources.filter((s) => isServiceEnabled(s.id));
}

function bodyFor(sourceId: SourceId, target: Target): Record<string, string> {
  if (target.kind === "ip") return { ip: target.value };
  if (sourceId === "domainwhois") return { domain: target.kind === "url" ? target.host : target.value };
  return { target: target.value, type: target.kind };
}

const CACHE_PREFIX = "argus:lookup:v2:";
const CACHE_TTL = 10 * 60 * 1000;
// A result with failed sources (missing key, rate limit, timeout) is not kept: it is only
// used to pass from the home page to the results page, then the next search queries the
// sources again.
const ERROR_TTL = 15 * 1000;
const memory = new Map<string, Lookup>();

// The key includes the active sources: if the user changes the preferences, a result
// saved with other sources is not reused.
const keyOf = (target: Target) => `${target.kind}:${target.value}:${sourcesFor(target).map((s) => s.id).join("+")}`;
// errors, or a VirusTotal analysis still queued: in both cases the next search must
// query the sources again
const hasErrors = (lookup: Lookup) =>
  resultList(lookup.results || {}).some(
    (r) => r.status === "error" || (r.status === "ok" && "status" in r.data && r.data.status === "queued"),
  );

function isFresh(lookup: Lookup): boolean {
  const age = Date.now() - lookup.finishedAt;
  return age < (hasErrors(lookup) ? ERROR_TTL : CACHE_TTL);
}

export function getCached(target: Target): Lookup | null {
  const key = keyOf(target);
  const hit = memory.get(key);
  if (hit) {
    if (isFresh(hit)) return hit;
    memory.delete(key);
  }
  try {
    const raw = sessionStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Lookup;
    if (!isFresh(parsed)) {
      sessionStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }
    memory.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

function setCached(target: Target, lookup: Lookup): void {
  const key = keyOf(target);
  memory.set(key, lookup);
  try {
    if (hasErrors(lookup)) sessionStorage.removeItem(CACHE_PREFIX + key);
    else sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify(lookup));
  } catch {
    // sessionStorage not available: the in-memory cache remains
  }
}

// Sources are queried for at most this long: VirusTotal can make several requests in a
// row and nginx waits for the backend up to 60 seconds.
const SOURCE_TIMEOUT = 65_000;

async function querySource(source: Source, target: Target, signal?: AbortSignal): Promise<SourceResult> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  // API keys do not travel from the browser: the backend uses the ones the user saved in
  // Settings (encrypted in the database, tied to their account).
  try {
    const data = await postJson<SourceData>(`/api/${source.endpoint || source.id}`, bodyFor(source.id, target), {
      signal,
      timeout: SOURCE_TIMEOUT,
    });
    return { status: "ok", data, ms: elapsed() };
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;  // AbortError: the search was cancelled
    return { status: "error", error: err.message, code: err.status, ms: elapsed() };
  }
}

export interface RunLookupOptions {
  onProgress?: (results: LookupResults) => void;
  signal?: AbortSignal;
}

export async function runLookup(target: Target, { onProgress, signal }: RunLookupOptions = {}): Promise<Lookup> {
  const sources = sourcesFor(target);
  const results: LookupResults = {};
  for (const s of sources) results[s.id] = { status: "pending" };
  onProgress?.({ ...results });

  await Promise.all(
    sources.map(async (source) => {
      results[source.id] = await querySource(source, target, signal);
      onProgress?.({ ...results });
    }),
  );

  const lookup: Lookup = { target, ip: target.kind === "ip" ? target.value : undefined, finishedAt: Date.now(), results };
  setCached(target, lookup);
  return lookup;
}
