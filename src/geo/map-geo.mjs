// Kartenlage ohne Client: uiMap -> Kontinent, Rechteck einer Karte auf einer anderen, Umrechnung Zone <-> Kontinent.
// Portiert die Rechnung aus addon/InkAndEmbers/journal/Geo.lua (rect, affine, zoneAffine); statt C_Map.GetMapRectOnMap
// liegt die Lage aus wago.tools UiMapAssignment in index.json (scripts/build-map-index.mjs). Koordinaten hier immer 0..1
// (Trail-Werte 0..9999 vorher durch 10000 teilen, siehe trailToUnit).
import DEFAULT_INDEX from "./index.json";

// plausibles Rechteck auf der Zielkarte (Zonen ragen über den Rand der Elternkarte; wie Geo.RECT_MIN/MAX im Addon)
export const RECT_MIN = -0.5;
export const RECT_MAX = 1.5;
export const CONTINENT_TYPE = 2;
export const ZONE_TYPE = 3;

const isId = (v) => Number.isInteger(v) && v > 0 && v <= 1e6;
const finite = (v) => typeof v === "number" && Number.isFinite(v);

export function mapIndex(index = DEFAULT_INDEX) {
  return index && index.maps ? index : { build: null, maps: {} };
}

// Eintrag einer uiMap oder null (nur eigene Schlüssel, kein Prototyp-Zugriff)
export function mapInfo(mapID, index = DEFAULT_INDEX) {
  if (!isId(mapID)) return null;
  const maps = mapIndex(index).maps;
  const key = String(mapID);
  return Object.prototype.hasOwnProperty.call(maps, key) ? maps[key] : null;
}

export function mapName(mapID, index) {
  const m = mapInfo(mapID, index);
  return m ? m.name : null;
}

export function hasArt(mapID, index) {
  const m = mapInfo(mapID, index);
  return !!(m && m.art);
}

export function continentOf(mapID, index) {
  const m = mapInfo(mapID, index);
  return m && isId(m.continent) ? m.continent : null;
}

export function zoneOf(mapID, index) {
  const m = mapInfo(mapID, index);
  return m && isId(m.zone) ? m.zone : null;
}

// Kartengröße in Yards [Breite, Höhe] oder null (für Wegstrecken)
export function mapSize(mapID, index) {
  const m = mapInfo(mapID, index);
  return m && Array.isArray(m.size) ? m.size : null;
}

export function trailToUnit(v) {
  return finite(v) ? v / 10000 : null;
}

export function plausibleRect(r) {
  if (!Array.isArray(r) || r.length !== 4 || !r.every(finite)) return false;
  const [l, rt, t, b] = r;
  return l >= RECT_MIN && t >= RECT_MIN && rt <= RECT_MAX && b <= RECT_MAX && rt > l && b > t;
}

// Rechteck der Karte mapID auf der Karte targetID: [links, rechts, oben, unten] in Einheiten der Zielkarte, oder null.
// Gleiche Karte -> volle Fläche; sonst über die gemeinsame Welt-Karte (beide müssen auf derselben Welt-Karte liegen).
export function rectOn(mapID, targetID, index = DEFAULT_INDEX) {
  if (!isId(mapID) || !isId(targetID)) return null;
  if (mapID === targetID) return [0, 1, 0, 1];
  const m = mapInfo(mapID, index), p = mapInfo(targetID, index);
  if (!m || !p) return null;
  if (m.continent === targetID && Array.isArray(m.rect) && plausibleRect(m.rect)) return m.rect.slice();
  for (const w of m.world || []) {
    const pw = (p.world || []).find((x) => x.m === w.m);
    if (!pw || pw.y0 === pw.y1 || pw.x0 === pw.x1) continue;
    const fx = (wy) => (pw.y0 - wy) / (pw.y0 - pw.y1);
    const fy = (wx) => (pw.x0 - wx) / (pw.x0 - pw.x1);
    const r = [fx(w.y0), fx(w.y1), fy(w.x0), fy(w.x1)];
    if (plausibleRect(r)) return r;
  }
  return null;
}

const rectAffine = (r) => ({ ox: r[0], sx: r[1] - r[0], oy: r[2], sy: r[3] - r[2] });

// lineare Abbildung mapID -> targetID: tx = ox + sx * x, ty = oy + sy * y, oder null. Direkt über das Rechteck (wie
// Geo.affine); liegt die Karte weit neben der Zielkarte (Nachbarzone, Rechteck außerhalb der Plausibilitätsgrenzen), über
// den gemeinsamen Kontinent zusammengesetzt (wie Geo.zoneAffine).
export function affine(mapID, targetID, index = DEFAULT_INDEX) {
  const r = rectOn(mapID, targetID, index);
  if (r) return rectAffine(r);
  const c = continentOf(mapID, index);
  if (!c || c !== continentOf(targetID, index)) return null;
  const mr = rectOn(mapID, c, index), zr = rectOn(targetID, c, index);
  if (!mr || !zr) return null;
  const m = rectAffine(mr), z = rectAffine(zr);
  // Kontinent: cx = m.ox + m.sx * x; Zielkarte: tx = (cx - z.ox) / z.sx
  return { ox: (m.ox - z.ox) / z.sx, sx: m.sx / z.sx, oy: (m.oy - z.oy) / z.sy, sy: m.sy / z.sy };
}

// Punkt (0..1) von mapID nach targetID; null, wenn es keine Lage gibt
export function project(mapID, x, y, targetID, index) {
  if (!finite(x) || !finite(y)) return null;
  const a = affine(mapID, targetID, index);
  if (!a) return null;
  return { x: a.ox + a.sx * x, y: a.oy + a.sy * y };
}

// Punkt auf dem Kontinent der Karte -> { continent, x, y } oder null (Instanz, eigene Insel-Welt, unbekannte Karte)
export function toContinent(mapID, x, y, index) {
  const c = continentOf(mapID, index);
  if (!c) return null;
  const p = project(mapID, x, y, c, index);
  return p ? { continent: c, x: p.x, y: p.y } : null;
}

// Umkehrung: Kontinent-Punkt -> Punkt auf der Karte zoneID (kann außerhalb 0..1 liegen), oder null
export function fromContinent(continentID, cx, cy, zoneID, index) {
  if (!finite(cx) || !finite(cy)) return null;
  const a = affine(zoneID, continentID, index);
  if (!a || a.sx === 0 || a.sy === 0) return null;
  return { x: (cx - a.ox) / a.sx, y: (cy - a.oy) / a.sy };
}

// Welche Karte zeigt die Seite für Punkte auf mapID? Die Karte selbst, wenn sie Kunst hat, sonst ihre Zone, sonst ihr
// Kontinent; ohne Kunst irgendwo -> { mapID, art: false } (Rückfall Pergament + Gitter, gleiches Koordinatensystem).
export function displayMap(mapID, index) {
  if (!isId(mapID)) return null;
  for (const id of [mapID, zoneOf(mapID, index), continentOf(mapID, index)]) {
    if (id && hasArt(id, index) && (id === mapID || rectOn(mapID, id, index))) return { mapID: id, art: true };
  }
  return { mapID, art: false };
}

export function indexBuild(index) {
  return mapIndex(index).build || null;
}
