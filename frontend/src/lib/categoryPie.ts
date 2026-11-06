// Logica del grafico a torta delle categorie dei report di AbuseIPDB.
//
// Una torta si legge bene con poche fette: al massimo MAX_SLICES, le altre
// categorie si uniscono in "Other" (grigio). I colori sono assegnati nell'ordine
// delle fette, mai ciclati, e sono definiti nel CSS (--pie-1 ... --pie-other):
// sono la palette di Argus, una rampa del mint dell'accento dal chiaro allo scuro
// (le fette sono ordinate per numero, quindi la luminosità segue l'ordine) più il
// grigio di "Other". La rampa è validata sullo sfondo scuro di Argus (passi
// distinti, contrasto >= 3:1). Il grafico non è mai l'unico canale: ogni
// categoria ha il suo nome e il suo numero nella lista accanto e nel tooltip.

import type { AbuseCategory } from "../types";

export const MAX_SLICES = 6;
export const OTHER_NAME = "Other";
export const OTHER_COLOR = "var(--pie-other)";
const SLOT_COLORS = ["var(--pie-1)", "var(--pie-2)", "var(--pie-3)", "var(--pie-4)", "var(--pie-5)"];

export interface PieSlice {
  name: string;
  count: number;
  /** Quota del totale, tra 0 e 1. */
  share: number;
  /** Inizio e fine della fetta, come frazione del giro (0 = ore 12, in senso orario). */
  start: number;
  end: number;
  color: string;
  /** Le categorie unite in "Other"; vuoto per una fetta che è una categoria sola. */
  members: string[];
}

/** Le fette, dalla più grande: al massimo MAX_SLICES, la coda finisce in "Other". */
export function pieSlices(items: AbuseCategory[]): PieSlice[] {
  const valid = items
    .filter((c) => c && typeof c.name === "string" && Number.isFinite(c.count) && c.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const total = valid.reduce((sum, c) => sum + c.count, 0);
  if (total === 0) return [];

  // 5 fette colorate più una grigia: la grigia è "Other", o l'unica categoria rimasta fuori
  const head = valid.slice(0, MAX_SLICES - 1);
  const tail = valid.slice(MAX_SLICES - 1);
  const parts: Pick<PieSlice, "name" | "count" | "color" | "members">[] = head.map((c, i) => ({
    name: c.name,
    count: c.count,
    color: SLOT_COLORS[i],
    members: [],
  }));
  if (tail.length === 1) parts.push({ name: tail[0].name, count: tail[0].count, color: OTHER_COLOR, members: [] });
  else if (tail.length > 1) {
    parts.push({ name: OTHER_NAME, count: tail.reduce((s, c) => s + c.count, 0), color: OTHER_COLOR, members: tail.map((c) => c.name) });
  }

  let acc = 0;
  return parts.map((p) => {
    const start = acc / total;
    acc += p.count;
    return { ...p, share: p.count / total, start, end: acc / total };
  });
}

/** Per ogni categoria, la fetta che la rappresenta e il suo colore (anche per quelle unite in "Other"). */
export function legendFor(slices: PieSlice[]): Map<string, { slice: string; color: string }> {
  const out = new Map<string, { slice: string; color: string }>();
  for (const s of slices) {
    for (const name of s.members.length ? s.members : [s.name]) out.set(name, { slice: s.name, color: s.color });
  }
  return out;
}

/** "35%", oppure "<1%" per le quote che arrotondate sarebbero 0. */
export function fmtShare(share: number): string {
  const pct = Math.round(share * 100);
  return pct === 0 && share > 0 ? "<1%" : `${pct}%`;
}

const num = (n: number) => n.toFixed(2);

/**
 * Il tracciato SVG di una fetta (settore) con centro (cx, cy) e raggio r, dalla
 * frazione `start` alla frazione `end` del giro. Una fetta che copre tutto il
 * cerchio non ha un tracciato valido come arco: restituisce null (si disegna un cerchio).
 */
export function slicePath(cx: number, cy: number, r: number, start: number, end: number): string | null {
  if (end - start >= 0.9999) return null;
  const point = (f: number): [number, number] => {
    const angle = f * 2 * Math.PI - Math.PI / 2;
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  };
  const [x0, y0] = point(start);
  const [x1, y1] = point(end);
  const large = end - start > 0.5 ? 1 : 0;
  return `M${num(cx)},${num(cy)}L${num(x0)},${num(y0)}A${num(r)},${num(r)} 0 ${large} 1 ${num(x1)},${num(y1)}Z`;
}

/** Il punto a metà della fetta, a `depth` volte il raggio dal centro (per ancorare il tooltip con la tastiera). */
export function sliceCenter(cx: number, cy: number, r: number, slice: Pick<PieSlice, "start" | "end">, depth = 0.6): [number, number] {
  const angle = ((slice.start + slice.end) / 2) * 2 * Math.PI - Math.PI / 2;
  return [cx + r * depth * Math.cos(angle), cy + r * depth * Math.sin(angle)];
}

/** La descrizione a parole del grafico, per chi usa uno screen reader. */
export function pieSummary(slices: PieSlice[]): string {
  if (slices.length === 0) return "No report categories.";
  return `Reports by category: ${slices.map((s) => `${s.name} ${s.count} (${fmtShare(s.share)})`).join(", ")}.`;
}
