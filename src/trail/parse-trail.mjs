// Positionsspur eines Charakters (chars[guid].trail, README "Log format" -> "Trail") lesen, streng prüfen, in Strecken
// zerlegen und auf eine Wiedergabe-Zeitachse legen. Reine Daten, kein DOM. Logik wie decodeTrail/buildIdle in
// addon/InkAndEmbers/journal/Model.lua, aber ohne Ausdünnen (das macht die Zeichnung).
//
// Block: Kopf "#~<epoch>~<uiMapID>", dann 1..500 Zeilen "<dt>~<x>~<y>[~<mark>]"; x, y ganzzahlig 0..9999, dt Sekunden ab
// Kopf, Marken nur z (Zonenwechsel), d (Tod), f (Abflug), l (Landung). Alles andere wird verworfen und gezählt, nie gezeichnet.
import { isTable, luaArray } from "../core/lua-parse.mjs";

export const TRAIL_LIMITS = Object.freeze({
  MAX_BLOCKS: 50000,
  MAX_POINTS_PER_BLOCK: 500,
  MAX_POINTS: 2000000,
  MAX_BLOCK_CHARS: 16384, // 500 Zeilen à höchstens 20 Zeichen + Kopf
  COORD_MAX: 9999,
  DT_MAX: 7 * 86400, // ein Block endet spätestens beim Ausloggen; eine Woche ist großzügig
  EPOCH_MIN: 1104537600, // 2005-01-01
  EPOCH_MAX: 4102444800, // 2100-01-01
  MAP_ID_MAX: 1000000,
});

export const MARKS = Object.freeze({ z: "zone", d: "death", f: "takeoff", l: "landing" });

// Schwellen wie im Addon (Model.lua)
export const SEGMENT = Object.freeze({
  BREAK_GAP: 120, // s ohne Punkt ...
  BREAK_DIST: 200, // ... und weiter als das (Einheiten 0..9999) = Sprung (Teleport, Portal)
  LINK_GAP: 30, // Kartenwechsel binnen so vieler s: Strecke läuft optisch weiter (link)
});
export const IDLE = Object.freeze({ GAP: 66, KEEP: 12, FLIGHT_KEEP: 60 });

const HEAD_RE = /^#~(\d{1,10})~(\d{1,7})$/;
const LINE_RE = /^(\d{1,7})~(\d{1,4})~(\d{1,4})(?:~([a-z]))?$/;

function newStats() {
  return {
    blocks: 0, blocksDropped: 0, lines: 0, linesDropped: 0, points: 0, truncated: false,
    dropped: { type: 0, size: 0, head: 0, duplicate: 0, form: 0, range: 0, mark: 0, order: 0, limit: 0 },
  };
}

function dropBlock(stats, why) {
  stats.blocksDropped++;
  stats.dropped[why]++;
}

function dropLine(stats, why) {
  stats.linesDropped++;
  stats.dropped[why]++;
}

// trail-Tabelle aus der Datei (Lua-Tabelle oder Array) -> { blocks, stats }
// blocks: [{ start, mapID, n, t: [epoch], x: [0..9999], y: [0..9999], mk: [Marke|null] }] nach start sortiert
export function parseTrail(trail, limits = TRAIL_LIMITS) {
  const L = { ...TRAIL_LIMITS, ...limits };
  const stats = newStats();
  const list = Array.isArray(trail) ? trail : isTable(trail) ? luaArray(trail) : [];
  const blocks = [];
  const seen = new Set();
  for (let bi = 0; bi < list.length; bi++) {
    const text = list[bi];
    stats.blocks++;
    if (bi >= L.MAX_BLOCKS) {
      dropBlock(stats, "limit");
      stats.truncated = true;
      continue;
    }
    if (typeof text !== "string") {
      dropBlock(stats, "type");
      continue;
    }
    if (text.length > L.MAX_BLOCK_CHARS) {
      dropBlock(stats, "size");
      continue;
    }
    if (seen.has(text)) {
      dropBlock(stats, "duplicate");
      continue;
    }
    seen.add(text);
    const lines = text.split("\n");
    const head = HEAD_RE.exec(stripCr(lines[0]));
    const start = head ? Number(head[1]) : NaN;
    const mapID = head ? Number(head[2]) : NaN;
    if (!head || start < L.EPOCH_MIN || start > L.EPOCH_MAX || mapID < 1 || mapID > L.MAP_ID_MAX) {
      dropBlock(stats, "head");
      continue;
    }
    const b = { start, mapID, n: 0, t: [], x: [], y: [], mk: [] };
    let lastDt = -1;
    for (let i = 1; i < lines.length; i++) {
      const line = stripCr(lines[i]);
      if (line === "") continue;
      stats.lines++;
      const m = LINE_RE.exec(line);
      if (!m) {
        dropLine(stats, "form");
        continue;
      }
      const dt = Number(m[1]), x = Number(m[2]), y = Number(m[3]), mark = m[4] || null;
      if (dt > L.DT_MAX || x > L.COORD_MAX || y > L.COORD_MAX) {
        dropLine(stats, "range");
        continue;
      }
      if (mark !== null && !Object.prototype.hasOwnProperty.call(MARKS, mark)) {
        dropLine(stats, "mark");
        continue;
      }
      if (dt < lastDt) {
        dropLine(stats, "order");
        continue;
      }
      if (b.n >= L.MAX_POINTS_PER_BLOCK || stats.points >= L.MAX_POINTS) {
        dropLine(stats, "limit");
        if (stats.points >= L.MAX_POINTS) stats.truncated = true;
        continue;
      }
      lastDt = dt;
      b.t.push(start + dt);
      b.x.push(x);
      b.y.push(y);
      b.mk.push(mark);
      b.n++;
      stats.points++;
    }
    if (b.n > 0) blocks.push(b);
  }
  // stabil nach Startzeit (Spiegel-Abgleich kann Blöcke umsortieren)
  blocks.sort((a, c) => a.start - c.start);
  return { blocks, stats };
}

function stripCr(s) {
  return s !== undefined && s.endsWith("\r") ? s.slice(0, -1) : s || "";
}

// Unterbrechungen aus dem Log (Ereignisse von core/journal-model.mjs parseLog): Login, Ruhestein, Instanz, Positions-
// lücke (TP außer Flug), Geistheiler/Wiederbelebung (DB). -> [{ t, reason }] nach Zeit
const BREAK_CODES = { L: "login", HS: "hearth", IE: "instance", IL: "instance", TP: "gap", DB: "death" };

export function breaksFromLog(events) {
  const out = [];
  if (!Array.isArray(events)) return out;
  for (const ev of events) {
    if (!ev || typeof ev.code !== "string" || !Number.isFinite(ev.t)) continue;
    const reason = Object.prototype.hasOwnProperty.call(BREAK_CODES, ev.code) ? BREAK_CODES[ev.code] : null;
    if (!reason) continue;
    if (ev.code === "TP" && Array.isArray(ev.f) && ev.f[0] === "taxi") continue;
    out.push({ t: ev.t, reason });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

// Vorrang, wenn mehrere Gründe zugleich eine neue Strecke beginnen lassen
const REASON_RANK = { hearth: 1, instance: 2, login: 3, gap: 4, death: 5, flight: 6, jump: 7, zone: 8, map: 9 };
const better = (a, b) => (!a ? b : !b ? a : REASON_RANK[b] < REASON_RANK[a] ? b : a);

// Blöcke -> Strecken. Neue Strecke bei Kartenwechsel (map), Marke z (zone), nach d (death) oder f (flight), bei einer
// Unterbrechung aus dem Log zwischen zwei Punkten (hearth/instance/login/gap/death) und bei einem Sprung (jump).
// segments: [{ mapID, reason, t0, t1, n, t, x, y, link }] (reason der ersten Strecke: "start"; link = letzter Punkt der
//   vorigen Strecke, wenn ein Kartenwechsel binnen LINK_GAP s weiterläuft)
// flights: [{ from: {mapID,x,y}, to: {mapID,x,y}, t0, t1 }] (f gefolgt von l, gestrichelt zu zeichnen)
// hops: [{ reason, from, to, t0, t1 }] Übergänge zwischen Strecken ohne Laufweg (Flug, Ruhestein, Sprung, Instanz ...)
// marks: [{ kind: zone|death|takeoff|landing, mapID, x, y, t }]
export function segmentTrail(parsed, options = {}) {
  const blocks = parsed && Array.isArray(parsed.blocks) ? parsed.blocks : [];
  const breaks = (Array.isArray(options.breaks) ? options.breaks : []).filter((b) => b && Number.isFinite(b.t) && REASON_RANK[b.reason]);
  breaks.sort((a, b) => a.t - b.t);
  const BG = SEGMENT.BREAK_GAP, BD2 = SEGMENT.BREAK_DIST * SEGMENT.BREAK_DIST, LG = SEGMENT.LINK_GAP;
  const segments = [], flights = [], hops = [], marks = [];
  let seg = null;
  let p = null; // voriger Punkt { t, x, y, mapID, mark }
  let bi = 0;
  for (const b of blocks) {
    for (let i = 0; i < b.n; i++) {
      const t = b.t[i], x = b.x[i], y = b.y[i], mark = b.mk[i];
      if (p && t < p.t) continue; // überlappende Blöcke: nie rückwärts zeichnen
      let reason = null;
      // Unterbrechungen strikt nach dem vorigen Punkt und bis einschließlich jetzt
      while (bi < breaks.length && breaks[bi].t <= t) {
        if (p && breaks[bi].t > p.t) reason = better(reason, breaks[bi].reason);
        bi++;
      }
      if (p) {
        if (b.mapID !== p.mapID) reason = better(reason, "map");
        if (mark === "z") reason = better(reason, "zone");
        if (p.mark === "d") reason = better(reason, "death");
        if (p.mark === "f") reason = better(reason, "flight");
        if (!reason && t - p.t > BG) {
          const dx = x - p.x, dy = y - p.y;
          if (dx * dx + dy * dy > BD2) reason = "jump";
        }
      }
      if (p && p.mark === "f" && mark === "l") {
        flights.push({ from: { mapID: p.mapID, x: p.x, y: p.y }, to: { mapID: b.mapID, x, y }, t0: p.t, t1: t });
      }
      if (!seg || reason) {
        let link = null;
        // jeder Kartenwechsel binnen LINK_GAP läuft weiter (auch mit Marke z), nicht nach Tod/Abflug/Log-Unterbrechung
        if (p && (reason === "map" || reason === "zone") && b.mapID !== p.mapID && t - p.t <= LG) {
          link = { mapID: p.mapID, x: p.x, y: p.y, t: p.t };
        }
        if (p && reason && reason !== "map" && reason !== "zone") {
          hops.push({ reason, from: { mapID: p.mapID, x: p.x, y: p.y }, to: { mapID: b.mapID, x, y }, t0: p.t, t1: t });
        }
        seg = { mapID: b.mapID, reason: p ? reason : "start", t0: t, t1: t, n: 0, t: [], x: [], y: [], link };
        segments.push(seg);
      }
      seg.t.push(t);
      seg.x.push(x);
      seg.y.push(y);
      seg.n++;
      seg.t1 = t;
      if (mark) marks.push({ kind: MARKS[mark], mapID: b.mapID, x, y, t });
      p = { t, x, y, mapID: b.mapID, mark };
    }
  }
  // Anfangszeiten der Strecken einmal vorhalten (positionAt wird je Video-Bild vielfach aufgerufen)
  return { segments, flights, hops, marks, starts: segments.map((s) => s.t0) };
}

// Wiedergabe-Zeitachse: Stillstand (kein Punkt länger als IDLE.GAP s: AFK, Kampf auf der Stelle, offline) schrumpft auf
// IDLE.KEEP s, ein Flug auf IDLE.FLIGHT_KEEP s. Achse in Sekunden ab dem ersten Punkt.
// -> { t0, t1, length, a, b, q, k } (a..b Epoch-Intervall der Lücke, q Achsenbeginn, k Achsenlänge)
export function buildTimeline(seg) {
  const segments = seg && Array.isArray(seg.segments) ? seg.segments : [];
  const flightAt = new Set((seg && Array.isArray(seg.flights) ? seg.flights : []).map((f) => f.t0));
  const A = [], B = [], K = [];
  let prev = null, first = null;
  for (const s of segments) {
    for (let i = 0; i < s.n; i++) {
      const t = s.t[i];
      if (first === null) first = t;
      if (prev !== null && t - prev > IDLE.GAP) {
        A.push(prev);
        B.push(t);
        K.push(flightAt.has(prev) ? IDLE.FLIGHT_KEEP : IDLE.KEEP);
      }
      if (prev === null || t > prev) prev = t;
    }
  }
  if (first === null) return { t0: null, t1: null, length: 0, a: [], b: [], q: [], k: [] };
  const Q = [];
  let removed = 0;
  for (let i = 0; i < A.length; i++) {
    Q.push(A[i] - first - removed);
    removed += B[i] - A[i] - K[i];
  }
  return { t0: first, t1: prev, length: prev - first - removed, a: A, b: B, q: Q, k: K };
}

// letzter Index i mit arr[i] <= v, sonst -1
function findLE(arr, v) {
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

// Epoch -> Achsensekunde (geklemmt auf 0..length)
export function toAxis(tl, t) {
  if (!tl || tl.t0 === null || !Number.isFinite(t)) return 0;
  if (t <= tl.t0) return 0;
  if (t >= tl.t1) return tl.length;
  const i = findLE(tl.a, t);
  if (i < 0) return t - tl.t0;
  const a = tl.a[i], b = tl.b[i], q = tl.q[i], k = tl.k[i];
  if (t < b) return q + ((t - a) * k) / (b - a);
  return q + k + (t - b);
}

// Achsensekunde -> Epoch
export function fromAxis(tl, q) {
  if (!tl || tl.t0 === null || !Number.isFinite(q)) return tl ? tl.t0 : null;
  if (q <= 0) return tl.t0;
  if (q >= tl.length) return tl.t1;
  const i = findLE(tl.q, q);
  if (i < 0) return tl.t0 + q;
  const a = tl.a[i], b = tl.b[i], q0 = tl.q[i], k = tl.k[i];
  if (q < q0 + k) return a + ((q - q0) * (b - a)) / k;
  return b + (q - q0 - k);
}

// Position zum Zeitpunkt t: { segment, index, mapID, x, y } (zwischen zwei Punkten einer Strecke linear), vor dem ersten
// Punkt null, in einer Lücke zwischen Strecken der letzte Punkt davor
export function positionAt(seg, t) {
  const segments = seg && Array.isArray(seg.segments) ? seg.segments : [];
  if (!segments.length || !Number.isFinite(t) || t < segments[0].t0) return null;
  const starts = Array.isArray(seg.starts) && seg.starts.length === segments.length ? seg.starts : segments.map((s) => s.t0);
  const si = findLE(starts, t);
  const s = segments[si];
  const i = findLE(s.t, t);
  if (i >= s.n - 1 || s.t[i] === t) return { segment: si, index: i, mapID: s.mapID, x: s.x[i], y: s.y[i] };
  const f = (t - s.t[i]) / (s.t[i + 1] - s.t[i]);
  return { segment: si, index: i, mapID: s.mapID, x: s.x[i] + (s.x[i + 1] - s.x[i]) * f, y: s.y[i] + (s.y[i + 1] - s.y[i]) * f };
}

// Bequemer Gesamtweg für einen Charakter der Datei: char-Tabelle (+ optional parseLog-Ereignisse) -> alles zusammen
export function readCharacterTrail(char, events) {
  const parsed = parseTrail(isTable(char) ? char.trail : null);
  const seg = segmentTrail(parsed, { breaks: breaksFromLog(events) });
  return { ...seg, timeline: buildTimeline(seg), stats: parsed.stats };
}
