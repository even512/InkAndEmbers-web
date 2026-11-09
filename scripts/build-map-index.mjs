// Baut src/geo/index.json aus den wago.tools-Schnappschüssen der Client-Tabellen (UiMap, UiMapAssignment, UiMapXMapArt,
// UiMapArt, UiMapArtTile) eines Forever-Builds. Die Seite braucht diese Tabelle, weil die SavedVariables nur uiMap-
// Koordinaten enthalten; das Addon fragt die Lage einer Zone auf dem Kontinent zur Laufzeit beim Client ab
// (C_Map.GetMapRectOnMap), das Web liest sie hier aus UiMapAssignment.
//
//   node scripts/build-map-index.mjs                  liest scripts/data/wago-<build>/, schreibt src/geo/index.json
//   node scripts/build-map-index.mjs --check          prüft nur: Exit 1, wenn index.json nicht zum Schnappschuss passt
//   node scripts/build-map-index.mjs --build <b>      anderer Build (Ordner scripts/data/wago-<b>/)
//   node scripts/build-map-index.mjs --fetch          lädt die fünf Tabellen (und UiMap in deDE/enUS) vorher neu von wago.tools (nur dieser Host)
//
// Zusätzlich schreibt es src/geo/zone-names.forever.json: die Kartennamen des Forever-Clients je uiMapID als [deDE, enUS]
// (UiMap.Name_lang aus UiMap.deDE.csv / UiMap.enUS.csv). Städte heißen dort auch auf Deutsch englisch (Ironforge, Stormwind).
//
// Je Eintrag in index.json (Schlüssel uiMapID):
//   name, type (1 Welt, 2 Kontinent, 3 Zone, 4 Unterzone, 5 Mikro, 6 Schlachtfeld/Instanz), parent,
//   continent (Vorfahr vom Typ 2 oder null), zone (Vorfahr vom Typ 3 einschließlich selbst, oder null),
//   art { id, rows, cols } oder null (Kartenkunst vorhanden: Kacheln der Ebene 0),
//   world [{ m, x0, x1, y0, y1 }]: Weltkoordinaten der vollen Karte (0..1) je Welt-Karte m
//     (x0/x1 = Welt-X am oberen/unteren Rand, y0/y1 = Welt-Y am linken/rechten Rand; WoW: Karten-x läuft gegen Welt-Y),
//   size [Breite, Höhe] in Yards oder null,
//   rect [links, rechts, oben, unten] auf der Kontinentkarte (0..1, wie GetMapRectOnMap) oder null.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { STRIP } from "../src/ui/safe-text.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_BUILD = "1.60.1.70862";
export const TABLES = ["UiMap", "UiMapAssignment", "UiMapXMapArt", "UiMapArt", "UiMapArtTile"];
// UiMap je Client-Sprache (Name_lang): Dateien UiMap.<Sprache>.csv; Reihenfolge [de, en] wie ZONE_NAMES
export const NAME_LOCALES = ["deDE", "enUS"];
export const NAME_TABLES = NAME_LOCALES.map((l) => "UiMap." + l);
const WAGO_HOST = "wago.tools";
const BUILD_RE = /^\d{1,2}\.\d{1,3}\.\d{1,3}\.\d{1,7}$/;
const MAX_CSV_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 100000;
const MAX_DEPTH = 8;
const FETCH_TIMEOUT_MS = 30000;
// plausible bounds of a map rect on its continent (zones can stick out past the edge; as Geo.RECT_MIN/MAX in the addon)
export const RECT_MIN = -0.5;
export const RECT_MAX = 1.5;

// Spalten, die das Skript braucht (je Tabelle); fehlt eine, bricht es ab statt still falsch zu rechnen
const REQUIRED = {
  UiMap: ["ID", "Name_lang", "ParentUiMapID", "Type"],
  UiMapAssignment: ["UiMapID", "MapID", "OrderIndex", "UiMin_0", "UiMin_1", "UiMax_0", "UiMax_1", "Region_0", "Region_1", "Region_3", "Region_4"],
  UiMapXMapArt: ["UiMapID", "UiMapArtID", "PhaseID"],
  UiMapArt: ["ID"],
  UiMapArtTile: ["UiMapArtID", "RowIndex", "ColIndex", "LayerIndex", "FileDataID"],
};

// RFC-4180-CSV (Anführungszeichen, verdoppelte "" im Feld, Zeilenumbruch im Feld) -> Liste von Objekten nach Kopfzeile
export function parseCsv(text, name = "CSV") {
  if (typeof text !== "string") throw new Error(name + ": kein Text");
  if (text.length > MAX_CSV_BYTES) throw new Error(name + ": zu groß");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  while (i < src.length) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else field += c;
      i++;
      continue;
    }
    if (c === '"' && field === "") quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (!(row.length === 1 && row[0] === "")) rows.push(row);
      if (rows.length > MAX_ROWS) throw new Error(name + ": zu viele Zeilen");
      row = [];
    } else field += c;
    i++;
  }
  if (quoted) throw new Error(name + ": Anführungszeichen nicht geschlossen");
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (!rows.length) throw new Error(name + ": leer");
  const head = rows[0];
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    if (rows[r].length !== head.length) throw new Error(name + ": Zeile " + (r + 1) + " hat " + rows[r].length + " statt " + head.length + " Felder");
    const o = Object.create(null);
    head.forEach((h, k) => (o[h] = rows[r][k]));
    out.push(o);
  }
  return { head, rows: out };
}

function num(v, what) {
  if (typeof v !== "string" || !/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(v)) throw new Error(what + ": keine Zahl (" + String(v).slice(0, 20) + ")");
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(what + ": keine endliche Zahl");
  return n;
}

function int(v, what) {
  const n = num(v, what);
  if (!Number.isInteger(n)) throw new Error(what + ": keine ganze Zahl");
  return n;
}

const round = (v, d) => {
  const f = 10 ** d;
  const r = Math.round(v * f) / f;
  return Object.is(r, -0) ? 0 : r;
};

// Weltausdehnung der vollen Karte (0..1) aus einer UiMapAssignment-Zeile: das Rechteck UiMin..UiMax der Karte deckt die
// Weltregion ab; linear auf 0..1 hochgerechnet. Karten-x wächst mit fallendem Welt-Y, Karten-y mit fallendem Welt-X.
export function worldExtent(a) {
  const u0 = a.uiMin0, v0 = a.uiMin1, u1 = a.uiMax0, v1 = a.uiMax1;
  const minX = a.minX, minY = a.minY, maxX = a.maxX, maxY = a.maxY;
  if (!(u1 > u0 && v1 > v0 && maxX > minX && maxY > minY)) return null;
  const sy = (maxY - minY) / (u1 - u0); // Yards je Karteneinheit in x
  const sx = (maxX - minX) / (v1 - v0); // Yards je Karteneinheit in y
  return { m: a.mapID, y0: maxY + u0 * sy, y1: maxY - (1 - u0) * sy, x0: maxX + v0 * sx, x1: maxX - (1 - v0) * sx };
}

// Rechteck der Karte mit Weltausdehnung w auf der Karte mit Weltausdehnung p (gleiche Welt-Karte) -> [l, r, t, b]
export function rectOnExtent(w, p) {
  if (!w || !p || w.m !== p.m) return null;
  const fx = (wy) => (p.y0 - wy) / (p.y0 - p.y1);
  const fy = (wx) => (p.x0 - wx) / (p.x0 - p.x1);
  return [fx(w.y0), fx(w.y1), fy(w.x0), fy(w.x1)];
}

export function plausibleRect(r) {
  if (!r || r.some((v) => !Number.isFinite(v))) return false;
  const [l, rt, t, b] = r;
  return l >= RECT_MIN && t >= RECT_MIN && rt <= RECT_MAX && b <= RECT_MAX && rt > l && b > t;
}

function check(table, parsed) {
  for (const col of REQUIRED[table]) if (!parsed.head.includes(col)) throw new Error(table + ": Spalte " + col + " fehlt");
  return parsed.rows;
}

// Kartenname aus der Tabelle: dieselbe Strip-Liste wie die Seite (safe-text: Steuer-, Bidi-, Zero-Width-, Tag-Zeichen)
export function cleanName(v) {
  return String(v ?? "").replace(STRIP, "").trim().slice(0, 80);
}

// UiMap-Auszüge deDE/enUS (CSV-Text) -> { build, source, names: { uiMapID: [de, en] } }; beide Sprachen müssen dieselben IDs haben
export function buildZoneNames(csv, build) {
  if (!BUILD_RE.test(String(build))) throw new Error("Build ungültig: " + build);
  const per = NAME_TABLES.map((name) => {
    if (typeof csv[name] !== "string") throw new Error("Tabelle fehlt: " + name);
    const m = new Map();
    for (const r of check("UiMap", parseCsv(csv[name], name))) {
      const id = int(r.ID, name + ".ID");
      if (id <= 0 || id > 1e6) throw new Error(name + ".ID außerhalb: " + id);
      m.set(id, cleanName(r.Name_lang));
    }
    return m;
  });
  const [de, en] = per;
  if (de.size !== en.size) throw new Error("UiMap deDE/enUS haben verschieden viele Karten");
  const names = Object.create(null);
  for (const id of [...en.keys()].sort((a, b) => a - b)) {
    if (!de.has(id)) throw new Error("UiMap " + id + " fehlt in " + NAME_TABLES[0]);
    if (!de.get(id) || !en.get(id)) continue;
    names[id] = [de.get(id), en.get(id)];
  }
  return { build: String(build), source: "https://" + WAGO_HOST + "/db2/UiMap/csv?build=" + build + "&locale=<deDE|enUS>", names };
}

// Tabellen (CSV-Text je Name) -> index-Objekt
export function buildIndex(csv, build) {
  if (!BUILD_RE.test(String(build))) throw new Error("Build ungültig: " + build);
  const t = {};
  for (const name of TABLES) {
    if (typeof csv[name] !== "string") throw new Error("Tabelle fehlt: " + name);
    t[name] = check(name, parseCsv(csv[name], name));
  }

  const maps = new Map();
  for (const r of t.UiMap) {
    const id = int(r.ID, "UiMap.ID");
    if (id <= 0 || id > 1e6) throw new Error("UiMap.ID außerhalb: " + id);
    const name = cleanName(r.Name_lang);
    maps.set(id, { id, name, type: int(r.Type, "UiMap.Type"), parent: int(r.ParentUiMapID, "UiMap.ParentUiMapID") });
  }

  const ancestor = (id, wanted, includeSelf) => {
    let cur = includeSelf ? maps.get(id) : maps.get(maps.get(id)?.parent);
    for (let d = 0; cur && d < MAX_DEPTH; d++) {
      if (cur.type === wanted) return cur.id;
      if (cur.type < wanted) return null;
      cur = maps.get(cur.parent);
    }
    return null;
  };

  const worlds = new Map();
  for (const r of t.UiMapAssignment) {
    const uiMap = int(r.UiMapID, "UiMapAssignment.UiMapID");
    if (!maps.has(uiMap)) continue;
    const a = {
      mapID: int(r.MapID, "UiMapAssignment.MapID"), order: int(r.OrderIndex, "UiMapAssignment.OrderIndex"),
      uiMin0: num(r.UiMin_0, "UiMin_0"), uiMin1: num(r.UiMin_1, "UiMin_1"), uiMax0: num(r.UiMax_0, "UiMax_0"), uiMax1: num(r.UiMax_1, "UiMax_1"),
      minX: num(r.Region_0, "Region_0"), minY: num(r.Region_1, "Region_1"), maxX: num(r.Region_3, "Region_3"), maxY: num(r.Region_4, "Region_4"),
    };
    const w = worldExtent(a);
    if (!w) continue;
    const list = worlds.get(uiMap) || [];
    // je Welt-Karte die Zeile mit dem kleinsten OrderIndex (Haupt-Zuordnung)
    const prev = list.find((x) => x.m === w.m);
    if (prev && prev.order <= a.order) continue;
    if (prev) list.splice(list.indexOf(prev), 1);
    list.push({ ...w, order: a.order });
    worlds.set(uiMap, list);
  }

  const tiles = new Map();
  for (const r of t.UiMapArtTile) {
    const art = int(r.UiMapArtID, "UiMapArtTile.UiMapArtID");
    if (int(r.LayerIndex, "UiMapArtTile.LayerIndex") !== 0) continue;
    if (int(r.FileDataID, "UiMapArtTile.FileDataID") <= 0) continue;
    const e = tiles.get(art) || { rows: 0, cols: 0, n: 0 };
    e.rows = Math.max(e.rows, int(r.RowIndex, "RowIndex") + 1);
    e.cols = Math.max(e.cols, int(r.ColIndex, "ColIndex") + 1);
    e.n++;
    tiles.set(art, e);
  }
  const artIds = new Set(t.UiMapArt.map((r) => int(r.ID, "UiMapArt.ID")));
  const artOf = new Map();
  for (const r of t.UiMapXMapArt) {
    if (int(r.PhaseID, "UiMapXMapArt.PhaseID") !== 0) continue;
    const id = int(r.UiMapID, "UiMapXMapArt.UiMapID");
    const art = int(r.UiMapArtID, "UiMapXMapArt.UiMapArtID");
    const tl = tiles.get(art);
    if (!maps.has(id) || !artIds.has(art) || !tl || tl.n !== tl.rows * tl.cols) continue;
    artOf.set(id, { id: art, rows: tl.rows, cols: tl.cols });
  }

  const out = Object.create(null);
  for (const id of [...maps.keys()].sort((a, b) => a - b)) {
    const m = maps.get(id);
    const continent = m.type === 2 ? id : ancestor(id, 2, false);
    const world = (worlds.get(id) || []).sort((a, b) => a.m - b.m)
      .map((w) => ({ m: w.m, x0: round(w.x0, 3), x1: round(w.x1, 3), y0: round(w.y0, 3), y1: round(w.y1, 3) }));
    const w0 = world[0];
    const size = w0 && world.length === 1 ? [round(Math.abs(w0.y0 - w0.y1), 3), round(Math.abs(w0.x0 - w0.x1), 3)] : null;
    let rect = null;
    if (continent === id) rect = [0, 1, 0, 1];
    else if (continent && w0) {
      const cw = worlds.get(continent) || [];
      for (const w of world) {
        const p = cw.find((x) => x.m === w.m);
        const r = p && rectOnExtent(w, p);
        if (r && plausibleRect(r)) {
          rect = r.map((v) => round(v, 6));
          break;
        }
      }
    }
    out[id] = { name: m.name, type: m.type, parent: m.parent || null, continent: continent || null, zone: ancestor(id, 3, true),
      art: artOf.get(id) || null, world, size, rect };
  }
  return { build: String(build), source: "https://" + WAGO_HOST + "/db2/<Tabelle>/csv?build=" + build, maps: out };
}

export function dataDir(build) {
  return join(ROOT, "scripts", "data", "wago-" + build);
}

export function readTables(dir) {
  const csv = {};
  for (const name of TABLES) {
    const f = join(dir, name + ".csv");
    if (!existsSync(f)) throw new Error("Schnappschuss fehlt: " + f + " (mit --fetch laden)");
    csv[name] = readFileSync(f, "utf8");
  }
  for (const name of NAME_TABLES) {
    const f = join(dir, name + ".csv");
    if (!existsSync(f)) throw new Error("Schnappschuss fehlt: " + f + " (mit --fetch laden)");
    csv[name] = readFileSync(f, "utf8");
  }
  return csv;
}

export function serialize(index) {
  return JSON.stringify(index, null, 1) + "\n";
}

// Antworttext mit Größenbremse lesen: bricht ab, sobald mehr als max Bytes ankommen (Content-Length vorab geprüft)
export async function readLimited(res, max, name) {
  const len = Number(res.headers && typeof res.headers.get === "function" ? res.headers.get("content-length") : NaN);
  if (Number.isFinite(len) && len > max) throw new Error(name + ": Antwort zu groß (" + len + " Bytes)");
  if (!res.body || typeof res.body.getReader !== "function") {
    const text = await res.text();
    if (Buffer.byteLength(text) > max) throw new Error(name + ": Antwort zu groß");
    return text;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new Error(name + ": Antwort zu groß (über " + max + " Bytes)");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

// alle fünf Tabellen laden (fester Host, Zeitlimit, Größenbremse), ERST alle prüfen (buildIndex), dann schreiben.
// fetchImpl ist für Tests austauschbar.
export async function fetchTables(build, dir, { fetchImpl = fetch, timeoutMs = FETCH_TIMEOUT_MS, write = true } = {}) {
  if (!BUILD_RE.test(String(build))) throw new Error("Build ungültig: " + build);
  const csv = {};
  const jobs = [...TABLES.map((t) => [t, t, null]), ...NAME_LOCALES.map((l) => ["UiMap." + l, "UiMap", l])];
  for (const [name, table, locale] of jobs) {
    // fester Host, Tabelle aus der Whitelist, Build per Regex geprüft, Sprache aus fester Liste
    const url = new URL("https://" + WAGO_HOST + "/db2/" + encodeURIComponent(table) + "/csv");
    url.searchParams.set("build", build);
    if (locale) url.searchParams.set("locale", locale);
    let res;
    try {
      res = await fetchImpl(url, { redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      const why = e && (e.name === "TimeoutError" || e.name === "AbortError") ? "Zeitlimit (" + timeoutMs / 1000 + " s) überschritten" : String((e && e.message) || e);
      throw new Error(name + ": Abruf fehlgeschlagen – " + why);
    }
    if (!res.ok) throw new Error(name + ": HTTP " + res.status);
    const text = (await readLimited(res, MAX_CSV_BYTES, name)).replace(/\r\n/g, "\n");
    parseCsv(text, name);
    csv[name] = text;
    process.stdout.write("geladen: " + name + " (" + text.length + " Zeichen)\n");
  }
  buildIndex(csv, build); // wirft, wenn eine Tabelle nicht passt – dann wird nichts überschrieben
  buildZoneNames(csv, build);
  if (write) {
    mkdirSync(dir, { recursive: true });
    for (const name of [...TABLES, ...NAME_TABLES]) writeFileSync(join(dir, name + ".csv"), csv[name]);
  }
  return csv;
}

function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  if (i < 0) return null;
  if (!argv[i + 1]) throw new Error(flag + " braucht einen Wert.");
  return argv[i + 1];
}

async function main() {
  const argv = process.argv.slice(2);
  const build = argValue(argv, "--build") || DEFAULT_BUILD;
  if (!BUILD_RE.test(build)) throw new Error("Build ungültig: " + build);
  const dir = dataDir(build);
  if (argv.includes("--fetch")) await fetchTables(build, dir);
  const index = buildIndex(readTables(dir), build);
  const text = serialize(index);
  const outFile = join(ROOT, "src", "geo", "index.json");
  const namesFile = join(ROOT, "src", "geo", "zone-names.forever.json");
  const namesText = serialize(buildZoneNames(readTables(dir), build));
  const maps = Object.values(index.maps);
  const summary = maps.length + " Karten, " + maps.filter((m) => m.art).length + " mit Kunst, " + maps.filter((m) => m.rect).length + " mit Kontinent-Rechteck";
  if (argv.includes("--check")) {
    const cur = existsSync(outFile) ? readFileSync(outFile, "utf8").replace(/\r\n/g, "\n") : "";
    if (cur !== text) {
      process.stderr.write("src/geo/index.json passt nicht zum Schnappschuss " + build + " (npm run build-map-index)\n");
      process.exit(1);
    }
    const curNames = existsSync(namesFile) ? readFileSync(namesFile, "utf8").replace(/\r\n/g, "\n") : "";
    if (curNames !== namesText) {
      process.stderr.write("src/geo/zone-names.forever.json passt nicht zum Schnappschuss " + build + " (npm run build-map-index)\n");
      process.exit(1);
    }
    process.stdout.write("index.json aktuell (" + summary + ")\n");
    return;
  }
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, text);
  writeFileSync(namesFile, namesText);
  process.stdout.write("geschrieben: src/geo/index.json (Build " + build + ", " + summary + ")\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    process.stderr.write(String(e && e.message ? e.message : e) + "\n");
    process.exit(2);
  });
}
