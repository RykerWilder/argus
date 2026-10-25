import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { AbuseReport, DailyCount } from "../types";
import { countryName } from "../lib/countries";

// Timeline dei report AbuseIPDB: una linea con i report per giorno.
// Passando sopra il grafico il mirino segue il giorno più vicino; cliccando un
// punto (o con le frecce della tastiera) si vedono i report di quel giorno:
// chi li ha inviati, quando, le categorie e la descrizione.

const FULL_HEIGHT = 220;
const COMPACT_HEIGHT = 170;
const M = { top: 14, right: 14, bottom: 28, left: 40 };

const DAY_FMT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const FULL_FMT = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const TIME_FMT = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const plural = (n: number, w: string) => `${n.toLocaleString("en-US")} ${w}${n === 1 ? "" : "s"}`;

// passo "pulito" per l'asse Y (1, 2, 5, 10, 20, 50…), circa 4 tacche
function niceStep(max: number): number {
  if (max <= 4) return 1;
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * pow).find((st) => st >= raw) ?? 10 * pow;
}

type Pt = [number, number];

// Curva B-spline uniforme (come d3.curveBasis): parte e arriva sugli estremi
// e smussa tutti i punti intermedi.
function basisPath(p: Pt[]): string {
  if (!p.length) return "";
  if (p.length < 3) return p.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join("");
  const f = (v: number) => v.toFixed(1);
  let d = `M${f(p[0][0])},${f(p[0][1])}`;
  d += `L${f((5 * p[0][0] + p[1][0]) / 6)},${f((5 * p[0][1] + p[1][1]) / 6)}`;
  for (let i = 2; i < p.length; i++) {
    const [x0, y0] = p[i - 2];
    const [x1, y1] = p[i - 1];
    const [x2, y2] = p[i];
    d += `C${f((2 * x0 + x1) / 3)},${f((2 * y0 + y1) / 3)} ${f((x0 + 2 * x1) / 3)},${f((y0 + 2 * y1) / 3)} ${f((x0 + 4 * x1 + x2) / 6)},${f((y0 + 4 * y1 + y2) / 6)}`;
  }
  const [xa, ya] = p[p.length - 2];
  const [xb, yb] = p[p.length - 1];
  d += `C${f((2 * xa + xb) / 3)},${f((2 * ya + yb) / 3)} ${f((xa + 2 * xb) / 3)},${f((ya + 2 * yb) / 3)} ${f((xa + 5 * xb) / 6)},${f((ya + 5 * yb) / 6)}`;
  d += `L${f(xb)},${f(yb)}`;
  return d;
}

// altezza della curva in corrispondenza del punto i
function basisY(p: Pt[], i: number): number {
  if (i <= 0 || i >= p.length - 1) return p[Math.max(0, Math.min(p.length - 1, i))][1];
  return (p[i - 1][1] + 4 * p[i][1] + p[i + 1][1]) / 6;
}

function compact(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n % 1000 ? 1 : 0)}K` : String(n);
}

interface ReportTimelineProps {
  daily: DailyCount[];
  reports: AbuseReport[];
  /** Report effettivamente restituiti da AbuseIPDB. */
  received: number;
  /** Report totali secondo AbuseIPDB. */
  total: number;
  days: number;
  compact?: boolean;
  /** Mostra i report come elenco invece che come grafico. */
  asList?: boolean;
}

export default function ReportTimeline({ daily, reports, received, total, days, compact: isCompact = false, asList = false }: ReportTimelineProps) {
  const HEIGHT = isCompact ? COMPACT_HEIGHT : FULL_HEIGHT;
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(720);
  const [hover, setHover] = useState<number | null>(null); // indice del giorno
  const [selected, setSelected] = useState<number | null>(() => {
    for (let i = daily.length - 1; i >= 0; i--) if (daily[i].count > 0) return i;
    return null;
  });

  // Larghezza del grafico. Il contenitore sparisce in vista elenco e torna con
  // la timeline: si osserva il nodo nuovo a ogni ritorno e si ignorano le
  // misure a 0 di un nodo appena rimosso (era questo a rimpicciolire il grafico).
  useEffect(() => {
    if (asList) return;
    const el = wrapRef.current;
    if (!el) return;
    const measure = (w: number) => {
      if (w > 0) setWidth(Math.max(280, Math.round(w)));
    };
    measure(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => measure(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [asList]);

  // Dopo un clic sul grafico, il dettaglio del giorno viene portato in vista.
  const detailRef = useRef<HTMLDivElement>(null);
  const scrollOnSelect = useRef(false);
  const choose = (i: number) => {
    scrollOnSelect.current = true;
    setSelected(i);
  };

  // report raggruppati per giorno UTC
  const byDay = useMemo(() => {
    const map = new Map<string, AbuseReport[]>();
    for (const r of reports) {
      const day = String(r.reportedAt || "").slice(0, 10);
      const iso = new Date(r.reportedAt);
      const key = Number.isNaN(iso.getTime()) ? day : iso.toISOString().slice(0, 10);
      const list = map.get(key) ?? [];
      list.push(r);
      map.set(key, list);
    }
    return map;
  }, [reports]);

  const innerW = width - M.left - M.right;
  const innerH = HEIGHT - M.top - M.bottom;
  const maxCount = Math.max(0, ...daily.map((d) => d.count));
  const yStep = niceStep(maxCount);
  const yMax = Math.max(yStep, Math.ceil(maxCount / yStep) * yStep);
  // con poco spazio per giorno si mostrano solo il punto selezionato e quello sotto il mouse
  const denseDots = (width - M.left - M.right) / Math.max(1, daily.length) < 9;
  const x = (i: number) => M.left + (daily.length > 1 ? (i / (daily.length - 1)) * innerW : innerW / 2);
  const y = (v: number) => M.top + innerH - (v / yMax) * innerH;

  const yTicks = useMemo(
    () => Array.from({ length: yMax / yStep + 1 }, (_, k) => k * yStep),
    [yMax, yStep],
  );

  const xTicks = useMemo(() => {
    const count = width < 520 ? 3 : 6;
    const idx = Array.from({ length: count }, (_, k) => Math.round((k / (count - 1)) * (daily.length - 1)));
    return [...new Set(idx)];
  }, [daily.length, width]);

  // Linea morbida (B-spline uniforme): niente punte, onde continue. La curva
  // passa vicino ai valori senza toccarli; i punti stanno sulla curva e il
  // valore esatto resta nel tooltip e nel dettaglio del giorno.
  const pts = daily.map((d, i): Pt => [x(i), y(d.count)]);
  const path = basisPath(pts);
  const area = `${path}L${x(daily.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`;
  const curveY = (i: number) => basisY(pts, i);
  const activeDays = daily.map((d, i) => (d.count > 0 ? i : -1)).filter((i) => i >= 0);

  function indexAt(clientX: number): number {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const px = ((clientX - rect.left) / rect.width) * width;
    const t = (px - M.left) / innerW;
    return Math.max(0, Math.min(daily.length - 1, Math.round(t * (daily.length - 1))));
  }

  function nearestActive(i: number): number | null {
    if (!activeDays.length) return null;
    return activeDays.reduce((best, d) => (Math.abs(d - i) < Math.abs(best - i) ? d : best), activeDays[0]);
  }

  function onKeyDown(e: ReactKeyboardEvent<SVGSVGElement>) {
    if (!activeDays.length) return;
    const pos = selected === null ? -1 : activeDays.indexOf(selected);
    let next: number | null = null;
    if (e.key === "ArrowLeft") next = activeDays[Math.max(0, (pos === -1 ? activeDays.length : pos) - 1)];
    if (e.key === "ArrowRight") next = activeDays[Math.min(activeDays.length - 1, pos + 1)];
    if (e.key === "Home") next = activeDays[0];
    if (e.key === "End") next = activeDays[activeDays.length - 1];
    if (next !== null && next !== undefined) {
      e.preventDefault();
      setSelected(next); // da tastiera il fuoco resta sul grafico
    }
  }

  useEffect(() => {
    if (!scrollOnSelect.current) return;
    scrollOnSelect.current = false;
    const el = detailRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.top > window.innerHeight - 120 || rect.top < 0) {
      el.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
    }
  }, [selected]);

  const sel = selected !== null ? daily[selected] : null;
  const selReports = sel ? byDay.get(sel.date) || [] : [];
  const hoverDay = hover !== null ? daily[hover] : null;
  const tipLeft = hover !== null ? (x(hover) / width) * 100 : 0;
  const tipFlip = hover !== null && x(hover) > width - 190;

  return (
    <div className={`timeline ${isCompact ? "timeline--compact" : ""}`}>
      <div className="timeline__head">
        <h3>{isCompact ? `Reports, last ${days} days` : `Reports over the last ${days} days`}</h3>
      </div>

      {asList ? (
        <ReportList reports={reports} size="list" />
      ) : (
        <>
          <div className="timeline__chart" ref={wrapRef}>
            <svg
              ref={svgRef}
              width="100%"
              height={HEIGHT}
              viewBox={`0 0 ${width} ${HEIGHT}`}
              role="img"
              tabIndex={0}
              aria-label={`${plural(maxCount ? daily.reduce((s, d) => s + d.count, 0) : 0, "report")} over ${days} days, busiest day ${plural(maxCount, "report")}. Use the left and right arrow keys to move between days with reports.`}
              onKeyDown={onKeyDown}
              onPointerMove={(e) => setHover(indexAt(e.clientX))}
              onPointerLeave={() => setHover(null)}
              onClick={(e) => {
                const i = nearestActive(indexAt(e.clientX));
                if (i !== null) choose(i);
              }}
            >
              {yTicks.map((t) => (
                <g key={t} className="timeline__grid">
                  <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} />
                  <text x={M.left - 10} y={y(t)} dy="0.32em" textAnchor="end">
                    {compact(t)}
                  </text>
                </g>
              ))}
              {xTicks.map((i) => (
                <text key={i} className="timeline__xtick" x={x(i)} y={HEIGHT - 8} textAnchor={i === 0 ? "start" : i === daily.length - 1 ? "end" : "middle"}>
                  {DAY_FMT.format(asDate(daily[i].date))}
                </text>
              ))}

              <path d={area} className="timeline__area" />
              <path d={path} className="timeline__line" />

              {hover !== null && <line className="timeline__crosshair" x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + innerH} />}

              {activeDays.filter((i) => !denseDots || i === selected || i === hover).map((i) => (
                <circle
                  key={i}
                  className={`timeline__dot ${i === selected ? "is-selected" : ""} ${i === hover ? "is-hover" : ""}`}
                  cx={x(i)}
                  cy={curveY(i)}
                  r={i === selected ? 6 : 4}
                />
              ))}
            </svg>

            {hover !== null && hoverDay && (
              <div
                className={`timeline__tip ${tipFlip ? "is-left" : ""}`}
                style={{ left: `${tipLeft}%`, top: `${(curveY(hover) / HEIGHT) * 100}%` }}
                role="presentation"
              >
                <strong>{plural(hoverDay.count, "report")}</strong>
                <span>{FULL_FMT.format(asDate(hoverDay.date))}</span>
                {hoverDay.count > 0 && <span className="timeline__hint">Click to see who reported it</span>}
              </div>
            )}
          </div>

          {received < total && (
            <p className="timeline__note muted">
              Based on the {plural(received, "report")} AbuseIPDB returned, out of {total.toLocaleString("en-US")} in total.
            </p>
          )}

          {sel && (
            <div className="timeline__detail" aria-live="polite" ref={detailRef}>
              <p className="timeline__detail-title">
                {FULL_FMT.format(asDate(sel.date))}
                <span className="muted">{plural(sel.count, "report")}</span>
              </p>
              {selReports.length < sel.count && (
                <p className="timeline__note muted">
                  Showing {selReports.length} of {sel.count}: AbuseIPDB only returns the most recent reports in full.
                </p>
              )}
              <ReportList reports={selReports} timeOnly size="day" />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Le segnalazioni scorrono dentro un riquadro ad altezza fissa: con centinaia di
// report la pagina non si allunga. Si scorre con rotella, trackpad o tastiera.
function ReportList({ reports, timeOnly = false, size = "list" }: { reports: AbuseReport[]; timeOnly?: boolean; size?: "list" | "day" }) {
  const shown = reports;
  const scrollable = reports.length > 3;
  return (
    <>
      {scrollable && size === "list" && (
        <p className="reports__count muted">
          {plural(reports.length, "report")}
          {reports.length > 4 && " · scroll to see them all"}
        </p>
      )}
      <div
        className={`reports-scroll reports-scroll--${size} ${scrollable ? "is-scrollable" : ""}`}
        tabIndex={scrollable ? 0 : undefined}
        role={scrollable ? "region" : undefined}
        aria-label={scrollable ? `${plural(reports.length, "report")}, scrollable list` : undefined}
      >
      <ol className="reports">
        {shown.map((r, i) => {
          const when = new Date(r.reportedAt);
          const country = r.reporterCountryName || countryName(r.reporterCountry) || r.reporterCountry;
          return (
            <li key={`${r.reportedAt}-${i}`}>
              <div className="reports__meta">
                <span className="mono">
                  {Number.isNaN(when.getTime())
                    ? r.reportedAt
                    : timeOnly
                      ? `${TIME_FMT.format(when)} UTC`
                      : `${DAY_FMT.format(when)} ${when.getUTCFullYear()}, ${TIME_FMT.format(when)}`}
                </span>
              </div>
              <div className="reports__body">
                <p className="reports__who">
                  {r.reporterId ? <>Reporter <span className="mono">#{r.reporterId}</span></> : "Anonymous reporter"}
                  {country && <span className="muted"> from {country}</span>}
                </p>
                <p className="reports__cats">{r.categories.join(", ") || "No category"}</p>
                {r.comment ? (
                  <p className="reports__comment mono">{r.comment}</p>
                ) : (
                  <p className="reports__comment muted">No description provided.</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      </div>
    </>
  );
}
