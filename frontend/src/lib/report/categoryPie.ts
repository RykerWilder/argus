// Logic of the pie chart of AbuseIPDB report categories.
//
// A pie reads well with few slices: at most MAX_SLICES, the other categories are merged
// into "Other" (gray). Colors are assigned in slice order, never cycled, and are defined
// in the CSS (--pie-1 ... --pie-other): they are the Argus palette, a ramp of the accent
// mint from light to dark (slices are sorted by count, so lightness follows the order)
// plus the gray of "Other". The ramp is validated on Argus's dark background (distinct
// steps, contrast >= 3:1). The chart is never the only channel: each category has its
// name and number in the list next to it and in the tooltip.

import type { AbuseCategory } from "../../types";

export const MAX_SLICES = 6;
export const OTHER_NAME = "Other";
export const OTHER_COLOR = "var(--pie-other)";
const SLOT_COLORS = ["var(--pie-1)", "var(--pie-2)", "var(--pie-3)", "var(--pie-4)", "var(--pie-5)"];

export interface PieSlice {
  name: string;
  count: number;
  /** Share of the total, between 0 and 1. */
  share: number;
  /** Start and end of the slice, as a fraction of the turn (0 = 12 o'clock, clockwise). */
  start: number;
  end: number;
  color: string;
  /** The categories merged into "Other"; empty for a slice that is a single category. */
  members: string[];
}

/** The slices, from the largest: at most MAX_SLICES, the tail ends up in "Other". */
export function pieSlices(items: AbuseCategory[]): PieSlice[] {
  const valid = items
    .filter((c) => c && typeof c.name === "string" && Number.isFinite(c.count) && c.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const total = valid.reduce((sum, c) => sum + c.count, 0);
  if (total === 0) return [];

  // 5 colored slices plus a gray one: the gray is "Other", or the only category left out
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

/** For each category, the slice that represents it and its color (also for those merged into "Other"). */
export function legendFor(slices: PieSlice[]): Map<string, { slice: string; color: string }> {
  const out = new Map<string, { slice: string; color: string }>();
  for (const s of slices) {
    for (const name of s.members.length ? s.members : [s.name]) out.set(name, { slice: s.name, color: s.color });
  }
  return out;
}

/** "35%", or "<1%" for shares that would round to 0. */
export function fmtShare(share: number): string {
  const pct = Math.round(share * 100);
  return pct === 0 && share > 0 ? "<1%" : `${pct}%`;
}

const num = (n: number) => n.toFixed(2);

/**
 * The SVG path of a slice (sector) with center (cx, cy) and radius r, from fraction
 * `start` to fraction `end` of the turn. A slice covering the whole circle has no valid
 * arc path: returns null (a circle is drawn).
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

/** The midpoint of the slice, at `depth` times the radius from the center (to anchor the tooltip with the keyboard). */
export function sliceCenter(cx: number, cy: number, r: number, slice: Pick<PieSlice, "start" | "end">, depth = 0.6): [number, number] {
  const angle = ((slice.start + slice.end) / 2) * 2 * Math.PI - Math.PI / 2;
  return [cx + r * depth * Math.cos(angle), cy + r * depth * Math.sin(angle)];
}

/** The chart described in words, for screen reader users. */
export function pieSummary(slices: PieSlice[]): string {
  if (slices.length === 0) return "No report categories.";
  return `Reports by category: ${slices.map((s) => `${s.name} ${s.count} (${fmtShare(s.share)})`).join(", ")}.`;
}
