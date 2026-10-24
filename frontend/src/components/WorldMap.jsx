import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MAP_HEIGHT, MAP_WIDTH, SPHERE_PATH, dotsPath, loadWorld, project } from "../lib/geo";
import { countryFeatureMatcher, countryName } from "../lib/countries";

const DOT_R = 1.9;
const MIN_W = MAP_WIDTH / 14; // zoom massimo 14x
const START_RATIO = 0.36; // altezza / larghezza del riquadro, aggiornata misurandolo

// La vista (viewBox) ha le stesse proporzioni del riquadro, che è più basso
// della mappa intera: per questo la si apre già zoomata sul paese.
const maxWidth = (ratio) => Math.min(MAP_WIDTH, MAP_HEIGHT / ratio);

function clampView({ x, y, w }, ratio) {
  const nw = Math.min(maxWidth(ratio), Math.max(MIN_W, w));
  const nh = nw * ratio;
  return {
    w: nw,
    x: Math.min(MAP_WIDTH - nw, Math.max(0, x)),
    y: Math.min(MAP_HEIGHT - nh, Math.max(0, y)),
  };
}

// vista centrata su un riquadro della mappa, con un po' di margine attorno
function viewAround(box, ratio, padding = 2.4) {
  const [x0, y0, x1, y1] = box;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const w = Math.max((x1 - x0) * padding, ((y1 - y0) * padding) / ratio, MIN_W * 1.8);
  return clampView({ x: cx - w / 2, y: cy - (w * ratio) / 2, w }, ratio);
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// route: percorso con più punti ([{ lat, lon, countryCode, label, hops }]), per
// esempio i server attraversati da un'email. Si evidenziano tutti i paesi, i
// punti sono numerati e collegati in ordine.
export default function WorldMap({ countryCode, lat, lon, className = "", label, interactive = false, placeLabel, route }) {
  const [world, setWorld] = useState(null);
  const [failed, setFailed] = useState(false);
  const [ratio, setRatio] = useState(START_RATIO);
  const [view, setView] = useState(() => clampView({ x: 0, y: 0, w: MAP_WIDTH }, START_RATIO));
  const [hover, setHover] = useState(null); // { index, x, y }
  const [hint, setHint] = useState(false);

  const svgRef = useRef(null);
  const figRef = useRef(null);
  const viewRef = useRef(view);
  const ratioRef = useRef(START_RATIO);
  const userMoved = useRef(false); // finché l'utente non sposta la mappa, si resta sul paese
  const animRef = useRef(0);
  const pointers = useRef(new Map());
  const gesture = useRef(null);
  const hintTimer = useRef(0);

  useEffect(() => {
    let alive = true;
    loadWorld()
      .then((w) => alive && setWorld(w))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const routeKey = route ? route.map((r) => `${r.lat},${r.lon},${r.countryCode}`).join("|") : "";
  const stops = useMemo(
    () => (route || []).filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon)).map((r) => ({ ...r, xy: project(r.lon, r.lat) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [routeKey],
  );
  const isRoute = !!route;
  const hasPoint = !isRoute && typeof lat === "number" && typeof lon === "number" && !Number.isNaN(lat) && !Number.isNaN(lon);
  const point = hasPoint ? project(lon, lat) : null;

  const layers = useMemo(() => {
    if (!world) return null;
    const codes = isRoute ? [...new Set(stops.map((s) => s.countryCode).filter(Boolean))] : [countryCode];
    const indexes = new Set(codes.map((c) => world.features.findIndex(countryFeatureMatcher(c))).filter((i) => i !== -1));
    const index = isRoute ? -1 : [...indexes][0] ?? -1;
    const lit = world.dots.filter((d) => indexes.has(d.feature));
    const base = indexes.size ? world.dots.filter((d) => !indexes.has(d.feature)) : world.dots;
    const origin = point || (stops[0]?.xy ?? (lit.length ? [lit[0].x, lit[0].y] : [0, 0]));
    const maxDist = Math.max(1, ...lit.map((d) => Math.hypot(d.x - origin[0], d.y - origin[1])));
    return {
      index,
      indexes,
      baseDots: base,
      lit: lit.map((d) => ({ ...d, delay: (Math.hypot(d.x - origin[0], d.y - origin[1]) / maxDist) * 900 })),
      outlines: [...indexes].map((i) => world.features[i].path),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, countryCode, lat, lon, stops, isRoute]);

  // ── vista (viewBox) ───────────────────────────
  const apply = useCallback((v) => {
    viewRef.current = v;
    setView(v);
  }, []);

  const animateTo = useCallback(
    (target, duration = 650) => {
      cancelAnimationFrame(animRef.current);
      const to = clampView(target, ratioRef.current);
      const from = viewRef.current;
      if (reducedMotion() || duration === 0) return apply(to);
      const start = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - start) / duration);
        const k = ease(t);
        apply({
          x: from.x + (to.x - from.x) * k,
          y: from.y + (to.y - from.y) * k,
          w: from.w + (to.w - from.w) * k,
        });
        if (t < 1) animRef.current = requestAnimationFrame(step);
      };
      animRef.current = requestAnimationFrame(step);
    },
    [apply],
  );

  useEffect(() => () => cancelAnimationFrame(animRef.current), []);

  const toSvg = (clientX, clientY) => {
    const rect = svgRef.current.getBoundingClientRect();
    const v = viewRef.current;
    return [
      v.x + ((clientX - rect.left) / rect.width) * v.w,
      v.y + ((clientY - rect.top) / rect.height) * v.w * ratioRef.current,
    ];
  };

  const zoomAround = (factor, cx, cy, animated = false) => {
    const v = viewRef.current;
    userMoved.current = true;
    const w = Math.min(maxWidth(ratioRef.current), Math.max(MIN_W, v.w / factor));
    const s = w / v.w;
    const next = clampView({ x: cx - (cx - v.x) * s, y: cy - (cy - v.y) * s, w }, ratioRef.current);
    animated ? animateTo(next, 320) : apply(next);
  };

  const zoomCenter = (factor) => {
    const v = viewRef.current;
    zoomAround(factor, v.x + v.w / 2, v.y + (v.w * ratioRef.current) / 2, true);
  };

  const focusBox = useCallback(
    (box) => {
      if (!box) return;
      userMoved.current = true;
      animateTo(viewAround(box, ratioRef.current));
    },
    [animateTo],
  );

  // vista iniziale: zoom sul paese dell'IP (o sul punto, se il paese non c'è)
  const homeBox = useMemo(() => {
    if (isRoute && stops.length) {
      // tutti i punti e i paesi attraversati, come la vista sul paese per un IP
      const xs = stops.map((st) => st.xy[0]);
      const ys = stops.map((st) => st.xy[1]);
      let box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      for (const i of layers?.indexes || []) {
        const fb = world.features[i].focusBox;
        if (fb) box = [Math.min(box[0], fb[0]), Math.min(box[1], fb[1]), Math.max(box[2], fb[2]), Math.max(box[3], fb[3])];
      }
      return box;
    }
    if (layers?.index >= 0) return world.features[layers.index].focusBox;
    if (point) return [point[0] - 20, point[1] - 12, point[0] + 20, point[1] + 12];
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, world, lat, lon, stops, isRoute]);

  const homeView = useCallback(
    () => (homeBox ? viewAround(homeBox, ratioRef.current) : clampView({ x: 0, y: 0, w: MAP_WIDTH }, ratioRef.current)),
    [homeBox],
  );

  useEffect(() => {
    userMoved.current = false;
    apply(homeView());
  }, [homeView, apply]);

  // proporzioni reali del riquadro: la vista le segue anche al ridimensionamento
  useEffect(() => {
    const fig = figRef.current;
    if (!fig) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (!width || !height) return;
      const r = height / width;
      if (Math.abs(r - ratioRef.current) < 0.002) return;
      ratioRef.current = r;
      setRatio(r);
      if (!userMoved.current) apply(homeView());
      else {
        const v = viewRef.current;
        const cy = v.y + (v.w * r) / 2;
        apply(clampView({ ...v, y: cy - (v.w * r) / 2 }, r));
      }
    });
    ro.observe(fig);
    return () => ro.disconnect();
  }, [apply, homeView]);

  // rotella: Ctrl/⌘ + scroll (o pinch sul trackpad) per zoomare, così la pagina scorre normalmente
  useEffect(() => {
    const svg = svgRef.current;
    if (!interactive || !svg) return;
    const onWheel = (e) => {
      if (!(e.ctrlKey || e.metaKey)) {
        setHint(true);
        clearTimeout(hintTimer.current);
        hintTimer.current = setTimeout(() => setHint(false), 1400);
        return;
      }
      e.preventDefault();
      cancelAnimationFrame(animRef.current);
      const [cx, cy] = toSvg(e.clientX, e.clientY);
      zoomAround(Math.exp(-e.deltaY * 0.0045), cx, cy);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      svg.removeEventListener("wheel", onWheel);
      clearTimeout(hintTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactive, world]);

  // ── puntatore: trascina, pinch, click sul paese ─
  const onPointerDown = (e) => {
    if (!interactive) return;
    cancelAnimationFrame(animRef.current);
    svgRef.current.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    gesture.current = { moved: 0, startView: viewRef.current, target: e.target };
  };

  const onPointerMove = (e) => {
    if (!interactive) return;
    const pts = pointers.current;
    if (!pts.has(e.pointerId)) {
      // solo hover
      const i = e.target?.dataset?.i;
      if (i !== undefined) {
        const rect = figRef.current.getBoundingClientRect();
        setHover({ index: Number(i), x: e.clientX - rect.left, y: e.clientY - rect.top });
      } else if (hover) setHover(null);
      return;
    }
    const prev = pts.get(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const rect = svgRef.current.getBoundingClientRect();
    const v = viewRef.current;

    if (pts.size === 1) {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      gesture.current.moved += Math.abs(dx) + Math.abs(dy);
      userMoved.current = true;
      apply(
        clampView(
          { x: v.x - (dx / rect.width) * v.w, y: v.y - (dy / rect.height) * v.w * ratioRef.current, w: v.w },
          ratioRef.current,
        ),
      );
      setHover(null);
    } else if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const other = [...pts.entries()].find(([id]) => id !== e.pointerId)[1];
      const before = Math.hypot(prev.x - other.x, prev.y - other.y);
      const after = Math.hypot(a.x - b.x, a.y - b.y);
      if (before > 0) {
        const [cx, cy] = toSvg((a.x + b.x) / 2, (a.y + b.y) / 2);
        zoomAround(after / before, cx, cy);
      }
      gesture.current.moved += 10;
    }
  };

  const onPointerUp = (e) => {
    if (!interactive) return;
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0 && g && g.moved < 6) {
      const i = g.target?.dataset?.i;
      if (i !== undefined && world) focusBox(world.features[Number(i)].focusBox);
    }
    if (pointers.current.size === 0) gesture.current = null;
  };

  const onDoubleClick = (e) => {
    if (!interactive) return;
    const [cx, cy] = toSvg(e.clientX, e.clientY);
    zoomAround(2.2, cx, cy, true);
  };

  const onKeyDown = (e) => {
    if (!interactive) return;
    const v = viewRef.current;
    const step = v.w * 0.15;
    const actions = {
      "+": () => zoomCenter(1.6),
      "=": () => zoomCenter(1.6),
      "-": () => zoomCenter(1 / 1.6),
      0: () => {
        userMoved.current = false;
        animateTo(homeView());
      },
      ArrowLeft: () => animateTo({ ...v, x: v.x - step }, 200),
      ArrowRight: () => animateTo({ ...v, x: v.x + step }, 200),
      ArrowUp: () => animateTo({ ...v, y: v.y - step }, 200),
      ArrowDown: () => animateTo({ ...v, y: v.y + step }, 200),
    };
    if (actions[e.key]) {
      e.preventDefault();
      actions[e.key]();
    }
  };

  const k = MAP_WIDTH / view.w; // fattore di zoom
  // i punti crescono meno dello zoom, così da vicino restano punti e non macchie
  const kStep = Math.round(Math.log2(k) * 4) / 4;
  const dotR = DOT_R / Math.sqrt(2 ** kStep);
  const basePath = useMemo(
    () => (layers ? dotsPath(layers.baseDots, Number(dotR.toFixed(2))) : ""),
    [layers, dotR],
  );
  const zoomed = view.w < maxWidth(ratio) - 0.5;
  const targetName = countryName(countryCode);

  let tooltip = null;
  if (hover && world && !pointers.current.size) {
    const f = world.features[hover.index];
    const isTarget = isRoute ? layers?.indexes.has(hover.index) : hover.index === layers?.index;
    tooltip = (
      <div
        className={`worldmap__tooltip ${isTarget ? "is-target" : ""}`}
        style={{ left: hover.x, top: hover.y }}
        role="presentation"
      >
        <strong>{isTarget && targetName ? targetName : f.name || "Unknown"}</strong>
        {isTarget && !isRoute && <span>IP location{placeLabel ? `: ${placeLabel}` : ""}</span>}
        {isTarget && isRoute && <span>On the route</span>}
      </div>
    );
  }

  return (
    <figure
      ref={figRef}
      className={`worldmap ${interactive ? "worldmap--interactive" : ""} ${className}`}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={onKeyDown}
      aria-label={interactive ? `${label || "World map"}. Drag to pan, plus and minus keys to zoom, 0 to return to the ${isRoute ? "route" : "country"}.` : undefined}
    >
      <svg
        ref={svgRef}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.w * ratio}`}
        role="img"
        aria-label={label || "World map"}
        preserveAspectRatio="xMidYMid meet"
        // fattore di zoom: il CSS ne ricava le dimensioni dei testi (font-size: calc(11px / var(--k)))
        style={{ "--k": k }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onDoubleClick={onDoubleClick}
      >
        <defs>
          <clipPath id="worldmap-sphere">
            <path d={SPHERE_PATH} />
          </clipPath>
        </defs>
        {layers && (
          <>
            <path d={basePath} className="worldmap__dots" />
            {layers.outlines.map((d, i) => (
              <path
                key={i}
                d={d}
                className="worldmap__country"
                vectorEffect="non-scaling-stroke"
                clipPath="url(#worldmap-sphere)"
              />
            ))}
            <g className="worldmap__lit">
              {layers.lit.map((d, i) => (
                <circle key={i} cx={d.x} cy={d.y} r={dotR + 0.25 / Math.sqrt(k)} style={{ animationDelay: `${d.delay}ms` }} />
              ))}
            </g>
            {interactive && (
              <g className={`worldmap__hits ${k > 1.6 ? "is-zoomed" : ""}`} clipPath="url(#worldmap-sphere)">
                {world.features.map((f, i) => (
                  <path
                    key={i}
                    d={f.path}
                    data-i={i}
                    className={hover?.index === i ? "is-hover" : undefined}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </g>
            )}
          </>
        )}

        {isRoute && stops.length > 0 && (
          <g className="worldmap__route">
            {stops.slice(1).map((s, i) => {
              const [ax, ay] = stops[i].xy;
              const [bx, by] = s.xy;
              const dist = Math.hypot(bx - ax, by - ay);
              if (dist < 0.5) return null;
              // curva verso l'alto, più ampia per le tratte lunghe
              const mx = (ax + bx) / 2;
              const my = (ay + by) / 2 - Math.min(60, dist * 0.28);
              return (
                <path
                  key={i}
                  d={`M${ax},${ay} Q${mx},${my} ${bx},${by}`}
                  className="worldmap__arc"
                  vectorEffect="non-scaling-stroke"
                  style={{ animationDelay: `${i * 220}ms` }}
                />
              );
            })}
            {stops.map((s, i) => (
              <g key={i} className={`worldmap__stop ${i === 0 ? "is-origin" : ""} ${i === stops.length - 1 ? "is-last" : ""}`}>
                {i === 0 && <circle className="worldmap__pulse" cx={s.xy[0]} cy={s.xy[1]} r={13 / k} vectorEffect="non-scaling-stroke" />}
                <circle className="worldmap__stop-dot" cx={s.xy[0]} cy={s.xy[1]} r={(s.label.length > 2 ? 13 : 10) / k} />
                <text x={s.xy[0]} y={s.xy[1]} dy={4 / k} textAnchor="middle">
                  {s.label}
                </text>
                <title>{s.title || s.label}</title>
              </g>
            ))}
          </g>
        )}

        {point && (
          <g className="worldmap__marker">
            <line x1={view.x} y1={point[1]} x2={view.x + view.w} y2={point[1]} vectorEffect="non-scaling-stroke" />
            <line x1={point[0]} y1={view.y} x2={point[0]} y2={view.y + view.w * ratio} vectorEffect="non-scaling-stroke" />
            <circle className="worldmap__pulse" cx={point[0]} cy={point[1]} r={7 / k} vectorEffect="non-scaling-stroke" />
            <circle className="worldmap__ring" cx={point[0]} cy={point[1]} r={7 / k} vectorEffect="non-scaling-stroke" />
            <circle className="worldmap__core" cx={point[0]} cy={point[1]} r={2.6 / k} />
            <text
              x={Math.min(point[0] + 8 / k, view.x + view.w - 4 / k)}
              y={view.y + 14 / k}
              textAnchor={point[0] > view.x + view.w - 90 / k ? "end" : "start"}
            >
              {lon.toFixed(2)}°
            </text>
            <text x={view.x + 6 / k} y={point[1] - 7 / k}>
              {lat.toFixed(2)}°
            </text>
          </g>
        )}
      </svg>

      {tooltip}

      {interactive && world && (
        <div className="worldmap__controls">
          <button type="button" onClick={() => zoomCenter(1.6)} aria-label="Zoom in" disabled={view.w <= MIN_W + 0.5}>+</button>
          <button type="button" onClick={() => zoomCenter(1 / 1.6)} aria-label="Zoom out" disabled={!zoomed}>−</button>
        </div>
      )}

      {interactive && hint && (
        <p className="worldmap__hint" aria-hidden="true">Hold Ctrl or ⌘ while scrolling to zoom</p>
      )}

      {failed && (
        <figcaption className="worldmap__fallback">
          {isRoute ? "Map data could not be loaded. Locations are listed next to each hop." : "Map data could not be loaded. Coordinates are listed in the ip-api.com panel."}
        </figcaption>
      )}
    </figure>
  );
}
