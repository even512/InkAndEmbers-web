// Zeichenroutine der Reise-Karte für Canvas 2D: Kartenbild (Originalfarben) oder Rückfall (Pergament, Gitter,
// Ortsnamen), gelaufene Route mit Glühen, gestrichelte Flüge, Marker, Kopf der Wiedergabe.
// Dieselbe Funktion dient dem Bildschirm (ui/journey.mjs) und dem Video/Bild (W6, OffscreenCanvas): kein DOM, kein
// window, nur der übergebene Kontext. Logik der Ansicht wie Map.fit/Map.toPixel in addon/InkAndEmbers/journal/Map.lua.
//
// drawFrame(ctx, state, t)
//   ctx    CanvasRenderingContext2D oder OffscreenCanvasRenderingContext2D
//   state  { width, height,           Zeichenfläche in CSS-Pixeln (Video: 1080, 1080)
//            pixelRatio = 1,           Gerätepixel je CSS-Pixel (Canvas-Größe = width * pixelRatio)
//            scene,                    prepareMapScene(...) aus map/scene.mjs
//            image = null,             geladenes Kartenbild (HTMLImageElement/ImageBitmap) oder null = Rückfall
//            aspect = 1.5,             Seitenverhältnis der Karte (Breite/Höhe); mit Bild dessen Maße
//            view = { cx, cy, zoom },  Mittelpunkt (Kartenkoordinaten 0..1) und Zoom (1 = ganze Karte)
//            title = "",               Kartenname (nur im Rückfall gezeichnet)
//            theme = "light",          "light" | "dark" (dunkel = Nachtlampe); Video immer "light"
//            timeline = null,          parse-trail buildTimeline: t ist dann eine Achsensekunde, sonst eine Epoche
//            highlight = null,         Marker, der hervorgehoben wird (Maus darüber)
//            drawMarkers = true,       false: Marker nicht zeichnen (die Seite legt sie als Knöpfe darüber)
//            drawHead = true,          false: Kopf der Wiedergabe nicht zeichnen (die Seite zeigt ihn als Bild)
//            icons = null }            Map(Markerart -> geladenes Bild) mit den Addon-Symbolen; fehlt eins: Kreis mit Zeichen
//   t      Achsensekunde der Wiedergabe; Infinity = ganze Route ohne Kopf
import { fromAxis } from "../trail/parse-trail.mjs";
import { safeText } from "../ui/safe-text.mjs";

export const DEFAULT_ASPECT = 1.5;
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 16;
export const ZOOM_STEP = 1.25;
export const MARKER_R = 9;
export const GRID_STEP = 0.1;

export const THEMES = Object.freeze({
  light: {
    desk: "#f4ebd6", paper: "#f3e6c6", paperEdge: "#d9c193", grid: "rgba(105, 70, 19, 0.22)", gridStrong: "rgba(105, 70, 19, 0.38)",
    ink: "#2b2118", inkSoft: "#5a4632", route: "#9b2c1f", glow: "rgba(244, 235, 214, 0.9)", flight: "#2f4e7a",
    head: "#9b2c1f", headRing: "#fff6e6", halo: "rgba(255, 246, 230, 0.85)", artAlpha: 1,
  },
  dark: {
    desk: "#1f150e", paper: "#e2cfa5", paperEdge: "#b99d68", grid: "rgba(70, 45, 15, 0.26)", gridStrong: "rgba(70, 45, 15, 0.42)",
    ink: "#241a12", inkSoft: "#4a3826", route: "#9b2c1f", glow: "rgba(244, 235, 214, 0.9)", flight: "#2f4e7a",
    head: "#9b2c1f", headRing: "#fff6e6", halo: "rgba(255, 244, 222, 0.8)", artAlpha: 0.92,
  },
});

export const MARKER_STYLE = Object.freeze({
  level: { fill: "#c9a14a", stroke: "#4a2c18", glyph: null, color: "#2b2118" },
  death: { fill: "#8a2a1c", stroke: "#3b0f08", glyph: "✝", color: "#fff6e6" },
  boss: { fill: "#5e1a10", stroke: "#2b0a05", glyph: "♛", color: "#f1d48a" },
  rare: { fill: "#6a3a92", stroke: "#2e1544", glyph: "◈", color: "#f6ecff" },
  discovery: { fill: "#2f552c", stroke: "#15290f", glyph: "✦", color: "#f1f6e6" },
});

const SERIF = '"Spectral", "Iowan Old Style", "Palatino Linotype", Georgia, serif';

// Transformation Kartenkoordinaten -> CSS-Pixel: px = ox + x * sx, py = oy + y * sy
export function transformFor(state) {
  const W = state.width, H = state.height;
  const aspect = state.aspect > 0 ? state.aspect : DEFAULT_ASPECT;
  const view = state.view || { cx: 0.5, cy: 0.5, zoom: 1 };
  const base = Math.min(W / aspect, H);
  const scale = base * (view.zoom || 1);
  const sx = aspect * scale, sy = scale;
  return { sx, sy, ox: W / 2 - view.cx * sx, oy: H / 2 - view.cy * sy };
}

export function clampView(view) {
  const zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Number.isFinite(view.zoom) ? view.zoom : 1));
  const c = (v) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0.5));
  return { cx: c(view.cx), cy: c(view.cy), zoom };
}

export const FIT_ZOOM_MAX = 4; // weiter vergrößert wirkt die Kartenkunst (ca. 1000 px) verwaschen

// Ansicht, die das Rechteck b (Kartenkoordinaten) mit Rand pad (Anteil) zeigt; ohne b die ganze Karte
export function fitView(b, aspect, width, height, pad = 0.12, maxZoom = FIT_ZOOM_MAX) {
  if (!b || !(b.x1 >= b.x0) || !(b.y1 >= b.y0)) return { cx: 0.5, cy: 0.5, zoom: 1 };
  const a = aspect > 0 ? aspect : DEFAULT_ASPECT;
  const w = Math.max(b.x1 - b.x0, 0.04) * (1 + 2 * pad);
  const h = Math.max(b.y1 - b.y0, 0.04) * (1 + 2 * pad);
  const base = Math.min(width / a, height);
  const zoom = Math.min(maxZoom, width / (w * a * base), height / (h * base));
  return clampView({ cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, zoom });
}

// Zoom um den Faktor f, der Kartenpunkt unter (px, py) bleibt stehen
export function zoomAt(state, f, px, py) {
  const T = transformFor(state);
  const ux = (px - T.ox) / T.sx, uy = (py - T.oy) / T.sy;
  const zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, (state.view.zoom || 1) * f));
  const T2 = transformFor({ ...state, view: { ...state.view, zoom } });
  return clampView({ zoom, cx: ux - (px - state.width / 2) / T2.sx, cy: uy - (py - state.height / 2) / T2.sy });
}

// Verschieben um (dx, dy) CSS-Pixel
export function panBy(state, dx, dy) {
  const T = transformFor(state);
  return clampView({ zoom: state.view.zoom, cx: state.view.cx - dx / T.sx, cy: state.view.cy - dy / T.sy });
}

// Achsensekunde/Epoche -> Epoche, bis zu der gezeichnet wird
export function cutoffFor(state, t) {
  if (t === Infinity || t === undefined || t === null) return Infinity;
  if (!Number.isFinite(t)) return Infinity;
  return state.timeline && state.timeline.t0 !== null ? fromAxis(state.timeline, t) : t;
}

// letzter Index mit arr[i] <= v, sonst -1
function lastLE(arr, v) {
  let lo = 0, hi = arr.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= v) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}

// sichtbarer Marker unter (px, py) oder null (oberster zuerst)
export function hitMarker(state, t, px, py, radius = MARKER_R + 3) {
  const scene = state.scene;
  if (!scene) return null;
  const T = transformFor(state);
  const cut = cutoffFor(state, t);
  for (let i = scene.markers.length - 1; i >= 0; i--) {
    const m = scene.markers[i];
    if (m.t > cut) continue;
    const dx = T.ox + m.px * T.sx - px, dy = T.oy + m.py * T.sy - py;
    if (dx * dx + dy * dy <= radius * radius) return m;
  }
  return null;
}

// Kopf der Wiedergabe (Position zum Zeitpunkt cut auf dieser Karte) oder null
export function headAt(scene, cut) {
  if (!scene || !Number.isFinite(cut)) return null;
  let best = null;
  for (const l of scene.lines) {
    if (!l.t.length || l.t[0] > cut) continue;
    const k = lastLE(l.t, cut);
    if (best && l.t[k] < best.t) continue;
    let x = l.x[k], y = l.y[k];
    if (k < l.t.length - 1 && l.t[k + 1] > l.t[k]) {
      const f = (cut - l.t[k]) / (l.t[k + 1] - l.t[k]);
      x += (l.x[k + 1] - x) * f;
      y += (l.y[k + 1] - y) * f;
    }
    best = { x, y, t: l.t[k] };
  }
  for (const f of scene.flights) {
    if (cut > f.t0 && cut < f.t1 && (!best || f.t0 >= best.t)) {
      const q = (cut - f.t0) / (f.t1 - f.t0);
      best = { x: f.x0 + (f.x1 - f.x0) * q, y: f.y0 + (f.y1 - f.y0) * q, t: cut };
    }
  }
  return best;
}

function drawFallback(ctx, T, theme, state) {
  const x = T.ox, y = T.oy, w = T.sx, h = T.sy;
  ctx.fillStyle = theme.paper;
  ctx.fillRect(x, y, w, h);
  // Gitter alle 10 % der Karte, jede halbe Karte kräftiger
  ctx.lineWidth = 1;
  for (let i = 1; i < 1 / GRID_STEP; i++) {
    const strong = i === 5;
    ctx.strokeStyle = strong ? theme.gridStrong : theme.grid;
    ctx.beginPath();
    ctx.moveTo(x + i * GRID_STEP * w, y);
    ctx.lineTo(x + i * GRID_STEP * w, y + h);
    ctx.moveTo(x, y + i * GRID_STEP * h);
    ctx.lineTo(x + w, y + i * GRID_STEP * h);
    ctx.stroke();
  }
  ctx.strokeStyle = theme.paperEdge;
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  // Ortsnamen
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const labels = state.scene && Array.isArray(state.scene.labels) ? state.scene.labels : [];
  for (const l of labels) {
    const px = x + l.x * w, py = y + l.y * h;
    const text = safeText(l.text, 60);
    if (l.kind === "zone") {
      ctx.font = "italic 13px " + SERIF;
      ctx.fillStyle = theme.inkSoft;
    } else {
      ctx.font = "600 14px " + SERIF;
      ctx.fillStyle = theme.ink;
    }
    ctx.lineWidth = 3;
    ctx.strokeStyle = theme.halo;
    ctx.strokeText(text, px, py);
    ctx.fillText(text, px, py);
  }
  const title = safeText(state.title || "", 60);
  if (title) {
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = "600 22px " + SERIF;
    ctx.lineWidth = 4;
    ctx.strokeStyle = theme.halo;
    const tx = Math.max(x, 0) + 14, ty = Math.max(y, 0) + 10;
    ctx.strokeText(title, tx, ty);
    ctx.fillStyle = theme.ink;
    ctx.fillText(title, tx, ty);
  }
}

function strokeLines(ctx, scene, T, cut) {
  ctx.beginPath();
  for (const l of scene.lines) {
    const n = l.t.length;
    if (!n || l.t[0] > cut) continue;
    const k = cut === Infinity ? n - 1 : lastLE(l.t, cut);
    ctx.moveTo(T.ox + l.x[0] * T.sx, T.oy + l.y[0] * T.sy);
    for (let i = 1; i <= k; i++) ctx.lineTo(T.ox + l.x[i] * T.sx, T.oy + l.y[i] * T.sy);
    if (k < n - 1 && cut !== Infinity && l.t[k + 1] > l.t[k]) {
      const f = (cut - l.t[k]) / (l.t[k + 1] - l.t[k]);
      ctx.lineTo(T.ox + (l.x[k] + (l.x[k + 1] - l.x[k]) * f) * T.sx, T.oy + (l.y[k] + (l.y[k + 1] - l.y[k]) * f) * T.sy);
    }
    if (n === 1) ctx.lineTo(T.ox + l.x[0] * T.sx + 0.1, T.oy + l.y[0] * T.sy);
  }
  ctx.stroke();
}

// Symbol einer Markerart wie in der Seite (ui/journey.mjs MARKER_ICON): Stufe 10/20/... = Meilenstein
export function iconKey(m) {
  return m.kind === "level" && Number.isFinite(m.level) && m.level % 10 === 0 ? "milestone" : m.kind;
}

function drawMarker(ctx, m, px, py, hot, icons) {
  const img = icons && typeof icons.get === "function" ? icons.get(iconKey(m)) || icons.get(m.kind) : null;
  if (img) {
    const s = (MARKER_R * 2 + 10) * (hot ? 1.25 : 1);
    ctx.drawImage(img, px - s / 2, py - s / 2, s, s);
    return;
  }
  const st = MARKER_STYLE[m.kind] || MARKER_STYLE.discovery;
  const r = MARKER_R * (hot ? 1.3 : m.kind === "level" && m.level % 10 === 0 ? 1.15 : 1);
  ctx.beginPath();
  ctx.arc(px, py, r + 2, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 246, 230, 0.9)";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.fillStyle = st.fill;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = st.stroke;
  ctx.stroke();
  const glyph = m.kind === "level" ? (Number.isFinite(m.level) ? String(m.level) : "▲") : st.glyph;
  ctx.fillStyle = st.color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = (m.kind === "level" ? "700 " + (glyph.length > 1 ? 10 : 11) : "12") + "px " + SERIF;
  ctx.fillText(glyph, px, py + 0.5);
}

export function drawFrame(ctx, state, t = Infinity) {
  const pr = state.pixelRatio > 0 ? state.pixelRatio : 1;
  const W = state.width, H = state.height;
  const theme = THEMES[state.theme] || THEMES.light;
  ctx.setTransform(pr, 0, 0, pr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  ctx.fillStyle = theme.desk;
  ctx.fillRect(0, 0, W, H);
  const T = transformFor(state);
  if (state.image) {
    ctx.globalAlpha = theme.artAlpha;
    ctx.imageSmoothingEnabled = true;
    if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";
    ctx.drawImage(state.image, T.ox, T.oy, T.sx, T.sy);
    ctx.globalAlpha = 1;
  } else drawFallback(ctx, T, theme, state);
  const scene = state.scene;
  if (!scene) return;
  const cut = cutoffFor(state, t);
  const zoomBoost = 1 + Math.log2(Math.max(1, (state.view && state.view.zoom) || 1)) * 0.25;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  // Flüge gestrichelt (bis zum Kopf anteilig), mit hellem Lichthof
  const flightPath = () => {
    ctx.beginPath();
    for (const f of scene.flights) {
      if (f.t0 > cut) continue;
      const q = cut === Infinity || cut >= f.t1 ? 1 : (cut - f.t0) / (f.t1 - f.t0);
      ctx.moveTo(T.ox + f.x0 * T.sx, T.oy + f.y0 * T.sy);
      ctx.lineTo(T.ox + (f.x0 + (f.x1 - f.x0) * q) * T.sx, T.oy + (f.y0 + (f.y1 - f.y0) * q) * T.sy);
    }
    ctx.stroke();
  };
  ctx.strokeStyle = theme.glow;
  ctx.lineWidth = 6 * zoomBoost;
  flightPath();
  ctx.strokeStyle = theme.flight;
  ctx.lineWidth = 2.4 * zoomBoost;
  ctx.setLineDash([9, 7]);
  flightPath();
  ctx.setLineDash([]);
  // Route: heller Lichthof, dann die rote Linie
  ctx.strokeStyle = theme.glow;
  ctx.lineWidth = 7 * zoomBoost;
  strokeLines(ctx, scene, T, cut);
  ctx.strokeStyle = theme.route;
  ctx.lineWidth = 3 * zoomBoost;
  strokeLines(ctx, scene, T, cut);
  // Marker
  const hot = state.highlight || null;
  if (state.drawMarkers !== false) {
    for (const m of scene.markers) {
      if (m.t > cut || m === hot) continue;
      drawMarker(ctx, m, T.ox + m.px * T.sx, T.oy + m.py * T.sy, false, state.icons);
    }
    if (hot && hot.t <= cut && scene.markers.includes(hot)) drawMarker(ctx, hot, T.ox + hot.px * T.sx, T.oy + hot.py * T.sy, true, state.icons);
  }
  // Kopf der Wiedergabe
  const head = state.drawHead === false ? null : headAt(scene, cut);
  const arrow = head && state.icons && typeof state.icons.get === "function" ? state.icons.get("current") : null;
  if (head && arrow) {
    // Addon-Pfeil (zeigt in der Datei nach oben), gedreht in Laufrichtung der letzten 30 Sekunden
    const px = T.ox + head.x * T.sx, py = T.oy + head.y * T.sy;
    const prev = headAt(scene, cut - 30);
    const ang = prev && (head.x !== prev.x || head.y !== prev.y) ? Math.atan2((head.y - prev.y) * T.sy, (head.x - prev.x) * T.sx) + Math.PI / 2 : 0;
    const s = 34;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(ang);
    ctx.drawImage(arrow, -s / 2, -s / 2, s, s);
    ctx.restore();
  } else if (head) {
    const px = T.ox + head.x * T.sx, py = T.oy + head.y * T.sy;
    ctx.beginPath();
    ctx.arc(px, py, 11, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(155, 44, 31, 0.22)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px, py, 6, 0, Math.PI * 2);
    ctx.fillStyle = theme.head;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = theme.headRing;
    ctx.stroke();
  }
}
