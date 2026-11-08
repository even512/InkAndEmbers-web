// Bilder für Video, GIF und PNG: die Wiedergabe-Zeitachse (map/playback, parse-trail) wird auf die Videolänge
// verdichtet, je Bild wird die Karte mit map/renderer drawFrame gezeichnet und eine Einblendung (Titel, Charakter, Stufe,
// Datum) sowie ein dezentes Wasserzeichen darübergelegt. Kein DOM: gezeichnet wird in einen übergebenen 2D-Kontext
// (OffscreenCanvas oder Canvas). Alle Texte aus der Datei laufen durch safeText.
import { fmtDate } from "../core/i18n.mjs";
import { fromAxis, positionAt } from "../trail/parse-trail.mjs";
import { mapInfo } from "../geo/map-geo.mjs";
import { zoneName } from "../geo/zone-names.mjs";
import { buildLabels, prepareMapScene, chooseMap, levelAt } from "../map/scene.mjs";
import { drawFrame, fitView, DEFAULT_ASPECT } from "../map/renderer.mjs";
import { safeText } from "../ui/safe-text.mjs";
import { scrubLabels } from "./anonymize.mjs";
import { st } from "./share-texts.mjs";

// logische Zeichenfläche: Marker, Linien und Schrift sind auf 720 CSS-Pixel ausgelegt und werden auf die Ausgabe skaliert
export const LOGICAL = 720;
export const SCOPES = Object.freeze(["zone", "continent", "trip"]);

export const VIDEO = Object.freeze({ size: 1080, fps: 30, maxSec: 20, holdSec: 2, minAnimSec: 6, refSpeed: 180 });
export const GIF = Object.freeze({ sizes: [540, 432, 360], fps: 12, maxSec: 15, holdSec: 2, minAnimSec: 5, refSpeed: 180 });

// Zeitachse verdichten: Bereich p0..p1 (Achsensekunden) auf höchstens maxSec Sekunden, davon holdSec Standbild am Ende.
// Die Laufzeit folgt dem schnellen Tempo (refSpeed), mindestens minAnimSec, höchstens maxSec - holdSec.
// -> { fps, frames, animFrames, duration, axisAt(i) }; axisAt liefert die Achsensekunde, im Standbild end (Infinity =
// ganze Route ohne Kopf, wenn der Bereich bis zum Ende der Reise geht)
export function planTimeline(p0, p1, opts = {}) {
  const o = { ...VIDEO, ...opts };
  const a = Number.isFinite(p0) ? p0 : 0;
  const b = Number.isFinite(p1) && p1 >= a ? p1 : a;
  const span = b - a;
  const maxAnim = Math.max(0, o.maxSec - o.holdSec);
  const animSec = span > 0 ? Math.min(maxAnim, Math.max(o.minAnimSec, span / o.refSpeed)) : 0;
  const animFrames = Math.round(animSec * o.fps);
  const holdFrames = Math.max(1, Math.round(o.holdSec * o.fps));
  const frames = Math.min(Math.floor(o.maxSec * o.fps), animFrames + holdFrames);
  const end = Number.isFinite(o.axisLength) && b >= o.axisLength ? Infinity : b;
  const axisAt = (i) => {
    if (i >= animFrames || animFrames < 2) return end;
    return a + (span * i) / (animFrames - 1);
  };
  return { fps: o.fps, frames, animFrames, duration: frames / o.fps, axisAt };
}

// Dateiname ohne Fremdtext-Sonderzeichen: inkandembers_<name>_<ausschnitt>_<JJJJ-MM-TT>.<endung>
const EXT = new Set(["mp4", "webm", "gif", "png"]);
export function fileName({ charName, scope, epoch, ext }) {
  const base = String(typeof charName === "string" ? charName : "")
    .replace(/ß/g, "ss").replace(/æ/gi, "ae").replace(/ø/gi, "o")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32).replace(/-+$/g, "");
  const sc = SCOPES.includes(scope) ? scope : "trip";
  let date = "";
  if (Number.isFinite(epoch)) {
    const d = new Date(epoch * 1000);
    const p = (n) => String(n).padStart(2, "0");
    date = "_" + d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  return "inkandembers_" + (base || "reise") + "_" + sc + date + "." + (EXT.has(ext) ? ext : "bin");
}

// Kartenwahl je Bild: zone/continent fest (Karte der Stelle, an der der Bereich endet bzw. der aktuellen Ansicht),
// trip folgt dem Kopf über die Kontinente. -> (axis) => mapID
export function mapChooser(data, scope, { baseMapID = null } = {}) {
  const tl = data.trail.timeline;
  const segs = data.trail.segments;
  const lastMap = segs.length ? segs[segs.length - 1].mapID : null;
  const atAxis = (a) => {
    const ep = a === Infinity ? tl.t1 : fromAxis(tl, a);
    const p = positionAt(data.trail, ep);
    return p ? p.mapID : segs.length ? segs[0].mapID : null;
  };
  if (scope === "trip") {
    let prev = null;
    return (a) => {
      const m = chooseMap("continent", atAxis(a) || lastMap);
      if (m) prev = m.mapID;
      return prev;
    };
  }
  const base = baseMapID || lastMap;
  const fixed = chooseMap(scope === "continent" ? "continent" : "zone", base);
  const id = fixed ? fixed.mapID : null;
  return () => id;
}

// Szenen je Karte (einmal je Karte gebaut). Mit Anonymisierer werden die Ortsnamen VOR prepareMapScene gesäubert
// (data selbst ist dann schon scrubJourney-gesäubert).
export function sceneCache(data, anon = null) {
  const cache = new Map();
  return (mapID) => {
    if (!mapID) return null;
    if (!cache.has(mapID)) {
      let labels = buildLabels(mapID, { events: data.events, trail: data.trail, names: data.names });
      if (anon) labels = scrubLabels(labels, anon);
      cache.set(mapID, prepareMapScene(data.trail, mapID, { markers: data.markers, labels }));
    }
    return cache.get(mapID);
  };
}

// Kartenname: in der Sprache lang aus der Addon-Tabelle (zone-names), sonst aus der Datei (data.names, gesäubert), sonst Index, sonst #ID
export function mapTitle(data, mapID, lang = null) {
  if (!mapID) return "";
  const z = lang ? zoneName(mapID, lang === "en" ? "en" : "de") : null;
  if (z) return z;
  const n = data.names.get(mapID);
  if (n) return safeText(n, 60);
  const info = mapInfo(mapID);
  return info ? safeText(info.name, 60) : "#" + mapID;
}

// Auftrag für die Bild-Erzeugung zusammenstellen.
//   data      prepareJourney-Ergebnis (bei „Andere Spieler ausblenden“ schon anonymisiert)
//   scope     zone | continent | trip
//   range     { p0, p1 } auf der Achse
//   images    Map(mapID -> Bild oder null)
//   plan      planTimeline(...)
//   info      { charName, lang }
//   icons     Map(Markerart -> Bild) mit den Addon-Symbolen (optional; ohne: Kreise mit Zeichen)
export function createFrameJob({ data, scope, range, images, plan, info, anon = null, baseMapID = null, icons = null }) {
  const tl = data.trail.timeline;
  const pick = mapChooser(data, scope, { baseMapID });
  const scenes = sceneCache(data, anon);
  const views = new Map();
  const lang = info.lang;
  const charName = safeText(info.charName || "", 40);
  const viewFor = (mapID, aspect) => {
    if (!views.has(mapID)) {
      const sc = scenes(mapID);
      views.set(mapID, scope === "zone" ? { cx: 0.5, cy: 0.5, zoom: 1 } : fitView(sc && sc.bounds, aspect, LOGICAL, LOGICAL, 0.15));
    }
    return views.get(mapID);
  };
  const frameAt = (i) => {
    const axis = plan.axisAt(i);
    const mapID = pick(axis);
    const img = images.get(mapID) || null;
    const aspect = img && img.width > 0 && img.height > 0 ? img.width / img.height : DEFAULT_ASPECT;
    const epoch = axis === Infinity ? Math.min(tl.t1, fromAxis(tl, range.p1)) : fromAxis(tl, axis);
    const level = levelAt(data.levels, epoch);
    return {
      axis,
      mapID,
      state: {
        width: LOGICAL, height: LOGICAL, scene: scenes(mapID), image: img, aspect, view: viewFor(mapID, aspect),
        title: "", theme: "light", timeline: tl, highlight: null, icons, // Kartenname steht in der Einblendung
      },
      overlay: {
        title: scope === "trip" ? st(lang, "shJourney") : mapTitle(data, mapID, lang),
        line: [charName, level !== null ? st(lang, "shLevel", level) : null, fmtDate(lang, epoch)].filter(Boolean).join(" · "),
        watermark: st(lang, "shWatermark"),
      },
    };
  };
  const mapIDs = () => {
    const s = new Set();
    for (let i = 0; i < plan.frames; i++) {
      const id = pick(plan.axisAt(i));
      if (id) s.add(id);
    }
    return [...s];
  };
  return { plan, frameAt, mapIDs, endEpoch: fromAxis(tl, range.p1) };
}

const SERIF = '"Spectral", "Iowan Old Style", "Palatino Linotype", Georgia, serif';

// Text kürzen, bis er in maxW passt
function fit(ctx, text, maxW) {
  let s = text;
  while (s.length > 1 && ctx.measureText(s).width > maxW) s = s.slice(0, -2) + "…";
  return s;
}

// Einblendung: Pergament-Band oben mit Titel und Zeile, Wasserzeichen unten rechts
export function drawOverlay(ctx, overlay, size) {
  const pr = size / LOGICAL;
  ctx.setTransform(pr, 0, 0, pr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  const W = LOGICAL;
  const grad = ctx.createLinearGradient(0, 0, 0, 96);
  grad.addColorStop(0, "rgba(243, 230, 198, 0.94)");
  grad.addColorStop(0.75, "rgba(243, 230, 198, 0.82)");
  grad.addColorStop(1, "rgba(243, 230, 198, 0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, 96);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#2b2118";
  ctx.font = "600 32px " + SERIF;
  ctx.fillText(fit(ctx, safeText(overlay.title || "", 60), W - 40), 20, 42);
  ctx.fillStyle = "#5a4632";
  ctx.font = "18px " + SERIF;
  ctx.fillText(fit(ctx, safeText(overlay.line || "", 120), W - 40), 20, 70);
  // Wasserzeichen
  ctx.globalAlpha = 0.62;
  ctx.textAlign = "right";
  ctx.font = "600 17px " + SERIF;
  const wm = safeText(overlay.watermark || "", 30);
  const tw = ctx.measureText(wm).width;
  ctx.fillStyle = "rgba(255, 246, 230, 0.75)";
  ctx.fillRect(W - tw - 40, LOGICAL - 34, tw + 30, 24);
  ctx.fillStyle = "#9b2c1f";
  ctx.beginPath();
  ctx.arc(W - tw - 28, LOGICAL - 22, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#2b2118";
  ctx.fillText(wm, W - 16, LOGICAL - 16);
  ctx.globalAlpha = 1;
}

// ein Bild vollständig zeichnen (Karte + Einblendung) in einen Kontext der Kantenlänge size
export function renderFrame(ctx, job, i, size) {
  const f = job.frameAt(i);
  drawFrame(ctx, { ...f.state, pixelRatio: size / LOGICAL }, f.axis);
  drawOverlay(ctx, f.overlay, size);
  return f;
}
