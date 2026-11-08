// Zusammensetzer der Kartenkunst (scripts/extract-maps.mjs) mit synthetischen Kacheln, ohne Client und ohne sharp.
import { describe, it, expect } from "vitest";
import { planMap, planFileIDs, composeMap, blit, cropSize, perImageLimit, parseArgs, escapeXml, MAP_W, MAP_H, MAX_BYTES_PER_IMAGE } from "../scripts/extract-maps.mjs";

const S = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)]));
const tileRow = (art, row, col, fileID, layer = 0) => S({ UiMapArtID: art, RowIndex: row, ColIndex: col, LayerIndex: layer, FileDataID: fileID });
const overlayRow = (id, art, w, h, x, y) => S({ ID: id, UiMapArtID: art, TextureWidth: w, TextureHeight: h, OffsetX: x, OffsetY: y, AreaID_0: 1 });
const ovTileRow = (ov, row, col, fileID) => S({ WorldMapOverlayID: ov, RowIndex: row, ColIndex: col, LayerIndex: 0, FileDataID: fileID });

function solid(width, height, [r, g, b, a]) {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) rgba.set([r, g, b, a], i);
  return { width, height, rgba };
}
const px = (img, x, y) => Array.from(img.rgba.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

// 4x3-Raster wie im Spiel, Kachel-Datei-ID = 100 + Zeile*4 + Spalte, jede Kachel eigene Farbe
function gridTables(art = 7) {
  const UiMapArtTile = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) UiMapArtTile.push(tileRow(art, r, c, 100 + r * 4 + c));
  UiMapArtTile.push(tileRow(art, 0, 0, 999, 1)); // andere Ebene wird ignoriert
  UiMapArtTile.push(tileRow(8, 0, 0, 555)); // andere Karte
  return { UiMapArtTile, WorldMapOverlay: [], WorldMapOverlayTile: [] };
}
const tileColor = (id) => [id - 100, 10, 20, 255];
const gridImages = (id) => (id >= 100 && id < 112 ? solid(256, 256, tileColor(id)) : null);

describe("planMap", () => {
  it("liest das Raster der Ebene 0 zeilenweise", () => {
    const p = planMap(7, gridTables());
    expect(p.rows).toBe(3);
    expect(p.cols).toBe(4);
    expect(p.tiles.map((t) => t.fileID)).toEqual([100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111]);
  });

  it("meldet Lücken im Raster statt zu überspringen", () => {
    const t = gridTables();
    t.UiMapArtTile = t.UiMapArtTile.filter((r) => r.FileDataID !== "105");
    expect(() => planMap(7, t)).toThrow(/Zeile 1 Spalte 1/);
  });

  it("wirft ohne Kacheln und bei kaputten Zahlen", () => {
    expect(() => planMap(42, gridTables())).toThrow(/keine Kacheln/);
    const t = gridTables();
    t.UiMapArtTile[0].FileDataID = "12; rm";
    expect(() => planMap(7, t)).toThrow(/keine ganze Zahl/);
  });

  it("übernimmt Overlays, ignoriert 0x0-Klickflächen und warnt bei Overlays ohne Teilstücke", () => {
    const t = gridTables();
    t.WorldMapOverlay.push(overlayRow(1, 7, 300, 100, 10, 20), overlayRow(2, 7, 0, 0, 0, 0), overlayRow(3, 7, 64, 64, 0, 0), overlayRow(4, 8, 64, 64, 0, 0));
    t.WorldMapOverlayTile.push(ovTileRow(1, 0, 1, 201), ovTileRow(1, 0, 0, 200));
    const p = planMap(7, t);
    expect(p.overlays).toHaveLength(1);
    expect(p.overlays[0].parts.map((x) => x.fileID)).toEqual([200, 201]);
    expect(p.warnings).toHaveLength(1);
    expect(p.warnings[0]).toMatch(/WorldMapOverlay 3/);
    expect(planFileIDs(p)).toEqual([100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 200, 201]);
  });
});

describe("composeMap", () => {
  it("setzt die Kacheln an ihre Stelle und schneidet auf 1002x668 zu", () => {
    const img = composeMap(planMap(7, gridTables()), gridImages);
    expect([img.width, img.height]).toEqual([MAP_W, MAP_H]);
    expect(px(img, 0, 0)).toEqual(tileColor(100));
    expect(px(img, 256 * 3 + 5, 0)).toEqual(tileColor(103));
    expect(px(img, 300, 600)).toEqual(tileColor(109));
    expect(px(img, MAP_W - 1, MAP_H - 1)).toEqual(tileColor(111));
  });

  it("meldet alle fehlenden Kachel-IDs gesammelt", () => {
    const get = (id) => {
      if (id === 102 || id === 110) throw new Error("ERROR_FILE_NOT_FOUND");
      return gridImages(id);
    };
    let err;
    try {
      composeMap(planMap(7, gridTables()), get);
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.missing).toHaveLength(2);
    expect(err.message).toMatch(/102 .*110 /);
  });

  it("weist Bilder mit falscher RGBA-Länge oder abweichender Kachelgröße ab", () => {
    expect(() => composeMap(planMap(7, gridTables()), (id) => ({ width: 256, height: 256, rgba: new Uint8Array(10) }))).toThrow(/RGBA-Länge/);
    expect(() => composeMap(planMap(7, gridTables()), (id) => solid(id === 104 ? 128 : 256, 256, [0, 0, 0, 255]))).toThrow(/abweichende Größe/);
  });

  it("blendet Overlays mit Alpha und beschneidet aufgefüllte Teilstücke auf die Texturgröße", () => {
    const t = gridTables();
    // 300x100 bei (10,20): Teilstück 0 voll 256 breit, Teilstück 1 nur 44 Pixel genutzt (Textur 64 breit)
    t.WorldMapOverlay.push(overlayRow(1, 7, 300, 100, 10, 20));
    t.WorldMapOverlayTile.push(ovTileRow(1, 0, 0, 200), ovTileRow(1, 0, 1, 201));
    const get = (id) => (id === 200 ? solid(256, 128, [255, 255, 255, 255]) : id === 201 ? solid(64, 128, [0, 0, 255, 128]) : gridImages(id));
    const img = composeMap(planMap(7, t), get);
    expect(px(img, 10, 20)).toEqual([255, 255, 255, 255]);
    expect(px(img, 9, 20)).toEqual(tileColor(100));
    expect(px(img, 10, 120)).toEqual(tileColor(100)); // unterhalb TextureHeight
    const blended = px(img, 10 + 256 + 5, 20); // halbe Deckkraft über Kachel 101
    expect(blended[2]).toBeGreaterThan(120);
    expect(blended[0]).toBeLessThan(10);
    expect(px(img, 10 + 300, 20)).toEqual(tileColor(101)); // rechts von TextureWidth unverändert
  });

  it("lässt andere Raster ungeschnitten", () => {
    const t = { UiMapArtTile: [tileRow(9, 0, 0, 300)], WorldMapOverlay: [], WorldMapOverlayTile: [] };
    const img = composeMap(planMap(9, t), () => solid(512, 512, [1, 2, 3, 255]));
    expect([img.width, img.height]).toEqual([512, 512]);
  });
});

describe("Hilfen", () => {
  it("blit ignoriert Pixel außerhalb der Zielfläche", () => {
    const dst = solid(4, 4, [0, 0, 0, 255]);
    blit(dst, solid(4, 4, [9, 9, 9, 255]), 2, -2);
    expect(px(dst, 3, 1)).toEqual([9, 9, 9, 255]);
    expect(px(dst, 1, 1)).toEqual([0, 0, 0, 255]);
  });

  it("cropSize nur für 1024x768", () => {
    expect(cropSize(1024, 768)).toEqual({ width: MAP_W, height: MAP_H });
    expect(cropSize(512, 512)).toEqual({ width: 512, height: 512 });
  });

  it("verteilt das Größenbudget", () => {
    expect(perImageLimit(1)).toBe(MAX_BYTES_PER_IMAGE);
    expect(perImageLimit(120) * 120).toBeLessThanOrEqual(20 * 1024 * 1024);
    expect(() => perImageLimit(0)).toThrow();
  });

  it("parseArgs prüft Eingaben", () => {
    expect(parseArgs(["--only", "1426,1453", "--locales", "de"])).toMatchObject({ only: [1426, 1453], locales: ["de"] });
    expect(() => parseArgs(["--locales", "fr"])).toThrow(/unbekannt/);
    expect(() => parseArgs(["--only", "x"])).toThrow();
    expect(() => parseArgs(["--build", "../x"])).toThrow();
    expect(() => parseArgs(["--wow-dir"])).toThrow(/Wert fehlt/);
    expect(() => parseArgs(["--evil"])).toThrow(/Unbekanntes/);
  });

  it("escapeXml für Kontaktbogen-Beschriftung", () => {
    expect(escapeXml(`<a & 'b'>`)).toBe("&lt;a &amp; &apos;b&apos;&gt;");
  });
});
