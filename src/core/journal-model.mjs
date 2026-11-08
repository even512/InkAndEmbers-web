// Herkunft: EveN_ForeverChronicle/tools/journal-export/src/journal-model.mjs (kopiert mit scripts/sync-core.mjs).
// NICHT HIER BEARBEITEN: Pflege im Addon-Repo, danach `npm run sync-core`. Commit siehe SOURCE.txt.
// Reading the Ink & Embers SavedVariables (EveNChronicleDB, schema 1; contract: README 'Log format' and ns.Types in
// addon/InkAndEmbers/Store.lua). Pure data, no texts and no DOM: buildJournal(db, guid) -> journal for the renderer.
// All names stay raw text from the file; the renderer inserts them only as text (textContent).
import { parseSavedVariables, LuaParseError, isTable, luaArray } from "./lua-parse.mjs";

export const KNOWN_SCHEMA = 1;
export const MAX_FILE_BYTES = 64 * 1024 * 1024;

// field names per line code (order after '<dt>~<code>~'), copied from ns.Types for the codes this export reads
export const FIELDS = {
  L: ["session", "build", "buildNumber", "interface", "locale", "tz", "xpPreset", "hc", "gameMode", "modeRec", "addon", "pvp"],
  O: ["session", "duration"],
  LV: ["level", "mapID", "x", "y", "sub", "day"],
  PL: ["total", "thisLevel", "level", "reason"],
  XP: ["source", "amount", "rested", "group", "target", "questID", "level", "mapID", "via"],
  RS: ["reason", "rested", "resting", "xp", "xpMax", "level"],
  QA: ["questID", "level", "qlevel", "mapID", "npcID", "npc", "x", "y"],
  QT: ["questID", "level", "qlevel", "mapID", "xp", "money", "itemID", "npcID", "npc", "x", "y"],
  QX: ["questID", "level", "qlevel", "mapID", "confirmed"],
  QO: ["questID", "idx", "have", "need", "kind", "text", "mapID", "px", "py"],
  BK: ["key", "page", "level", "mapID", "new"],
  KI: ["npcID", "level", "cls", "mapID", "xp", "by", "via", "name", "plevel", "x", "y"],
  KF: ["duration", "kills", "damage", "healing", "taken", "hpEnd", "close", "dead", "level", "mapID"],
  DE: ["level", "mapID", "x", "y", "instance", "combat", "sub", "durMin", "durAvg", "day", "instanceID"],
  DC: ["npcID", "source", "spellID", "cause", "guess", "events", "maxHP"],
  DB: ["how", "guess", "seconds", "mapID", "x", "y", "durMin", "durAvg"],
  ZN: ["mapID", "mapType", "zone", "continent", "level", "x", "y"],
  SZ: ["mapID", "name", "level"],
  EX: ["name", "xp", "mapID", "level"],
  FP: ["npcID", "mapID", "x", "y", "level", "name"],
  TP: ["reason", "mapID"],
  TF: ["from", "to", "cost", "fromNode", "toNode", "mapID"],
  TL: ["seconds", "mapID", "x", "y"],
  HS: ["spellID", "bind", "mapID", "x", "y"],
  HB: ["bind", "mapID"],
  IE: ["instanceID", "type", "difficultyID", "group", "level", "pos", "mapLock", "chatLock", "resumed"],
  IL: ["instanceID", "seconds", "kills", "deaths", "bosses", "loot"],
  IB: ["encounterID", "success", "seconds", "group", "difficultyID", "instanceID"],
  MO: ["kind", "value", "detail", "level", "mapID", "sub"],
  SH: ["key", "reasons", "auto", "level", "mapID", "x", "y", "sub"],
  GD: ["delta", "balance", "source", "level", "mapID"],
  LT: ["item", "count", "quality", "source", "srcID", "level", "mapID", "x", "y"],
  SK: ["name", "rank", "max", "skillLine", "level", "why"],
  RP: ["faction", "factionID", "delta", "standing", "level", "mapID"],
  RT: ["faction", "factionID", "standing", "prev", "standingName", "level"],
  GS: ["size", "kind", "leader", "level", "mapID"],
  RA: ["kind", "mapID", "x", "y", "level", "rested", "src"],
  LF: ["mapID", "x", "y", "level", "seconds", "count", "people", "said", "sim"],
  VE: ["id", "mapID", "level", "x", "y", "text", "how"],
};

// codes whose "level" field is the character's own level (KI/PK: plevel)
const OWN_LEVEL = { LV: 1, PL: 1, RS: 1, QA: 1, QT: 1, QX: 1, BK: 1, DE: 1, ZN: 1, SZ: 1, EX: 1, FP: 1, IE: 1, MO: 1, SH: 1, GD: 1, LT: 1, VE: 1, RA: 1, LF: 1, XP: 1 };

export class ExportError extends Error {
  constructor(code, detail) {
    super(code);
    this.name = "ExportError";
    this.code = code; // notLua | empty | tooBig | noData | noChars | unknownChar
    this.detail = detail || null;
  }
}

// text of a whole SavedVariables file -> { db, schemaWarning }
export function readSavedVariables(text) {
  if (typeof text !== "string" || text.trim() === "") throw new ExportError("empty");
  if (text.length > MAX_FILE_BYTES) throw new ExportError("tooBig");
  let vars;
  try {
    vars = parseSavedVariables(text);
  } catch (e) {
    if (e instanceof LuaParseError) throw new ExportError(e.code === "empty" ? "empty" : "notLua", { line: e.line, message: e.message });
    throw e;
  }
  const db = vars.EveNChronicleDB;
  if (!isTable(db)) throw new ExportError("noData");
  if (!isTable(db.chars) || Object.keys(db.chars).length === 0) throw new ExportError("noChars");
  const schema = num(db.schema);
  return { db, schemaWarning: schema !== null && schema > KNOWN_SCHEMA ? schema : null };
}

function num(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return null;
}

function str(v) {
  return typeof v === "string" && v !== "" ? v : null;
}

function entry(tbl, key) {
  if (!isTable(tbl) || key === null || key === undefined || key === "") return undefined;
  return tbl[String(key)];
}

function nameOf(tbl, key) {
  const e = entry(tbl, key);
  if (typeof e === "string") return str(e);
  if (isTable(e)) return str(e.name);
  return null;
}

// language of the file: "de" | "en" | null (setting 'auto' -> client language of the newest session)
export function fileLanguage(db) {
  const loc = isTable(db) ? db.locale : null;
  if (loc === "deDE") return "de";
  if (loc === "enUS") return "en";
  const sessions = luaArray(isTable(db) && isTable(db.meta) ? db.meta.sessions : null);
  for (let i = sessions.length - 1; i >= 0; i--) {
    const s = sessions[i];
    if (isTable(s) && typeof s.locale === "string") return s.locale === "deDE" ? "de" : "en";
  }
  return null;
}

// log blocks -> events { t, code, f, ln } in time order (X blocks come late in the list and are sorted in)
export function parseLog(char) {
  const out = [];
  let ln = 0;
  for (const block of luaArray(isTable(char) ? char.log : null)) {
    if (typeof block !== "string") continue;
    const lines = block.split("\n");
    const head = /^#~(-?\d+)~(-?\d+)/.exec(lines[0] || "");
    if (!head) continue;
    const epoch = Number(head[1]);
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split("~");
      if (parts.length < 2) continue;
      const dt = Number(parts[0]);
      if (!Number.isFinite(dt)) continue;
      out.push({ t: epoch + dt, code: parts[1], f: parts.slice(2), ln: ln++ });
    }
  }
  out.sort((a, b) => a.t - b.t || a.ln - b.ln);
  return out;
}

// field value of an event by name ("" or missing -> null); numeric fields via fnum
export function field(ev, name) {
  const names = FIELDS[ev.code];
  if (!names) return null;
  const i = names.indexOf(name);
  if (i < 0) return null;
  const v = ev.f[i];
  return v === undefined || v === "" || v === "?" ? null : v;
}

export function fnum(ev, name) {
  const v = field(ev, name);
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function ownLevel(ev) {
  if (ev.code === "KI") return fnum(ev, "plevel");
  return OWN_LEVEL[ev.code] ? fnum(ev, "level") : null;
}

export function listCharacters(db) {
  const out = [];
  if (!isTable(db) || !isTable(db.chars)) return out;
  for (const guid of Object.keys(db.chars)) {
    const c = db.chars[guid];
    if (!isTable(c)) continue;
    const info = isTable(c.info) ? c.info : {};
    let level = null;
    // the newest blocks carry the current level; scanning a few from the end is enough for the list
    const blocks = luaArray(c.log);
    for (let i = blocks.length - 1; i >= 0 && level === null; i--) {
      const evs = parseLog({ log: { 1: blocks[i] } });
      for (const ev of evs) {
        const l = ownLevel(ev);
        if (l !== null && (level === null || l > level)) level = l;
      }
    }
    out.push({
      guid,
      name: str(info.name) || "?",
      realm: str(info.realm),
      race: str(info.race),
      cls: str(info.class),
      classFile: str(info.classFile),
      faction: str(info.faction),
      level,
      lastSeen: num(info.lastSeen),
      lines: num(c.lineCount) || 0,
    });
  }
  out.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0) || a.name.localeCompare(b.name));
  return out;
}

// item key "<itemID>[.s<suffix>][.b<bonus>...]" -> itemID text
export function itemIdOf(key) {
  const m = /^(\d+)/.exec(String(key || ""));
  return m ? m[1] : null;
}

const FIRST_KINDS = { first_rare: 1, first_elite: 1, first_boss: 1, first_dungeon: 1, first_raid: 1, continent: 1, first_blue: 1, first_epic: 1, first_bag: 1, first_fish: 1, mount: 1, reputation: 1, profession: 1, kill: 1, close_win: 1 };

// a zone visit becomes a chapter only with an event AND at least this many played seconds (= Model.STAY_FLICKER in the addon)
export const STAY_FLICKER = 30;
export const ACTIVE_GAP = 10 * 60;

export function buildJournal(db, guid) {
  if (!isTable(db) || !isTable(db.chars)) throw new ExportError("noChars");
  const c = db.chars[guid];
  if (!isTable(c)) throw new ExportError("unknownChar");
  const info = isTable(c.info) ? c.info : {};
  const snaps = isTable(c.snapshots) ? c.snapshots : {};
  const npcs = isTable(c.npcs) ? c.npcs : {};
  const events = parseLog(c);

  const mapName = (id) => nameOf(snaps.maps, id);
  const npcName = (id) => nameOf(npcs, id);
  const itemName = (key) => nameOf(snaps.items, itemIdOf(key));
  const itemQuality = (key) => {
    const e = entry(snaps.items, itemIdOf(key));
    return isTable(e) ? num(e.quality) : null;
  };
  const instanceName = (id) => nameOf(snaps.instances, id);
  const encounterName = (id) => nameOf(snaps.encounters, id);

  // map -> zone (from ZN: own zone field), map types
  const parentZone = new Map();
  const mapType = new Map();
  for (const ev of events) {
    if (ev.code !== "ZN") continue;
    const id = field(ev, "mapID");
    if (!id) continue;
    mapType.set(id, fnum(ev, "mapType"));
    const z = field(ev, "zone");
    parentZone.set(id, z || id);
  }
  const zoneOf = (id) => {
    if (!id) return null;
    const type = mapType.get(id);
    if (type !== undefined && type !== null && type <= 2) return null; // cosmic, world, continent: no chapter
    return parentZone.get(id) || id;
  };

  // trail heads as zone hints (one per block, a new block on every map change)
  const hints = [];
  for (const block of luaArray(c.trail)) {
    if (typeof block !== "string") continue;
    const head = /^#~(-?\d+)~(\d+)/.exec(block);
    if (head) hints.push({ t: Number(head[1]), code: "~T", f: [head[2]], ln: -1, mapID: head[2] });
  }

  // statistics
  const stats = {
    kills: 0, fights: 0, closeWins: 0, deaths: 0, questsDone: 0, questsAccepted: 0, questsAbandoned: 0,
    goldIn: 0, goldOut: 0, goldBalance: null, booksRead: 0, flights: 0, flightPoints: 0, zones: 0, subzones: 0,
    discoveries: 0, xp: 0, finds: { 2: 0, 3: 0, 4: 0, 5: 0 }, played: null, sessions: 0, levelsGained: 0,
    topEnemy: null, plansDone: 0, campfires: 0, hearthstones: 0, instances: 0,
  };
  const books = new Set();
  const enemyCount = new Map();
  const highlights = [];
  let level = null;
  let firstLevel = null;
  let played = null;
  const seenInstances = new Set();
  const bossSeen = [];

  const addHighlight = (h) => {
    highlights.push(h);
    return h;
  };

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const l = ownLevel(ev);
    if (l !== null) {
      if (level === null || l > level) level = l;
      if (firstLevel === null) firstLevel = l;
    }
    switch (ev.code) {
      case "L":
        stats.sessions++;
        break;
      case "KI": {
        stats.kills++;
        const id = field(ev, "npcID");
        const key = id ? "n" + id : field(ev, "name") ? "s" + field(ev, "name") : null;
        if (key) enemyCount.set(key, (enemyCount.get(key) || 0) + 1);
        break;
      }
      case "KF":
        stats.fights++;
        if (fnum(ev, "close") === 1) stats.closeWins++;
        break;
      case "QA":
        stats.questsAccepted++;
        break;
      case "QT":
        stats.questsDone++;
        break;
      case "QX":
        stats.questsAbandoned++;
        break;
      case "XP": {
        const a = fnum(ev, "amount");
        if (a !== null && a > 0 && field(ev, "via") !== "unclear") stats.xp += a;
        break;
      }
      case "PL": {
        const total = fnum(ev, "total");
        if (total !== null) played = total;
        break;
      }
      case "GD": {
        const d = fnum(ev, "delta");
        const src = field(ev, "source");
        if (d !== null && src !== "start") {
          if (d > 0) stats.goldIn += d;
          else stats.goldOut -= d;
        }
        const b = fnum(ev, "balance");
        if (b !== null) stats.goldBalance = b;
        break;
      }
      case "BK":
        if (field(ev, "key")) books.add(field(ev, "key"));
        break;
      case "TF":
        stats.flights++;
        break;
      case "FP":
        stats.flightPoints++;
        break;
      case "HS":
        stats.hearthstones++;
        break;
      case "ZN":
        if (fnum(ev, "mapType") === 3) stats.zones++;
        break;
      case "SZ":
        stats.subzones++;
        break;
      case "EX":
        stats.discoveries++;
        break;
      case "LF":
        if (field(ev, "sim") !== "1") stats.campfires++;
        break;
      case "LT": {
        const q = fnum(ev, "quality") ?? itemQuality(field(ev, "item"));
        if (q !== null && stats.finds[q] !== undefined) stats.finds[q] += fnum(ev, "count") || 1;
        if (q !== null && q >= 3) {
          addHighlight({ kind: "find", t: ev.t, ev, item: itemName(field(ev, "item")), itemID: itemIdOf(field(ev, "item")), quality: q, level: l });
        }
        break;
      }
      case "LV":
        addHighlight({ kind: "level", t: ev.t, ev, level: fnum(ev, "level"), place: field(ev, "sub") || mapName(field(ev, "mapID")), major: (fnum(ev, "level") || 0) % 10 === 0 });
        stats.levelsGained++;
        break;
      case "DE": {
        stats.deaths++;
        const h = addHighlight({ kind: "death", t: ev.t, ev, level: fnum(ev, "level"), place: field(ev, "sub") || mapName(field(ev, "mapID")), cause: null, killer: null, guess: false });
        for (let j = i + 1; j < events.length && events[j].code !== "DE" && events[j].t - ev.t < 3600; j++) {
          const n = events[j];
          if (n.code === "DC") {
            h.cause = field(n, "cause");
            h.killer = npcName(field(n, "npcID")) || field(n, "source");
            h.guess = fnum(n, "guess") === 1;
            break;
          }
        }
        break;
      }
      case "IE": {
        const id = field(ev, "instanceID");
        if (id && !seenInstances.has(id)) {
          seenInstances.add(id);
          stats.instances++;
        }
        break;
      }
      case "IB": {
        if (fnum(ev, "success") !== 1) break;
        const id = field(ev, "encounterID");
        if (bossSeen.some((b) => b.id === id && Math.abs(b.t - ev.t) < 300)) break;
        bossSeen.push({ id, t: ev.t });
        addHighlight({ kind: "boss", t: ev.t, ev, name: encounterName(id), instance: instanceName(field(ev, "instanceID")), level: null });
        break;
      }
      case "MO": {
        const kind = field(ev, "kind");
        const value = field(ev, "value");
        const detail = field(ev, "detail");
        if (kind === "boss") {
          if (bossSeen.some((b) => b.id === value && Math.abs(b.t - ev.t) < 300)) break;
          bossSeen.push({ id: value, t: ev.t });
          addHighlight({ kind: "boss", t: ev.t, ev, name: encounterName(value), instance: null, level: l });
          break;
        }
        if (!FIRST_KINDS[kind]) break;
        const h = { kind: "moment", moment: kind, t: ev.t, ev, level: l, name: null, detail, place: field(ev, "sub") || mapName(field(ev, "mapID")) };
        if (kind === "first_rare" || kind === "first_elite" || kind === "first_boss" || kind === "kill") h.name = npcName(value);
        else if (kind === "first_dungeon" || kind === "first_raid") h.name = instanceName(value);
        else if (kind === "continent") h.name = mapName(value);
        else if (kind === "first_blue" || kind === "first_epic" || kind === "first_bag" || kind === "first_fish") {
          h.name = itemName(value);
          h.quality = itemQuality(value);
        } else if (kind === "mount") h.name = detail && !/^\d+$/.test(detail) ? detail : value && !/^\d+$/.test(value) ? value : null;
        else if (kind === "reputation") h.name = value && !/^\d+$/.test(value) ? value : nameOf(snaps.factions, value);
        else if (kind === "profession") h.name = value;
        else if (kind === "close_win") h.name = null;
        // a rare/elite kill moment repeats the first_* moment of the same enemy: keep only the first
        if (kind === "kill" && highlights.some((x) => x.kind === "moment" && x.ev.f[1] === value && Math.abs(x.t - ev.t) < 5)) break;
        addHighlight(h);
        break;
      }
      case "HB":
        addHighlight({ kind: "home", t: ev.t, ev, name: field(ev, "bind"), level: null });
        break;
      case "VE":
        stats.plansDone++;
        if (field(ev, "text")) addHighlight({ kind: "plan", t: ev.t, ev, name: field(ev, "text"), level: l });
        break;
      default:
        break;
    }
  }
  // a find that is also the "first blue/epic" moment shows once (as the moment)
  for (let i = highlights.length - 1; i >= 0; i--) {
    const h = highlights[i];
    if (h.kind !== "find") continue;
    const dup = highlights.some((m) => m.kind === "moment" && (m.moment === "first_blue" || m.moment === "first_epic") && m.ev.f[1] === h.itemID && Math.abs(m.t - h.t) < 30);
    if (dup) highlights.splice(i, 1);
  }
  stats.booksRead = books.size;
  stats.played = played;
  let top = null;
  for (const [key, n] of enemyCount) {
    if (!top || n > top.n) top = { key, n };
  }
  if (top) stats.topEnemy = { name: top.key[0] === "n" ? npcName(top.key.slice(1)) : top.key.slice(1), count: top.n };

  // chapters: zone visits with an event (rule of the addon, journal/Model.lua buildChapters); the other visits are detours
  const chapters = buildChapters(events, hints, zoneOf, { mapName, highlights, itemQuality });

  const notes = [];
  const list = luaArray(isTable(c.notes) ? c.notes.list : null);
  for (const n of list) {
    if (!isTable(n)) continue;
    const title = typeof n.title === "string" ? n.title : "";
    const body = typeof n.body === "string" ? n.body : "";
    if (title === "" && body === "") continue;
    notes.push({ title, body, created: num(n.created), updated: num(n.updated), zone: str(n.zone) || mapName(n.mapID), level: num(n.level), pinned: n.pinned === true });
  }
  notes.sort((a, b) => (a.created || 0) - (b.created || 0));

  const firstT = events.length ? events[0].t : num(info.firstSeen);
  const lastT = events.length ? events[events.length - 1].t : num(info.lastSeen);
  const flavor = events.find((e) => e.code === "L");
  const iface = flavor ? fnum(flavor, "interface") : null;

  return {
    guid,
    name: str(info.name) || "?",
    realm: str(info.realm),
    race: str(info.race),
    cls: str(info.class),
    classFile: str(info.classFile),
    faction: str(info.faction),
    factionName: str(info.factionName),
    level,
    firstLevel,
    played,
    firstT: num(info.firstSeen) && firstT ? Math.min(num(info.firstSeen), firstT) : firstT,
    lastT,
    flavor: iface === null ? null : iface >= 100000 ? "retail" : "forever",
    lines: events.length,
    stats,
    highlights,
    chapters,
    notes,
  };
}

// Chapter = zone visit with an event (same rule as buildChapters in addon/InkAndEmbers/journal/Model.lua):
// a visit is a stay in one main zone (zoneOf; sub-maps stay in it; continent/world maps belong to the running visit). It becomes
// a chapter of its own only if something of note happens in it (KI, PK, QA, QT, LV, DE, EX, FP, HB, SP, RT, IE, IB, MO except
// "continent", LT blue or better, VE) AND it lasts at least STAY_FLICKER played seconds; the chapter then starts at the entry
// into the zone, even if the event comes late. Every other visit is a detour: it stays in the running chapter and is named in
// chapter.via (zone names, first occurrence order) if it lasted STAY_FLICKER seconds and was not only a flight crossing
// (TF .. TL). Returning to the chapter zone continues the chapter. Visits before the first chapter belong to it (it starts at
// the beginning of the journey); without any event everything is one chapter. IE counts for the middle of the instance visit
// (the visit that opens after the IE line).
const EVENT_CODES = new Set(["KI", "PK", "QA", "QT", "LV", "DE", "EX", "FP", "HB", "SP", "RT", "IB", "VE"]);

function isChapterEvent(ev, ctx) {
  if (EVENT_CODES.has(ev.code)) return true;
  if (ev.code === "MO") return field(ev, "kind") !== "continent";
  if (ev.code === "LT") {
    const q = fnum(ev, "quality") ?? ctx.itemQuality(field(ev, "item"));
    return q !== null && q >= 3;
  }
  return false;
}

// flights as [start, landing] intervals: TL carries the duration (else back to the last TF)
function flightRanges(events) {
  const tfs = events.filter((e) => e.code === "TF").map((e) => e.t);
  const out = [];
  let ti = -1;
  for (const e of events) {
    if (e.code !== "TL") continue;
    const sec = fnum(e, "seconds");
    let s = sec !== null && sec > 0 ? e.t - sec : null;
    if (s === null) {
      while (ti + 1 < tfs.length && tfs[ti + 1] <= e.t) ti++;
      s = ti >= 0 ? tfs[ti] : null;
    }
    if (s !== null && s <= e.t) out.push([s, e.t]);
  }
  out.sort((x, y) => x[0] - y[0]);
  return out;
}

function buildChapters(events, hints, zoneOf, ctx) {
  const stream = hints.length ? mergeByTime(events, hints) : events;
  if (!stream.length) return [];

  // 1) raw visits in stream order
  const visits = [];
  const visitAt = new Array(stream.length); // stream index -> raw visit
  let cur = null;
  let pendingIE = false;
  const open = (zone, i, t) => {
    cur = { zone, i0: i, t0: t, t1: t, act: 0, ev: false };
    visits.push(cur);
    if (pendingIE) {
      cur.ev = true;
      pendingIE = false;
    }
  };
  for (let i = 0; i < stream.length; i++) {
    const ev = stream[i];
    const id = ev.code === "~T" ? ev.mapID : field(ev, "mapID");
    const z = zoneOf(id);
    if (!cur) open(z, i, ev.t);
    else if (z && cur.zone === null) cur.zone = z; // prologue without a known map
    else if (z && cur.zone !== z) open(z, i, ev.t);
    visitAt[i] = cur;
    if (ev.code === "~T") continue;
    if (ev.code === "IE") pendingIE = true;
    else if (ev.code === "IL" && pendingIE) {
      cur.ev = true;
      pendingIE = false;
    } else if (isChapterEvent(ev, ctx)) cur.ev = true;
  }
  if (pendingIE) cur.ev = true;
  // played time: gaps up to ACTIVE_GAP count as play (logged-out breaks do not); the gap after a line belongs to its visit
  const gapAfter = new Array(stream.length).fill(0);
  for (let i = 0; i + 1 < stream.length; i++) {
    const d = stream[i + 1].t - stream[i].t;
    if (d > 0 && d <= ACTIVE_GAP) {
      gapAfter[i] = d;
      visitAt[i].act += d;
    }
  }
  for (let k = 0; k < visits.length; k++) visits[k].t1 = k + 1 < visits.length ? visits[k + 1].t0 : stream[stream.length - 1].t;

  // 2) qualifying visits: without duration (several lines in the same second) they are no visit; only if there is nothing else
  const anyLong = visits.some((v) => v.t1 > v.t0);
  const q = [];
  for (const v of visits) {
    const keep = v.t1 > v.t0 || !anyLong;
    const last = q[q.length - 1];
    if (!keep) {
      if (last) last.ev = last.ev || v.ev;
      else q.push({ zone: v.zone, i0: v.i0, t0: v.t0, t1: v.t1, act: 0, ev: v.ev });
      continue;
    }
    if (last && last.zone === v.zone) {
      last.t1 = v.t1;
      last.act += v.act;
      last.ev = last.ev || v.ev;
    } else q.push({ zone: v.zone, i0: v.i0, t0: v.t0, t1: v.t1, act: v.act, ev: v.ev });
  }

  // 3) which visit opens a chapter
  const flicker = STAY_FLICKER;
  const flights = flightRanges(events);
  const inFlight = (s) => {
    let lo = 0;
    let hi = flights.length - 1;
    let best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (flights[mid][0] <= s.t0 + 2) {
        best = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return best >= 0 && s.t1 <= flights[best][1] + 2;
  };
  const n = q.length;
  let first = -1;
  for (let k = 0; k < n; k++) {
    if (q[k].ev && q[k].act >= flicker) {
      first = k;
      break;
    }
  }
  if (first < 0) {
    // no event: everything is one chapter, anchored at the first visit that is not a short lead-in
    first = 0;
    let sum = 0;
    for (let k = 0; k < n - 1; k++) {
      sum += q[k].act;
      if (sum >= flicker) break;
      if (q[k + 1].act >= flicker) {
        first = k + 1;
        break;
      }
    }
  }
  const chs = []; // { visit, i0 (stream index of the entry), t0, via: [zone ids] }
  let c = null;
  const openChapter = (v, i0, t0) => {
    c = { visit: v, i0, t0, via: [], seen: new Set() };
    chs.push(c);
  };
  const detour = (v) => {
    if (v.zone === c.visit.zone || v.act < flicker || inFlight(v) || c.seen.has(v.zone)) return;
    c.seen.add(v.zone);
    c.via.push(v.zone);
  };
  openChapter(q[first], 0, stream[0].t); // the first chapter starts at the beginning of the journey
  for (let k = 0; k < first; k++) detour(q[k]);
  for (let k = first + 1; k < n; k++) {
    const v = q[k];
    if (v.zone !== c.visit.zone) {
      if (v.ev && v.act >= flicker) openChapter(v, v.i0, v.t0);
      else detour(v);
    }
  }

  // 4) fill the chapters: each stream line belongs to the chapter that was running at its index
  const out = chs.map((ch) => ({
    zone: ch.visit.zone,
    zoneName: ctx.mapName(ch.visit.zone),
    start: ch.t0,
    active: 0,
    end: ch.t0,
    minLevel: null,
    maxLevel: null,
    quests: 0,
    kills: 0,
    deaths: 0,
    subzones: [],
    discoveries: [],
    via: ch.via.map((z) => ctx.mapName(z)).filter(Boolean).filter((v, j, a) => a.indexOf(v) === j),
    highlights: [],
  }));
  let ci = 0;
  for (let i = 0; i < stream.length; i++) {
    while (ci + 1 < chs.length && chs[ci + 1].i0 <= i) ci++;
    const r = out[ci];
    const ev = stream[i];
    r.end = ev.t;
    r.active += gapAfter[i];
    if (ev.code === "~T") continue;
    const l = ownLevel(ev);
    if (l !== null) {
      if (r.minLevel === null || l < r.minLevel) r.minLevel = l;
      if (r.maxLevel === null || l > r.maxLevel) r.maxLevel = l;
    }
    if (ev.code === "QT") r.quests++;
    else if (ev.code === "KI") r.kills++;
    else if (ev.code === "DE") r.deaths++;
    else if (ev.code === "SZ" && field(ev, "name")) pushUnique(r.subzones, field(ev, "name"));
    else if (ev.code === "EX" && field(ev, "name")) pushUnique(r.discoveries, field(ev, "name"));
  }
  // highlights into their chapter (by time)
  for (const h of ctx.highlights) {
    let r = null;
    for (const ch of out) {
      if (ch.start <= h.t) r = ch;
      else break;
    }
    (r || out[0]).highlights.push(h);
  }
  return out
    .filter((r) => r.zone !== null || r.highlights.length || r.quests || r.kills)
    .map((r, i) => ({ n: i + 1, ...r }));
}

function pushUnique(arr, v) {
  if (!arr.includes(v)) arr.push(v);
}

function mergeByTime(a, b) {
  const out = a.concat(b);
  out.sort((x, y) => x.t - y.t || (x.code === "~T" ? -1 : 0) - (y.code === "~T" ? -1 : 0) || x.ln - y.ln);
  return out;
}

// whole pipeline for the page: text -> { db, characters, language, schemaWarning }
export function openFile(text) {
  const { db, schemaWarning } = readSavedVariables(text);
  const characters = listCharacters(db);
  if (characters.length === 0) throw new ExportError("noChars");
  return { db, characters, language: fileLanguage(db), schemaWarning };
}
