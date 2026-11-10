// Szene der Reise-Karte aus den Daten eines Charakters: Marker (Stufe, Tod, Boss/Rare, Entdeckung), Kapitel je Zone,
// Stufe und Spielzeit zu jedem Zeitpunkt, und je Zielkarte die projizierten Linien/Flüge/Marker/Ortsnamen.
// Reine Daten, kein DOM. Alle Texte aus der Datei laufen hier schon durch safeText (auch was später ins Canvas geht).
import { field, fnum, ACTIVE_GAP } from "../core/journal-model.mjs";
import { positionAt, toAxis } from "../trail/parse-trail.mjs";
import { affine, mapInfo, mapIndex, continentOf, zoneOf, displayMap, project, CONTINENT_TYPE, ZONE_TYPE } from "../geo/map-geo.mjs";
import { safeText } from "../ui/safe-text.mjs";

export const MARKER_KINDS = Object.freeze(["level", "death", "boss", "rare", "discovery"]);
export const THIN = 0.0006; // Ausdünnen: Mindestabstand zweier gezeichneter Punkte (Einheiten der Zielkarte)
export const LABELS_MAX = 40;
export const SCENE_POINTS_MAX = 200000; // mehr Punkte je Szene: gröber ausdünnen (riesige oder präparierte Dateien)
export const SCENE_MARKERS_MAX = 5000; // mehr Marker je Szene: die wichtigsten Arten zuerst, der Rest entfällt
export const NAME_MAX = 80;

const RARE_MOMENTS = new Set(["first_rare", "first_elite", "first_boss", "kill"]);
const coord = (v) => (Number.isInteger(v) && v >= 0 && v <= 9999 ? v / 10000 : null);
const idOf = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= 1e6 ? n : null;
};
const txt = (s) => (typeof s === "string" && s !== "" ? safeText(s, NAME_MAX) : null);

// Ort eines Ereignisses: eigene Felder mapID/x/y, sonst die Spur zu diesem Zeitpunkt
function placeOf(ev, trail) {
  if (ev) {
    const m = idOf(field(ev, "mapID"));
    const x = coord(fnum(ev, "x"));
    const y = coord(fnum(ev, "y"));
    if (m && x !== null && y !== null) return { mapID: m, x, y };
  }
  const p = trail && ev ? positionAt(trail, ev.t) : null;
  return p ? { mapID: p.mapID, x: p.x / 10000, y: p.y / 10000 } : null;
}

// Marker aus Höhepunkten des Journals und den EX-Zeilen des Logs. -> [{ kind, t, mapID, x, y, level, name, place, extra }]
export function buildMarkers(journal, events, trail) {
  const out = [];
  const push = (kind, ev, fields) => {
    const at = placeOf(ev, trail);
    if (!at) return;
    out.push({ kind, t: ev.t, mapID: at.mapID, x: at.x, y: at.y, level: null, name: null, place: null, extra: null, ...fields });
  };
  for (const h of (journal && Array.isArray(journal.highlights) ? journal.highlights : [])) {
    if (!h || !h.ev || !Number.isFinite(h.t)) continue;
    if (h.kind === "level") push("level", h.ev, { level: Number.isFinite(h.level) ? h.level : null, place: txt(h.place) });
    else if (h.kind === "death") push("death", h.ev, { level: Number.isFinite(h.level) ? h.level : null, place: txt(h.place), name: txt(h.killer) });
    else if (h.kind === "boss") push("boss", h.ev, { name: txt(h.name), extra: txt(h.instance) });
    else if (h.kind === "moment" && RARE_MOMENTS.has(h.moment)) push("rare", h.ev, { name: txt(h.name), place: txt(h.place), level: Number.isFinite(h.level) ? h.level : null });
  }
  for (const ev of (Array.isArray(events) ? events : [])) {
    if (ev && ev.code === "EX" && Number.isFinite(ev.t)) push("discovery", ev, { name: txt(field(ev, "name")), level: fnum(ev, "level") });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

// Stufe zu jedem Zeitpunkt aus LV-Zeilen; davor die erste bekannte Stufe des Journals
export function levelTrack(journal, events) {
  const steps = [];
  for (const ev of (Array.isArray(events) ? events : [])) {
    if (ev && ev.code === "LV" && Number.isFinite(ev.t)) {
      const l = fnum(ev, "level");
      if (Number.isInteger(l) && l > 0 && l < 1000) steps.push({ t: ev.t, level: l });
    }
  }
  const first = journal && Number.isFinite(journal.firstLevel) ? journal.firstLevel : steps.length ? Math.max(1, steps[0].level - 1) : null;
  return { first, steps };
}

// letzter Index i mit list[i].t <= t (list nach t sortiert) oder -1; Binärsuche
function lastAtOrBefore(list, t) {
  let lo = 0, hi = list.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].t <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

export function levelAt(track, t) {
  if (!track) return null;
  const steps = Array.isArray(track.steps) ? track.steps : [];
  const i = Number.isNaN(t) ? -1 : lastAtOrBefore(steps, t);
  return i >= 0 ? steps[i].level : track.first;
}

// Spielzeit zu jedem Zeitpunkt: letzte /played-Zeile (PL total) plus aktive Zeit auf der Spur seitdem (Lücken über
// ACTIVE_GAP zählen nicht). Ohne PL-Zeile nur die aktive Zeit der Spur.
export function playedTrack(events, trail) {
  const ts = [], acc = [];
  let prev = null, sum = 0;
  for (const s of (trail && Array.isArray(trail.segments) ? trail.segments : [])) {
    for (let i = 0; i < s.n; i++) {
      const t = s.t[i];
      if (prev !== null && t > prev && t - prev <= ACTIVE_GAP) sum += t - prev;
      if (prev === null || t >= prev) {
        ts.push(t);
        acc.push(sum);
        prev = t;
      }
    }
  }
  const pl = [];
  for (const ev of (Array.isArray(events) ? events : [])) {
    if (ev && ev.code === "PL" && Number.isFinite(ev.t)) {
      const total = fnum(ev, "total");
      if (total !== null && total >= 0) pl.push({ t: ev.t, total });
    }
  }
  return { ts, acc, pl };
}

function activeAt(track, t) {
  const { ts, acc } = track;
  if (!ts.length || t <= ts[0]) return 0;
  if (t >= ts[ts.length - 1]) return acc[acc.length - 1];
  let lo = 0, hi = ts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] <= t) lo = mid;
    else hi = mid;
  }
  const gap = ts[hi] - ts[lo];
  return gap > 0 ? acc[lo] + ((acc[hi] - acc[lo]) * (t - ts[lo])) / gap : acc[lo];
}

export function playedAt(track, t) {
  if (!track || !Number.isFinite(t)) return null;
  if (!track.pl.length) return track.ts.length ? activeAt(track, t) : null;
  const bi = lastAtOrBefore(track.pl, t);
  const base = bi >= 0 ? track.pl[bi] : null;
  if (base) return base.total + Math.max(0, activeAt(track, t) - activeAt(track, base.t));
  const first = track.pl[0];
  return Math.max(0, first.total - (activeAt(track, first.t) - activeAt(track, t)));
}

// Kapitel je Zone: aus dem Journal (gleiche Regel wie im Spiel), sonst aus der Spur (Strecken je Zone hintereinander).
// -> [{ n, mapID, name, t0, t1, a0, a1, minLevel, maxLevel }]
export function buildChapters(journal, trail, index) {
  const tl = trail ? trail.timeline : null;
  const list = [];
  const src = journal && Array.isArray(journal.chapters) ? journal.chapters : [];
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (!ch || !Number.isFinite(ch.start)) continue;
    const next = src[i + 1];
    const t1 = next && Number.isFinite(next.start) ? next.start : Number.isFinite(ch.end) ? ch.end : ch.start;
    let mapID = idOf(ch.zone);
    if (!mapID && trail) {
      const p = positionAt(trail, ch.start);
      mapID = p ? p.mapID : null;
    }
    list.push({ src: i, mapID, name: txt(ch.zoneName), t0: ch.start, t1, minLevel: ch.minLevel ?? null, maxLevel: ch.maxLevel ?? null });
  }
  if (!list.length && trail && Array.isArray(trail.segments)) {
    for (const s of trail.segments) {
      const z = zoneOf(s.mapID, index) || s.mapID;
      const last = list[list.length - 1];
      if (last && last.mapID === z) last.t1 = s.t1;
      else list.push({ src: -1, mapID: z, name: null, t0: s.t0, t1: s.t1, minLevel: null, maxLevel: null });
    }
  }
  return list.map((c, i) => {
    const info = c.mapID ? mapInfo(c.mapID, index) : null;
    return {
      n: i + 1,
      ...c,
      name: c.name || (info ? safeText(info.name, NAME_MAX) : c.mapID ? "#" + c.mapID : null),
      a0: tl ? toAxis(tl, c.t0) : 0,
      a1: tl ? toAxis(tl, c.t1) : 0,
    };
  });
}

// Akte (Gruppen von Kapiteln, gleiche Regel wie im Spiel: journal.acts) auf die Kapitel der Karte gelegt.
// -> [{ n, chapters (Indizes in chapters), mapID, name (Anker-Zone), t0, t1, a0, a1, levelFrom, levelTo, played, quests,
//       kills, deaths, places }]; leer, wenn das Journal keine Akte hat (dann gilt die flache Kapitelleiste)
export function buildActs(journal, chapters) {
  const src = journal && Array.isArray(journal.acts) ? journal.acts : [];
  const jcs = journal && Array.isArray(journal.chapters) ? journal.chapters : [];
  const list = Array.isArray(chapters) ? chapters : [];
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const out = [];
  for (const a of src) {
    if (!a || !Array.isArray(a.chapters)) continue;
    const idx = [];
    for (const ci of a.chapters) {
      const k = list.findIndex((c) => c.src === ci);
      if (k >= 0 && !idx.includes(k)) idx.push(k);
    }
    if (!idx.length) continue;
    const first = list[idx[0]];
    const last = list[idx[idx.length - 1]];
    const ak = list.findIndex((c) => c.src === a.anchor);
    const anchor = ak >= 0 ? list[ak] : first;
    let places = 0;
    for (const ci of a.chapters) if (jcs[ci] && Array.isArray(jcs[ci].discoveries)) places += jcs[ci].discoveries.length;
    out.push({
      n: out.length + 1, chapters: idx, mapID: anchor.mapID, name: anchor.name, t0: first.t0, t1: last.t1, a0: first.a0, a1: last.a1,
      levelFrom: num(a.levelFrom), levelTo: num(a.levelTo), played: num(a.active), quests: num(a.quests), kills: num(a.kills),
      deaths: num(a.deaths), places,
    });
  }
  return out;
}

// Akt (Index) zum Kapitel-Index oder -1
export function actOfChapter(acts, ci) {
  for (let i = 0; i < acts.length; i++) if (acts[i].chapters.includes(ci)) return i;
  return -1;
}

// Kapitel, das zur Achsensekunde a läuft (Index) oder -1
export function chapterAtAxis(chapters, a) {
  let found = -1;
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i].a0 <= a) found = i;
    else break;
  }
  return found;
}

// Welche Karte zeigt die Seite? mode "zone" | "continent"; base = uiMap des Kapitels oder der aktuellen Position.
// -> { mapID, art } (art = Kartenkunst laut Index; ob das Bild wirklich da ist, entscheidet erst das Laden)
export function chooseMap(mode, baseID, index) {
  if (!baseID) return null;
  if (mode === "continent") {
    const info = mapInfo(baseID, index);
    const c = info && info.type === CONTINENT_TYPE ? baseID : continentOf(baseID, index);
    if (c) return displayMap(c, index);
  }
  return displayMap(baseID, index);
}

function pushThin(line, x, y, t, force, thin = THIN) {
  const n = line.x.length;
  if (n > 0 && !force) {
    const dx = x - line.x[n - 1], dy = y - line.y[n - 1];
    if (dx * dx + dy * dy < thin * thin) return;
  }
  line.x.push(x);
  line.y.push(y);
  line.t.push(t);
}

const near = (p) => p.x > -0.6 && p.x < 1.6 && p.y > -0.6 && p.y < 1.6;

// Ortsnamen für den Rückfall ohne Kartenbild: auf einem Kontinent die Zonen, auf einer Zone die Nachbarzonen (aus dem
// Index) und die Unterzonen/Entdeckungen aus dem Log an der Stelle der Spur. names: Map(uiMapID -> Name aus der Datei).
export function buildLabels(mapID, { events, trail, index, names } = {}) {
  const out = [];
  const seen = new Set();
  const add = (text, x, y, kind) => {
    const s = txt(text);
    if (!s || seen.has(s) || out.length >= LABELS_MAX) return;
    if (!(x >= -0.02 && x <= 1.02 && y >= -0.02 && y <= 1.02)) return;
    seen.add(s);
    out.push({ text: s, x, y, kind });
  };
  const self = mapInfo(mapID, index);
  const maps = mapIndex(index).maps;
  const nameFor = (id, info) => (names && names.get(id)) || (info && info.name) || null;
  if (self) {
    const cont = self.type === CONTINENT_TYPE ? mapID : self.continent;
    for (const key of Object.keys(maps)) {
      const id = Number(key);
      const info = maps[key];
      if (!info || info.type !== ZONE_TYPE || info.continent !== cont || id === mapID) continue;
      const r = Array.isArray(info.rect) ? info.rect : null;
      if (!r) continue;
      const c = project(cont, (r[0] + r[1]) / 2, (r[2] + r[3]) / 2, mapID, index);
      if (c) add(nameFor(id, info), c.x, c.y, "zone");
    }
  }
  for (const ev of (Array.isArray(events) ? events : [])) {
    if (!ev || (ev.code !== "SZ" && ev.code !== "EX") || !Number.isFinite(ev.t)) continue;
    const p = trail ? positionAt(trail, ev.t) : null;
    if (!p) continue;
    const q = project(p.mapID, p.x / 10000, p.y / 10000, mapID, index);
    if (q) add(field(ev, "name"), q.x, q.y, "place");
  }
  return out;
}

// Alles für eine Zielkarte vorbereiten (einmal je Karte, danach nur noch zeichnen).
// -> { mapID, lines: [{ x, y, t }], flights: [{ x0, y0, x1, y1, t0, t1 }], markers: [{ ...marker, px, py }], labels, bounds }
// Wichtigkeit der Markerarten, wenn eine Szene mehr als SCENE_MARKERS_MAX Marker hätte (kleiner = wichtiger)
const MARKER_RANK = { death: 0, boss: 1, level: 2, rare: 3, discovery: 4 };
const markerRank = (m) => (m && Object.prototype.hasOwnProperty.call(MARKER_RANK, m.kind) ? MARKER_RANK[m.kind] : 5);

// höchstens max Marker: wichtigste Arten zuerst, innerhalb einer Art die früheren; Ergebnis wieder nach Zeit
export function capMarkers(list, max = SCENE_MARKERS_MAX) {
  if (list.length <= max) return list;
  const keep = list.map((m, i) => ({ m, i })).sort((a, b) => markerRank(a.m) - markerRank(b.m) || a.i - b.i).slice(0, max);
  return keep.sort((a, b) => a.i - b.i).map((k) => k.m);
}

// Linien einer Szene projizieren und ausdünnen (thin = Mindestabstand); -> { lines, points, bounds }
function sceneLines(trail, aff, thin) {
  const lines = [];
  let points = 0;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const grow = (p) => {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  };
  for (const s of (trail && Array.isArray(trail.segments) ? trail.segments : [])) {
    const a = aff(s.mapID);
    if (!a) continue;
    const line = { x: [], y: [], t: [] };
    if (s.link) {
      const la = aff(s.link.mapID);
      if (la) pushThin(line, la.ox + (la.sx * s.link.x) / 10000, la.oy + (la.sy * s.link.y) / 10000, s.link.t, true, thin);
    }
    let any = false;
    for (let i = 0; i < s.n; i++) {
      const p = { x: a.ox + (a.sx * s.x[i]) / 10000, y: a.oy + (a.sy * s.y[i]) / 10000 };
      if (near(p)) {
        any = true;
        if (p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1) grow(p);
      }
      pushThin(line, p.x, p.y, s.t[i], i === s.n - 1, thin);
    }
    if (any && line.x.length) {
      lines.push(line);
      points += line.x.length;
    }
  }
  return { lines, points, bounds: x1 >= x0 ? { x0, x1, y0, y1 } : null };
}

// jeden k-ten Punkt einer Linie behalten (erster und letzter bleiben) – letzte Bremse nach dem Ausdünnen
function decimate(line, k) {
  const out = { x: [], y: [], t: [] };
  const n = line.x.length;
  for (let i = 0; i < n; i++) {
    if (i % k !== 0 && i !== n - 1) continue;
    out.x.push(line.x[i]);
    out.y.push(line.y[i]);
    out.t.push(line.t[i]);
  }
  return out;
}

export function prepareMapScene(trail, mapID, { markers = [], labels = [], index, maxPoints = SCENE_POINTS_MAX, maxMarkers = SCENE_MARKERS_MAX } = {}) {
  const flights = [], placed = [];
  const cache = new Map();
  const aff = (id) => {
    if (!cache.has(id)) cache.set(id, affine(id, mapID, index));
    return cache.get(id);
  };
  // zu viele Punkte: Mindestabstand verdoppeln (höchstens sechsmal), danach jeden k-ten Punkt behalten
  let thin = THIN;
  let built = sceneLines(trail, aff, thin);
  for (let round = 0; built.points > maxPoints && round < 6; round++) {
    thin *= 2;
    built = sceneLines(trail, aff, thin);
  }
  let lines = built.lines;
  if (built.points > maxPoints) {
    const k = Math.ceil(built.points / maxPoints);
    lines = lines.map((l) => decimate(l, k));
  }
  for (const f of (trail && Array.isArray(trail.flights) ? trail.flights : [])) {
    const p = project(f.from.mapID, f.from.x / 10000, f.from.y / 10000, mapID, index);
    const q = project(f.to.mapID, f.to.x / 10000, f.to.y / 10000, mapID, index);
    if (p && q && (near(p) || near(q))) flights.push({ x0: p.x, y0: p.y, x1: q.x, y1: q.y, t0: f.t0, t1: f.t1 });
  }
  for (const m of markers) {
    const p = project(m.mapID, m.x, m.y, mapID, index);
    if (p && p.x >= -0.02 && p.x <= 1.02 && p.y >= -0.02 && p.y <= 1.02) placed.push({ ...m, px: p.x, py: p.y });
  }
  return { mapID, lines, flights, markers: capMarkers(placed, maxMarkers), labels, bounds: built.bounds };
}
