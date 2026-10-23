// Interroga in parallelo le sorgenti adatte al tipo di ricerca (IP, dominio o
// URL) e notifica l'avanzamento.
//
// `enabled: false` esclude una sorgente senza toccarne la logica: l'endpoint
// /api/whois (RDAP per gli IP) resta nel backend e il codice del suo riquadro
// resta in report.js. Per riattivarla basta rimettere `true`.

export const SOURCES = [
  { id: "iptracker", name: "ip-api.com", covers: "Location and connection", enabled: true },
  { id: "proxycheck", name: "ProxyCheck.io", covers: "VPN, proxy and Tor detection", enabled: true },
  { id: "abuseipdb", name: "AbuseIPDB", covers: "Abuse reports and connection type", enabled: true },
  { id: "whois", name: "RDAP WHOIS", covers: "Who owns the address block", enabled: false },
];

export const ACTIVE_SOURCES = SOURCES.filter((s) => s.enabled);

// Domini e URL
export const DOMAIN_SOURCES = [
  { id: "domainwhois", endpoint: "domain-whois", name: "WHOIS", covers: "Registration, name servers and DNS" },
  { id: "virustotal", endpoint: "virustotal", name: "VirusTotal", covers: "Verdicts from 90+ security engines" },
];

export const SOURCE_NAMES = Object.fromEntries(
  [...SOURCES, ...DOMAIN_SOURCES].map((s) => [s.id, s.name]),
);

export function sourcesFor(target) {
  if (target.kind === "ip") return ACTIVE_SOURCES;
  // il WHOIS di dominio non ha senso se l'URL punta a un indirizzo IP
  if (target.kind === "url" && target.hostIsIp) return DOMAIN_SOURCES.filter((s) => s.id !== "domainwhois");
  return DOMAIN_SOURCES;
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

const keyOf = (target) => `${target.kind}:${target.value}`;
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

async function querySource(source, target, signal) {
  const started = performance.now();
  try {
    const res = await fetch(`/api/${source.endpoint || source.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyFor(source.id, target)),
      signal,
    });
    const body = await res.json().catch(() => ({}));
    const ms = Math.round(performance.now() - started);
    if (!res.ok) {
      const detail = typeof body.detail === "string" ? body.detail : `HTTP ${res.status}`;
      return { status: "error", error: detail, code: res.status, ms };
    }
    return { status: "ok", data: body, ms };
  } catch (err) {
    if (err.name === "AbortError") throw err;
    return {
      status: "error",
      error: "The backend could not be reached.",
      ms: Math.round(performance.now() - started),
    };
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
