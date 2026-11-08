// Sammelpatch W7 (aus den Gates W2/W4/W5): Steuerzeichen-Liste, Kern tr/raw, Obergrenzen je Szene, Binärsuchen, LRU,
// Item-Schlüssel und Qualität, touches(), REASON_RANK, build-map-index (Namen säubern, Abruf mit Zeitlimit/Größenbremse).
import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { safeText } from "../src/ui/safe-text.mjs";
import { clean } from "../src/core/render.mjs";
import { tr, raw } from "../src/core/i18n.mjs";
import { prepareMapScene, capMarkers, levelAt, playedAt, SCENE_POINTS_MAX, SCENE_MARKERS_MAX } from "../src/map/scene.mjs";
import { createLru } from "../src/ui/lru.mjs";
import { itemKey, itemQuality } from "../src/chronik/log.mjs";
import { touches } from "../src/chronik/dungeons.mjs";
import { segmentTrail, parseTrail } from "../src/trail/parse-trail.mjs";
import { cleanName, fetchTables, readLimited, TABLES, dataDir, readTables, DEFAULT_BUILD } from "../scripts/build-map-index.mjs";
import { model, thanenOpts } from "./helpers/chronik-sv.mjs";
import { rng } from "./helpers/trail-gen.mjs";
import { createAnonymizer, anonymizeChar, collectForeignNames } from "../src/share/anonymize.mjs";

const cp = (...n) => String.fromCodePoint(...n);
const HIDDEN = [0x061c, 0x180e, 0x200b, 0x200e, 0x200f, 0x2028, 0x2029, 0x202a, 0x202e, 0x2060, 0x2066, 0x2069, 0x206a, 0x206f, 0xfeff, 0xe0001, 0xe0041, 0xe007f];

describe("Steuerzeichen (safeText, Kern clean)", () => {
  it("entfernen U+061C, U+180E, U+206A–F und Tag-Zeichen, lassen Emoji stehen", () => {
    for (const c of HIDDEN) {
      expect(safeText("a" + cp(c) + "b"), c.toString(16)).toBe("ab");
      expect(clean("a" + cp(c) + "b"), c.toString(16)).toBe("ab");
    }
    expect(safeText("Flagge " + cp(0x1f3f4))).toBe("Flagge " + cp(0x1f3f4));
    expect(clean("Flagge " + cp(0x1f3f4))).toBe("Flagge " + cp(0x1f3f4));
  });

  it("Kern tr/raw lesen keine Prototyp-Eigenschaften", () => {
    for (const k of ["constructor", "__proto__", "toString", "cause.constructor"]) {
      expect(tr("de", k)).toBe(k);
      expect(raw("de", k)).toBeUndefined();
    }
  });

  it("Stat-Kacheln und Bildunterschriften sind bidi-isoliert (base.css und Kern-Stil)", () => {
    const base = readFileSync(new URL("../src/ui/base.css", import.meta.url), "utf8");
    const core = readFileSync(new URL("../src/core/style.css", import.meta.url), "utf8");
    for (const css of [base, core]) for (const c of [".stat-value", ".stat-sub", ".stat-label"]) expect(css).toMatch(new RegExp("\\" + c + "[^{]*\\)[^{]*\\{ unicode-bidi: isolate"));
  });
});

// Spur aus einem Block mit n Punkten auf Elwynn (1429), Zickzack, damit nichts ausgedünnt wird
function bigTrail(n) {
  const t = [], x = [], y = [];
  for (let i = 0; i < n; i++) {
    t.push(1793000000 + i);
    x.push(100 + (i % 97) * 97);
    y.push(100 + Math.floor(i / 97) % 97 * 97);
  }
  return { segments: [{ mapID: 1429, n, t, x, y }], flights: [] };
}

describe("Obergrenzen je Szene", () => {
  it("dünnt über maxPoints gröber aus bzw. behält jeden k-ten Punkt", () => {
    const sc = prepareMapScene(bigTrail(20000), 1429, { maxPoints: 1000 });
    const pts = sc.lines.reduce((s, l) => s + l.x.length, 0);
    expect(pts).toBeLessThanOrEqual(1100);
    expect(pts).toBeGreaterThan(100);
    expect(sc.bounds).not.toBeNull();
    expect(SCENE_POINTS_MAX).toBe(200000);
  });

  it("kappt Marker auf maxMarkers, wichtige Arten zuerst, Reihenfolge nach Zeit", () => {
    const list = [];
    for (let i = 0; i < 50; i++) list.push({ kind: i % 10 === 0 ? "death" : "discovery", t: i });
    const out = capMarkers(list, 10);
    expect(out).toHaveLength(10);
    expect(out.filter((m) => m.kind === "death")).toHaveLength(5);
    expect(out.map((m) => m.t)).toEqual([...out.map((m) => m.t)].sort((a, b) => a - b));
    expect(capMarkers([{ kind: "constructor", t: 1 }, { kind: "death", t: 2 }], 1)[0].kind).toBe("death");
    expect(SCENE_MARKERS_MAX).toBe(5000);
    const markers = Array.from({ length: 30 }, (_, i) => ({ kind: "level", t: 1793000000 + i, mapID: 1429, x: 0.5, y: 0.5 }));
    expect(prepareMapScene(bigTrail(10), 1429, { markers, maxMarkers: 7 }).markers).toHaveLength(7);
  });
});

describe("Binärsuchen levelAt/playedAt", () => {
  it("liefern dasselbe wie die lineare Suche", () => {
    const r = rng(3);
    const steps = [];
    let t = 1000;
    for (let i = 0; i < 300; i++) steps.push({ t: (t += Math.floor(r() * 50)), level: i + 2 });
    const track = { first: 1, steps };
    const linear = (q) => {
      let l = track.first;
      for (const s of steps) if (s.t <= q) l = s.level;
      return l;
    };
    for (let i = 0; i < 500; i++) {
      const q = 900 + Math.floor(r() * 16000);
      expect(levelAt(track, q)).toBe(linear(q));
    }
    expect(levelAt(track, NaN)).toBe(1);
    expect(levelAt({ first: 5, steps: [] }, 10)).toBe(5);
    const pl = steps.map((s, i) => ({ t: s.t, total: i * 100 }));
    const ptrack = { ts: [], acc: [], pl };
    expect(playedAt(ptrack, steps[10].t + 1)).toBe(1000);
    expect(playedAt(ptrack, 0)).toBe(0);
  });
});

describe("LRU für Kartenbilder/Szenen", () => {
  it("hält höchstens max Einträge und frischt beim Lesen auf", () => {
    const c = createLru(3);
    for (const k of ["a", "b", "c"]) c.set(k, k.toUpperCase());
    c.get("a");
    c.set("d", "D");
    expect(c.size).toBe(3);
    expect(c.has("b")).toBe(false);
    expect(c.has("a")).toBe(true);
    expect([...c.entries()].map(([k]) => k)).toEqual(["c", "a", "d"]);
    expect(c.peek("c")).toBe("C");
    expect(createLru(0).set("x", 1)).toBe(1);
  });
});

describe("Item-Schlüssel und Qualität", () => {
  it("nimmt nur Schlüssel nach README an und klemmt Qualität auf 0–7", () => {
    for (const k of ["2589", "2589.s-12", "2589.s7.b1.b22", "1" + ".b1".repeat(8)]) expect(itemKey(k), k).toBe(k);
    for (const k of ["", "x2589", "2589.b1".concat(".b1".repeat(8)), "2589.s", "2589;DROP", "constructor", "2589\n1", null, 5]) expect(itemKey(k), String(k)).toBeNull();
    expect(itemQuality(9)).toBe(7);
    expect(itemQuality(-3)).toBe(0);
    expect(itemQuality("4")).toBe(4);
    expect(itemQuality(3.7)).toBe(3);
    expect(itemQuality("abc")).toBeNull();
    expect(itemQuality(Infinity)).toBeNull();
  });
});

describe("touches und instanceAt", () => {
  it("touches entspricht der naiven Doppelschleife (auch unsortiert/überlappend)", () => {
    const r = rng(11);
    const naive = (a, b) => {
      for (let k = 0; k < a.length; k += 2) for (let w = 0; w < b.length; w += 2) if (a[k] <= b[w + 1] && a[k + 1] >= b[w]) return true;
      return false;
    };
    const rand = (n) => {
      const out = [];
      for (let i = 0; i < n; i++) {
        const a = Math.floor(r() * 10000);
        out.push(a, a + Math.floor(r() * 300));
      }
      return out;
    };
    for (let i = 0; i < 300; i++) {
      const a = rand(1 + Math.floor(r() * 20)), b = rand(1 + Math.floor(r() * 5));
      expect(touches(a, b)).toBe(naive(a, b));
    }
    expect(touches([], [1, 2])).toBe(false);
    expect(touches([1, NaN, 5, 6], [6, 7])).toBe(true);
  });

  it("instanceAt findet den umfassenden Besuch per Binärsuche", () => {
    const { m } = model(thanenOpts());
    const run = m.dungeons.runs[0];
    expect(m.dungeons.instanceAt(run.t0 + 1)).toBe(run.instanceID);
    expect(m.dungeons.instanceAt(run.t0 - 100000)).toBeNull();
    expect(m.dungeons.instanceAt(NaN)).toBeNull();
  });
});

describe("Anonymisierung: Prototyp-Kürzel im Log", () => {
  it("Kürzel wie constructor/__proto__/toString stürzen nicht ab und tragen keine Namen", () => {
    const char = { info: { name: "Eigener" }, log: { 1: "#~1793000000~1\n1~constructor~a~b\n2~__proto__~x\n3~toString~y\n4~DU~Fremdling~win~5~1429" } };
    expect(collectForeignNames(char)).toEqual(["Fremdling"]);
    const anon = createAnonymizer(char, "de");
    const out = anonymizeChar(char, anon);
    expect(JSON.stringify(out)).not.toContain("Fremdling");
    expect(JSON.stringify(out)).toContain("constructor~a~b");
  });
});

describe("Spur: Unterbrechungsgründe nur aus der eigenen Liste", () => {
  it("ein Grund wie „constructor“ teilt keine Strecke", () => {
    const parsed = parseTrail(["#~1793000000~1429\n0~4000~4000\n10~4010~4010\n20~4020~4020"]);
    const evil = segmentTrail(parsed, { breaks: [{ t: 1793000010, reason: "constructor" }, { t: 1793000010, reason: "__proto__" }, { t: 1793000010, reason: "toString" }] });
    expect(evil.segments).toHaveLength(1);
    const ok = segmentTrail(parsed, { breaks: [{ t: 1793000010, reason: "hearth" }] });
    expect(ok.segments.length).toBeGreaterThan(1);
  });
});

describe("build-map-index: Namen säubern, Abruf mit Zeitlimit und Größenbremse", () => {
  const csv = readTables(dataDir(DEFAULT_BUILD));
  const okResponse = (text, headers = {}) => ({ ok: true, status: 200, headers: { get: (k) => headers[k] ?? null }, body: null, text: async () => text });

  it("cleanName nutzt die Strip-Liste der Seite", () => {
    expect(cleanName("Elwynn" + cp(0x202e) + cp(0x200b) + cp(0xe0041) + " Forest\u0007")).toBe("Elwynn Forest");
    expect(cleanName(undefined)).toBe("");
    expect(cleanName("x".repeat(200))).toHaveLength(80);
  });

  it("lädt alle Tabellen, prüft erst und schreibt dann", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "iae-wago-")), "out");
    const seen = [];
    const fetchImpl = async (url, opts) => {
      seen.push(String(url));
      expect(opts.redirect).toBe("error");
      expect(opts.signal).toBeTruthy();
      const name = /\/db2\/([A-Za-z]+)\/csv/.exec(String(url))[1];
      return okResponse(csv[name]);
    };
    await fetchTables(DEFAULT_BUILD, dir, { fetchImpl });
    expect(seen.every((u) => u.startsWith("https://wago.tools/db2/"))).toBe(true);
    expect(readdirSync(dir).sort()).toEqual(TABLES.map((t) => t + ".csv").sort());
  });

  it("schreibt nichts, wenn eine Tabelle nicht passt, zu groß ist oder das Zeitlimit greift", async () => {
    const base = mkdtempSync(join(tmpdir(), "iae-wago-"));
    const bad = join(base, "bad");
    await expect(fetchTables(DEFAULT_BUILD, bad, { fetchImpl: async (url) => okResponse(String(url).includes("UiMapArtTile") ? "ID,Foo\n1,2\n" : csv[/\/db2\/([A-Za-z]+)\//.exec(String(url))[1]]) })).rejects.toThrow(/UiMapArtTile/);
    expect(existsSync(bad)).toBe(false);
    const big = join(base, "big");
    await expect(fetchTables(DEFAULT_BUILD, big, { fetchImpl: async () => okResponse("x", { "content-length": String(50 * 1024 * 1024) }) })).rejects.toThrow(/zu groß/);
    expect(existsSync(big)).toBe(false);
    const slow = join(base, "slow");
    const timeout = async (url, opts) => new Promise((_, rej) => opts.signal.addEventListener("abort", () => rej(opts.signal.reason)));
    await expect(fetchTables(DEFAULT_BUILD, slow, { fetchImpl: timeout, timeoutMs: 20 })).rejects.toThrow(/Zeitlimit/);
    expect(existsSync(slow)).toBe(false);
    await expect(fetchTables("1.2.3; rm", base, { fetchImpl: timeout })).rejects.toThrow(/Build ungültig/);
  });

  it("readLimited bricht einen zu großen Datenstrom ab", async () => {
    const chunk = new Uint8Array(1024);
    let n = 0;
    const res = { headers: { get: () => null }, body: { getReader: () => ({ read: async () => (n++ < 10 ? { done: false, value: chunk } : { done: true }), cancel: async () => {} }) } };
    await expect(readLimited(res, 4096, "T")).rejects.toThrow(/zu groß/);
  });
});
