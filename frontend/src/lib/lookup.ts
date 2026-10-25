// Interroga in parallelo le sorgenti adatte al tipo di ricerca (IP, dominio o
// URL) e notifica l'avanzamento.

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
} from "../types";
import { ApiError, postJson } from "./api";
import { API_KEY_HEADER, getApiKey, isServiceEnabled } from "./settings";

// Indirizzi IP
export const IP_SOURCES: Source[] = [
  { id: "iptracker", name: "ip-api.com", covers: "Location and connection" },
  { id: "proxycheck", name: "ProxyCheck.io", covers: "VPN, proxy and Tor detection" },
  { id: "abuseipdb", name: "AbuseIPDB", covers: "Abuse reports and connection type" },
];

// Domini e URL
export const DOMAIN_SOURCES: Source[] = [
  { id: "domainwhois", endpoint: "domain-whois", name: "WHOIS", covers: "Registration, name servers and DNS" },
  { id: "virustotal", endpoint: "virustotal", name: "VirusTotal", covers: "Verdicts from 90+ security engines" },
];

export const SOURCE_NAMES = Object.fromEntries(
  [...IP_SOURCES, ...DOMAIN_SOURCES].map((s) => [s.id, s.name]),
) as Record<SourceId, string>;

/** I risultati presenti, senza le fonti non interrogate. */
export function resultList(results: LookupResults): SourceResult[] {
  return Object.values(results).filter((r): r is SourceResult => r !== undefined);
}

/** Coppie (fonte, risultato) per le sole fonti interrogate. */
export function resultEntries(results: LookupResults): [SourceId, SourceResult][] {
  return (Object.entries(results) as [SourceId, SourceResult | undefined][]).filter(
    (e): e is [SourceId, SourceResult] => e[1] !== undefined,
  );
}

/** Il corpo della risposta di una fonte, oppure null se non ha risposto (o ha dato errore). */
export function dataOf<K extends SourceId>(results: LookupResults, id: K): SourceDataMap[K] | null {
  const r = results[id];
  return r?.status === "ok" ? (r.data as SourceDataMap[K]) : null;
}

/** Stato, errore e tempo di risposta di una fonte, come compaiono nei riquadri del report. */
export function resultMeta(r: SourceResult | undefined): { status: ResultStatus; error?: string; ms?: number } {
  if (!r) return { status: "pending" };
  if (r.status === "pending") return { status: "pending" };
  return { status: r.status, error: r.status === "error" ? r.error : undefined, ms: r.ms };
}

// Le fonti da interrogare per `target`: quelle adatte al tipo di ricerca che
// l'utente non ha disattivato nelle impostazioni (Settings > Preferences).
export function sourcesFor(target: Target): Source[] {
  let sources = DOMAIN_SOURCES;
  if (target.kind === "ip") sources = IP_SOURCES;
  // il WHOIS di dominio non ha senso se l'URL punta a un indirizzo IP
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
// Un risultato con fonti in errore (chiave mancante, rate limit, timeout) non
// viene conservato: serve solo per il passaggio dalla home alla pagina dei
// risultati, poi la ricerca successiva interroga di nuovo le fonti.
const ERROR_TTL = 15 * 1000;
const memory = new Map<string, Lookup>();

// La chiave include le fonti attive: se l'utente cambia le preferenze, un
// risultato salvato con altre fonti non viene riusato.
const keyOf = (target: Target) => `${target.kind}:${target.value}:${sourcesFor(target).map((s) => s.id).join("+")}`;
// errori, oppure un'analisi VirusTotal ancora in coda: in entrambi i casi la
// ricerca successiva deve interrogare di nuovo le fonti
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
    // sessionStorage non disponibile: resta la cache in memoria
  }
}

// Le fonti si interrogano al massimo per questo tempo: VirusTotal può fare più
// richieste di fila e nginx aspetta il backend fino a 60 secondi.
const SOURCE_TIMEOUT = 65_000;

async function querySource(source: Source, target: Target, signal?: AbortSignal): Promise<SourceResult> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  // La chiave API salvata in Settings per questa fonte viaggia con la richiesta:
  // il server non ne ha di sue.
  const apiKey = getApiKey(source.id);
  const headers = apiKey ? { [API_KEY_HEADER]: apiKey } : undefined;
  try {
    const data = await postJson<SourceData>(`/api/${source.endpoint || source.id}`, bodyFor(source.id, target), {
      headers,
      signal,
      timeout: SOURCE_TIMEOUT,
    });
    return { status: "ok", data, ms: elapsed() };
  } catch (err) {
    if (!(err instanceof ApiError)) throw err; // AbortError: la ricerca è stata annullata
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
