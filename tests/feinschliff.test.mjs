// Feinschliff nach dem Laufzeit-Gate: Kapitelmodus (Infozeile und Route nur im Kapitel), Medaillen-Texte, „Andere Spieler
// ausblenden“ (Zähler, Nummerierung, NPC-Namen), Video „Aktuelle Zone“ nur über die Besuche, Kartenname im Rückfall.
// Alles synthetisch (keine echten Spielerdaten).
import { describe, it, expect } from "vitest";
import { readSavedVariables, buildJournal } from "../src/core/journal-model.mjs";
import { prepareJourney, createJourneyView } from "../src/ui/journey.mjs";
import { drawFrame, hitMarker, visibleSpan, transformFor } from "../src/map/renderer.mjs";
import { planTimeline, visitRange, createFrameJob, sceneCache, VIDEO } from "../src/share/frames.mjs";
import { fromAxis } from "../src/trail/parse-trail.mjs";
import { createAnonymizer, anonymizeChar, collectForeignNames, createRenumberer, looksLikeNpc } from "../src/share/anonymize.mjs";
import { buildChronik } from "../src/chronik/model.mjs";
import { renderChronicle } from "../src/chronik/view.mjs";
import { ct, ctn } from "../src/chronik/texts.mjs";
import { buildPrintBook } from "../src/ui/print.mjs";
import { fakeEnv, findAll } from "./helpers/fake-dom.mjs";
import { makeDb, model, medal, thanenOpts, L, GUID } from "./helpers/chronik-sv.mjs";
import { sampleWithTrail } from "./helpers/trail-gen.mjs";

const byClass = (root, cls) => findAll(root, (n) => typeof n.className === "string" && n.className.split(" ").includes(cls));

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

function sample() {
  const { db } = readSavedVariables(sampleWithTrail());
  const guid = Object.keys(db.chars).sort()[0];
  const journal = buildJournal(db, guid);
  return { db, guid, journal, char: db.chars[guid] };
}

describe("Kapitelmodus der Reise", () => {
  it("Akt/Kapitel wählen springt an den Anfang (kein Abspielen); Infozeile zeigt den Start, zurück zeigt die ganze Reise", () => {
    const s = sample();
    const env = fakeEnv({ language: "de-DE" });
    const view = createJourneyView(env.doc, env.win, { journal: s.journal, char: s.char, lang: "de" });
    const info = () => byClass(view.element, "play-info")[0].textContent;
    const day = (text) => Number((/(\d{1,2})\./.exec(text) || [])[1]);
    const dateOf = (t) => new Date(t * 1000).getDate();
    const whole = info();
    expect(view.data.acts.length).toBeGreaterThan(0);
    byClass(view.element, "act-chip")[0].click(); // Akt I öffnen
    expect([view.state.act, view.state.chapter, view.state.pb.playing]).toEqual([0, -1, false]);
    expect(view.state.pb.p).toBe(view.state.pb.p0);
    expect(day(info())).toBe(dateOf(view.data.acts[0].t0));
    // im Akt: zurück + seine Kapitel
    const chips = byClass(view.element, "chapter-chip");
    expect(chips[0].className).toContain("back-chip");
    expect(chips.length).toBe(1 + view.data.acts[0].chapters.length);
    const ci = view.data.acts[0].chapters[view.data.acts[0].chapters.length - 1];
    chips[chips.length - 1].click();
    expect([view.state.act, view.state.chapter, view.state.pb.playing]).toEqual([0, ci, false]);
    expect(day(info())).toBe(dateOf(view.data.chapters[ci].t0));
    expect(info()).not.toBe(whole);
    // das gewählte Kapitel noch einmal: zurück zum Akt; dann zurück zu den Akten = ganze Reise
    byClass(view.element, "chapter-chip")[byClass(view.element, "chapter-chip").length - 1].click();
    expect([view.state.act, view.state.chapter]).toEqual([0, -1]);
    byClass(view.element, "back-chip")[0].click();
    expect([view.state.act, view.state.chapter]).toEqual([-1, -1]);
    expect(info()).toBe(whole);
    view.destroy();
  });

  it("zeichnet im Kapitelmodus nur Marker und Route des Kapitels kräftig, die übrige Route blass", () => {
    const scene = {
      lines: [{ x: [0.1, 0.2, 0.3, 0.4], y: [0.5, 0.5, 0.5, 0.5], t: [100, 200, 300, 400] }],
      flights: [{ x0: 0.1, y0: 0.1, x1: 0.2, y1: 0.2, t0: 50, t1: 60 }],
      markers: [
        { kind: "level", level: 3, t: 150, px: 0.15, py: 0.5 },
        { kind: "death", level: 4, t: 250, px: 0.25, py: 0.5 },
        { kind: "boss", t: 450, px: 0.45, py: 0.5 },
      ],
      labels: [],
    };
    const icon = {};
    const icons = new Map([["level", icon], ["death", icon], ["boss", icon]]);
    const base = { width: 1000, height: 1000, aspect: 1, scene, view: { cx: 0.5, cy: 0.5, zoom: 1 }, icons, drawHead: false };
    const T = transformFor(base);
    const run = (st, t) => {
      const ctx = recordingCtx();
      drawFrame(ctx, st, t);
      return ctx.calls;
    };
    const all = run(base, Infinity);
    expect(all.filter((c) => c[0] === "drawImage")).toHaveLength(3);
    const st = { ...base, range: { t0: 200, t1: 300 } };
    const calls = run(st, Infinity);
    expect(calls.filter((c) => c[0] === "drawImage")).toHaveLength(1);
    const strokes = [];
    let cur = [];
    for (const c of calls) {
      if (c[0] === "moveTo" || c[0] === "lineTo") cur.push(c[1]);
      if (c[0] === "stroke") {
        strokes.push(cur);
        cur = [];
      }
    }
    const route = strokes[strokes.length - 1];
    const pale = strokes[strokes.length - 3];
    const x = (v) => T.ox + v * T.sx;
    expect([...new Set(route.map(Math.round))]).toEqual([0.2, 0.3].map((v) => Math.round(x(v))));
    expect(pale.map(Math.round)).toEqual([0.1, 0.2, 0.3, 0.4].map((v) => Math.round(x(v))));
    expect(visibleSpan(st, Infinity)).toEqual({ lo: 200, hi: 300 });
    expect(hitMarker(st, Infinity, T.ox + 0.15 * T.sx, T.oy + 0.5 * T.sy)).toBeNull();
    expect(hitMarker(st, Infinity, T.ox + 0.25 * T.sx, T.oy + 0.5 * T.sy)).not.toBeNull();
    expect(hitMarker(base, Infinity, T.ox + 0.15 * T.sx, T.oy + 0.5 * T.sy)).not.toBeNull();
  });
});

describe("Medaillen-Texte", () => {
  it("Einstufen-Medaille ohne Verdienst widerspricht sich nicht mehr (Gold-Medaille und Noch nicht verdient)", () => {
    const { m, journal } = model({ lines: [L(1, "LV", 5, 1429, 0, 0, "")] });
    expect(medal(m, "epic").earned).toBe(false);
    const env = fakeEnv({ language: "de-DE" });
    const view = renderChronicle(env.doc, { model: m, journal, lang: "de" });
    const tiers = byClass(view, "medal-tier").map((n) => n.textContent);
    expect(tiers).toContain("Noch zu verdienen: Gold-Medaille");
    expect(tiers.filter((t) => t === "Gold-Medaille")).toHaveLength(0);
    const en = renderChronicle(env.doc, { model: m, journal, lang: "en" });
    expect(byClass(en, "medal-tier").map((n) => n.textContent)).toContain("Still to earn: Gold Medal");
  });

  it("Pluralform bei ausgeblendeten Medaillen (eine/mehrere), Deutsch und Englisch", () => {
    expect(ctn("de", "medHidden", 1)).toBe("1 Medaille ist auf diesem Spiel nicht erreichbar und ausgeblendet.");
    expect(ctn("de", "medHidden", 2)).toBe("2 Medaillen sind auf diesem Spiel nicht erreichbar und ausgeblendet.");
    expect(ctn("en", "medHidden", 1)).toBe("1 medal cannot be reached on this game and is hidden.");
    expect(ctn("en", "medHidden", 3)).toBe("3 medals cannot be reached on this game and are hidden.");
    expect(ct("de", "medToEarn", "X")).toBe("Noch zu verdienen: X");
  });
});

describe("Andere Spieler ausblenden: Zähler, Nummerierung, NPC-Namen", () => {
  const lines = [
    L(1, "GM", "Alpha-Testreich", "PRIEST", 6, 2),
    L(2, "GM", "Beta-Testreich", "MAGE", 6, 2),
    L(3, "GM", "Gamma-Testreich", "ROGUE", 6, 2),
    L(4, "GM", "Delta-Testreich", "ROGUE", 6, 2),
    L(5, "GM", "Epsilon-Testreich", "ROGUE", 6, 2),
    L(6, "DC", "", "Doktor", "", "enemy"),
    L(7, "DC", "", "Anna Beispiel", "", "enemy"),
  ];
  const counters = { mates: { "Alpha-Testreich": 2, "Beta-Testreich": 1, "Gamma-Testreich": 4, "Delta-Testreich": 1, "Epsilon-Testreich": 1 } };

  it("Medaillenfortschritt Gesellig bleibt gleich, im Zähler stehen keine Namen mehr", () => {
    const db = makeDb({ lines, counters });
    const char = db.chars[GUID];
    const before = medal(buildChronik(db, GUID, buildJournal(db, GUID)), "companions");
    expect(before.value).toBe(5);
    const copy = anonymizeChar(char, createAnonymizer(char, "de"));
    const adb = Object.assign(Object.create(null), db);
    adb.chars = Object.create(null);
    adb.chars[GUID] = copy;
    const after = medal(buildChronik(adb, GUID, buildJournal(adb, GUID)), "companions");
    expect(after.value).toBe(5);
    expect(after.count).toBe(before.count);
    expect(JSON.stringify(copy.counters)).not.toMatch(/Alpha|Beta|Gamma|Delta|Epsilon/);
    expect(char.counters.mates["Alpha-Testreich"]).toBe(2);
  });

  it("NPC-artige Namen (Doktor, Leerzeichen) werden nicht als Spieler gesammelt und bleiben stehen", () => {
    const db = makeDb({ lines, counters });
    const char = db.chars[GUID];
    expect(collectForeignNames(char).map((n) => n.split("-")[0])).toEqual(["Alpha", "Beta", "Gamma", "Delta", "Epsilon"]);
    const log = anonymizeChar(char, createAnonymizer(char, "de")).log["1"];
    expect(log).toContain("Doktor");
    expect(log).toContain("Anna Beispiel");
    expect(log).not.toContain("Alpha");
    expect(looksLikeNpc("Auktionshaus der Allianz")).toBe(true);
    expect(looksLikeNpc("Doktor")).toBe(true);
    expect(looksLikeNpc("Zedrik-Testreich")).toBe(false);
    expect(looksLikeNpc("Zedrik")).toBe(false);
  });

  it("Renumberer: Lesereihenfolge ab 1, gleicher Name behält seine Nummer", () => {
    const r = createRenumberer("de");
    expect(r("Gefährte 7 und Gefährte 12, dann wieder Gefährte 7.")).toBe("Gefährte 1 und Gefährte 2, dann wieder Gefährte 1.");
    expect(r("Gefährte 31")).toBe("Gefährte 3");
    expect(createRenumberer("en")("Companion 9")).toBe("Companion 1");
  });

  it("im Druck beginnen die Pseudonyme bei Gefährte 1 und zählen in Lesereihenfolge ohne Lücke", async () => {
    const opts = thanenOpts();
    opts.blocks = opts.blocks.map((b) => b.replace("\n1080~LT~2978~1~2~mob~~18", "\n1080~LT~2978~1~2~mob~~18\n1081~LG~2978~1~3~Zedrik-Testreich~MAGE~need\n1082~LG~2978~1~3~Quillan-Testreich~MAGE~need"));
    const db = makeDb(opts);
    const char = db.chars[GUID];
    const journal = buildJournal(db, GUID);
    const { doc, win } = fakeEnv({ language: "de-DE" });
    const book = await buildPrintBook(doc, win, { db, guid: GUID, journal, char, lang: "de", anonymize: true });
    const seen = [];
    for (const m of book.element.textContent.matchAll(/Gefährte (\d+)/g)) if (!seen.includes(Number(m[1]))) seen.push(Number(m[1]));
    expect(seen.length).toBeGreaterThan(0);
    expect(seen).toEqual(seen.map((_, i) => i + 1));
  });
});

describe("Video Aktuelle Zone: nur die Besuche dieser Zone", () => {
  it("verdichtet den Zeitraum auf die Besuche der spät besuchten Karte; sonst bleibt er", () => {
    const s = sample();
    const data = prepareJourney(s.journal, s.char);
    const tl = data.trail.timeline;
    const whole = { p0: 0, p1: tl.length };
    const late = data.chapters[2]; // diese Karte wird nur im dritten Kapitel besucht
    const r = visitRange(data, "zone", whole, { baseMapID: late.mapID });
    expect(r.p0).toBeGreaterThan(late.a0 - 1);
    expect(r.p0).toBeLessThan(late.a1);
    expect(r.p1).toBeLessThanOrEqual(late.a1 + 1);
    expect(r.p1).toBeGreaterThan(r.p0);
    const plan = planTimeline(r.p0, r.p1, { ...VIDEO, axisLength: tl.length });
    const job = createFrameJob({ data, scope: "zone", range: r, images: new Map(), plan, info: { charName: "Wegfinder", lang: "de" }, baseMapID: late.mapID, scenes: sceneCache(data) });
    const f = job.frameAt(0);
    const firstLineT = Math.min(...f.state.scene.lines.map((l) => l.t[0]));
    expect(fromAxis(tl, f.axis)).toBeGreaterThanOrEqual(firstLineT - 1);
    expect(visitRange(data, "trip", whole)).toBe(whole);
    const r0 = visitRange(data, "zone", whole, { baseMapID: data.chapters[0].mapID });
    expect(r0.p0).toBe(0);
  });

  it("Kapitel als Zeitraum: bleibt im Kapitel, das Bild bekommt den Kapitelzeitraum für die blasse Restroute", () => {
    const s = sample();
    const data = prepareJourney(s.journal, s.char);
    const tl = data.trail.timeline;
    const ch = data.chapters[1];
    const range = visitRange(data, "zone", { p0: ch.a0, p1: ch.a1 }, { baseMapID: ch.mapID });
    expect(range.p0).toBeGreaterThanOrEqual(ch.a0);
    expect(range.p1).toBeLessThanOrEqual(ch.a1);
    const plan = planTimeline(range.p0, range.p1, { ...VIDEO, axisLength: tl.length });
    const job = createFrameJob({ data, scope: "zone", range, images: new Map(), plan, info: { charName: "W", lang: "de" }, baseMapID: ch.mapID, restrict: true });
    const f = job.frameAt(plan.frames - 1);
    expect(f.state.range).toEqual({ t0: fromAxis(tl, range.p0), t1: fromAxis(tl, range.p1) });
  });
});

describe("Pergament-Rückfall: Kartenname weicht den Ortsnamen aus", () => {
  it("setzt den Kartennamen in eine freie Ecke, ohne einen Ortsnamen zu überdecken", () => {
    const labels = [{ text: "Ortsname Eins", x: 0.08, y: 0.04, kind: "place" }, { text: "Ortsname Zwei", x: 0.3, y: 0.5, kind: "zone" }];
    const scene = { lines: [], flights: [], markers: [], labels };
    const ctx = recordingCtx();
    ctx.measureText = (s) => ({ width: String(s).length * 8 });
    drawFrame(ctx, { width: 900, height: 600, aspect: 1.5, scene, view: { cx: 0.5, cy: 0.5, zoom: 1 }, title: "Kartenname" });
    const title = ctx.calls.find((c) => c[0] === "fillText" && c[1] === "Kartenname");
    expect(title).toBeTruthy();
    const w = "Kartenname".length * 8;
    const drawn = ctx.calls.filter((c) => c[0] === "fillText" && /^Ortsname/.test(c[1]));
    for (const d of drawn) {
      const half = String(d[1]).length * 4 + 3;
      const overlapX = d[2] - half < title[2] + w && d[2] + half > title[2];
      const overlapY = d[3] - 10 < title[3] + 28 && d[3] + 10 > title[3];
      expect(overlapX && overlapY, String(d[1])).toBe(false);
    }
    expect(drawn.length).toBe(2);
  });
});

describe("Charakterauswahl", () => {
  it("nennt die Stufe vor dem Realm, damit das geschlossene Auswahlfeld sie nie abschneidet", async () => {
    const { startApp } = await import("../src/ui/app.mjs");
    const { makeFile } = await import("./helpers/fake-dom.mjs");
    const env = fakeEnv({ language: "de-DE" });
    const app = startApp(env.doc, env.win);
    await app.loadFile(makeFile("InkAndEmbers.lua", sampleWithTrail()));
    const sel = findAll(env.appRoot, (n) => n.tagName === "SELECT" && n.className === "char-select")[0];
    const opts = findAll(sel, (n) => n.tagName === "OPTION").map((o) => o.textContent);
    expect(opts.length).toBeGreaterThan(0);
    for (const o of opts) {
      const level = o.indexOf("Stufe");
      const realm = o.indexOf(" · ");
      expect(level, o).toBeGreaterThan(0);
      if (realm >= 0) expect(level).toBeLessThan(realm);
    }
  });
});
