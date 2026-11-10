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
  const k = String(key);
  return Object.hasOwn(tbl, k) ? tbl[k] : undefined; // own keys only: file data like "constructor" must not hit the prototype
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
  // own keys only: a log code like "constructor" / "__proto__" is no known code (Object.prototype hit)
  const names = Object.hasOwn(FIELDS, ev.code) ? FIELDS[ev.code] : null;
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
  return Object.hasOwn(OWN_LEVEL, ev.code) ? fnum(ev, "level") : null;
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

// a zone visit shorter than this many played seconds (border flicker) never forms a chapter and is not named (= Model.STAY_FLICKER)
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
        if (q !== null && Object.hasOwn(stats.finds, q)) stats.finds[q] += fnum(ev, "count") || 1;
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
        if (!Object.hasOwn(FIRST_KINDS, kind)) break;
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

  // chapters and acts exactly like the addon (journal/Model.lua buildChapters + buildActs, see the cut below)
  const cut = buildChapters(c, events, { mapName, highlights });
  const chapters = cut.chapters;

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
    acts: cut.acts,
    visits: cut.visits,
    flights: cut.flights,
    notes,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Chapters and acts (K2, port of addon/InkAndEmbers/journal/Model.lua: buildStays, buildChapters, aggregate, buildActs,
// Model.zoneAt, Model.flightAt). Same constants, same order of operations, so the export and the web page cut the journey
// exactly like the addon. Played time comes from the session spans (L opens, O closes, the first line after a close opens
// again), not from line gaps.
//
// Chapter = zone visit with an event and weight: a visit is a stay in one main zone (zoneOf: own ZN zone field; continent and
// world maps (ZN map type <= 2) belong to the running visit). Events of note: KI, PK, QA, QT, LV, DE, EX, FP, HB, SP, RT, IE
// (middle of the instance stay), IB won, MO except "continent", LT blue or better, VE.
// R1* (weight): a visit opens a chapter only with an event AND (>= CHAPTER_MIN played seconds OR LV/IE/IB/DE OR
//   >= CHAPTER_QUESTS turn-ins). Visits under STAY_FLICKER seconds never count.
// R3 (commuting): A -> B -> A with B < DETOUR_MAX and < DETOUR_SHARE of both A parts = one chapter A, B is a detour.
// Every other visit is a detour of the running chapter (chapter.via: names, first occurrence; flicker and flown-over zones
// are not named). Visits before the first chapter belong to it (it starts at the start of the journey).
// Act = consecutive chapters around an anchor (chapter >= ACT_ANCHOR played seconds); smaller chapters belong to the NEXT
// anchor, the ones after the last anchor to the last act; neighbouring acts with the same anchor zone merge (the longer
// chapter stays the anchor); without any anchor one act anchored at the longest chapter.
export const CHAPTER_MIN = 1500;
export const CHAPTER_QUESTS = 3;
export const DETOUR_MAX = 1200;
export const DETOUR_SHARE = 0.25;
export const ACT_ANCHOR = 6000;

// field position (1-based, after the code) of the map of a line, as Model.lua MAP_FIELD (KI: field 4)
const CUT_MAP_FIELD = { LV: 2, QA: 4, QT: 4, QX: 4, BK: 4, DE: 2, DB: 4, ZN: 1, SZ: 1, EX: 3, FP: 2, TP: 2, TF: 6, TL: 2, HS: 3,
  HB: 2, MO: 5, SH: 5, GW: 6, SP: 4, RP: 6, GS: 5, GE: 7, DU: 4, PK: 6, PD: 4, AH: 10, TH: 7, KI: 4 };
// field position of the own level for the start level of the journey (Model.lua LEVEL_FIELD)
const CUT_LEVEL_FIELD = { RS: 6, PL: 3, QA: 2, QT: 2, DE: 1 };

// Lua tonumber on a field: "" / missing / not a number -> null
function cutNum(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// last index i with arr[i] <= v, -1 if none (arr ascending)
function cutFind(arr, v) {
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

// trail blocks -> [{ start, map, end }] (end = time of the last point, else the start)
function cutTrailBlocks(char) {
  const out = [];
  for (const block of luaArray(isTable(char) ? char.trail : null)) {
    if (typeof block !== "string") continue;
    const head = /^#~(-?\d+)~(\d+)/.exec(block);
    if (!head) continue;
    const start = Number(head[1]);
    let end = start;
    const re = /\n(-?\d+)~(\d+)~(\d+)/g;
    let m;
    let any = false;
    while ((m = re.exec(block)) !== null) {
      end = start + Number(m[1]);
      any = true;
    }
    out.push({ start, map: Number(head[2]), end: any ? end : start });
  }
  return out;
}

// read the log in file order like Model.lua readLog/onLine: spans, positions, zone info and the event lists of the cut
function cutRead(events, info) {
  const J = {
    firstT: Infinity, lastT: -Infinity, spT0: [], spT1: [], spCum: [], spanOpen: false, spanStart: 0, spLastOpen: false,
    playedTotal: 0, sT: [], sM: [], zn: new Map(), lv: [], baseLevel: null, marks: [], gaps: [], openInst: null, tf: [], tl: [],
    nonQual: new Set(), zoneKey: new Map(),
  };
  const open = (t) => {
    J.spanOpen = true;
    J.spanStart = t;
  };
  const close = (t) => {
    if (!J.spanOpen) return;
    J.spanOpen = false;
    J.spT0.push(J.spanStart);
    J.spT1.push(t < J.spanStart ? J.spanStart : t);
  };
  const mark = (t, w) => J.marks.push({ t, w });
  const fileOrder = events.slice().sort((a, b) => a.ln - b.ln);
  for (const ev of fileOrder) {
    const t = ev.t;
    const F = ev.f;
    if (!J.spanOpen) open(t);
    if (t > J.lastT) J.lastT = t;
    if (t < J.firstT) J.firstT = t;
    const mf = Object.hasOwn(CUT_MAP_FIELD, ev.code) ? CUT_MAP_FIELD[ev.code] : null;
    if (mf) {
      const m = cutNum(F[mf - 1]);
      if (m !== null && m > 0) {
        J.sT.push(t);
        J.sM.push(m);
      }
    }
    const lf = Object.hasOwn(CUT_LEVEL_FIELD, ev.code) ? CUT_LEVEL_FIELD[ev.code] : null;
    if (lf && J.baseLevel === null) J.baseLevel = cutNum(F[lf - 1]);
    switch (ev.code) {
      case "L":
        if (J.spanOpen) close(J.lastT);
        open(t);
        break;
      case "O":
        close(t);
        break;
      case "LV": {
        const lv = cutNum(F[0]);
        if (lv !== null) J.lv.push({ t, level: lv });
        mark(t, "strong");
        break;
      }
      case "KI":
      case "PK":
      case "EX":
      case "SP":
      case "QA":
      case "VE":
      case "FP":
      case "HB":
      case "RT":
        mark(t, null);
        break;
      case "LT": {
        const q = cutNum(F[2]);
        if (q !== null && q >= 3) mark(t, null);
        break;
      }
      case "QT":
        mark(t, "qt");
        break;
      case "DE":
        mark(t, "strong");
        break;
      case "IB":
        if (F[1] === "1") mark(t, "strong");
        break;
      case "MO":
        if (F[0] !== "continent") mark(t, null);
        break;
      case "IE": {
        const g = { t0: t, t1: null };
        J.gaps.push(g);
        J.openInst = g;
        break;
      }
      case "IL":
        if (J.openInst && J.openInst.t1 === null) J.openInst.t1 = t;
        J.openInst = null;
        break;
      case "TP": {
        const reason = F[0];
        if (reason === "taxi") break;
        if (J.openInst && J.openInst.t1 === null) break;
        if (reason === "instance") J.gaps.push({ t0: t, t1: null });
        break;
      }
      case "TF":
        J.tf.push(t);
        break;
      case "TL":
        J.tl.push({ t, sec: cutNum(F[0]) });
        break;
      case "ZN": {
        const m = cutNum(F[0]);
        if (m !== null && !J.zn.has(m)) J.zn.set(m, { type: cutNum(F[1]), zone: cutNum(F[2]) });
        break;
      }
      default:
        break;
    }
  }
  return J;
}

function cutFinish(J, blocks, info) {
  for (const b of blocks) {
    if (b.start < J.firstT) J.firstT = b.start;
    if (b.end > J.lastT) J.lastT = b.end;
  }
  if (J.firstT === Infinity) {
    const fs = num(info.firstSeen) ?? 0;
    J.firstT = fs;
    J.lastT = fs;
  }
  if (J.lastT < J.firstT) J.lastT = J.firstT;
  if (J.spanOpen) {
    const t = J.lastT;
    J.spanOpen = false;
    J.spT0.push(J.spanStart);
    J.spT1.push(t < J.spanStart ? J.spanStart : t);
    J.spLastOpen = true;
  }
  let cum = 0;
  for (let i = 0; i < J.spT0.length; i++) {
    J.spCum.push(cum);
    cum += J.spT1[i] - J.spT0[i];
  }
  J.playedTotal = cum;
  J.lv.sort((a, b) => a.t - b.t);
}

// played seconds at epoch t (Model.lua played)
function cutPlayed(J, t) {
  const i = cutFind(J.spT0, t);
  if (i < 0) return 0;
  let d = t - J.spT0[i];
  const len = J.spT1[i] - J.spT0[i];
  if (d > len && !(i === J.spT0.length - 1 && J.spLastOpen)) d = len;
  return J.spCum[i] + d;
}

function cutLevelAt(J, t) {
  const i = cutFind(J.lv.map((l) => l.t), t);
  if (i >= 0) return J.lv[i].level;
  if (J.baseLevel !== null) return J.baseLevel;
  if (J.lv.length) return J.lv[0].level - 1;
  return 1;
}

// map -> main zone of the chapters (Model.lua zoneOf / mainZoneOf without the client's geo data)
function cutZoneOf(J, m) {
  if (m === null || m === undefined) return null;
  if (J.zoneKey.has(m)) return J.zoneKey.get(m);
  const zi = J.zn.get(m);
  let k;
  if (zi && zi.type !== null && zi.type <= 2) {
    k = m;
    J.nonQual.add(m);
  } else if (zi && zi.zone !== null) k = zi.zone;
  else k = m;
  J.zoneKey.set(m, k);
  return k;
}

// stays in one main zone from the positions of the log lines and the trail block bounds (Model.lua buildStays)
function cutStays(J, blocks) {
  const tT = [];
  const tM = [];
  for (const b of blocks) {
    tT.push(b.start, b.end);
    tM.push(b.map, b.map);
  }
  const { sT, sM } = J;
  let i = 0;
  let k = 0;
  const stays = [];
  let cur = null;
  while (i < sT.length || k < tT.length) {
    let t;
    let m;
    if (k >= tT.length || (i < sT.length && sT[i] <= tT[k])) {
      t = sT[i];
      m = sM[i];
      i++;
    } else {
      t = tT[k];
      m = tM[k];
      k++;
    }
    const z = cutZoneOf(J, m);
    if (cur && cur.z === z) {
      if (t > cur.t1) cur.t1 = t;
    } else {
      if (cur && t > cur.t1) cur.t1 = t;
      cur = { z, t0: t, t1: t };
      stays.push(cur);
    }
  }
  if (cur && J.lastT > cur.t1) cur.t1 = J.lastT;
  for (const s of stays) s.act = cutPlayed(J, s.t1) - cutPlayed(J, s.t0);
  return stays;
}

// -> { ranges: [{ z, t0, detours }], q (qualifying visits { z, t0, t1, act, fly }), fa, fb (flight starts/landings) }
function cutChapters(J, stays) {
  if (!stays.length) return { ranges: [{ z: null, t0: J.firstT, detours: [] }], q: [], fa: [], fb: [] };
  let anyLong = false;
  for (const s of stays) {
    if (!J.nonQual.has(s.z) && s.t1 > s.t0) {
      anyLong = true;
      break;
    }
  }
  const q = [];
  for (const s of stays) {
    if (J.nonQual.has(s.z) || !(s.t1 > s.t0 || !anyLong)) continue;
    const last = q[q.length - 1];
    if (last && last.z === s.z) {
      last.act += s.act;
      last.t1 = s.t1;
    } else q.push({ z: s.z, t0: s.t0, t1: s.t1, act: s.act, ev: false, qt: 0, strong: false, fly: false });
  }
  if (!q.length) return { ranges: [{ z: stays[0].z, t0: J.firstT, detours: [] }], q, fa: [], fb: [] };
  const flicker = STAY_FLICKER;
  const n = q.length;
  const qT0 = q.map((s) => s.t0);
  const markAt = (t, w) => {
    if (typeof t !== "number" || !Number.isFinite(t)) return;
    let qi = cutFind(qT0, t);
    if (qi < 0) qi = 0;
    const s = q[qi];
    s.ev = true;
    if (w === "qt") s.qt++;
    else if (w) s.strong = true;
  };
  for (const mk of J.marks) markAt(mk.t, mk.w);
  // instance entered: the middle of the stay inside, still inside: the entry time
  for (const g of J.gaps) markAt(g.t1 !== null && g.t1 > g.t0 ? g.t0 + (g.t1 - g.t0) / 2 : g.t0, "strong");
  // flights: TL with duration, else back to the last TF start
  const list = [];
  let ti = -1;
  for (const l of J.tl) {
    let s = l.sec !== null && l.sec > 0 ? l.t - l.sec : null;
    if (s === null) {
      while (ti + 1 < J.tf.length && J.tf[ti + 1] <= l.t) ti++;
      s = ti >= 0 ? J.tf[ti] : null;
    }
    if (s !== null && s <= l.t) list.push([s, l.t]);
  }
  list.sort((x, y) => x[0] - y[0]);
  const fa = list.map((f) => f[0]);
  const fb = list.map((f) => f[1]);
  const inFlight = (s) => {
    const k = cutFind(fa, s.t0 + 2);
    return k >= 0 && s.t1 <= fb[k] + 2;
  };
  const event = (s) => s.ev && s.act >= flicker;
  const weighty = (s) => event(s) && (s.act >= CHAPTER_MIN || s.strong || s.qt >= CHAPTER_QUESTS);
  let first = q.findIndex(weighty);
  if (first < 0) first = q.findIndex(event);
  if (first < 0) {
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
  const ranges = [{ a: 0, z: q[first].z }];
  let curZ = q[first].z;
  for (let k = first + 1; k < n; k++) {
    const s = q[k];
    if (s.z !== curZ && weighty(s)) {
      ranges.push({ a: k, z: s.z });
      curZ = s.z;
    }
  }
  const startT = (i) => (i === 0 ? J.firstT : q[ranges[i].a].t0);
  const dur = (i) => cutPlayed(J, i + 1 < ranges.length ? startT(i + 1) : J.lastT) - cutPlayed(J, startT(i));
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 1; i < ranges.length - 1; i++) {
      const p = ranges[i - 1];
      const c = ranges[i];
      const nx = ranges[i + 1];
      if (p.z === nx.z && c.z !== p.z) {
        const dc = dur(i);
        if (dc < DETOUR_MAX && dc < DETOUR_SHARE * (dur(i - 1) + dur(i + 1))) {
          ranges.splice(i, 2);
          changed = true;
          break;
        }
      }
    }
  }
  const out = ranges.map((r, i) => {
    const detours = [];
    const seen = new Set();
    const b = i + 1 < ranges.length ? ranges[i + 1].a - 1 : n - 1;
    for (let k = r.a; k <= b; k++) {
      const s = q[k];
      if (s.z !== r.z && s.act >= flicker && !seen.has(s.z) && !inFlight(s)) {
        seen.add(s.z);
        detours.push(s.z);
      }
    }
    return { z: r.z, t0: startT(i), detours };
  });
  for (const s of q) s.fly = inFlight(s);
  return { ranges: out, q, fa, fb };
}

// acts over the finished chapters (Model.lua buildActs); chapter indices are 0-based
function cutActs(chapters) {
  const groups = [];
  let pending = [];
  chapters.forEach((c, i) => {
    pending.push(i);
    if ((c.active || 0) >= ACT_ANCHOR) {
      groups.push({ anchor: i, list: pending });
      pending = [];
    }
  });
  if (pending.length) {
    const g = groups[groups.length - 1];
    if (g) g.list.push(...pending);
    else {
      let best = pending[0];
      for (const i of pending) if ((chapters[i].active || 0) > (chapters[best].active || 0)) best = i;
      groups.push({ anchor: best, list: pending });
    }
  }
  const merged = [];
  for (const g of groups) {
    const last = merged[merged.length - 1];
    if (last && chapters[last.anchor].zone !== null && chapters[last.anchor].zone === chapters[g.anchor].zone) {
      last.list.push(...g.list);
      if ((chapters[g.anchor].active || 0) > (chapters[last.anchor].active || 0)) last.anchor = g.anchor;
    } else merged.push(g);
  }
  return merged.map((g, k) => {
    const a = chapters[g.list[0]];
    const b = chapters[g.list[g.list.length - 1]];
    const anchor = chapters[g.anchor];
    const act = {
      n: k + 1, anchor: g.anchor, zone: anchor.zone, zoneName: anchor.zoneName, chapters: g.list.slice(),
      first: g.list[0], last: g.list[g.list.length - 1], levelFrom: a.levelFrom, levelTo: Math.max(b.levelTo ?? a.levelFrom, a.levelFrom),
      start: a.start, end: b.end, p0: a.p0, p1: b.p1, active: b.p1 - a.p0, quests: 0, kills: 0, deaths: 0,
    };
    for (const i of g.list) {
      act.quests += chapters[i].quests;
      act.kills += chapters[i].kills;
      act.deaths += chapters[i].deaths;
      chapters[i].act = k + 1;
    }
    return act;
  });
}

// the whole cut: -> { chapters, acts, visits, flights }
function buildChapters(char, events, ctx) {
  const info = isTable(char.info) ? char.info : {};
  const J = cutRead(events, info);
  const blocks = cutTrailBlocks(char);
  cutFinish(J, blocks, info);
  const stays = cutStays(J, blocks);
  const { ranges, q, fa, fb } = cutChapters(J, stays);
  const chapters = ranges.map((r, i) => {
    const t1 = i + 1 < ranges.length ? ranges[i + 1].t0 : J.lastT;
    const levelFrom = i === 0 ? cutLevelAt(J, J.firstT) : cutLevelAt(J, r.t0);
    const levelTo = Math.max(cutLevelAt(J, t1), levelFrom);
    const p0 = cutPlayed(J, r.t0);
    const p1 = cutPlayed(J, t1);
    return {
      n: i + 1,
      zone: r.z === null ? null : String(r.z),
      zoneName: r.z === null ? null : ctx.mapName(String(r.z)),
      start: r.t0,
      end: t1,
      p0,
      p1,
      active: p1 - p0,
      levelFrom,
      levelTo,
      minLevel: levelFrom,
      maxLevel: levelTo,
      quests: 0,
      kills: 0,
      deaths: 0,
      subzones: [],
      discoveries: [],
      detours: r.detours.map(String),
      via: r.detours.map((z) => ctx.mapName(String(z))).filter(Boolean).filter((v, j, a) => a.indexOf(v) === j),
      highlights: [],
      act: null,
    };
  });
  const chT0 = chapters.map((c) => c.start);
  const at = (t) => chapters[Math.max(0, cutFind(chT0, t))];
  for (const ev of events) {
    if (ev.code === "QT") at(ev.t).quests++;
    else if (ev.code === "KI") at(ev.t).kills++;
    else if (ev.code === "DE") at(ev.t).deaths++;
    else if (ev.code === "SZ" && field(ev, "name")) pushUnique(at(ev.t).subzones, field(ev, "name"));
    else if (ev.code === "EX" && field(ev, "name")) pushUnique(at(ev.t).discoveries, field(ev, "name"));
  }
  for (const h of ctx.highlights) at(h.t).highlights.push(h);
  const acts = cutActs(chapters);
  const visits = q.map((s) => ({ zone: s.z === null ? null : String(s.z), start: s.t0, end: s.t1, active: s.act, fly: s.fly }));
  return { chapters, acts, visits, flights: { starts: fa, ends: fb }, playedTotal: J.playedTotal };
}

function pushUnique(arr, v) {
  if (!arr.includes(v)) arr.push(v);
}

// chapter index (0-based) running at epoch t; before the first chapter the first, -1 without chapters
export function chapterAt(journal, t) {
  const cs = isTable(journal) && Array.isArray(journal.chapters) ? journal.chapters : [];
  if (!cs.length || typeof t !== "number" || !Number.isFinite(t)) return cs.length ? 0 : -1;
  return Math.max(0, cutFind(cs.map((c) => c.start), t));
}

// act index (0-based) running at epoch t; -1 without acts or for an invalid time
export function actAt(journal, t) {
  const acts = isTable(journal) && Array.isArray(journal.acts) ? journal.acts : [];
  if (!acts.length || typeof t !== "number" || !Number.isFinite(t)) return -1;
  const c = journal.chapters[chapterAt(journal, t)];
  return c && Number.isInteger(c.act) ? c.act - 1 : 0;
}

// main zone (map ID text) of the visit running at epoch t, skipping border flicker and flown-over zones (Model.zoneAt);
// -> { zone, start, end } or null
export function zoneAt(journal, t) {
  const v = isTable(journal) && Array.isArray(journal.visits) ? journal.visits : [];
  if (!v.length || typeof t !== "number" || !Number.isFinite(t)) return null;
  let i = Math.max(0, cutFind(v.map((x) => x.start), t));
  const skip = (x) => x.active < STAY_FLICKER || x.fly;
  let k = i;
  while (k > 0 && skip(v[k])) k--;
  if (skip(v[k])) {
    k = i;
    while (k < v.length - 1 && skip(v[k])) k++;
  }
  return { zone: v[k].zone, start: v[k].start, end: v[k].end };
}

// flight running at epoch t (TF -> TL): { start, end } or null
export function flightAt(journal, t) {
  const f = isTable(journal) && isTable(journal.flights) ? journal.flights : null;
  if (!f || !Array.isArray(f.starts) || typeof t !== "number" || !Number.isFinite(t)) return null;
  const k = cutFind(f.starts, t);
  return k >= 0 && t <= f.ends[k] ? { start: f.starts[k], end: f.ends[k] } : null;
}

// whole pipeline for the page: text -> { db, characters, language, schemaWarning }
export function openFile(text) {
  const { db, schemaWarning } = readSavedVariables(text);
  const characters = listCharacters(db);
  if (characters.length === 0) throw new ExportError("noChars");
  return { db, characters, language: fileLanguage(db), schemaWarning };
}
