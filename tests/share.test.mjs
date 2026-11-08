// Teilen (W6): Zeitverdichtung, Bitraten-Rechnung, Anonymisierung im Modell (auch Pergament-Ortsnamen), Dateiname,
// GIF-Differenzbilder, Einblendung ohne fremde Namen, Panel im Fake-DOM.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openFile, buildJournal } from "../src/core/journal-model.mjs";
import { readCharacterTrail, positionAt } from "../src/trail/parse-trail.mjs";
import { prepareJourney, createJourneyView } from "../src/ui/journey.mjs";
import { planTimeline, fileName, createFrameJob, renderFrame, sceneCache, VIDEO, GIF, LOGICAL } from "../src/share/frames.mjs";
import { videoBitrate, retryBitrate, projectedTooBig, formatBytes, LIMIT_BYTES, BITRATE_MAX } from "../src/share/limits.mjs";
import { collectForeignNames, createAnonymizer, anonymizeChar, anonymizeModel, anonymizeForExport, scrubJourney, pseudonym } from "../src/share/anonymize.mjs";
import { shareData } from "../src/ui/share-panel.mjs";
import { padPalette, encodeGifFrame, TRANSPARENT } from "../src/share/gif-core.mjs";
import { SHARE_TEXTS, st } from "../src/share/share-texts.mjs";
import { fakeEnv, findAll } from "./helpers/fake-dom.mjs";

const fixture = (n) => readFileSync(fileURLToPath(new URL("./fixtures/" + n, import.meta.url)), "utf8");
const GUID = "Player-0000-00000001";
const RLO = String.fromCharCode(0x202e);

function recordingCtx() {
  const calls = [];
  const target = { calls, createLinearGradient: () => ({ addColorStop() {} }), measureText: (s) => ({ width: String(s).length * 8 }) };
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
const texts = (ctx) => ctx.calls.filter((c) => c[0] === "fillText" || c[0] === "strokeText").map((c) => String(c[1]));

// synthetisch: fremde Spieler in Gruppe (GI/GM/WB), Lagerfeuer (LF), PvP-Tod (DC ohne npcID, PD), Handel, Post.
// "Brannock" heißt eine Unterzone (SZ) und ein Kapitel (ZN zone-Name); im zweiten Fall auch ein Spieler.
const NAMES = ["Brannock", "Kaelira", "Grimtusk", "Sylvane", "Torvak", "Mirela"];
const LOG = [
  "#~1793000000~1",
  "0~L~1~11500~70170~11500~deDE~0",
  "1~ZN~1429~3~Brannock~1415~5~4200~6500",
  "2~GM~Kaelira-Testreich~PRIEST~6~2",
  "3~WB~Kaelira-Testreich~PRIEST~Human~6~1429~4200~6500",
  "4~GI~36~3~Kaelira:PRIEST:6,Torvak:MAGE:7",
  "5~SZ~1429~Brannock~6",
  "8~LV~6~1429~4210~6490~Brannock~1",
  "10~DE~6~1429~4220~6480~0~1~Wald~~~1",
  "11~DC~~Grimtusk~~enemy",
  "11~PD~Grimtusk~ROGUE~6~1429~4220~6480",
  "12~TH~Sylvane~0~0~~~6~1429",
  "13~PM~Mirela~100~~~~6",
  "14~PM~Auktionshaus~100~~~1~6",
  "15~LF~1429~4230~6470~6~90~2~0000-1,Kaelira-Testreich,PRIEST,Human,6,3,a;0000-2,Torvak-Testreich,MAGE,Gnome,7,2,d~0",
].join("\\n");
const SOCIAL = `EveNChronicleDB = {
["schema"] = 1, ["locale"] = "deDE",
["chars"] = { ["${GUID}"] = {
["info"] = { ["name"] = "Wegfinder", ["realm"] = "Testreich", ["lastSeen"] = 1793002100 },
["counters"] = { ["mates"] = { ["Kaelira"] = 3 }, ["kills"] = 4 },
["log"] = { "${LOG}" },
["trail"] = { "#~1793000000~1429\\n0~4200~6500\\n5~4210~6490\\n10~4220~6480\\n15~4230~6470\\n200~4400~6400" },
} } }`;
const EVIL = SOCIAL.replace("12~TH~Sylvane", "12~TH~Brannock");

function load(text) {
  const { db } = openFile(text);
  return { db, journal: buildJournal(db, GUID), char: db.chars[GUID] };
}

describe("Zeitverdichtung", () => {
  it("lange Reise: höchstens 20 s, 2 s Standbild am Ende mit ganzer Route", () => {
    const p = planTimeline(0, 500000, { ...VIDEO, axisLength: 500000 });
    expect(p.duration).toBeLessThanOrEqual(20);
    expect(p.frames).toBe(600);
    expect(p.animFrames).toBe(540);
    expect(p.axisAt(0)).toBe(0);
    expect(p.axisAt(539)).toBeCloseTo(500000);
    expect(p.axisAt(540)).toBe(Infinity);
    expect(p.axisAt(599)).toBe(Infinity);
    for (let i = 1; i < 540; i++) expect(p.axisAt(i)).toBeGreaterThan(p.axisAt(i - 1));
  });
  it("kurzer Bereich: mindestens minAnimSec, Kapitel endet am Kapitelende (mit Kopf), nicht bei Infinity", () => {
    const p = planTimeline(100, 400, { ...VIDEO, axisLength: 5000 });
    expect(p.animFrames).toBe(VIDEO.minAnimSec * VIDEO.fps);
    expect(p.axisAt(p.frames - 1)).toBe(400);
    expect(p.duration).toBeCloseTo(VIDEO.minAnimSec + VIDEO.holdSec);
  });
  it("GIF: 12 Bilder/s, höchstens 15 s", () => {
    const p = planTimeline(0, 1e7, { ...GIF, axisLength: 1e7 });
    expect(p.fps).toBe(12);
    expect(p.duration).toBeLessThanOrEqual(15);
  });
  it("leerer Bereich: nur Standbild, keine NaN", () => {
    const p = planTimeline(50, 50, { ...VIDEO, axisLength: 50 });
    expect(p.animFrames).toBe(0);
    expect(p.frames).toBeGreaterThan(0);
    expect(p.axisAt(0)).toBe(Infinity);
    expect(planTimeline(NaN, NaN).frames).toBeGreaterThan(0);
  });
});

describe("Bitraten-Rechnung", () => {
  it("hält 15 MB bei 20 s mit Puffer ein", () => {
    const b = videoBitrate(20);
    expect((b * 20) / 8).toBeLessThan(LIMIT_BYTES * 0.85);
    expect(b).toBe(4_800_000);
  });
  it("kurze Videos werden gedeckelt, Unsinn ergibt die Mindestrate", () => {
    expect(videoBitrate(2)).toBe(BITRATE_MAX);
    expect(videoBitrate(0)).toBe(500_000);
    expect(videoBitrate(-1)).toBe(500_000);
  });
  it("zweiter Versuch skaliert proportional herunter", () => {
    expect(retryBitrate(4_800_000, 18_000_000)).toBeLessThan(4_800_000 * (15 / 18));
    expect(retryBitrate(4_800_000, 0)).toBe(4_800_000);
  });
  it("Hochrechnung erst ab 15 % der Bilder", () => {
    expect(projectedTooBig(5e6, 10, 100)).toBe(false);
    expect(projectedTooBig(5e6, 20, 100)).toBe(true);
    expect(projectedTooBig(1e6, 20, 100)).toBe(false);
  });
  it("Größe lesbar", () => {
    expect(formatBytes("de", 4_200_000)).toBe("4,2 MB");
    expect(formatBytes("en", 4_200_000)).toBe("4.2 MB");
    expect(formatBytes("de", 840_000)).toBe("840 KB");
  });
});

describe("Dateiname", () => {
  it("nur a-z, 0-9, Bindestrich aus dem Charakternamen", () => {
    const n = fileName({ charName: "Wëgfïnder ß<script>/../" + RLO, scope: "zone", epoch: 1793000000, ext: "mp4" });
    expect(n).toMatch(/^inkandembers_[a-z0-9-]+_zone_\d{4}-\d{2}-\d{2}\.mp4$/);
    expect(n).toContain("wegfinder-ss-script");
  });
  it("Rückfälle: leerer Name, unbekannter Ausschnitt/Endung, ohne Datum", () => {
    expect(fileName({ charName: "東京", scope: "x", ext: "exe" })).toBe("inkandembers_reise_trip.bin");
    expect(fileName({ charName: null, scope: "trip", ext: "gif" })).toBe("inkandembers_reise_trip.gif");
  });
});

describe("Andere Spieler ausblenden", () => {
  const { journal, char } = load(SOCIAL);

  it("findet alle fremden Namen in Log-Reihenfolge, ohne den eigenen und ohne Auktionshaus", () => {
    const names = collectForeignNames(char).map((n) => n.split("-")[0]);
    expect(names).toEqual(["Kaelira", "Torvak", "Grimtusk", "Sylvane", "Mirela"]);
  });

  it("ersetzt im Log, stabil Gefährte 1…n, und lässt das Original unverändert", () => {
    const anon = createAnonymizer(char, "de");
    const copy = anonymizeChar(char, anon);
    const log = copy.log["1"];
    for (const n of ["Kaelira", "Torvak", "Grimtusk", "Sylvane", "Mirela"]) expect(log).not.toContain(n);
    expect(log).toContain("GM~Gefährte 1~PRIEST");
    expect(log).toContain("GI~36~3~Gefährte 1:PRIEST:6,Gefährte 2:MAGE:7");
    expect(log).toContain("DC~~Gefährte 3~");
    expect(log).toContain("PM~Auktionshaus~");
    expect(copy.counters.mates).toBeUndefined();
    expect(copy.counters.kills).toBe(4);
    expect(char.log["1"] || char.log[1]).toContain("Kaelira");
    expect(pseudonym("en", 2)).toBe("Companion 2");
  });

  it("Journal neu gebaut: Tod-Killer ist Gefährte, kein fremder Name irgendwo im Modell", () => {
    const a = anonymizeForExport({ char, lang: "de", buildJournal });
    const death = a.journal.highlights.find((h) => h.kind === "death");
    expect(death.killer).toBe("Gefährte 3");
    const dump = JSON.stringify(a.journal, (k, v) => (v instanceof Map ? [...v] : v));
    for (const n of ["Kaelira", "Torvak", "Grimtusk", "Sylvane", "Mirela"]) expect(dump).not.toContain(n);
  });

  it("deckt auch Modelle späterer Ansichten ab (Gruppen, Beute-who), ganze Wörter", () => {
    const anon = createAnonymizer(char, "de");
    const m = anonymizeModel({ dungeons: { runs: [{ group: [{ name: "Zedrik", cls: "MAGE" }, { name: "Kaelira-Testreich" }] }] }, detail: { loot: [{ who: "Fremder", item: "Schwert" }] }, note: "Mit Torvak in Torvakheim" }, anon);
    expect(m.dungeons.runs[0].group[0].name).toMatch(/^Gefährte \d+$/);
    expect(m.dungeons.runs[0].group[1].name).toBe("Gefährte 1");
    expect(m.dungeons.runs[0].group[0].cls).toBe("MAGE");
    expect(m.detail.loot[0].who).toMatch(/^Gefährte \d+$/);
    expect(m.detail.loot[0].item).toBe("Schwert");
    expect(m.note).toBe("Mit Gefährte 2 in Torvakheim");
  });

  it("Pergament-Rückfall und Kartennamen: Ortsname = Spielername wird vor prepareMapScene ersetzt", () => {
    const { anon } = shareData({ data: prepareJourney(journal, char), char, lang: "de", anonymize: true, prepareJourney });
    expect(anon.names.some((n) => n.startsWith("Brannock"))).toBe(false); // hier nur ein Ort
    const L = load(EVIL);
    const s = shareData({ data: prepareJourney(L.journal, L.char), char: L.char, lang: "de", anonymize: true, prepareJourney });
    for (const id of [1429, 1415]) {
      const scene = sceneCache(s.data, s.anon)(id);
      const all = JSON.stringify({ labels: scene.labels, markers: scene.markers, names: [...s.data.names], chapters: s.data.chapters });
      expect(all, String(id)).not.toContain("Brannock");
    }
    const placeLabels = sceneCache(s.data, s.anon)(1429).labels.map((l) => l.text);
    expect(placeLabels.some((t) => /^Gefährte \d+$/.test(t))).toBe(true);
  });

  it("gezeichnete Bilder (Einblendung, Rückfall-Ortsnamen) enthalten keinen fremden Namen", () => {
    const L = load(EVIL);
    const s = shareData({ data: prepareJourney(L.journal, L.char), char: L.char, lang: "de", anonymize: true, prepareJourney });
    const tl = s.data.trail.timeline;
    const plan = planTimeline(0, tl.length, { ...VIDEO, minAnimSec: 1, holdSec: 0.5, axisLength: tl.length });
    for (const scope of ["zone", "continent", "trip"]) {
      const job = createFrameJob({ data: s.data, scope, range: { p0: 0, p1: tl.length }, images: new Map(), plan, info: { charName: "Wegfinder", lang: "de" }, anon: s.anon });
      for (const i of [0, Math.floor(plan.frames / 2), plan.frames - 1]) {
        const ctx = recordingCtx();
        renderFrame(ctx, job, i, 1080);
        const drawn = texts(ctx).join("|");
        for (const n of NAMES) expect(drawn, scope + ":" + i).not.toContain(n);
        expect(drawn).toContain("Wegfinder");
        expect(drawn).toContain("Ink & Embers");
      }
    }
  });

  it("ohne Schalter bleiben die Daten der Seite unverändert (gleiches Objekt)", () => {
    const data = prepareJourney(journal, char);
    expect(shareData({ data, char, lang: "de", anonymize: false, prepareJourney }).data).toBe(data);
    expect(scrubJourney(data, createAnonymizer(char, "de")).markers).not.toBe(data.markers);
  });
});

describe("Bilder", () => {
  const { journal, char } = load(fixture("trail-sample.lua"));
  const data = prepareJourney(journal, char);
  const tl = data.trail.timeline;

  it("Einblendung zeigt Charakter, Stufe/Datum, ohne Bidi-Zeichen, und skaliert auf die Ausgabe", () => {
    const plan = planTimeline(0, tl.length, { ...VIDEO, axisLength: tl.length });
    const job = createFrameJob({ data, scope: "zone", range: { p0: 0, p1: tl.length }, images: new Map(), plan, info: { charName: "Wegfinder" + RLO, lang: "de" } });
    const ctx = recordingCtx();
    const f = renderFrame(ctx, job, 10, 1080);
    expect(f.mapID).toBeTruthy();
    const st0 = ctx.calls.find((c) => c[0] === "setTransform");
    expect(st0[1]).toBeCloseTo(1080 / LOGICAL);
    expect(texts(ctx).some((s) => s.startsWith("Wegfinder ·"))).toBe(true);
    expect(texts(ctx).join("")).not.toContain(RLO);
    expect(job.mapIDs().length).toBeGreaterThan(0);
  });

  it("Ausschnitt ganze Reise folgt dem Kopf (Kontinent der aktuellen Position)", () => {
    const plan = planTimeline(0, tl.length, { ...VIDEO, axisLength: tl.length });
    const job = createFrameJob({ data, scope: "trip", range: { p0: 0, p1: tl.length }, images: new Map(), plan, info: { charName: "W", lang: "de" } });
    expect(job.mapIDs()).toEqual([1415]);
  });

  it("positionAt nutzt das vorgehaltene t0-Array", () => {
    const tr = readCharacterTrail(char, []);
    expect(tr.starts).toEqual(tr.segments.map((s) => s.t0));
    expect(positionAt(tr, tr.segments[1].t0).segment).toBe(1);
    expect(positionAt({ segments: tr.segments }, tr.segments[1].t0).segment).toBe(1);
  });
});

describe("GIF-Differenzbilder", () => {
  it("Palette hat 256 Einträge, unveränderte Punkte werden durchsichtig", () => {
    const pal = padPalette([[1, 2, 3], [4, 5, 6]]);
    expect(pal.length).toBe(256);
    const writes = [];
    const enc = { writeFrame: (idx, w, h, o) => writes.push({ idx: Array.from(idx), o }) };
    const opts = { width: 2, height: 2, delay: 83, palette: pal };
    let prev = encodeGifFrame(enc, new Uint8Array([0, 1, 1, 0]), null, opts);
    prev = encodeGifFrame(enc, new Uint8Array([0, 1, 0, 0]), prev, opts);
    expect(writes[0].o.palette).toBe(pal);
    expect(writes[0].o.dispose).toBe(1);
    expect(writes[1].idx).toEqual([TRANSPARENT, TRANSPARENT, 0, TRANSPARENT]);
    expect(writes[1].o).toMatchObject({ transparent: true, transparentIndex: 255, dispose: 1 });
    expect(writes[1].o.palette).toBeUndefined();
  });
});

describe("Teilen-Panel", () => {
  it("Texte DE/EN vollständig", () => {
    expect(Object.keys(SHARE_TEXTS.de).sort()).toEqual(Object.keys(SHARE_TEXTS.en).sort());
    expect(st("en", "shRendering", "GIF", 1, 2)).toBe("Creating GIF: frame 1 of 2");
  });

  it("hängt an der Reise-Ansicht: Ausschnitt, Zeitraum, Schalter (aus), drei Knöpfe; nur Textknoten", () => {
    const { doc, win } = fakeEnv();
    const { journal, char } = load(fixture("trail-sample.lua"));
    const v = createJourneyView(doc, win, { journal, char, lang: "de" });
    const panel = findAll(v.element, (n) => n.className === "share-panel")[0];
    expect(panel).toBeTruthy();
    const btns = findAll(panel, (n) => /share-btn/.test(n.className)).map((n) => n.textContent);
    expect(btns).toEqual(["Video (MP4)", "GIF", "Bild (PNG)"]);
    const box = findAll(panel, (n) => n.className === "share-anon")[0];
    expect(box.checked).toBe(false);
    const scope = findAll(panel, (n) => /seg-btn/.test(n.className)).map((n) => n.textContent);
    expect(scope).toEqual(["Aktuelle Zone", "Kontinent", "Ganze Reise"]);
    v.setLang("en");
    expect(findAll(panel, (n) => /share-btn/.test(n.className))[2].textContent).toBe("Picture (PNG)");
    v.destroy();
  });
});

describe("Anonymisierung der Chronik-Felder (W5) am echten Modell", () => {
  it("Dungeon-Gruppe (group[].name) und Beute (loot[].who) tragen keinen Spielernamen mehr", async () => {
    const { model, thanenOpts } = await import("./helpers/chronik-sv.mjs");
    const { dungeonGroup, dungeonDetail } = await import("../src/chronik/dungeons.mjs");
    const opts = thanenOpts();
    opts.blocks = opts.blocks.map((b) => b.replace("\n1080~LT~2978~1~2~mob~~18", "\n1080~LT~2978~1~2~mob~~18\n1081~LG~2978~1~3~Zedrik-Testreich~MAGE~need"));
    const { m } = model(opts);
    const run = m.dungeons.runs[0];
    const group = dungeonGroup(m.ctx, run);
    const detail = dungeonDetail(m.ctx, run);
    const realNames = group.map((g) => g.name);
    expect(realNames.length).toBeGreaterThan(0);
    const who = detail.loot.filter((e) => e.who);
    expect(who.map((e) => e.who)).toContain("Zedrik-Testreich");
    const anon = createAnonymizer({ info: { name: "Eigener" }, log: {} }, "de");
    const out = anonymizeModel({ dungeons: { runs: [{ group, detail }] } }, anon);
    const dump = JSON.stringify(out);
    for (const n of [...realNames, "Zedrik"]) expect(dump).not.toContain(n);
    expect(out.dungeons.runs[0].group.every((g) => /^Gefährte \d+$/.test(g.name))).toBe(true);
    expect(out.dungeons.runs[0].detail.loot.filter((e) => e.who).every((e) => /^Gefährte \d+$/.test(e.who))).toBe(true);
    expect(group[0].name).toBe(realNames[0]); // Original unverändert
  });
});

describe("Anonymisierung: Gruppenbeute (LG) und Auktionshaus-Partner (AH)", () => {
  const mkChar = (lines) => ({ info: { name: "Eigener" }, log: { 1: ["#~1794000000~1", ...lines].join("\n") } });
  it("collectForeignNames und anonymizeChar erfassen LG.who und AH.partner; leerer Partner bleibt leer", () => {
    const char = mkChar([
      "10~LG~2978~1~3~Zedrik-Testreich~MAGE~need",
      "20~AH~sold~2978~~1~5000~250~~Handelsfuerst-Realm~12~1429",
      "30~AH~post~2978~~1~5000~250~24~~12~1429",
    ]);
    expect(collectForeignNames(char)).toEqual(["Zedrik-Testreich", "Handelsfuerst-Realm"]);
    const anon = createAnonymizer(char, "de");
    const copy = anonymizeChar(char, anon);
    const text = copy.log["1"];
    expect(text).not.toContain("Zedrik");
    expect(text).not.toContain("Handelsfuerst");
    expect(text).toContain("20~AH~sold~2978~~1~5000~250~~Gefährte 2~12~1429");
    expect(text).toContain("30~AH~post~2978~~1~5000~250~24~~12~1429");
    expect(anon.scrub("Zedrik verkauft an Handelsfuerst")).toBe("Gefährte 1 verkauft an Gefährte 2");
  });
});
