// Kartenlage: index.json aus dem wago.tools-Schnappschuss, Umrechnung Zone <-> Kontinent, Rückfälle
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  parseCsv, buildIndex, readTables, dataDir, serialize, worldExtent, rectOnExtent, DEFAULT_BUILD, TABLES,
} from "../scripts/build-map-index.mjs";
import {
  mapInfo, mapName, hasArt, continentOf, zoneOf, mapSize, rectOn, affine, project, toContinent, fromContinent,
  displayMap, plausibleRect, trailToUnit, indexBuild,
} from "../src/geo/map-geo.mjs";
import INDEX from "../src/geo/index.json";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const lf = (s) => s.split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));

describe("build-map-index", () => {
  it("index.json entspricht dem eingecheckten Schnappschuss (sonst: npm run build-map-index)", () => {
    const fresh = serialize(buildIndex(readTables(dataDir(DEFAULT_BUILD)), DEFAULT_BUILD));
    expect(lf(readFileSync(join(ROOT, "src", "geo", "index.json"), "utf8"))).toBe(fresh);
    expect(indexBuild()).toBe(DEFAULT_BUILD);
  });

  it("Forever-Build: 60 Karten mit Kunst, beide Kontinente, alle Kunstkarten mit Kachelraster", () => {
    const maps = Object.entries(INDEX.maps);
    const art = maps.filter(([, m]) => m.art);
    expect(art).toHaveLength(60);
    for (const [, m] of art) expect(m.art.rows * m.art.cols).toBeGreaterThan(0);
    expect(INDEX.maps["1414"]).toMatchObject({ name: "Kalimdor", type: 2, rect: [0, 1, 0, 1] });
    expect(INDEX.maps["1415"]).toMatchObject({ name: "Eastern Kingdoms", type: 2, rect: [0, 1, 0, 1] });
    // jede Zone auf einem der beiden Kontinente hat ein plausibles Rechteck
    for (const [id, m] of maps) {
      if (m.type === 3 && (m.continent === 1414 || m.continent === 1415)) expect(plausibleRect(m.rect), id).toBe(true);
    }
  });

  it("liest CSV mit Anführungszeichen, verdoppelten Zeichen, Kommas und CRLF", () => {
    const { head, rows } = parseCsv('A,B,C\r\n1,"Un\'Goro, Krater","sagt ""hi"""\r\n2,,x\n');
    expect(head).toEqual(["A", "B", "C"]);
    expect(rows[0]).toEqual(Object.assign(Object.create(null), { A: "1", B: "Un'Goro, Krater", C: 'sagt "hi"' }));
    expect(rows[1].B).toBe("");
    expect(() => parseCsv('A,B\n1,"offen')).toThrow(/geschlossen/);
    expect(() => parseCsv("A,B\n1,2,3")).toThrow(/Felder/);
    expect(() => parseCsv("")).toThrow(/leer/);
  });

  it("bricht bei fehlender Tabelle, fehlender Spalte, falschen Zahlen oder ungültigem Build ab", () => {
    const csv = readTables(dataDir(DEFAULT_BUILD));
    expect(() => buildIndex(csv, "1.60; rm -rf")).toThrow(/Build/);
    const { UiMap, ...rest } = csv;
    expect(UiMap).toBeTruthy();
    expect(() => buildIndex(rest, DEFAULT_BUILD)).toThrow(/UiMap/);
    expect(() => buildIndex({ ...csv, UiMap: "ID,Name_lang,Type\n1,x,3" }, DEFAULT_BUILD)).toThrow(/ParentUiMapID/);
    expect(() => buildIndex({ ...csv, UiMap: "ID,Name_lang,ParentUiMapID,Type\nabc,x,0,3" }, DEFAULT_BUILD)).toThrow(/Zahl/);
    expect(TABLES).toHaveLength(5);
  });

  it("rechnet Weltausdehnung und Rechteck wie GetMapRectOnMap (synthetisch)", () => {
    // Elternkarte: Welt-X 0..1000 (oben 1000), Welt-Y 0..2000 (links 2000); Kind: rechte untere Hälfte
    const parent = worldExtent({ mapID: 0, uiMin0: 0, uiMin1: 0, uiMax0: 1, uiMax1: 1, minX: 0, minY: 0, maxX: 1000, maxY: 2000 });
    expect(parent).toEqual({ m: 0, y0: 2000, y1: 0, x0: 1000, x1: 0 });
    const child = worldExtent({ mapID: 0, uiMin0: 0, uiMin1: 0, uiMax0: 1, uiMax1: 1, minX: 0, minY: 0, maxX: 500, maxY: 1000 });
    expect(rectOnExtent(child, parent)).toEqual([0.5, 1, 0.5, 1]);
    // Teil-Zuordnung (wie Azeroth 947): UiMin/UiMax deckt nur einen Teil der Karte ab -> auf 0..1 hochgerechnet
    const part = worldExtent({ mapID: 1, uiMin0: 0.5, uiMin1: 0, uiMax0: 1, uiMax1: 0.5, minX: 0, minY: 0, maxX: 100, maxY: 100 });
    expect(part).toEqual({ m: 1, y0: 200, y1: 0, x0: 100, x1: -100 });
    expect(rectOnExtent(child, { ...parent, m: 1 })).toBeNull();
    expect(worldExtent({ mapID: 0, uiMin0: 1, uiMin1: 0, uiMax0: 0, uiMax1: 1, minX: 0, minY: 0, maxX: 1, maxY: 1 })).toBeNull();
  });
});

describe("map-geo", () => {
  it("liefert Name, Kunst, Kontinent, Zone und Größe; unbekannte oder ungültige IDs -> null", () => {
    expect(mapName(1429)).toBe("Elwynn Forest");
    expect(hasArt(1429)).toBe(true);
    expect(continentOf(1429)).toBe(1415);
    expect(continentOf(1412)).toBe(1414);
    expect(zoneOf(1459)).toBe(1424);
    expect(mapSize(1429)[0]).toBeGreaterThan(3000);
    for (const bad of [0, -1, 1.5, "1429", null, undefined, NaN, 99999999, 123456]) {
      expect(mapInfo(bad)).toBeNull();
      expect(continentOf(bad)).toBeNull();
    }
    expect(mapInfo(Number("__proto__"))).toBeNull();
    expect(mapInfo(1429, { maps: Object.create(null) })).toBeNull();
    expect(mapInfo(1429, null)).toBeNull();
  });

  it("Elwynn liegt auf den Östlichen Königreichen südlich von Dun Morogh, Durotar östlich von Mulgore", () => {
    const elw = rectOn(1429, 1415), dm = rectOn(1426, 1415);
    expect(plausibleRect(elw)).toBe(true);
    expect(elw[2]).toBeGreaterThan(dm[2]);
    const dur = rectOn(1411, 1414), mul = rectOn(1412, 1414);
    expect(dur[0]).toBeGreaterThan(mul[0]);
    // Sturmwind liegt in Elwynn
    const sw = rectOn(1453, 1415);
    expect(sw[0]).toBeGreaterThanOrEqual(elw[0] - 0.01);
    expect(sw[3]).toBeLessThanOrEqual(elw[3] + 0.01);
  });

  it("Zone -> Kontinent -> Zone ist invers; Nachbarzone über die gemeinsame Welt-Karte", () => {
    const c = toContinent(1429, 0.42, 0.65);
    expect(c.continent).toBe(1415);
    const back = fromContinent(1415, c.x, c.y, 1429);
    expect(back.x).toBeCloseTo(0.42, 9);
    expect(back.y).toBeCloseTo(0.65, 9);
    // Punkt aus Elwynn auf der Nachbarkarte Westfall: liegt östlich ihrer Mitte und landet auf dem Kontinent an derselben Stelle
    const onWestfall = project(1429, 0.1, 0.8, 1436);
    expect(onWestfall.x).toBeGreaterThan(0.5);
    const viaWestfall = toContinent(1436, onWestfall.x, onWestfall.y);
    const direct = toContinent(1429, 0.1, 0.8);
    expect(viaWestfall.x).toBeCloseTo(direct.x, 9);
    expect(viaWestfall.y).toBeCloseTo(direct.y, 9);
    // weit entfernte Zone (Rechteck außerhalb der Grenzen) geht über den Kontinent
    expect(rectOn(1429, 1423)).toBeNull();
    expect(project(1429, 0.5, 0.5, 1423)).not.toBeNull();
    const a = affine(1429, 1415);
    expect(a.sx).toBeGreaterThan(0);
    expect(project(1429, 0, 0, 1429)).toEqual({ x: 0, y: 0 });
  });

  it("keine Lage zwischen verschiedenen Welten (Kontinente untereinander, Insel-Welt, Schlachtfeld)", () => {
    expect(rectOn(1429, 1414)).toBeNull();
    expect(toContinent(2521, 0.5, 0.5)).toBeNull(); // Zephras: eigene Welt
    expect(toContinent(1459, 0.5, 0.5)).toBeNull(); // Alterac-Tal: Instanz-Welt
    expect(project(1429, NaN, 0.5, 1415)).toBeNull();
    expect(fromContinent(1415, 0.5, Infinity, 1429)).toBeNull();
  });

  it("wählt die Anzeigekarte und fällt ohne Kunst auf Pergament zurück", () => {
    expect(displayMap(1429)).toEqual({ mapID: 1429, art: true });
    expect(displayMap(84)).toEqual({ mapID: 84, art: false }); // Retail-Karte: unbekannt
    expect(displayMap("x")).toBeNull();
    expect(trailToUnit(5000)).toBe(0.5);
    expect(trailToUnit("5000")).toBeNull();
  });
});
