// Cronologia delle ricerche, salvata solo nel browser (localStorage).
// Nessun database: ogni browser ha la sua cronologia e cancellare i dati del
// sito la azzera. Una voce per indicatore (tipo + valore); ripetere una
// ricerca aggiorna verdetto, riepilogo e data e incrementa il contatore.

const STORE_KEY = "argus:history:v1";
const MAX_ENTRIES = 200;
export const HISTORY_EVENT = "argus:history-changed";

function load() {
  try {
    const list = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function save(list) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(0, MAX_ENTRIES)));
  } catch {
    // spazio esaurito o storage bloccato: la cronologia resta com'era
  }
  window.dispatchEvent(new Event(HISTORY_EVENT));
}

const byRecent = (a, b) => (a.lastSearchedAt < b.lastSearchedAt ? 1 : a.lastSearchedAt > b.lastSearchedAt ? -1 : b.id - a.id);

// ricerche già registrate: in memoria e in sessionStorage, così ricaricare la
// pagina di un risultato preso dalla cache non conta come nuova ricerca
const recorded = new Set();
const SEEN_KEY = "argus:history:recorded";
function seen(key) {
  if (recorded.has(key)) return true;
  try {
    return JSON.parse(sessionStorage.getItem(SEEN_KEY) || "[]").includes(key);
  } catch {
    return false;
  }
}
function markSeen(key) {
  recorded.add(key);
  try {
    const list = JSON.parse(sessionStorage.getItem(SEEN_KEY) || "[]");
    list.push(key);
    sessionStorage.setItem(SEEN_KEY, JSON.stringify(list.slice(-200)));
  } catch {
    // sessionStorage non disponibile: resta il controllo in memoria
  }
}

function summaryFor(target, report) {
  const hl = Object.fromEntries((report.highlights || []).map((h) => [h.key, h]));
  if (target.kind === "ip") {
    const place = [hl.location?.value, hl.location?.sub].filter(Boolean).join(", ");
    return [place, hl.isp?.value, hl.vpn?.detected ? hl.vpn.value : null].filter(Boolean).join(" · ") || null;
  }
  const det = hl.detections?.value;
  const detText = det && /^\d+ \/ \d+$/.test(det) ? `${det} engines` : det || null;
  return [hl.registrar?.value, detText].filter(Boolean).join(" · ") || null;
}

/**
 * Registra una ricerca appena completata. Si chiama quando il report è pronto:
 * ogni ricerca (identificata dall'orario di fine) viene registrata una sola volta,
 * anche se la pagina si ridisegna o il risultato arriva dalla cache.
 */
export function recordSearch(target, report, lookup) {
  if (!target || !report || !lookup) return;
  const key = `${target.kind}:${target.value}:${lookup.finishedAt}`;
  if (seen(key)) return;
  markSeen(key);
  const results = Object.values(lookup.results || {});
  if (!results.length || results.every((r) => r.status === "error")) return;

  const now = new Date().toISOString();
  const list = load();
  const fields = {
    verdictLevel: report.verdict?.level || "unknown",
    verdictTitle: report.verdict?.title || null,
    summary: (summaryFor(target, report) || "").slice(0, 300) || null,
    lastSearchedAt: now,
  };
  const existing = list.find((e) => e.kind === target.kind && e.value === target.value);
  if (existing) {
    Object.assign(existing, fields, { times: (existing.times || 1) + 1 });
  } else {
    const id = list.reduce((m, e) => Math.max(m, e.id || 0), 0) + 1;
    list.push({ id, kind: target.kind, value: target.value, firstSearchedAt: now, times: 1, ...fields });
  }
  save(list.sort(byRecent));
}

export async function fetchHistory(kind) {
  const list = load().sort(byRecent);
  const counts = {};
  for (const e of list) counts[e.kind] = (counts[e.kind] || 0) + 1;
  return { entries: kind ? list.filter((e) => e.kind === kind) : list, counts };
}

export async function deleteHistoryEntry(id) {
  save(load().filter((e) => e.id !== id));
  return { deleted: id };
}

export async function clearHistory() {
  const n = load().length;
  save([]);
  return { deleted: n };
}
