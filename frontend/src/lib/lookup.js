// Interroga in parallelo le sorgenti adatte al tipo di ricerca (IP, dominio o
// URL) e notifica l'avanzamento.

import { ApiError, postJson } from "./api";
import { API_KEY_HEADER, getApiKey, isServiceEnabled } from "./settings";

// Indirizzi IP
export const IP_SOURCES = [
  { id: "iptracker", name: "ip-api.com", covers: "Location and connection" },
  { id: "proxycheck", name: "ProxyCheck.io", covers: "VPN, proxy and Tor detection" },
  { id: "abuseipdb", name: "AbuseIPDB", covers: "Abuse reports and connection type" },
];

// Domini e URL
export const DOMAIN_SOURCES = [
  { id: "domainwhois", endpoint: "domain-whois", name: "WHOIS", covers: "Registration, name servers and DNS" },
  { id: "virustotal", endpoint: "virustotal", name: "VirusTotal", covers: "Verdicts from 90+ security engines" },
];

export const SOURCE_NAMES = Object.fromEntries(
  [...IP_SOURCES, ...DOMAIN_SOURCES].map((s) => [s.id, s.name]),
);

// Le fonti da interrogare per `target`: quelle adatte al tipo di ricerca che
// l'utente non ha disattivato nelle impostazioni (Settings > Preferences).
export function sourcesFor(target) {
  let sources = DOMAIN_SOURCES;
  if (target.kind === "ip") sources = IP_SOURCES;
  // il WHOIS di dominio non ha senso se l'URL punta a un indirizzo IP
  else if (target.kind === "url" && target.hostIsIp) sources = DOMAIN_SOURCES.filter((s) => s.id !== "domainwhois");
  return sources.filter((s) => isServiceEnabled(s.id));
}

function bodyFor(sourceId, target) {
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
const memory = new Map();

// La chiave include le fonti attive: se l'utente cambia le preferenze, un
// risultato salvato con altre fonti non viene riusato.
const keyOf = (target) => `${target.kind}:${target.value}:${sourcesFor(target).map((s) => s.id).join("+")}`;
// errori, oppure un'analisi VirusTotal ancora in coda: in entrambi i casi la
// ricerca successiva deve interrogare di nuovo le fonti
const hasErrors = (lookup) =>
  Object.values(lookup.results || {}).some((r) => r.status === "error" || r.data?.status === "queued");

function isFresh(lookup) {
  const age = Date.now() - lookup.finishedAt;
  return age < (hasErrors(lookup) ? ERROR_TTL : CACHE_TTL);
}

export function getCached(target) {
  const key = keyOf(target);
  const hit = memory.get(key);
  if (hit) {
    if (isFresh(hit)) return hit;
    memory.delete(key);
  }
  try {
    const raw = sessionStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
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

function setCached(target, lookup) {
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

async function querySource(source, target, signal) {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  // Se l'utente ha salvato una chiave API per questa fonte, il backend usa
  // quella al posto della chiave di .env.
  const apiKey = getApiKey(source.id);
  const headers = apiKey ? { [API_KEY_HEADER]: apiKey } : undefined;
  try {
    const data = await postJson(`/api/${source.endpoint || source.id}`, bodyFor(source.id, target), {
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

/** target: { kind: "ip" | "domain" | "url", value, host?, hostIsIp? } */
export async function runLookup(target, { onProgress, signal } = {}) {
  const sources = sourcesFor(target);
  const results = Object.fromEntries(sources.map((s) => [s.id, { status: "pending" }]));
  onProgress?.({ ...results });

  await Promise.all(
    sources.map(async (source) => {
      results[source.id] = await querySource(source, target, signal);
      onProgress?.({ ...results });
    }),
  );

  const lookup = { target, ip: target.kind === "ip" ? target.value : undefined, finishedAt: Date.now(), results };
  setCached(target, lookup);
  return lookup;
}
