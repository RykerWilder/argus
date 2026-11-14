import { useRef, useState } from "react";
import type { PointerEvent } from "react";
import { fmtShare, pieSummary, sliceCenter, slicePath } from "../../lib/report/categoryPie";
import type { PieSlice } from "../../lib/report/categoryPie";

// Drawing coordinates (viewBox): the pie takes almost the whole square; the remaining
// border is for the highlighted slice, which grows slightly.
const SIZE = 160;
const CENTER = SIZE / 2;
const RADIUS = 76;

interface Tip {
  x: number;
  y: number;
}

interface CategoryPieProps {
  slices: PieSlice[];
  /** Name of the highlighted slice (also from the list next to it), or null. */
  active: string | null;
  onActive: (name: string | null) => void;
}

/**
 * Pie of the categories. Each slice has its own tooltip (value and share) on hover and
 * with the keyboard; the same data is always in the list next to it.
 */
export default function CategoryPie({ slices, active, onActive }: CategoryPieProps) {
  const box = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);

  const pointerTip = (e: PointerEvent): Tip | null => {
    const rect = box.current?.getBoundingClientRect();
    return rect ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : null;
  };

  const focusTip = (slice: PieSlice): Tip | null => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return null;
    const [x, y] = sliceCenter(CENTER, CENTER, RADIUS, slice);
    const scale = rect.width / SIZE;
    return { x: x * scale, y: y * scale };
  };

  const hovered = slices.find((s) => s.name === active) ?? null;

  return (
    <div className="categories__pie" ref={box}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="group" aria-label={pieSummary(slices)}>
        {slices.map((s) => {
          const path = slicePath(CENTER, CENTER, RADIUS, s.start, s.end);
          const props = {
            className: `pie__slice${active === null ? "" : active === s.name ? " is-active" : " is-dim"}`,
            fill: s.color,
            tabIndex: 0,
            role: "img",
            "aria-label": `${s.name}: ${s.count} (${fmtShare(s.share)})`,
            onPointerEnter: (e: PointerEvent) => {
              onActive(s.name);
              setTip(pointerTip(e));
            },
            onPointerMove: (e: PointerEvent) => setTip(pointerTip(e)),
            onPointerLeave: () => {
              onActive(null);
              setTip(null);
            },
            onFocus: () => {
              onActive(s.name);
              setTip(focusTip(s));
            },
            onBlur: () => {
              onActive(null);
              setTip(null);
            },
          };
          return path ? <path key={s.name} d={path} {...props} /> : <circle key={s.name} cx={CENTER} cy={CENTER} r={RADIUS} {...props} />;
        })}
      </svg>
      {hovered && tip && (
        <div className="pie__tip" style={{ left: tip.x, top: tip.y }} role="presentation">
          <strong>
            {hovered.count} · {fmtShare(hovered.share)}
          </strong>
          <span>{hovered.members.length > 0 ? `${hovered.name} (${hovered.members.length} categories)` : hovered.name}</span>
        </div>
      )}
    </div>
  );
}
