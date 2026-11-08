// Kartenkunst aus dem lokalen WoW-Forever-Client (CASC) auslesen und als WebP nach public/maps/forever/ schreiben (W3).
// Läuft nur auf dem Rechner mit installiertem Client; der CI-Build braucht den Client nicht, die Bilder werden committet.
//
//   node scripts/extract-maps.mjs                       alle uiMaps mit Kunst (src/geo/index.json), Sprachen en + de
//   node scripts/extract-maps.mjs --only 1426,1453      nur diese uiMapIDs (Probelauf)
//   node scripts/extract-maps.mjs --locales de          nur eine Sprache
//   node scripts/extract-maps.mjs --wow-dir "D:\World of Warcraft"   Client-Pfad (sonst WOW_FOREVER_DIR aus .env/Umgebung)
//   node scripts/extract-maps.mjs --contact docs/maps-contact.png    zusätzlich Kontaktbogen (alle Karten klein) zur Sichtprüfung
//
// Ablauf je Karte: Kachel-FileDataIDs aus UiMapArtTile (Ebene 0, Zeile/Spalte wie Map.tiles im Spiel) und alle
// Erkundungs-Overlays aus WorldMapOverlay/WorldMapOverlayTile (aufgedeckt eingerechnet) -> BLP aus CASC lesen
// (@jamiephan/casclib, Datei "File<FileDataID>") -> dekodieren (wow-blp-web) -> zusammensetzen (Originalfarben) ->
// auf die sichtbare Kartenfläche zuschneiden -> WebP (sharp), Qualität so gewählt, dass ≤ 300 KB.
// Kartenkunst ist sprachabhängig (Ortsnamen sind ins Bild gemalt), darum je Sprache ein Satz:
//   public/maps/forever/<locale>/<uiMapID>.webp  und  public/maps/forever/manifest.json
// Fehlt eine Kachel im Client, bricht die Karte mit Fehlermeldung ab (Exit 1), es wird nichts still übersprungen.
// Kartenkunst © Blizzard Entertainment, siehe public/maps/LICENSE-NOTE.md.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync } from "node:fs";
import { dirname, join, resolve, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { parseCsv, DEFAULT_BUILD } from "./build-map-index.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const PRODUCT = "wowf";
export const TILE = 256; // Raster der Kacheln und Overlay-Teilstücke im Spiel
// sichtbare Fläche der Weltkarte bei 4x3 Kacheln (Rest der 1024x768 ist Polster); andere Raster bleiben ungeschnitten
export const MAP_W = 1002;
export const MAP_H = 668;
export const MAX_BYTES_PER_IMAGE = 300 * 1024;
export const MAX_BYTES_TOTAL = 20 * 1024 * 1024;
export const LOCALES = { en: "CASC_LOCALE_ENUS", de: "CASC_LOCALE_DEDE" };
const QUALITIES = [90, 85, 80, 75, 70, 65, 60, 55, 50];
const BUDGET_SHARE = 0.95; // Reserve unter der Gesamtgrenze
const MAX_TILES_PER_MAP = 64;
const MAX_TILE_EDGE = 1024;
const BUILD_RE = /^\d{1,2}\.\d{1,3}\.\d{1,3}\.\d{1,7}$/;

const toInt = (v, what) => {
  if (typeof v !== "string" || !/^-?\d+$/.test(v)) throw new Error(what + ": keine ganze Zahl (" + String(v).slice(0, 20) + ")");
  return Number(v);
};

// --- reine Planung (testbar) ---------------------------------------------------------------------------------------

// Tabellen (Objekte aus parseCsv) -> Bauplan einer Karte: Kachelraster der Ebene 0 und Overlays mit ihren Teilstücken.
// Wirft bei Lücken im Raster (fehlende Zeile/Spalte in UiMapArtTile) statt still zu überspringen.
export function planMap(artID, tables) {
  const tiles = tables.UiMapArtTile.filter((r) => toInt(r.UiMapArtID, "UiMapArtID") === artID && toInt(r.LayerIndex, "LayerIndex") === 0).map(
    (r) => ({ row: toInt(r.RowIndex, "RowIndex"), col: toInt(r.ColIndex, "ColIndex"), fileID: toInt(r.FileDataID, "FileDataID") }),
  );
  if (!tiles.length) throw new Error("UiMapArt " + artID + ": keine Kacheln in UiMapArtTile");
  if (tiles.length > MAX_TILES_PER_MAP) throw new Error("UiMapArt " + artID + ": zu viele Kacheln");
  const rows = Math.max(...tiles.map((t) => t.row)) + 1;
  const cols = Math.max(...tiles.map((t) => t.col)) + 1;
  const grid = new Map(tiles.map((t) => [t.row + ":" + t.col, t]));
  const gaps = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (!grid.has(r + ":" + c)) gaps.push("Zeile " + r + " Spalte " + c);
  if (gaps.length) throw new Error("UiMapArt " + artID + ": Raster unvollständig (" + gaps.join(", ") + ")");
  if (grid.size !== tiles.length) throw new Error("UiMapArt " + artID + ": doppelte Kachel im Raster");
  tiles.sort((a, b) => a.row - b.row || a.col - b.col);

  const overlays = [];
  const warnings = [];
  for (const o of tables.WorldMapOverlay || []) {
    if (toInt(o.UiMapArtID, "UiMapArtID") !== artID) continue;
    const id = toInt(o.ID, "WorldMapOverlay.ID");
    // 0x0-Einträge sind reine Klickflächen ohne Bild (Spiel zeichnet nichts)
    if (toInt(o.TextureWidth, "TextureWidth") === 0 && toInt(o.TextureHeight, "TextureHeight") === 0) continue;
    const parts = (tables.WorldMapOverlayTile || [])
      .filter((t) => toInt(t.WorldMapOverlayID, "WorldMapOverlayID") === id && toInt(t.LayerIndex, "LayerIndex") === 0)
      .map((t) => ({ row: toInt(t.RowIndex, "RowIndex"), col: toInt(t.ColIndex, "ColIndex"), fileID: toInt(t.FileDataID, "FileDataID") }))
      .sort((a, b) => a.row - b.row || a.col - b.col);
    if (!parts.length) {
      // Overlay mit Größe, aber ohne Bilddateien in der Tabelle: es gibt nichts zu laden; laut melden, Karte trotzdem bauen
      warnings.push("WorldMapOverlay " + id + " (Gebiet " + o.AreaID_0 + ", " + o.TextureWidth + "x" + o.TextureHeight + "): keine Teilstücke in WorldMapOverlayTile, fehlt im Bild");
      continue;
    }
    const ov = {
      id,
      width: toInt(o.TextureWidth, "TextureWidth"),
      height: toInt(o.TextureHeight, "TextureHeight"),
      x: toInt(o.OffsetX, "OffsetX"),
      y: toInt(o.OffsetY, "OffsetY"),
      parts,
    };
    if (ov.width <= 0 || ov.height <= 0 || ov.width > 4 * MAX_TILE_EDGE || ov.height > 4 * MAX_TILE_EDGE) throw new Error("WorldMapOverlay " + id + ": unplausible Größe");
    overlays.push(ov);
  }
  overlays.sort((a, b) => a.id - b.id);
  return { artID, rows, cols, tiles, overlays, warnings };
}

// Alle FileDataIDs eines Bauplans (Kacheln + Overlays), für die Vorab-Prüfung auf fehlende Dateien
export function planFileIDs(plan) {
  return [...plan.tiles.map((t) => t.fileID), ...plan.overlays.flatMap((o) => o.parts.map((p) => p.fileID))];
}

// Zuschnitt der zusammengesetzten Fläche: 4x3 Kacheln à 256 -> 1002x668 wie im Spiel, sonst die volle Fläche
export function cropSize(fullW, fullH) {
  return fullW === 4 * TILE && fullH === 3 * TILE ? { width: MAP_W, height: MAP_H } : { width: fullW, height: fullH };
}

// --- Zusammensetzen (rein, testbar) -------------------------------------------------------------------------------

function checkImage(img, what) {
  if (!img || !Number.isInteger(img.width) || !Number.isInteger(img.height) || img.width <= 0 || img.height <= 0) throw new Error(what + ": ungültige Bildmaße");
  if (img.width > MAX_TILE_EDGE || img.height > MAX_TILE_EDGE) throw new Error(what + ": Bild zu groß");
  if (!img.rgba || img.rgba.length !== img.width * img.height * 4) throw new Error(what + ": RGBA-Länge passt nicht");
}

// Kopiert (opak) bzw. blendet (Alpha, "source over") ein Bild in die Zielfläche; clip begrenzt die Quellfläche
// (Overlay-Teilstücke sind auf Zweierpotenzen aufgefüllt, nur TextureWidth x TextureHeight zählt).
export function blit(dst, src, dx, dy, { blend = false, clipW = src.width, clipH = src.height } = {}) {
  const w = Math.min(src.width, clipW);
  const h = Math.min(src.height, clipH);
  for (let y = 0; y < h; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= dst.height) continue;
    for (let x = 0; x < w; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= dst.width) continue;
      const s = (y * src.width + x) * 4;
      const d = (ty * dst.width + tx) * 4;
      if (!blend) {
        dst.rgba[d] = src.rgba[s];
        dst.rgba[d + 1] = src.rgba[s + 1];
        dst.rgba[d + 2] = src.rgba[s + 2];
        dst.rgba[d + 3] = src.rgba[s + 3];
        continue;
      }
      const a = src.rgba[s + 3] / 255;
      if (a === 0) continue;
      const da = dst.rgba[d + 3] / 255;
      const oa = a + da * (1 - a);
      for (let k = 0; k < 3; k++) dst.rgba[d + k] = Math.round((src.rgba[s + k] * a + dst.rgba[d + k] * da * (1 - a)) / oa);
      dst.rgba[d + 3] = Math.round(oa * 255);
    }
  }
}

// plan + getImage(fileID) -> { width, height, rgba } der zugeschnittenen Karte. getImage liefert dekodierte Bilder
// ({ width, height, rgba }) oder wirft; fehlende Dateien werden gesammelt und am Ende gemeinsam gemeldet.
export function composeMap(plan, getImage) {
  const missing = [];
  const load = (fileID, what) => {
    try {
      const img = getImage(fileID);
      checkImage(img, what + " (File " + fileID + ")");
      return img;
    } catch (e) {
      missing.push(fileID + " (" + what + ": " + (e && e.message ? e.message : e) + ")");
      return null;
    }
  };
  const base = plan.tiles.map((t) => ({ t, img: load(t.fileID, "Kachel " + t.row + "/" + t.col) }));
  const overlays = plan.overlays.map((o) => ({ o, parts: o.parts.map((p) => ({ p, img: load(p.fileID, "Overlay " + o.id + " " + p.row + "/" + p.col) })) }));
  if (missing.length) {
    const err = new Error("UiMapArt " + plan.artID + ": " + missing.length + " Datei(en) fehlen oder sind unlesbar: " + missing.join("; "));
    err.missing = missing;
    throw err;
  }
  const tw = base[0].img.width;
  const th = base[0].img.height;
  for (const { t, img } of base) if (img.width !== tw || img.height !== th) throw new Error("UiMapArt " + plan.artID + ": Kachel " + t.row + "/" + t.col + " hat abweichende Größe");
  const full = { width: plan.cols * tw, height: plan.rows * th };
  const canvas = { ...full, rgba: new Uint8Array(full.width * full.height * 4) };
  for (const { t, img } of base) blit(canvas, img, t.col * tw, t.row * th);
  // Overlays in Spiel-Pixeln (Basis 1002x668 bei 256er-Kacheln); bei anderer Kachelgröße mitskalieren wäre nötig
  if (overlays.length && (tw !== TILE || th !== TILE)) throw new Error("UiMapArt " + plan.artID + ": Overlays bei Kachelgröße " + tw + "x" + th + " nicht unterstützt");
  for (const { o, parts } of overlays) {
    for (const { p, img } of parts) {
      const clipW = o.width - p.col * TILE;
      const clipH = o.height - p.row * TILE;
      if (clipW <= 0 || clipH <= 0) continue;
      blit(canvas, img, o.x + p.col * TILE, o.y + p.row * TILE, { blend: true, clipW, clipH });
    }
  }
  const crop = cropSize(full.width, full.height);
  if (crop.width === full.width && crop.height === full.height) return canvas;
  const out = { ...crop, rgba: new Uint8Array(crop.width * crop.height * 4) };
  for (let y = 0; y < crop.height; y++) out.rgba.set(canvas.rgba.subarray(y * full.width * 4, (y * full.width + crop.width) * 4), y * crop.width * 4);
  return out;
}

// --- Konfiguration ------------------------------------------------------------------------------------------------

export function parseArgs(argv) {
  const opts = { only: null, locales: Object.keys(LOCALES), wowDir: null, build: DEFAULT_BUILD, contact: null, out: join(ROOT, "public", "maps", "forever") };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(a + ": Wert fehlt");
      return v;
    };
    if (a === "--only") {
      opts.only = val().split(",").map((s) => toInt(s.trim(), "--only"));
      if (opts.only.some((n) => n <= 0)) throw new Error("--only: nur positive uiMapIDs");
    } else if (a === "--locales") {
      opts.locales = val().split(",").map((s) => s.trim());
      for (const l of opts.locales) if (!Object.hasOwn(LOCALES, l)) throw new Error("--locales: unbekannt '" + l + "' (erlaubt: " + Object.keys(LOCALES).join(", ") + ")");
    } else if (a === "--wow-dir") opts.wowDir = val();
    else if (a === "--build") {
      opts.build = val();
      if (!BUILD_RE.test(opts.build)) throw new Error("--build: Format a.b.c.d erwartet");
    } else if (a === "--contact") opts.contact = resolve(ROOT, val());
    else throw new Error("Unbekanntes Argument: " + a);
  }
  return opts;
}

function resolveWowDir(opts) {
  if (!opts.wowDir) {
    const envFile = join(ROOT, ".env");
    if (existsSync(envFile) && typeof process.loadEnvFile === "function") process.loadEnvFile(envFile);
    opts.wowDir = process.env.WOW_FOREVER_DIR || null;
  }
  if (!opts.wowDir || !opts.wowDir.trim()) {
    throw new Error("Client-Pfad nicht konfiguriert: WOW_FOREVER_DIR in .env setzen (siehe .env.example) oder --wow-dir angeben.");
  }
  const dir = opts.wowDir.trim();
  if (!isAbsolute(dir)) throw new Error("Client-Pfad muss absolut sein");
  // CASC liegt unter <Installationsordner>/Data; auch den Produktordner (_forever_) annehmen
  const root = existsSync(join(dir, "Data", "data")) ? dir : existsSync(join(dir, "..", "Data", "data")) ? resolve(dir, "..") : null;
  if (!root) throw new Error("Kein CASC-Speicher gefunden unter " + dir + " (erwartet Data/data im WoW-Ordner)");
  return root;
}

function loadTables(build) {
  const dir = join(ROOT, "scripts", "data", "wago-" + build);
  const tables = {};
  for (const name of ["UiMapArtTile", "WorldMapOverlay", "WorldMapOverlayTile"]) {
    const f = join(dir, name + ".csv");
    if (!existsSync(f)) throw new Error("Schnappschuss fehlt: " + f);
    tables[name] = parseCsv(readFileSync(f, "utf8"), name).rows;
  }
  return tables;
}

// --- Client-Zugriff -----------------------------------------------------------------------------------------------

async function loadTools() {
  const require = createRequire(join(ROOT, "package.json"));
  const casc = require("@jamiephan/casclib");
  const sharp = require("sharp");
  const blpDir = dirname(require.resolve("wow-blp-web/package.json"));
  const blp = await import(pathToFileURL(join(blpDir, "wow_blp_web.js")).href);
  // in Node lädt init() die WASM-Datei nicht selbst (fetch auf file:), darum direkt übergeben
  blp.initSync({ module: readFileSync(join(blpDir, "wow_blp_web_bg.wasm")) });
  return { casc, sharp, blp };
}

// Öffnet den gemeinsamen CASC-Speicher gezielt für das Forever-Produkt. Achtung: die Kurzform "Pfad:wowf" öffnet bei
// geteiltem Data-Ordner still Retail; codeName als Option ist nötig. Sprache als Maske, sonst wählt CascLib bei
// sprachabhängigen Kacheln eine nicht installierte Variante (Datei gefunden, aber ohne Inhalt).
function openStorage(casc, root, locale, build) {
  const st = casc.Storage.openEx(root, { codeName: PRODUCT, localeMask: casc[LOCALES[locale]] });
  const info = st.getProductInfo();
  const wantBuild = Number(build.split(".").pop());
  if (!info || info.codeName !== PRODUCT || info.buildNumber !== wantBuild) {
    st.close();
    throw new Error("Falsches Produkt im CASC-Speicher: " + (info ? info.codeName + " " + info.buildNumber : "unbekannt") + ", erwartet " + PRODUCT + " " + wantBuild + " (Snapshot " + build + "; bei neuem Client-Build erst die wago-Tabellen erneuern)");
  }
  return st;
}

function makeReader(st, blp) {
  const cache = new Map();
  return (fileID) => {
    if (cache.has(fileID)) return cache.get(fileID);
    const bytes = st.readFile("File" + fileID);
    const d = blp.decodeBlp(new Uint8Array(bytes));
    const img = { width: d.width, height: d.height, rgba: d.rgba instanceof Uint8Array ? d.rgba : new Uint8Array(d.rgba) };
    cache.set(fileID, img);
    return img;
  };
}

// Größengrenze je Bild: 300 KB, aber so, dass alle Karten aller Sprachen zusammen unter 20 MB bleiben
export function perImageLimit(imageCount) {
  if (!Number.isInteger(imageCount) || imageCount <= 0) throw new Error("Bildanzahl ungültig");
  return Math.min(MAX_BYTES_PER_IMAGE, Math.floor((MAX_BYTES_TOTAL * BUDGET_SHARE) / imageCount));
}

// WebP mit der höchsten Qualität, die unter das Größenlimit passt
export async function encodeWebp(sharp, img, maxBytes = MAX_BYTES_PER_IMAGE) {
  const src = sharp(Buffer.from(img.rgba.buffer, img.rgba.byteOffset, img.rgba.byteLength), { raw: { width: img.width, height: img.height, channels: 4 } });
  for (const quality of QUALITIES) {
    const buf = await src.clone().webp({ quality, effort: 6, alphaQuality: 100 }).toBuffer();
    if (buf.length <= maxBytes) return { buf, quality };
  }
  throw new Error("WebP auch bei Qualität " + QUALITIES[QUALITIES.length - 1] + " größer als " + maxBytes + " Bytes");
}

async function writeContactSheet(sharp, manifest, outDir, file) {
  const THUMB_W = 250;
  const THUMB_H = 167;
  const entries = [];
  for (const [id, m] of Object.entries(manifest.maps)) for (const loc of Object.keys(m.files)) entries.push({ id, loc, name: m.name, file: join(outDir, m.files[loc].file) });
  const cols = 8;
  const rows = Math.ceil(entries.length / cols);
  const comps = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const thumb = await sharp(e.file).resize(THUMB_W, THUMB_H, { fit: "contain", background: "#222" }).png().toBuffer();
    const label = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + THUMB_W + '" height="18"><rect width="100%" height="100%" fill="#000" opacity="0.6"/>' +
        '<text x="4" y="13" font-family="Arial" font-size="12" fill="#fff">' + escapeXml(e.id + " " + e.loc + " " + e.name) + "</text></svg>",
    );
    const left = (i % cols) * (THUMB_W + 4);
    const top = Math.floor(i / cols) * (THUMB_H + 4);
    comps.push({ input: thumb, left, top }, { input: label, left, top: top + THUMB_H - 18 });
  }
  mkdirSync(dirname(file), { recursive: true });
  await sharp({ create: { width: cols * (THUMB_W + 4), height: rows * (THUMB_H + 4), channels: 3, background: "#111" } }).composite(comps).png().toFile(file);
}

export function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
}

function dirBytes(dir) {
  let sum = 0;
  if (!existsSync(dir)) return 0;
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    const s = statSync(p);
    sum += s.isDirectory() ? dirBytes(p) : n.endsWith(".webp") ? s.size : 0;
  }
  return sum;
}

// --- Hauptlauf ----------------------------------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const root = resolveWowDir(opts);
  const index = JSON.parse(readFileSync(join(ROOT, "src", "geo", "index.json"), "utf8"));
  if (index.build !== opts.build) throw new Error("src/geo/index.json ist für Build " + index.build + ", erwartet " + opts.build);
  const tables = loadTables(opts.build);
  const wanted = Object.entries(index.maps)
    .filter(([id, m]) => m.art && (!opts.only || opts.only.includes(Number(id))))
    .map(([id, m]) => ({ id: Number(id), name: m.name, artID: m.art.id }));
  if (opts.only) for (const id of opts.only) if (!wanted.some((w) => w.id === id)) throw new Error("uiMap " + id + " hat laut index.json keine Kartenkunst");
  if (!wanted.length) throw new Error("keine Karten mit Kunst gefunden");

  const tools = await loadTools();
  const manifestFile = join(opts.out, "manifest.json");
  const manifest = existsSync(manifestFile) && opts.only ? JSON.parse(readFileSync(manifestFile, "utf8")) : { maps: {} };
  Object.assign(manifest, { build: opts.build, product: PRODUCT, source: "lokaler Client (CASC), Tabellen wago.tools", license: "../LICENSE-NOTE.md" });
  manifest.maps ||= {};
  if (!opts.only) for (const loc of opts.locales) rmSync(join(opts.out, loc), { recursive: true, force: true });

  // Budget immer auf den vollen Satz gerechnet, damit Teil-Läufe (--only) gleich groß ausfallen
  const limit = perImageLimit(Object.values(index.maps).filter((m) => m.art).length * opts.locales.length);
  const failures = [];
  for (const locale of opts.locales) {
    const st = openStorage(tools.casc, root, locale, opts.build);
    try {
      const read = makeReader(st, tools.blp);
      for (const w of wanted) {
        try {
          const plan = planMap(w.artID, tables);
          for (const wmsg of plan.warnings) process.stderr.write("WARNUNG " + locale + " " + w.id + " " + w.name + ": " + wmsg + "\n");
          const img = composeMap(plan, read);
          const { buf, quality } = await encodeWebp(tools.sharp, img, limit);
          const rel = locale + "/" + w.id + ".webp";
          mkdirSync(join(opts.out, locale), { recursive: true });
          writeFileSync(join(opts.out, rel), buf);
          const entry = (manifest.maps[w.id] ||= { name: w.name, art: w.artID, files: {} });
          Object.assign(entry, { name: w.name, art: w.artID, width: img.width, height: img.height, overlays: plan.overlays.length });
          if (plan.warnings.length) entry.warnings = plan.warnings;
          else delete entry.warnings;
          entry.files[locale] = { file: rel, bytes: buf.length, quality };
          process.stdout.write(locale + " " + w.id + " " + w.name + ": " + img.width + "x" + img.height + ", " + plan.overlays.length + " Overlays, " + Math.round(buf.length / 1024) + " KB (q" + quality + ")\n");
        } catch (e) {
          failures.push(locale + " " + w.id + " " + w.name + ": " + (e && e.message ? e.message : e));
          process.stderr.write("FEHLER " + failures[failures.length - 1] + "\n");
        }
      }
    } finally {
      st.close();
    }
  }
  manifest.maps = Object.fromEntries(Object.entries(manifest.maps).sort((a, b) => Number(a[0]) - Number(b[0])));
  const total = dirBytes(opts.out);
  manifest.totalBytes = total;
  mkdirSync(opts.out, { recursive: true });
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 1) + "\n");
  process.stdout.write("Karten: " + Object.keys(manifest.maps).length + ", Bilder gesamt " + (total / 1024 / 1024).toFixed(2) + " MB\n");
  if (opts.contact) {
    await writeContactSheet(tools.sharp, manifest, opts.out, opts.contact);
    process.stdout.write("Kontaktbogen: " + opts.contact + "\n");
  }
  if (total > MAX_BYTES_TOTAL) failures.push("Gesamtgröße " + total + " Bytes über " + MAX_BYTES_TOTAL);
  if (failures.length) {
    process.stderr.write(failures.length + " Fehlschläge:\n  " + failures.join("\n  ") + "\n");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    process.stderr.write(String(e && e.message ? e.message : e) + "\n");
    process.exit(2);
  });
}
