// Search history, saved in the browser only (localStorage). No database: each browser has
// its own history and clearing the site's data resets it. One entry per indicator
// (type + value); repeating a search updates verdict, summary and date and increments
// the counter.

import type { HistoryData, HistoryEntry, Lookup, Report, Target, TargetKind } from "../../types";
import { resultList } from "./lookup";

const STORE_KEY = "argus:history:v1";
const MAX_ENTRIES = 200;
export const HISTORY_EVENT = "argus:history-changed";

function load(): HistoryEntry[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
    return Array.isArray(list) ? (list as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function save(list: HistoryEntry[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(0, MAX_ENTRIES)));
  } catch {
    // storage full or blocked: the history stays as it was
  }
  window.dispatchEvent(new Event(HISTORY_EVENT));
}

const byRecent = (a: HistoryEntry, b: HistoryEntry): number => (a.lastSearchedAt < b.lastSearchedAt ? 1 : a.lastSearchedAt > b.lastSearchedAt ? -1 : b.id - a.id);

// searches already recorded: in memory and in sessionStorage, so reloading a result
// page taken from the cache does not count as a new search
const recorded = new Set<string>();
const SEEN_KEY = "argus:history:recorded";
function seen(key: string): boolean {
  if (recorded.has(key)) return true;
  try {
    return JSON.parse(sessionStorage.getItem(SEEN_KEY) || "[]").includes(key);
  } catch {
    return false;
  }
}
function markSeen(key: string): void {
  recorded.add(key);
  try {
    const list = JSON.parse(sessionStorage.getItem(SEEN_KEY) || "[]");
    list.push(key);
    sessionStorage.setItem(SEEN_KEY, JSON.stringify(list.slice(-200)));
  } catch {
    // sessionStorage not available: the in-memory check remains
  }
}

function summaryFor(target: Target, report: Report): string | null {
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
 * Records a search that has just completed. Called when the report is ready: each search
 * (identified by its end time) is recorded only once, even if the page redraws or the
 * result comes from the cache.
 */
export function recordSearch(target: Target | null, report: Report | null, lookup: Lookup | null): void {
  if (!target || !report || !lookup) return;
  const key = `${target.kind}:${target.value}:${lookup.finishedAt}`;
  if (seen(key)) return;
  markSeen(key);
  const results = resultList(lookup.results || {});
  if (!results.length || results.every((r) => r.status === "error")) return;

  const now = new Date().toISOString();
  const list = load();
  const fields: Pick<HistoryEntry, "verdictLevel" | "verdictTitle" | "summary" | "lastSearchedAt"> = {
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

export async function fetchHistory(kind?: TargetKind | null): Promise<HistoryData> {
  const list = load().sort(byRecent);
  const counts: HistoryData["counts"] = {};
  for (const e of list) counts[e.kind] = (counts[e.kind] || 0) + 1;
  return { entries: kind ? list.filter((e) => e.kind === kind) : list, counts };
}

export async function deleteHistoryEntry(id: number): Promise<{ deleted: number }> {
  save(load().filter((e) => e.id !== id));
  return { deleted: id };
}

export async function clearHistory(): Promise<{ deleted: number }> {
  const n = load().length;
  save([]);
  return { deleted: n };
}
