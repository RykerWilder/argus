// User settings.
//
// - Search preferences: which services to query. All are on by default. They live on the
//   server, in the database, tied to the user: they follow them in any browser. Here there
//   is an in-memory copy, loaded at startup (loadPreferences), so isServiceEnabled stays
//   synchronous. Search history, instead, stays in the browser (history.ts).
// - API keys: they live on the server, encrypted and tied to the signed-in user (see
//   account.ts). Only the list of services and the accepted format remain here.

import { putJson, request } from "../api";
import type { SourceId } from "../../types";

/** Where earlier versions kept the preferences (in the browser): see migrateLegacyPreferences. */
const LEGACY_PREFS_KEY = "argus:preferences:v1";

/** Where earlier versions of Argus kept the API keys (in clear, in the browser): see migrateLegacyKeys. */
export const LEGACY_API_KEYS_KEY = "argus:api-keys:v1";

export const SETTINGS_EVENT = "argus:settings-changed";

export interface ApiKeyService {
  id: SourceId;
  name: string;
  required: boolean;
  note: string;
  href: string;
}

/** Services that accept an API key, with the instructions shown on the page. */
export const API_KEY_SERVICES: ApiKeyService[] = [
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

/** How preferences travel to and from the server (GET/PUT /api/preferences). */
interface ServerPreferences {
  disabledSources: string[];
}

/** Services the user turned off. Empty until the preferences arrive from the server. */
let disabled = new Set<string>();

// One save at a time, in order: each sends the state of that moment, so with several
// switches pressed quickly the last one always wins.
let saving: Promise<unknown> = Promise.resolve();

function apply(next: Iterable<string>): void {
  disabled = new Set(next);
  window.dispatchEvent(new Event(SETTINGS_EVENT));
}

/** A service is on unless the user turned it off. */
export function isServiceEnabled(id: string): boolean {
  return !disabled.has(id);
}

/**
 * Earlier versions kept the preferences in localStorage. If the server has no choice from
 * the user yet they move there; in any case they are deleted from the browser, but only if
 * everything went well: on error they stay and it is retried on the next visit.
 */
async function migrateLegacyPreferences(server: ServerPreferences): Promise<ServerPreferences> {
  let legacy: string[] = [];
  try {
    const raw = localStorage.getItem(LEGACY_PREFS_KEY);
    if (raw === null) return server;
    const parsed: unknown = JSON.parse(raw);
    const list = (parsed as { disabled?: unknown } | null)?.disabled;
    if (Array.isArray(list)) legacy = list.filter((v): v is string => typeof v === "string");
  } catch {
    // unreadable content: nothing to move, but it is removed
  }

  try {
    let result = server;
    if (server.disabledSources.length === 0 && legacy.length > 0) {
      result = await putJson<ServerPreferences>("/api/preferences", { disabledSources: legacy });
    }
    localStorage.removeItem(LEGACY_PREFS_KEY);
    return result;
  } catch {
    return server;  // the preferences stay in the browser, retried on the next visit
  }
}

let migrated = false;
let watching = false;

/**
 * When the tab becomes visible again the preferences are re-read: a change made elsewhere
 * (another browser, another tab) arrives here too. Any save in progress is awaited, so as
 * not to restore the old state.
 */
function watchVisibility(): void {
  if (watching || typeof document === "undefined") return;
  watching = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    saving
      .catch(() => undefined)
      .then(() => loadPreferences())
      .catch(() => undefined);
  });
}

/**
 * Loads the preferences from the server. If it fails the existing ones stay (at the start:
 * all services on) and the error reaches the caller.
 */
export async function loadPreferences(): Promise<void> {
  let server = await request<ServerPreferences>("/api/preferences", { timeout: 8_000 });
  if (!migrated) {
    migrated = true;
    server = await migrateLegacyPreferences(server);
  }
  apply(server.disabledSources);
  watchVisibility();
}

function persist(): Promise<unknown> {
  const run = () => putJson<ServerPreferences>("/api/preferences", { disabledSources: [...disabled] });
  saving = saving.then(run, run);
  return saving;
}

/**
 * Turns a service on or off. The change shows immediately and is saved on the server; if
 * the save fails it goes back to what the server has and the error reaches the caller.
 */
export async function setServiceEnabled(id: string, enabled: boolean): Promise<void> {
  const previous = disabled;
  const next = new Set(disabled);
  if (enabled) next.delete(id);
  else next.add(id);
  apply(next);
  try {
    await persist();
  } catch (err) {
    const refreshed = await loadPreferences().then(() => true, () => false);
    if (!refreshed) apply(previous);
    throw err;
  }
}

/** Format accepted by the backend: 8-256 characters among letters, digits and . _ ~ + / = - */
export const API_KEY_PATTERN = /^[A-Za-z0-9._~+/=-]{8,256}$/;

export function subscribeSettings(callback: () => void): () => void {
  window.addEventListener(SETTINGS_EVENT, callback);
  return () => window.removeEventListener(SETTINGS_EVENT, callback);
}
