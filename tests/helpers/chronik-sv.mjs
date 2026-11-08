// Baut synthetische SavedVariables für die Chronik-Tests: JS-Wert -> Lua-Text -> der echte Parser (readSavedVariables).
// Keine echten Spielerdaten. Zeilen als Text "<dt>~<Kürzel>~Felder" wie im Log des Addons.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readSavedVariables, buildJournal } from "../../src/core/journal-model.mjs";
import { buildChronik } from "../../src/chronik/model.mjs";

const esc = (s) =>
  s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");

export function lit(v) {
  if (typeof v === "string") return '"' + esc(v) + '"';
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return "{" + v.map(lit).join(",") + "}";
  return "{" + Object.keys(v).map((k) => '["' + esc(k) + '"]=' + lit(v[k])).join(",") + "}";
}

export const luaText = (name, value) => name + " = " + lit(value) + "\n";

export const GUID = "Player-1-0000TEST";
export const T0 = 1794000000;

// Zeile im Log: dt, Kürzel, Felder
export const L = (dt, code, ...fields) => [dt, code, ...fields].join("~");

// Ein Log-Block (Kopf "#~Epoche~1") aus Zeilen
export const block = (start, lines) => "#~" + start + "~1\n" + lines.join("\n");

// Datenbank für einen Charakter. opts: blocks (Textblöcke) oder lines (Zeilen für einen Block ab T0), info, snapshots, counters,
// npcs, quests, sessions, interface
export function makeDb(opts = {}) {
  const blocks = opts.blocks || [block(opts.start ?? T0, opts.lines || [])];
  const char = {
    info: { name: "Testa", realm: "Probenwacht", race: "Mensch", raceFile: "Human", class: "Paladin", classFile: "PALADIN", faction: "Alliance", factionName: "Allianz", firstSeen: opts.start ?? T0, lastSeen: (opts.start ?? T0) + 100000, ...(opts.info || {}) },
    lineCount: 1,
    log: blocks,
    snapshots: opts.snapshots || {},
  };
  if (opts.counters) char.counters = opts.counters;
  if (opts.npcs) char.npcs = opts.npcs;
  if (opts.quests) char.quests = opts.quests;
  const meta = { tzOffset: 3600 };
  if (opts.sessions) meta.sessions = opts.sessions.map((s) => ({ guid: GUID, ...s }));
  const text = luaText("EveNChronicleDB", { locale: "deDE", schema: 1, meta, chars: { [GUID]: char } });
  const { db } = readSavedVariables(text);
  return db;
}

export function model(opts) {
  const db = makeDb(opts);
  const journal = buildJournal(db, GUID);
  return { db, journal, m: buildChronik(db, GUID, journal) };
}

export const medal = (m, id) => m.medals.list.find((e) => e.id === id);

// Die echte Dungeon-Probe des Addons (Halle der Thanen, Spielernamen ersetzt) als Datenbank
const FIX = JSON.parse(readFileSync(fileURLToPath(new URL("../fixtures/dungeon-thanen.json", import.meta.url)), "utf8"));
export { FIX as THANEN };

export function thanenOpts(rename = (s) => s) {
  const blocks = FIX.blocks.map((b) => block(b.start, b.lines.map((l) => rename(l))));
  const snapshots = {
    instances: { 3065: { name: rename(FIX.instances["3065"].name), type: "party" } },
    encounters: Object.fromEntries(Object.entries(FIX.encounters).map(([k, v]) => [k, { name: rename(v) }])),
    items: Object.fromEntries(Object.entries(FIX.items).map(([k, v]) => [k, { ...v, name: rename(v.name) }])),
    maps: { 1455: { name: "Eisenschmiede" }, 1426: { name: "Dun Morogh" }, 1415: { name: "Östliche Königreiche" } },
  };
  return {
    blocks,
    start: FIX.blocks[0].start,
    snapshots,
    npcs: Object.fromEntries(Object.entries(FIX.npcs).map(([k, v]) => [k, rename(v)])),
    quests: Object.fromEntries(Object.entries(FIX.quests).map(([k, v]) => [k, { title: rename(v) }])),
    sessions: [{ start: FIX.blocks[0].start - 100, stop: FIX.blocks[2].start + 1400 }],
  };
}
