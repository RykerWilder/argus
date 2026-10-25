// Impostazioni dell'utente, salvate solo in questo browser (localStorage).
// Più avanti verranno spostate in un database vero e proprio: il resto
// dell'app passa da queste funzioni, quindi basterà cambiare qui.
//
// - Preferenze: quali servizi interrogare. Tutti sono attivi di default.
// - Chiavi API: quelle inserite dall'utente. Il server non ne conserva: ogni
//   richiesta porta la chiave della fonte che interroga (header X-Argus-Api-Key).

const PREFS_KEY = "argus:preferences:v1";
const API_KEYS_KEY = "argus:api-keys:v1";

export const SETTINGS_EVENT = "argus:settings-changed";

/** Intestazione con cui la chiave API salvata viaggia verso il backend (vedi backend/routers/common.py). */
export const API_KEY_HEADER = "X-Argus-Api-Key";

/** Servizi che accettano una chiave API, con le istruzioni mostrate nella pagina. */
export const API_KEY_SERVICES = [
  {
    id: "abuseipdb",
    name: "AbuseIPDB",
    required: true,
    note: "Required for IP addresses. A free account gives 1,000 checks a day.",
    href: "https://www.abuseipdb.com/account/api",
  },
  {
    id: "proxycheck",
    name: "ProxyCheck.io",
    required: false,
    note: "Optional. Without a key the daily limit is lower (100 queries instead of 1,000).",
    href: "https://proxycheck.io/dashboard",
  },
  {
    id: "virustotal",
    name: "VirusTotal",
    required: true,
    note: "Required for domains and URLs. The free plan allows 4 requests a minute and 500 a day.",
    href: "https://www.virustotal.com/gui/my-apikey",
  },
];

function read(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage non disponibile (navigazione privata, spazio esaurito): le
    // impostazioni restano quelle di default.
  }
  window.dispatchEvent(new Event(SETTINGS_EVENT));
}

// ── Preferenze: servizi attivi ─────────────────────────────

/** Un servizio è attivo salvo che l'utente lo abbia disattivato. */
export function isServiceEnabled(id) {
  return read(PREFS_KEY).disabled?.includes?.(id) !== true;
}

export function setServiceEnabled(id, enabled) {
  const prefs = read(PREFS_KEY);
  const disabled = new Set(Array.isArray(prefs.disabled) ? prefs.disabled : []);
  if (enabled) disabled.delete(id);
  else disabled.add(id);
  write(PREFS_KEY, { ...prefs, disabled: [...disabled] });
}

// ── Chiavi API ─────────────────────────────────────────────

export function getApiKey(id) {
  const value = read(API_KEYS_KEY)[id];
  return typeof value === "string" ? value : "";
}

export function setApiKey(id, value) {
  const keys = read(API_KEYS_KEY);
  const clean = (value || "").trim();
  if (clean) keys[id] = clean;
  else delete keys[id];
  write(API_KEYS_KEY, keys);
}

/** Formato accettato dal backend: 8-256 caratteri tra lettere, cifre e . _ ~ + / = - */
export const API_KEY_PATTERN = /^[A-Za-z0-9._~+/=-]{8,256}$/;

// ── Ascolto delle modifiche (questa scheda e le altre) ─────

export function subscribeSettings(callback) {
  const onStorage = (e) => {
    if (e.key === PREFS_KEY || e.key === API_KEYS_KEY || e.key === null) callback();
  };
  window.addEventListener(SETTINGS_EVENT, callback);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(SETTINGS_EVENT, callback);
    window.removeEventListener("storage", onStorage);
  };
}
