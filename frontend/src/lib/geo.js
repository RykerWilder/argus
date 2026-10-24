// Mappa del mondo a punti, senza dipendenze: decodifica TopoJSON, proiezione
// Natural Earth e campionamento di una griglia di punti dentro ogni paese.
//
// Il file countries-110m.json (world-atlas) viene scaricato dal Dockerfile e
// servito da nginx; in sviluppo si usa la CDN come fallback.

const SOURCES = [
  "/geo/countries-110m.json",
  "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json",
];

export const MAP_WIDTH = 1000;
const LAT_TOP = 84;
const LAT_BOTTOM = -57; // esclude l'Antartide
const DOT_STEP = 1.55; // gradi tra un punto e l'altro
const RAD = Math.PI / 180;

function naturalEarthRaw(lambda, phi) {
  const phi2 = phi * phi;
  const phi4 = phi2 * phi2;
  return [
    lambda * (0.8707 - 0.131979 * phi2 + phi4 * (-0.013791 + phi4 * (0.003971 * phi2 - 0.001529 * phi4))),
    phi * (1.007226 + phi2 * (0.015085 + phi4 * (-0.044475 + 0.028874 * phi2 - 0.005916 * phi4))),
  ];
}

const X_EXTENT = naturalEarthRaw(Math.PI, 0)[0];
const SCALE = MAP_WIDTH / (2 * X_EXTENT);
const Y_TOP = naturalEarthRaw(0, LAT_TOP * RAD)[1];
const Y_BOTTOM = naturalEarthRaw(0, LAT_BOTTOM * RAD)[1];
export const MAP_HEIGHT = Math.round((Y_TOP - Y_BOTTOM) * SCALE);

export function project(lon, lat) {
  const [x, y] = naturalEarthRaw(lon * RAD, lat * RAD);
  return [(x + X_EXTENT) * SCALE, (Y_TOP - y) * SCALE];
}

// Contorno della mappa proiettata: serve a ritagliare i paesi che escono dai bordi.
export const SPHERE_PATH = (() => {
  const pts = [];
  for (let lat = LAT_BOTTOM; lat <= LAT_TOP; lat += 1) pts.push(project(-180, lat));
  for (let lon = -180; lon <= 180; lon += 2) pts.push(project(lon, LAT_TOP));
  for (let lat = LAT_TOP; lat >= LAT_BOTTOM; lat -= 1) pts.push(project(180, lat));
  for (let lon = 180; lon >= -180; lon -= 2) pts.push(project(lon, LAT_BOTTOM));
  return pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("") + "Z";
})();

// ── TopoJSON ────────────────────────────────────────────────

function decodeArcs(topology) {
  const t = topology.transform;
  return topology.arcs.map((arc) => {
    if (!t) return arc;
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x * t.scale[0] + t.translate[0], y * t.scale[1] + t.translate[1]];
    });
  });
}

function ringFromArcs(indexes, arcs) {
  const ring = [];
  indexes.forEach((i, k) => {
    const arc = i < 0 ? arcs[~i].slice().reverse() : arcs[i];
    ring.push(...(k === 0 ? arc : arc.slice(1)));
  });
  return ring;
}

// Alcuni paesi (Russia, Fiji, Stati Uniti con le Aleutine) attraversano il
// meridiano 180°: tra due punti consecutivi la longitudine salta da +180 a -180
// e un disegno ingenuo traccia linee attraverso tutto il mondo. Qui l'anello
// viene reso continuo (es. 170 → 190) e, se esce da [-180, 180], se ne aggiunge
// una copia spostata di 360° che copre l'altro lato. Il disegno viene poi
// ritagliato sul contorno della mappa (SPHERE_PATH).
function unwrapRing(ring) {
  const out = [];
  let shift = 0;
  let prev = null;
  for (const [lon, lat] of ring) {
    if (prev !== null) {
      const d = lon + shift - prev;
      if (d > 180) shift -= 360;
      else if (d < -180) shift += 360;
    }
    const x = lon + shift;
    out.push([x, lat]);
    prev = x;
  }
  return out;
}

function splitAntimeridian(ring) {
  const r = unwrapRing(ring);
  let min = Infinity;
  let max = -Infinity;
  for (const [lon] of r) {
    if (lon < min) min = lon;
    if (lon > max) max = lon;
  }
  const shiftBy = (k) => r.map(([lon, lat]) => [lon + k, lat]);
  const rings = [r];
  if (max > 180) rings.push(shiftBy(-360));
  if (min < -180) rings.push(shiftBy(360));
  return rings;
}

function toFeatures(topology) {
  const arcs = decodeArcs(topology);
  return topology.objects.countries.geometries
    .filter((g) => g.type === "Polygon" || g.type === "MultiPolygon")
    .filter((g) => String(g.id) !== "010") // Antartide
    .map((g) => {
      const polygons = g.type === "Polygon" ? [g.arcs] : g.arcs;
      const rings = polygons.flatMap((poly) => poly.flatMap((r) => splitAntimeridian(ringFromArcs(r, arcs))));
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const ring of rings) {
        for (const [x, y] of ring) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      return { id: g.id, properties: g.properties || {}, rings, bbox: [minX, minY, maxX, maxY] };
    });
}

function contains(rings, lon, lat) {
  // even-odd su tutti gli anelli: i buchi si annullano da soli
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

function ringPath(ring, box) {
  let d = "";
  ring.forEach(([lon, lat], i) => {
    const [x, y] = project(lon, Math.max(LAT_BOTTOM, Math.min(LAT_TOP, lat)));
    if (x < box[0]) box[0] = x;
    if (y < box[1]) box[1] = y;
    if (x > box[2]) box[2] = x;
    if (y > box[3]) box[3] = y;
    d += `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return d + "Z";
}

// Riquadro proiettato del poligono principale (il più grande): evita che
// territori lontani (es. Guyana francese per la Francia) allarghino lo zoom.
function mainBox(rings) {
  let best = null;
  let bestArea = -1;
  for (const ring of rings) {
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    ringPath(ring, box);
    // solo la parte visibile della mappa
    box[0] = Math.max(0, box[0]);
    box[2] = Math.min(MAP_WIDTH, box[2]);
    if (box[2] <= box[0]) continue;
    const area = (box[2] - box[0]) * (box[3] - box[1]);
    if (area > bestArea) {
      bestArea = area;
      best = box;
    }
  }
  return best;
}

function buildModel(topology) {
  const features = toFeatures(topology).map((f) => {
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    const path = f.rings.map((r) => ringPath(r, box)).join("");
    return { ...f, name: f.properties.name || null, path, pbox: box, focusBox: mainBox(f.rings) };
  });

  const dots = [];
  let row = 0;
  for (let lat = LAT_TOP - DOT_STEP / 2; lat > LAT_BOTTOM; lat -= DOT_STEP, row++) {
    const offset = row % 2 ? DOT_STEP / 2 : 0;
    for (let lon = -180 + offset; lon < 180; lon += DOT_STEP) {
      const idx = features.findIndex(
        (f) =>
          lon >= f.bbox[0] && lon <= f.bbox[2] && lat >= f.bbox[1] && lat <= f.bbox[3] &&
          contains(f.rings, lon, lat),
      );
      if (idx !== -1) {
        const [x, y] = project(lon, lat);
        dots.push({ x, y, feature: idx });
      }
    }
  }
  return { features, dots };
}

let modelPromise;
export function loadWorld() {
  modelPromise ??= (async () => {
    for (const url of SOURCES) {
      try {
        const res = await fetch(url);
        if (!res.ok) {
          console.warn(`[argus] World map data: ${url} answered HTTP ${res.status}`);
          continue;
        }
        return buildModel(await res.json());
      } catch (err) {
        // prova la sorgente successiva
        console.warn(`[argus] World map data: could not load ${url}`, err);
      }
    }
    throw new Error("World map data unavailable");
  })();
  modelPromise.catch(() => {
    modelPromise = undefined;
  });
  return modelPromise;
}

export function dotsPath(dots, r) {
  const d = 2 * r;
  return dots
    .map(({ x, y }) => `M${(x - r).toFixed(1)},${y.toFixed(1)}a${r},${r} 0 1,0 ${d},0a${r},${r} 0 1,0 -${d},0`)
    .join("");
}
