import { useEffect, useRef } from "react";
import { MAP_HEIGHT, MAP_WIDTH, loadWorld } from "../lib/geo";

// Sfondo della home: mappa a punti su canvas con collegamenti casuali tra
// punti del mondo. Puramente estetico.
//
// Costo contenuto: i punti vengono disegnati una sola volta su un canvas
// fuori schermo; a ogni frame si copiano e si aggiungono solo gli archi attivi
// (max 9) e i punti vicini al cursore. L'animazione si ferma quando la scheda
// non è visibile e diventa statica con "riduci movimento".

const MAX_ARCS = 9;
const SPAWN_EVERY = 650; // ms
const SPOT_RADIUS = 150; // px
const ACCENT = "61, 255, 197";

const rand = (a, b) => a + Math.random() * (b - a);

export default function NetworkBackground() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let world = null;
    let base = null; // canvas fuori schermo con i punti
    let pts = new Float32Array(0); // coordinate dei punti in pixel CSS
    let w = 0, h = 0, scale = 1, dotR = 1;
    let arcs = [];
    let raf = 0;
    let lastSpawn = 0;
    let mouse = null;
    let alive = true;

    function layout() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!world) return;

      // larghezza piena; su schermi stretti la mappa si ingrandisce e viene ritagliata ai lati
      scale = Math.max(w / MAP_WIDTH, (h * 0.62) / MAP_HEIGHT);
      const ox = (w - MAP_WIDTH * scale) / 2;
      const oy = Math.max((h - MAP_HEIGHT * scale) / 2 + h * 0.06, 0);
      dotR = Math.max(0.8, 0.62 * scale);

      pts = new Float32Array(world.dots.length * 2);
      world.dots.forEach((d, i) => {
        pts[i * 2] = ox + d.x * scale;
        pts[i * 2 + 1] = oy + d.y * scale;
      });

      base = document.createElement("canvas");
      base.width = canvas.width;
      base.height = canvas.height;
      const b = base.getContext("2d");
      b.setTransform(dpr, 0, 0, dpr, 0, 0);
      b.fillStyle = "#3c3c3a";
      b.beginPath();
      for (let i = 0; i < pts.length; i += 2) {
        b.moveTo(pts[i] + dotR, pts[i + 1]);
        b.arc(pts[i], pts[i + 1], dotR, 0, Math.PI * 2);
      }
      b.fill();
      arcs = [];
    }

    function pick() {
      const n = pts.length / 2;
      return Math.floor(Math.random() * n);
    }

    function spawn(now, fromIndex) {
      const n = pts.length / 2;
      if (!n) return;
      const a = fromIndex ?? pick();
      let b = pick();
      for (let tries = 0; tries < 12; tries++) {
        const dx = pts[b * 2] - pts[a * 2];
        const dy = pts[b * 2 + 1] - pts[a * 2 + 1];
        if (Math.hypot(dx, dy) > Math.min(w, 1400) * 0.18) break;
        b = pick();
      }
      const x0 = pts[a * 2], y0 = pts[a * 2 + 1];
      const x1 = pts[b * 2], y1 = pts[b * 2 + 1];
      const dist = Math.hypot(x1 - x0, y1 - y0);
      // punto di controllo sollevato: l'arco "vola" sopra la mappa
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      const nx = -(y1 - y0) / (dist || 1), ny = (x1 - x0) / (dist || 1);
      const lift = dist * rand(0.22, 0.34) * (ny > 0 ? -1 : 1);
      arcs.push({
        x0, y0, x1, y1,
        cx: mx + nx * lift,
        cy: my + ny * lift,
        start: now,
        dur: rand(1400, 2600) * Math.min(1.6, Math.max(0.7, dist / 500)),
        hold: 900,
      });
    }

    const qp = (a, c, b, t) => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * c + t * t * b;

    function drawArc(arc, now) {
      const t = (now - arc.start) / arc.dur;
      if (t < 0) return true; // in attesa di partire
      const travel = Math.min(1, t);
      const fade = t <= 1 ? 1 : Math.max(0, 1 - ((now - arc.start - arc.dur) / arc.hold));
      if (fade <= 0) return false;

      // scia: dal punto di partenza alla testa
      const steps = 36;
      const tail = Math.max(0, travel - 0.45);
      ctx.lineWidth = 1.1;
      for (let i = 0; i < steps; i++) {
        const ta = tail + ((travel - tail) * i) / steps;
        const tb = tail + ((travel - tail) * (i + 1)) / steps;
        const alpha = ((i + 1) / steps) * 0.9 * fade;
        ctx.strokeStyle = `rgba(${ACCENT}, ${alpha})`;
        ctx.beginPath();
        ctx.moveTo(qp(arc.x0, arc.cx, arc.x1, ta), qp(arc.y0, arc.cy, arc.y1, ta));
        ctx.lineTo(qp(arc.x0, arc.cx, arc.x1, tb), qp(arc.y0, arc.cy, arc.y1, tb));
        ctx.stroke();
      }

      // origine
      ctx.fillStyle = `rgba(${ACCENT}, ${0.8 * fade})`;
      ctx.beginPath();
      ctx.arc(arc.x0, arc.y0, 1.8, 0, Math.PI * 2);
      ctx.fill();

      // testa e impulso all'arrivo
      const hx = qp(arc.x0, arc.cx, arc.x1, travel);
      const hy = qp(arc.y0, arc.cy, arc.y1, travel);
      ctx.fillStyle = `rgba(243, 243, 240, ${fade})`;
      ctx.beginPath();
      ctx.arc(hx, hy, 2, 0, Math.PI * 2);
      ctx.fill();
      if (t > 1) {
        const p = (now - arc.start - arc.dur) / arc.hold;
        ctx.strokeStyle = `rgba(${ACCENT}, ${0.7 * (1 - p)})`;
        ctx.beginPath();
        ctx.arc(arc.x1, arc.y1, 2 + p * 14, 0, Math.PI * 2);
        ctx.stroke();
      }
      return true;
    }

    function drawSpotlight() {
      if (!mouse) return;
      const r2 = SPOT_RADIUS * SPOT_RADIUS;
      for (let i = 0; i < pts.length; i += 2) {
        const dx = pts[i] - mouse.x;
        const dy = pts[i + 1] - mouse.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const k = 1 - Math.sqrt(d2) / SPOT_RADIUS;
        ctx.fillStyle = `rgba(${ACCENT}, ${0.55 * k * k})`;
        ctx.beginPath();
        ctx.arc(pts[i], pts[i + 1], dotR * (1 + 0.4 * k), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function frame(now) {
      if (!alive) return;
      ctx.clearRect(0, 0, w, h);
      if (base) {
        ctx.drawImage(base, 0, 0, w, h);
        drawSpotlight();
        if (now - lastSpawn > SPAWN_EVERY && arcs.length < MAX_ARCS) {
          spawn(now);
          lastSpawn = now;
        }
        arcs = arcs.filter((a) => drawArc(a, now));
      }
      if (!reduce) raf = requestAnimationFrame(frame);
    }

    function drawStatic() {
      // con "riduci movimento": qualche collegamento fermo, nessuna animazione
      if (!base) return;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(base, 0, 0, w, h);
      arcs = [];
      const now = performance.now();
      for (let i = 0; i < 7; i++) spawn(now - 10000);
      arcs.forEach((a) => {
        a.hold = 1e9;
        drawArc(a, now - 10000 + a.dur);
      });
    }

    function start() {
      cancelAnimationFrame(raf);
      if (reduce) drawStatic();
      else raf = requestAnimationFrame(frame);
    }

    const onResize = () => {
      layout();
      start();
    };
    const onMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      mouse = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const onLeave = () => {
      mouse = null;
    };
    const onDown = (e) => {
      // un click su uno spazio vuoto fa partire collegamenti dal punto più vicino
      if (reduce || e.target.closest("input, button, a, form, label, nav")) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      let best = -1, bestD = Infinity;
      for (let i = 0; i < pts.length; i += 2) {
        const d = (pts[i] - x) ** 2 + (pts[i + 1] - y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i / 2;
        }
      }
      if (best === -1 || bestD > 120 * 120) return;
      const now = performance.now();
      for (let i = 0; i < 3; i++) spawn(now + i * 120, best);
    };
    const onVisibility = () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else start();
    };

    loadWorld()
      .then((model) => {
        if (!alive) return;
        world = model;
        layout();
        start();
      })
      .catch(() => {});

    layout();
    window.addEventListener("resize", onResize);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    window.addEventListener("pointerdown", onDown);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("pointerdown", onDown);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={canvasRef} className="network-bg" aria-hidden="true" />;
}
