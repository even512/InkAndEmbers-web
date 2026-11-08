// Druckansicht (W7): Druckbuch aus Tagebuch + Chronik, Kapitel auf eigener Seite, Karten-Standbilder, „Andere Spieler
// ausblenden“ auch im Druck; Seite „Lizenzen & Hinweise“; Knopf „Drucken / PDF“ in der App.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readSavedVariables, buildJournal } from "../src/core/journal-model.mjs";
import { buildPrintBook, sliceScene, printData, expandForPrint, fillView } from "../src/ui/print.mjs";
import { renderLicenses, LIB_VERSIONS, LICENSE_FILES } from "../src/ui/licenses.mjs";
import { collectForeignNames } from "../src/share/anonymize.mjs";
import { startApp } from "../src/ui/app.mjs";
import { fakeEnv, findAll, makeFile, makeNode, tick } from "./helpers/fake-dom.mjs";
import { makeDb, thanenOpts, GUID } from "./helpers/chronik-sv.mjs";
import { sampleWithTrail } from "./helpers/trail-gen.mjs";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const SAMPLE = read("./fixtures/journal-export-sample.lua");
const byClass = (root, cls) => findAll(root, (n) => typeof n.className === "string" && n.className.split(" ").includes(cls));

// Canvas-Ersatz: jede Methode ist ein No-op, toBlob liefert einen Blob-Ersatz
function fakeCanvasDoc() {
  const env = fakeEnv({ language: "de-DE" });
  const base = env.doc.createElement;
  let canvases = 0;
  env.doc.createElement = (tag) => {
    const n = base(tag);
    if (tag === "canvas") {
      canvases++;
      const store = {};
      const ctx = new Proxy(store, {
        get: (o, k) => (k in o ? o[k] : () => ({ addColorStop() {}, width: 10 })),
        set: (o, k, v) => ((o[k] = v), true),
      });
      n.getContext = () => ctx;
      n.toBlob = (cb) => cb({ size: 1234, type: "image/jpeg" });
    }
    return n;
  };
  let urls = 0;
  env.win.URL = { createObjectURL: () => "blob:print-" + ++urls, revokeObjectURL: () => {} };
  return { ...env, canvasCount: () => canvases };
}

function sampleDb(text = SAMPLE) {
  const { db } = readSavedVariables(text);
  const guid = Object.keys(db.chars)[0];
  return { db, guid, journal: buildJournal(db, guid), char: db.chars[guid] };
}

describe("Druckbuch", () => {
  it("Titelseite zuerst, jedes Kapitel und jeder Abschnitt als eigene Druckseite, ohne Bedienelemente", async () => {
    const { doc, win } = fakeEnv({ language: "de-DE" });
    const s = sampleDb();
    const { element, urls } = await buildPrintBook(doc, win, { ...s, lang: "de", anonymize: false });
    expect(urls).toEqual([]); // ohne Canvas keine Standbilder, aber auch kein Fehler
    const pages = element.childNodes.filter((n) => (n.className || "").split(" ").includes("print-page"));
    expect(pages.length).toBeGreaterThan(3);
    expect(element.childNodes[0].className).toContain("print-title");
    expect(element.textContent).toContain(s.journal.name);
    expect(byClass(element, "chapter").length).toBe(s.journal.chapters.length);
    for (const ch of byClass(element, "chapter")) expect(ch.className).toContain("print-page");
    expect(byClass(element, "chron-nav")).toHaveLength(0);
    expect(byClass(element, "chron-more")).toHaveLength(0);
    expect(byClass(element, "print-colophon")[0].textContent).toContain("Blizzard");
    expect(byClass(element, "print-colophon")[0].textContent).toContain("nichts wurde hochgeladen");
  });

  it("legt je Kapitel ein Standbild der Kapitelroute und auf die Titelseite die ganze Reise (blob:-Bilder)", async () => {
    const env = fakeCanvasDoc();
    const s = sampleDb(sampleWithTrail());
    const { element, urls } = await buildPrintBook(env.doc, env.win, { ...s, lang: "de", anonymize: false });
    expect(urls.length).toBeGreaterThan(0);
    const figs = byClass(element, "print-map");
    expect(figs.length).toBe(urls.length);
    for (const f of figs) {
      const img = findAll(f, (n) => n.tagName === "IMG")[0];
      expect(img.attributes.src).toMatch(/^blob:print-\d+$/);
      expect(img.attributes.alt.length).toBeGreaterThan(3);
    }
    expect(byClass(element.childNodes[0], "print-map")).toHaveLength(1); // Titelseite
    const chapterFig = byClass(element, "chapter").find((c) => byClass(c, "print-map").length);
    if (chapterFig) expect(chapterFig.childNodes[1].className).toBe("print-map"); // direkt nach dem Kapitelkopf
  });

  it("„Andere Spieler ausblenden“ entfernt fremde Namen auch aus dem Druck (Modell + Netz)", async () => {
    const opts = thanenOpts();
    opts.blocks = opts.blocks.map((b) => b.replace("\n1080~LT~2978~1~2~mob~~18", "\n1080~LT~2978~1~2~mob~~18\n1081~LG~2978~1~3~Zedrik-Testreich~MAGE~need"));
    const db = makeDb(opts);
    const char = db.chars[GUID];
    const journal = buildJournal(db, GUID);
    const names = collectForeignNames(char).map((n) => n.split("-")[0]);
    expect(names.length).toBeGreaterThan(0);
    const { doc, win } = fakeEnv({ language: "de-DE" });
    const plain = await buildPrintBook(doc, win, { db, guid: GUID, journal, char, lang: "de", anonymize: false });
    expect(names.some((n) => plain.element.textContent.includes(n))).toBe(true);
    const anon = await buildPrintBook(doc, win, { db, guid: GUID, journal, char, lang: "de", anonymize: true });
    const text = anon.element.textContent;
    for (const n of names) expect(text, n).not.toContain(n);
    expect(text).toContain("Gefährte 1");
    expect(byClass(anon.element, "print-anon-note")).toHaveLength(1);
    expect(anon.anonymized).toBe(true);
    // Original-Datei unverändert
    expect(collectForeignNames(char).length).toBe(names.length);
  });

  it("printData mit Schalter rechnet auf einer Kopie, die Datei bleibt unberührt", () => {
    const s = sampleDb();
    const before = JSON.stringify(s.char.log);
    const p = printData({ ...s, lang: "de", anonymize: true });
    expect(p.db).not.toBe(s.db);
    expect(Object.keys(p.db.chars)).toEqual([s.guid]);
    expect(JSON.stringify(s.char.log)).toBe(before);
  });

  it("expandForPrint klappt „Mehr anzeigen“ auf, bis nichts mehr nachkommt", () => {
    const root = makeNode("div");
    let left = 3;
    const addMore = () => {
      const b = makeNode("button");
      b.className = "btn chron-more";
      b.addEventListener("click", () => {
        root.removeChild(b);
        if (--left > 0) addMore();
      });
      root.appendChild(b);
    };
    addMore();
    expandForPrint(root);
    expect(left).toBe(0);
    expect(byClass(root, "chron-more")).toHaveLength(0);
  });

  it("fillView hält den vergrößerten Ausschnitt innerhalb der Karte", () => {
    const v = fillView({ cx: 0.5, cy: 0.02, zoom: 2 }, 1.5, 900, 600);
    expect(v.cy).toBeCloseTo(0.25, 5);
    expect(fillView({ cx: 0.99, cy: 0.5, zoom: 4 }, 1.5, 900, 600).cx).toBeCloseTo(0.875, 5);
    expect(fillView({ cx: 0.1, cy: 0.9, zoom: 1 }, 1.5, 900, 600)).toMatchObject({ cx: 0.5, cy: 0.5 });
  });

  it("sliceScene schneidet Linien, Flüge und Marker auf das Kapitel und berechnet die Grenzen neu", () => {
    const scene = {
      mapID: 1,
      lines: [{ x: [0.1, 0.2, 0.3, 0.4], y: [0.1, 0.2, 0.3, 0.4], t: [10, 20, 30, 40] }, { x: [0.9], y: [0.9], t: [100] }],
      flights: [{ x0: 0, y0: 0, x1: 1, y1: 1, t0: 25, t1: 35 }, { x0: 0, y0: 0, x1: 1, y1: 1, t0: 90, t1: 95 }],
      markers: [{ t: 15 }, { t: 99 }],
      labels: [],
      bounds: { x0: 0.1, x1: 0.9, y0: 0.1, y1: 0.9 },
    };
    const s = sliceScene(scene, 20, 30);
    expect(s.lines).toEqual([{ x: [0.2, 0.3], y: [0.2, 0.3], t: [20, 30] }]);
    expect(s.flights).toHaveLength(1);
    expect(s.markers).toHaveLength(0);
    expect(s.bounds).toEqual({ x0: 0.2, x1: 0.3, y0: 0.2, y1: 0.3 });
    expect(sliceScene(scene, 200, 300).bounds).toBeNull();
    expect(sliceScene(null, 0, 1)).toBeNull();
  });
});

describe("Lizenzen & Hinweise", () => {
  it("nennt Datenschutz, Blizzard, Grafiken, Bibliotheken mit Lizenz und Lizenztext (de/en)", () => {
    const { doc } = fakeEnv();
    const de = renderLicenses(doc, "de").textContent;
    for (const s of ["Nichts wird hochgeladen", "Blizzard Entertainment", "alle Rechte vorbehalten", "Mozilla Public License 2.0", "gifenc", "SIL Open Font License 1.1", "MIT", LICENSE_FILES.mediabunny, LICENSE_FILES.gifenc, LICENSE_FILES.spectral]) expect(de, s).toContain(s);
    const en = renderLicenses(doc, "en").textContent;
    for (const s of ["Nothing is uploaded", "not affiliated", "all rights reserved", "Mozilla Public License 2.0"]) expect(en, s).toContain(s);
  });

  it("Versionen stimmen mit package.json überein und die Lizenztexte liegen in public/", () => {
    const pkg = JSON.parse(read("../package.json"));
    expect(pkg.dependencies.mediabunny).toBe(LIB_VERSIONS.mediabunny);
    expect(pkg.dependencies.gifenc).toBe(LIB_VERSIONS.gifenc);
    for (const f of Object.values(LICENSE_FILES)) expect(read("../public/" + f).length).toBeGreaterThan(500);
  });
});

describe("App: Drucken / PDF und Lizenzseite", () => {
  it("Knopf baut das Druckbuch neben #app, öffnet den Druckdialog; afterprint räumt auf", async () => {
    const env = fakeEnv({ language: "de-DE" });
    let printed = 0;
    env.win.print = () => printed++;
    const app = startApp(env.doc, env.win);
    await app.loadFile(makeFile("InkAndEmbers.lua", SAMPLE));
    const btn = byClass(env.appRoot, "print-btn")[0];
    expect(btn.textContent).toBe("Drucken / PDF");
    const box = byClass(env.appRoot, "print-anon")[0];
    expect(box.checked).toBe(false); // Standard aus
    btn.click();
    for (let i = 0; i < 20 && !printed; i++) await tick();
    expect(printed).toBe(1);
    const root = byClass(env.doc.body, "print-root")[0];
    expect(root).toBeTruthy();
    expect(env.doc.body.classList.contains("has-print-book")).toBe(true);
    expect(byClass(env.appRoot, "print-status")[0].textContent).toContain("Als PDF speichern");
    env.win.dispatch("afterprint");
    expect(byClass(env.doc.body, "print-root")).toHaveLength(0);
    expect(env.doc.body.classList.contains("has-print-book")).toBe(false);
  });

  it("Fußzeile öffnet „Lizenzen & Hinweise“, Zurück führt zur Ansicht", async () => {
    const env = fakeEnv({ language: "de-DE" });
    const app = startApp(env.doc, env.win);
    byClass(env.appRoot, "licenses-link")[0].click();
    expect(app.state.page).toBe("licenses");
    expect(byClass(env.appRoot, "licenses")[0].textContent).toContain("Nichts wird hochgeladen");
    expect(byClass(env.appRoot, "dropzone")).toHaveLength(0);
    byClass(env.appRoot, "lic-back")[0].click();
    expect(byClass(env.appRoot, "dropzone")).toHaveLength(1);
  });
});
