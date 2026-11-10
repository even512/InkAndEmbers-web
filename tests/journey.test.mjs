// Reise-Ansicht: Projektion auf die Zielkarte, Ansicht (Zoom/Pan), Wiedergabe-Zeitachse, Rückfall ohne Kartenbild,
// Tooltips nur als Text (XSS), Bedienung in der Seite.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openFile, buildJournal } from "../src/core/journal-model.mjs";
import { project } from "../src/geo/map-geo.mjs";
import { toAxis } from "../src/trail/parse-trail.mjs";
import { prepareMapScene, buildLabels, chooseMap, levelAt, playedAt } from "../src/map/scene.mjs";
import { drawFrame, transformFor, zoomAt, panBy, fitView, clampView, hitMarker, headAt, ZOOM_MAX } from "../src/map/renderer.mjs";
import * as PB from "../src/map/playback.mjs";
import { prepareJourney, createJourneyView, markerTip, markerLines, mapImageUrl, mapImageCandidates } from "../src/ui/journey.mjs";
import { startApp } from "../src/ui/app.mjs";
import { fakeEnv, findAll, makeFile } from "./helpers/fake-dom.mjs";

const fixture = (n) => readFileSync(fileURLToPath(new URL("./fixtures/" + n, import.meta.url)), "utf8");
const TRAIL = fixture("trail-sample.lua");
const GUID = "Player-0000-00000001";

// Zeichen-Kontext, der alle Aufrufe mitschreibt
function recordingCtx() {
  const calls = [];
  const target = { calls };
  return new Proxy(target, {
    get(o, k) {
      if (k in o) return o[k];
      return (...args) => calls.push([k, ...args]);
    },
    set(o, k, v) {
      o[k] = v;
      return true;
    },
  });
}
const called = (ctx, name) => ctx.calls.filter((c) => c[0] === name);

function load(text, guid = GUID) {
  const { db } = openFile(text);
  const journal = buildJournal(db, guid);
  return { db, journal, char: db.chars[guid] };
}

// Fixture mit Markern und Schadtext in Unterzonen-/Gegnernamen (synthetisch)
const EVIL = "<img src=x onerror=alert(1)>‮Evil​Ort";
const XSS_TRAIL = `EveNChronicleDB = {
["schema"] = 1, ["locale"] = "deDE",
["chars"] = { ["${GUID}"] = {
["info"] = { ["name"] = "Wegfinder", ["lastSeen"] = 1793002100 },
["npcs"] = { [99] = "<script>alert(2)</script>\\u{202E}Hogger" },
["log"] = { "#~1793000000~1\\n0~L~1~11500~70170~11500~deDE~0\\n0~PL~3600~60~5\\n8~LV~6~1429~4210~6490~<img src=x onerror=alert(1)>\\u{202E}Evil\\u{200B}Ort~1\\n10~DE~6~1429~4220~6480~0~1~Wald~~~1\\n11~DC~99~Hogger~~melee\\n12~EX~<b>Turm</b>~20~1429~6" },
["trail"] = { "#~1793000000~1429\\n0~4200~6500\\n5~4210~6490\\n10~4220~6480\\n15~4230~6470\\n200~4400~6400" },
} } }`;

describe("Projektion auf die Zielkarte", () => {
  const { journal, char } = load(TRAIL);
  const data = prepareJourney(journal, char);

  it("legt Westfall-Punkte auf der eigenen Karte unverändert ab (0..1) und auf dem Kontinent in das Westfall-Rechteck", () => {
    const own = prepareMapScene(data.trail, 1436, {});
    const first = own.lines.find((l) => l.t[0] === 1793000300);
    expect(first.x[0]).toBeCloseTo(0.56, 6);
    expect(first.y[0]).toBeCloseTo(0.3, 6);
    const cont = prepareMapScene(data.trail, 1415, {});
    const c = cont.lines.find((l) => l.t[0] === 1793000300);
    const p = project(1436, 0.56, 0.3, 1415);
    expect(c.x[0]).toBeCloseTo(p.x, 9);
    expect(c.y[0]).toBeCloseTo(p.y, 9);
    expect(cont.bounds.x1).toBeGreaterThan(cont.bounds.x0);
    // alle Strecken (Elwynn + Westfall) liegen auf dem Kontinent
    expect(cont.lines.length).toBe(data.trail.segments.length);
  });

  it("zeichnet den Flug als eigene gestrichelte Strecke von Elwynn nach Westfall", () => {
    const cont = prepareMapScene(data.trail, 1415, {});
    expect(cont.flights).toHaveLength(1);
    const f = cont.flights[0];
    const a = project(1429, 0.423, 0.647, 1415), b = project(1436, 0.56, 0.3, 1415);
    expect(f.x0).toBeCloseTo(a.x, 9);
    expect(f.x1).toBeCloseTo(b.x, 9);
    expect(f.t1).toBeGreaterThan(f.t0);
  });

  it("wählt Zone oder Kontinent; unbekannte Karten (Retail, Instanz) bleiben im Rückfall auf sich selbst", () => {
    expect(chooseMap("zone", 1436)).toEqual({ mapID: 1436, art: true });
    expect(chooseMap("continent", 1436)).toEqual({ mapID: 1415, art: true });
    expect(chooseMap("continent", 1415)).toEqual({ mapID: 1415, art: true });
    expect(chooseMap("zone", 999999)).toEqual({ mapID: 999999, art: false });
    expect(chooseMap("continent", 999999)).toEqual({ mapID: 999999, art: false });
    const lone = prepareMapScene(data.trail, 999999, {});
    expect(lone.lines).toHaveLength(0);
  });

  it("Ansicht: Zoom hält den Punkt unter der Maus fest, Pan verschiebt, Grenzen werden eingehalten", () => {
    const st = { width: 900, height: 600, aspect: 1.5, view: { cx: 0.5, cy: 0.5, zoom: 1 } };
    const T = transformFor(st);
    expect(T.sx).toBeCloseTo(900, 6);
    expect(T.sy).toBeCloseTo(600, 6);
    const ux = (300 - T.ox) / T.sx, uy = (200 - T.oy) / T.sy;
    const v = zoomAt(st, 2, 300, 200);
    const T2 = transformFor({ ...st, view: v });
    expect((300 - T2.ox) / T2.sx).toBeCloseTo(ux, 9);
    expect((200 - T2.oy) / T2.sy).toBeCloseTo(uy, 9);
    const moved = panBy({ ...st, view: v }, 90, 0);
    expect(moved.cx).toBeCloseTo(v.cx - 90 / T2.sx, 9);
    expect(clampView({ cx: 7, cy: -1, zoom: 999 })).toEqual({ cx: 1, cy: 0, zoom: ZOOM_MAX });
    expect(fitView(null, 1.5, 900, 600)).toEqual({ cx: 0.5, cy: 0.5, zoom: 1 });
    const fit = fitView({ x0: 0.4, x1: 0.5, y0: 0.6, y1: 0.7 }, 1.5, 900, 600, 0, ZOOM_MAX);
    expect(fitView({ x0: 0.4, x1: 0.41, y0: 0.6, y1: 0.61 }, 1.5, 900, 600).zoom).toBe(4);
    expect(fit.zoom).toBeCloseTo(10, 6);
    expect(fit.cx).toBeCloseTo(0.45, 9);
  });
});

describe("Wiedergabe-Zeitachse", () => {
  const { journal, char } = load(TRAIL);
  const data = prepareJourney(journal, char);
  const tl = data.trail.timeline;

  it("überspringt Leerlauf wie im Spiel: die Achse ist viel kürzer als die echte Spanne", () => {
    expect(tl.t1 - tl.t0).toBe(2016);
    expect(tl.length).toBeLessThan(200);
    expect(tl.length).toBeGreaterThan(0);
  });

  it("läuft mit 20/60/180 Spielsekunden je Sekunde, hält am Ende an und beginnt dann von vorn", () => {
    expect(PB.SPEEDS).toEqual([20, 60, 180]);
    const st = PB.createPlayback(999);
    expect(st.speed).toBe(60);
    PB.setRange(st, 0, 600);
    expect(PB.drawAxis(st)).toBe(Infinity); // angehalten am Ende: alles zeigen
    expect(PB.toggle(st)).toBe(true);
    expect(st.p).toBe(0);
    for (const [speed, dt, want] of [[20, 1, 20], [60, 1, 80], [180, 2, 440]]) {
      PB.setSpeed(st, speed);
      PB.step(st, dt);
      expect(st.p).toBe(want);
    }
    PB.step(st, 10);
    expect(st.p).toBe(600);
    expect(st.playing).toBe(false);
    PB.seek(st, 0.25);
    expect(st.p).toBe(150);
    expect(PB.frac(st)).toBe(0.25);
    expect(PB.drawAxis(st)).toBe(150);
    expect(PB.realDuration(PB.setRange(PB.createPlayback(20), 0, 600))).toBe(30);
  });

  it("zeichnet bis zur Stelle: Kopf mitten im Flug, später auf der Westfall-Route", () => {
    const scene = prepareMapScene(data.trail, 1415, {});
    const midFlight = (1793000015 + 1793000300) / 2;
    const h = headAt(scene, midFlight);
    const f = scene.flights[0];
    expect(h.x).toBeCloseTo((f.x0 + f.x1) / 2, 6);
    expect(headAt(scene, Infinity)).toBeNull();
    // Achse -> Epoche: Zeichnen bis zur Achsensekunde der Landung
    const ctx = recordingCtx();
    drawFrame(ctx, { width: 300, height: 200, scene, view: { cx: 0.5, cy: 0.5, zoom: 1 }, timeline: tl }, toAxis(tl, 1793000304));
    expect(called(ctx, "arc").length).toBeGreaterThan(0); // Kopf gezeichnet
  });

  it("Stufe und Spielzeit laufen mit", () => {
    const x = load(XSS_TRAIL);
    const d = prepareJourney(x.journal, x.char);
    expect(levelAt(d.levels, 1793000001)).toBe(5);
    expect(levelAt(d.levels, 1793000009)).toBe(6);
    expect(playedAt(d.played, 1793000000)).toBe(3600);
    expect(playedAt(d.played, 1793000015)).toBe(3615);
    // Lücke über ACTIVE_GAP zählt nicht? 15 -> 200 sind 185 s, unter 10 min: zählt
    expect(playedAt(d.played, 1793000200)).toBe(3800);
  });
});

describe("Rückfall ohne Kartenbild", () => {
  const { journal, char } = load(TRAIL);
  const data = prepareJourney(journal, char);
  const scene = prepareMapScene(data.trail, 1436, { labels: buildLabels(1436, { events: data.events, trail: data.trail }) });
  const base = { width: 900, height: 600, scene, view: { cx: 0.5, cy: 0.5, zoom: 1 }, title: "Westfall" };

  it("zeichnet ohne Bild Pergament, Gitter, Ortsnamen und den Kartennamen, dazu die Route", () => {
    const ctx = recordingCtx();
    drawFrame(ctx, { ...base, image: null });
    expect(called(ctx, "drawImage")).toHaveLength(0);
    expect(called(ctx, "strokeRect")).toHaveLength(1);
    const texts = called(ctx, "fillText").map((c) => c[1]);
    expect(texts).toContain("Westfall");
    expect(scene.labels.length).toBeGreaterThan(0);
    expect(texts).toContain(scene.labels[0].text); // Nachbarzone aus dem Index
    expect(called(ctx, "stroke").length).toBeGreaterThan(10);
  });

  it("zeichnet mit Bild das Bild statt Gitter und Namen", () => {
    const ctx = recordingCtx();
    const img = { naturalWidth: 1002, naturalHeight: 668 };
    drawFrame(ctx, { ...base, image: img, aspect: 1002 / 668 });
    expect(called(ctx, "drawImage")).toHaveLength(1);
    expect(called(ctx, "drawImage")[0][1]).toBe(img);
    expect(called(ctx, "strokeRect")).toHaveLength(0);
    expect(called(ctx, "fillText").map((c) => c[1])).not.toContain("Westfall");
  });

  it("baut Bildpfade nur aus geprüften Zahlen und der festen Sprachliste", () => {
    expect(mapImageUrl(1436, "de")).toBe("maps/forever/de/1436.webp");
    expect(mapImageUrl(1436)).toBe("maps/forever/en/1436.webp");
    for (const bad of ["../x", "1436/../../a", 1.5, -3, 0, NaN, null, 1e7]) expect(mapImageUrl(bad, "de")).toBeNull();
    expect(mapImageUrl(1436, "../../x")).toBeNull();
    // Sprache der Seite zuerst, dann Englisch
    expect(mapImageCandidates(1436, "de")).toEqual(["maps/forever/de/1436.webp", "maps/forever/en/1436.webp"]);
    expect(mapImageCandidates(1436, "en")).toEqual(["maps/forever/en/1436.webp"]);
    expect(mapImageCandidates(1436, "fr")).toEqual(["maps/forever/en/1436.webp"]);
  });
});

describe("Kartenbild laden (Sprache, Rückfall en, Pergament)", () => {
  // Bild-Ersatz: lädt nur die URLs aus "have", sonst Fehler
  function envWithImages(have) {
    const env = fakeEnv({ language: "de-DE" });
    const ctx = recordingCtx();
    const create = env.doc.createElement;
    env.doc.createElement = (tag) => {
      const n = create(tag);
      if (tag === "canvas") n.getContext = () => ctx;
      return n;
    };
    const requested = [];
    env.win.Image = class {
      constructor() {
        this.h = {};
        this.naturalWidth = 0;
        this.naturalHeight = 0;
      }
      addEventListener(type, fn) {
        this.h[type] = fn;
      }
      set src(u) {
        requested.push(u);
        if (have.includes(u)) {
          this.naturalWidth = 1002;
          this.naturalHeight = 668;
          this.h.load();
        } else this.h.error();
      }
    };
    return { env, ctx, requested };
  }
  const { journal, char } = load(TRAIL);
  const note = (view) => findAll(view.element, (n) => n.className === "map-note")[0];

  it("nimmt das deutsche Bild, fällt sonst auf Englisch zurück", () => {
    const { env, ctx, requested } = envWithImages(["maps/forever/en/1429.webp"]);
    const view = createJourneyView(env.doc, env.win, { journal, char, lang: "de" });
    expect(view.state.map.mapID).toBe(1429);
    expect(requested).toEqual(["maps/forever/de/1429.webp", "maps/forever/en/1429.webp"]);
    view.shown();
    expect(called(ctx, "drawImage").length).toBeGreaterThan(0);
    expect(note(view).hidden).toBe(true);
  });

  it("zeigt Pergament und Hinweis, wenn kein Bild da ist; Sprachwechsel lädt die passende Fassung", () => {
    const { env, ctx, requested } = envWithImages(["maps/forever/en/1429.webp"]);
    const view = createJourneyView(env.doc, env.win, { journal, char, lang: "en" });
    view.setLang("de");
    expect(requested).toEqual(["maps/forever/en/1429.webp", "maps/forever/de/1429.webp", "maps/forever/en/1429.webp"]);
    const none = envWithImages([]);
    const v2 = createJourneyView(none.env.doc, none.env.win, { journal, char, lang: "de" });
    expect(note(v2).hidden).toBe(false);
    expect(called(none.ctx, "drawImage")).toHaveLength(0);
    expect(called(none.ctx, "strokeRect").length).toBeGreaterThan(0);
    expect(ctx).toBeTruthy();
  });
});

describe("Tooltips und Canvas-Text (XSS)", () => {
  const x = load(XSS_TRAIL);
  const data = prepareJourney(x.journal, x.char);

  it("baut Marker für Stufe, Tod und Entdeckung mit gesäuberten Namen", () => {
    const kinds = data.markers.map((m) => m.kind);
    expect(kinds).toEqual(expect.arrayContaining(["level", "death", "discovery"]));
    const lv = data.markers.find((m) => m.kind === "level");
    expect(lv.place).toBe("<img src=x onerror=alert(1)>EvilOrt");
    const de = data.markers.find((m) => m.kind === "death");
    expect(de.name).toBe("<script>alert(2)</script>Hogger");
    const ex = data.markers.find((m) => m.kind === "discovery");
    expect(ex.mapID).toBe(1429);
  });

  it("gibt Tooltip-Inhalte nur als Textknoten in SPANs aus, Zeichen erhalten, Bidi/Zero-Width entfernt", () => {
    const env = fakeEnv();
    for (const m of data.markers) {
      const nodes = markerTip(env.doc, "de", m);
      for (const n of nodes) {
        expect(n.tagName).toBe("SPAN");
        for (const c of n.childNodes) expect(c.nodeType).toBe(3);
      }
      const text = nodes.map((n) => n.textContent).join("|");
      expect(text).not.toMatch(/[‪-‮⁦-⁩​-‏]/);
    }
    const lines = markerLines("de", data.markers.find((m) => m.kind === "death"));
    expect(lines[0]).toBe("Tod auf Stufe 6");
    expect(lines[1]).toBe("durch <script>alert(2)</script>Hogger");
    expect(markerLines("en", { kind: "rare", name: null, t: 1793000000 })[0]).toBe("Notable foe: Unknown");
  });

  it("zeichnet keine Steuerzeichen ins Canvas, auch nicht über den Kartennamen", () => {
    const labels = buildLabels(1429, { events: data.events, trail: data.trail });
    const scene = prepareMapScene(data.trail, 1429, { markers: data.markers, labels });
    const ctx = recordingCtx();
    drawFrame(ctx, { width: 900, height: 600, scene, view: { cx: 0.5, cy: 0.5, zoom: 1 }, title: EVIL });
    const texts = called(ctx, "fillText").map((c) => c[1]);
    expect(texts).toContain("<img src=x onerror=alert(1)>EvilOrt");
    for (const s of texts) expect(s).not.toMatch(/[‪-‮⁦-⁩​-‏]/);
  });

  it("zeigt in der Seite beim Darüberfahren den Tooltip als Text", () => {
    const env = fakeEnv({ language: "de-DE" });
    const ctx = recordingCtx();
    const create = env.doc.createElement;
    env.doc.createElement = (tag) => {
      const n = create(tag);
      if (tag === "canvas") {
        n.getContext = () => ctx;
        n.getBoundingClientRect = () => ({ left: 0, top: 0, width: 900, height: 600 });
      }
      if (tag === "div") n.getBoundingClientRect = () => ({ left: 0, top: 0, width: 900, height: 600 });
      return n;
    };
    const view = createJourneyView(env.doc, env.win, { journal: x.journal, char: x.char, lang: "de" });
    const canvas = findAll(view.element, (n) => n.tagName === "CANVAS")[0];
    const tip = findAll(view.element, (n) => n.className === "map-tip")[0];
    expect(tip.hidden).toBe(true);
    // Marker "Tod" in Pixel umrechnen
    canvas.dispatch("pointermove", { pointerId: 1, pointerType: "mouse", clientX: 0, clientY: 0 });
    const st = { width: 900, height: 600, aspect: 1.5, view: view.state.view };
    const T = transformFor(st);
    const scene = prepareMapScene(data.trail, view.state.map.mapID, { markers: data.markers });
    const de = scene.markers.find((m) => m.kind === "death");
    const hit = hitMarker({ ...st, scene }, Infinity, T.ox + de.px * T.sx, T.oy + de.py * T.sy);
    expect(hit).not.toBeNull();
    canvas.dispatch("pointermove", { pointerId: 1, pointerType: "mouse", clientX: T.ox + de.px * T.sx, clientY: T.oy + de.py * T.sy });
    expect(tip.hidden).toBe(false);
    // oberster Marker an der Stelle (die Entdeckung liegt direkt neben dem Tod): Text wörtlich, kein <b>-Element
    expect(tip.textContent).toBe(markerLines("de", hit).join(""));
    expect(tip.textContent).toContain("<b>Turm</b>");
    expect(findAll(tip, (n) => n.tagName !== "SPAN" && n !== tip)).toHaveLength(0);
    view.destroy();
  });
});

describe("Bedienung in der Seite", () => {
  it("zeigt Kapitelleiste, Umschalter, drei Tempi und die mitlaufende Zeile; Kapitelklick wechselt die Karte", async () => {
    const env = fakeEnv({ language: "de-DE" });
    const app = startApp(env.doc, env.win);
    await app.loadFile(makeFile("InkAndEmbers.lua", TRAIL));
    const cls = (c) => findAll(env.appRoot, (n) => n.className.split(" ").includes(c));
    expect(cls("journey-panel")).toHaveLength(1);
    expect(cls("speed-switch")[0].textContent).toBe("LangsamMittelSchnell");
    expect(cls("mode-switch")[0].textContent).toBe("ZoneKontinent");
    expect(cls("jtoc-head")[0].textContent).toBe("Inhalt");
    expect(cls("jtoc-whole")[0].textContent).toMatch(/^Ganze Reise/);
    expect(cls("jtoc-act").length).toBeGreaterThan(0);
    expect(cls("play-info")[0].textContent).toMatch(/2026/);
    // Kontinent
    cls("mode-switch")[0].childNodes[1].click();
    const panel = cls("journey-panel")[0];
    expect(cls("journey-panel")[0]).toBe(panel); // dieselbe Ansicht bleibt erhalten
    // Englisch
    findAll(env.appRoot, (n) => n.className.split(" ").includes("lang-btn"))[1].click();
    expect(cls("speed-switch")[0].textContent).toBe("SlowMediumFast");
  });

  it("Datei ohne Spur: verständlicher Hinweis statt Karte", async () => {
    const env = fakeEnv({ language: "de-DE" });
    const app = startApp(env.doc, env.win);
    await app.loadFile(makeFile("InkAndEmbers.lua", fixture("journal-export-sample.lua")));
    const panel = findAll(env.appRoot, (n) => n.className.split(" ").includes("journey-panel"))[0];
    expect(panel.textContent).toContain("keine Positionsspur");
    expect(findAll(panel, (n) => n.tagName === "CANVAS")).toHaveLength(0);
  });
});
