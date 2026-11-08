// Gemeinsame Grundlage der Chronik-Berechnungen (kein DOM, keine Texte): Zeilen des Charakters mit Feldzugriff, Namen aus den
// Schnappschüssen, Sitzungsspannen (aktive Spielzeit) und kleine Zahlenhelfer. Liest nur, ändert nichts an src/core.
// Alles aus der Datei bleibt Rohtext; die Ansicht setzt ihn ausschließlich als Textknoten ein.
import { parseLog, FIELDS, itemIdOf } from "../core/journal-model.mjs";
import { isTable, luaArray } from "../core/lua-parse.mjs";

// Zeilenarten, die der Kern nicht liest, die die Chronik aber braucht (Reihenfolge der Felder wie ns.Types im Addon)
const MORE_FIELDS = {
  GU: ["action", "guild", "rank", "rankIndex", "level"],
  DU: ["opponent", "result", "level", "mapID"],
  WB: ["name", "class", "race", "level", "mapID", "x", "y"],
  WV: ["name", "class", "race", "level", "mapID", "x", "y", "why"],
  LG: ["item", "count", "quality", "who", "class", "roll"],
  AF: ["seconds", "level", "mapID", "why"],
};
// Objekt ohne Prototyp: ein Zeilenkürzel wie "constructor" aus der Datei trifft nie eine Eigenschaft von Object
const ALL_FIELDS = Object.assign(Object.create(null), FIELDS, MORE_FIELDS);

// Feldtext einer Zeile ("" und "?" zählen als fehlend)
export function fld(ev, name) {
  const names = ALL_FIELDS[ev.code];
  if (!names) return null;
  const i = names.indexOf(name);
  if (i < 0) return null;
  const v = ev.f[i];
  return v === undefined || v === "" || v === "?" ? null : v;
}

export function num(ev, name) {
  const v = fld(ev, name);
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function toNum(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return null;
}

// Gegenstands-Schlüssel einer Beutezeile (README „Log format“): "<itemID>[.s<suffix>][.b<bonus>]{0,8}"; alles andere
// (abgeschnittene Einträge, fremde Zeichen, überlange Texte) gilt als fehlend
export const ITEM_KEY_RE = /^\d+(\.s-?\d+)?(\.b\d+){0,8}$/;
export function itemKey(v) {
  return typeof v === "string" && v.length <= 120 && ITEM_KEY_RE.test(v) ? v : null;
}

// Gegenstandsqualität: ganze Zahl, auf 0..7 geklemmt (0 grau … 7 Erbstück); kein Zahlwert -> null
export function itemQuality(v) {
  const n = typeof v === "number" ? v : toNum(v);
  if (n === null || !Number.isFinite(n)) return null;
  return Math.min(7, Math.max(0, Math.floor(n)));
}

export const isFiniteNum = (v) => typeof v === "number" && Number.isFinite(v);

// Stufe des Charakters in einer Zeile (bei KI steht die eigene Stufe in plevel); nur 1..200
export function levelOf(ev) {
  const n = ev.code === "KI" ? num(ev, "plevel") : num(ev, "level");
  return n !== null && n >= 1 && n <= 200 ? Math.floor(n) : null;
}

export function validLevel(v) {
  const n = toNum(v);
  return n !== null && n >= 1 && n <= 200 ? Math.floor(n) : null;
}

// ganzzahlige ID aus Feldtext (positiv, kleiner 2^31) oder null
export function posId(v) {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d{1,10}$/.test(v) ? Number(v) : null;
  return n !== null && Number.isInteger(n) && n > 0 && n < 2147483648 ? n : null;
}

function entry(tbl, key) {
  if (!isTable(tbl) || key === null || key === undefined || key === "") return undefined;
  return tbl[String(key)];
}

// Name eines Eintrags einer Schnappschuss-Gruppe (Text oder Tabelle mit name)
export function nameIn(group, id) {
  const e = entry(group, id);
  const v = typeof e === "string" ? e : isTable(e) ? e.name : null;
  return typeof v === "string" && v !== "" ? v : null;
}

export function snapGroup(char, name) {
  const s = isTable(char) && isTable(char.snapshots) ? char.snapshots[name] : null;
  return isTable(s) ? s : null;
}

export function bsearchLE(arr, v) {
  let lo = 0;
  let hi = arr.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= v) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}

// erster Index mit list[i].t >= t (Listen sind nach Zeit sortiert)
export function lowerBound(list, t) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// alle Zeilen der Liste innerhalb der Spannen [a1, b1, a2, b2 ...] (zeitlich sortiert)
export function eachIn(list, intervals, fn) {
  for (let k = 0; k < intervals.length; k += 2) {
    const a = intervals[k];
    const b = intervals[k + 1];
    for (let i = lowerBound(list, a); i < list.length && list[i].t <= b; i++) fn(list[i], i);
  }
}

// Sitzungsspannen des Charakters aus meta.sessions (start/stop; ohne stop: lastKnown bei Abbruch, sonst lastSave)
export function sessionSpans(db, guid) {
  const meta = isTable(db) && isTable(db.meta) ? db.meta : null;
  const raw = [];
  for (const s of luaArray(meta ? meta.sessions : null)) {
    if (!isTable(s) || s.guid !== guid) continue;
    const t0 = toNum(s.start);
    if (t0 === null) continue;
    let t1 = toNum(s.stop);
    if (t1 === null) {
      t1 = s.interrupted === true ? toNum(s.lastKnown) : toNum(s.lastSave);
      if (t1 === null) t1 = t0;
    }
    raw.push([t0, Math.max(t0, t1)]);
  }
  raw.sort((a, b) => a[0] - b[0]);
  const sp = { t0: [], t1: [], cum: [] };
  for (const [a, b] of raw) {
    const k = sp.t0.length - 1;
    if (k >= 0 && a <= sp.t1[k]) {
      if (b > sp.t1[k]) sp.t1[k] = b;
    } else {
      sp.t0.push(a);
      sp.t1.push(b);
    }
  }
  let cum = 0;
  for (let i = 0; i < sp.t0.length; i++) {
    sp.cum[i] = cum;
    cum += sp.t1[i] - sp.t0[i];
  }
  return sp;
}

function activeUntil(sp, t) {
  const i = bsearchLE(sp.t0, t);
  if (i < 0) return 0;
  return sp.cum[i] + (Math.min(t, sp.t1[i]) - sp.t0[i]);
}

// aktive Spielzeit zwischen zwei Zeitpunkten (ohne Zeiten außerhalb der Sitzungen; ohne Sitzungen: die ganze Spanne)
export function activeSeconds(sp, t0, t1) {
  if (!isFiniteNum(t0) || !isFiniteNum(t1) || t1 <= t0) return 0;
  if (!sp || sp.t0.length === 0) return t1 - t0;
  return activeUntil(sp, t1) - activeUntil(sp, t0);
}

// Ende der Sitzungsspanne, in der t liegt (null, wenn t in keiner liegt)
export function sessionEnd(sp, t) {
  if (!sp || sp.t0.length === 0) return null;
  const i = bsearchLE(sp.t0, t);
  if (i < 0 || sp.t1[i] < t) return null;
  return sp.t1[i];
}

// Kontext eines Charakters: alle Zeilen (nach Zeit), nach Kürzel geordnet, Namenstabellen, Sitzungen
export function makeCtx(db, guid) {
  const char = db.chars[guid];
  const info = isTable(char.info) ? char.info : {};
  const events = parseLog(char);
  const byCode = new Map();
  for (const ev of events) {
    let l = byCode.get(ev.code);
    if (!l) byCode.set(ev.code, (l = []));
    l.push(ev);
  }
  const snaps = isTable(char.snapshots) ? char.snapshots : {};
  const firstSeen = toNum(info.firstSeen);
  const firstT = events.length ? events[0].t : firstSeen;
  const lastT = events.length ? events[events.length - 1].t : firstSeen; // ohne Zeilen gibt es keine Spanne (wie im Addon-Index)
  const startT = firstSeen !== null && firstT !== null && firstSeen < firstT ? firstSeen : firstT;
  const ctx = {
    db,
    guid,
    char,
    info,
    events,
    startT,
    firstT,
    lastT,
    sessions: sessionSpans(db, guid),
    list: (code) => byCode.get(code) || [],
    mapName: (id) => nameIn(snaps.maps, id),
    instanceName: (id) => nameIn(snaps.instances, id),
    encounterName: (id) => nameIn(snaps.encounters, id),
    npcName: (id) => nameIn(char.npcs, id),
    itemSnap: (key) => {
      const k = itemKey(key);
      const e = k ? entry(snaps.items, itemIdOf(k)) : undefined;
      return isTable(e) ? e : null;
    },
    questTitle: (id) => {
      const e = entry(char.quests, id);
      return isTable(e) && typeof e.title === "string" && e.title !== "" ? e.title : null;
    },
  };
  return ctx;
}

// Gesamtzahl der Einträge einer Zählergruppe (counters[group]); distinct: Anzahl der Schlüssel mit Wert > 0
export function counterValue(char, group, distinct = false) {
  const c = isTable(char) && isTable(char.counters) ? char.counters[group] : null;
  if (!isTable(c)) return 0;
  let n = 0;
  for (const k of Object.keys(c)) {
    const v = c[k];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) n += distinct ? 1 : v;
  }
  return Math.floor(n);
}
