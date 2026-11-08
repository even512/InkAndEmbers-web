// Positionsspur: strenge Prüfung (Whitelist, Zahlengrenzen, Limits, Zählung), Strecken (Flug, Tod, Ruhestein, Sprung,
// Zonenwechsel), Zeitachse und Position zum Zeitpunkt
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readSavedVariables, parseLog } from "../src/core/journal-model.mjs";
import {
  parseTrail, segmentTrail, breaksFromLog, buildTimeline, toAxis, fromAxis, positionAt, readCharacterTrail,
  TRAIL_LIMITS, IDLE,
} from "../src/trail/parse-trail.mjs";

const fixture = (name) => readFileSync(fileURLToPath(new URL("./fixtures/" + name, import.meta.url)), "utf8");
const T0 = 1793000000;
const GUID = "Player-0000-00000001";

function sampleChar() {
  const { db } = readSavedVariables(fixture("trail-sample.lua"));
  return db.chars[GUID];
}

describe("parseTrail: Prüfung", () => {
  it("liest die Fixture-Datei vollständig (Lua-Tabelle, 5 Blöcke, 15 Punkte, nichts verworfen)", () => {
    const { blocks, stats } = parseTrail(sampleChar().trail);
    expect(blocks).toHaveLength(5);
    expect(stats).toMatchObject({ blocks: 5, blocksDropped: 0, lines: 15, linesDropped: 0, points: 15, truncated: false });
    expect(blocks[0]).toMatchObject({ start: T0, mapID: 1429, n: 4 });
    expect(blocks[0].t).toEqual([T0, T0 + 5, T0 + 10, T0 + 15]);
    expect(blocks[0].mk).toEqual([null, null, null, "f"]);
    expect(blocks[1].x).toEqual([5600, 5610, 5620, 5000, 5010]);
  });

  it("verwirft ungültige Zeilen einzeln und zählt den Grund", () => {
    const block = ["#~" + T0 + "~1429", "0~1~2", "9~5~5", "5~10000~5", "abc", "3~1~1", "7~1~1~q", "8~2~2~z~x", "-1~1~1",
      "10~1.5~2", "11~ 1~2", "12~1~2~Z", "13~1~1;", "8000000~1~1", "0x10~1~1", "10~6~6~d", ""].join("\n");
    const { blocks, stats } = parseTrail([block]);
    expect(blocks[0].t.map((t) => t - T0)).toEqual([0, 9, 10]);
    expect(blocks[0].mk).toEqual([null, null, "d"]);
    expect(stats.dropped).toMatchObject({ range: 1, form: 9, order: 1, mark: 1 });
    expect(stats.linesDropped).toBe(12);
    expect(stats.lines).toBe(15);
  });

  it("nimmt nur die Marken z, d, f, l und Koordinaten 0..9999", () => {
    const ok = ["#~" + T0 + "~1", "0~0~0~z", "1~9999~9999~d", "2~1~1~f", "3~2~2~l"].join("\n");
    const { blocks } = parseTrail([ok]);
    expect(blocks[0].mk).toEqual(["z", "d", "f", "l"]);
    for (const bad of ["a", "x", "e", "h"]) expect(parseTrail(["#~" + T0 + "~1\n0~1~1~" + bad]).stats.dropped.mark).toBe(1);
  });

  it("verwirft ganze Blöcke bei falschem Kopf, falschem Typ, Übergröße und Dublette", () => {
    const good = "#~" + T0 + "~1429\n0~1~1";
    const trail = [
      good, good, // Dublette
      "#~12~1429\n0~1~1", // Epoch unplausibel
      "#~" + T0 + "~0\n0~1~1", // uiMap 0
      "#~" + T0 + "~1429~7\n0~1~1", // Kopf mit Zusatzfeld
      "#~-5~1429\n0~1~1", // negative Epoch
      "<script>alert(1)</script>",
      "#~" + T0 + "~1429\n" + "0~1~1\n".repeat(4000), // > MAX_BLOCK_CHARS
      42, null, { 1: "x" },
    ];
    const { blocks, stats } = parseTrail(trail);
    expect(blocks).toHaveLength(1);
    expect(stats.dropped).toMatchObject({ duplicate: 1, head: 5, size: 1, type: 3 });
    expect(stats.blocksDropped).toBe(10);
  });

  it("hält die Limits ein: 500 Punkte je Block, Gesamtzahl, Blockzahl", () => {
    const lines = ["#~" + T0 + "~1429"];
    for (let i = 0; i < 520; i++) lines.push(i + "~1~1");
    const r = parseTrail([lines.join("\n")]);
    expect(r.blocks[0].n).toBe(TRAIL_LIMITS.MAX_POINTS_PER_BLOCK);
    expect(r.stats.dropped.limit).toBe(20);
    const many = [];
    for (let i = 0; i < 5; i++) many.push("#~" + (T0 + i * 100) + "~1429\n0~1~1\n1~2~2");
    const capped = parseTrail(many, { MAX_POINTS: 3, MAX_BLOCKS: 4 });
    expect(capped.stats.points).toBe(3);
    expect(capped.stats.truncated).toBe(true);
    expect(capped.stats.dropped.limit).toBe(1 + 1 + 2 + 2); // Block 5 (Blockzahl), Punkt 4, Blöcke 3 und 4 ganz
  });

  it("verträgt fehlende oder fremde Eingaben ohne Ausnahme", () => {
    for (const v of [undefined, null, 5, "text", {}, []]) {
      const r = parseTrail(v);
      expect(r.blocks).toEqual([]);
      expect(r.stats.points).toBe(0);
    }
    const proto = JSON.parse('{"__proto__": "#~1793000000~1\\n0~1~1", "1": "#~1793000000~1429\\n0~2~2"}');
    expect(parseTrail(proto).blocks).toHaveLength(1);
    expect(({}).polluted).toBeUndefined();
  });

  it("sortiert Blöcke nach Startzeit und toleriert CRLF", () => {
    const r = parseTrail(["#~" + (T0 + 100) + "~2\r\n0~1~1\r\n", "#~" + T0 + "~1\r\n0~1~1"]);
    expect(r.blocks.map((b) => b.mapID)).toEqual([1, 2]);
    expect(r.stats.linesDropped).toBe(0);
  });

  it("Datei ohne Trail (journal-export-sample.lua) ergibt eine leere Spur", () => {
    const { db } = readSavedVariables(fixture("journal-export-sample.lua"));
    for (const guid of Object.keys(db.chars)) {
      const r = readCharacterTrail(db.chars[guid], parseLog(db.chars[guid]));
      expect(r.segments).toEqual([]);
      expect(r.timeline.length).toBe(0);
      expect(positionAt(r, T0)).toBeNull();
    }
  });
});

describe("segmentTrail: Strecken", () => {
  const char = sampleChar();
  const breaks = breaksFromLog(parseLog(char));
  const seg = segmentTrail(parseTrail(char.trail), { breaks });

  it("liest Unterbrechungen aus dem Log (Login, Ruhestein), Flug-TP nicht", () => {
    expect(breaks).toEqual([{ t: T0, reason: "login" }, { t: T0 + 990, reason: "hearth" }]);
    expect(breaksFromLog([{ t: 5, code: "TP", f: ["taxi"] }, { t: 6, code: "TP", f: ["instance"] }, { t: NaN, code: "L" }, null, { t: 7, code: "XX" }]))
      .toEqual([{ t: 6, reason: "gap" }]);
    expect(breaksFromLog("nein")).toEqual([]);
  });

  it("zerlegt in Strecken: Start, Flug, Tod, Ruhestein, Sprung, Zonenwechsel", () => {
    expect(seg.segments.map((s) => s.reason)).toEqual(["start", "flight", "death", "hearth", "jump", "zone"]);
    expect(seg.segments.map((s) => s.mapID)).toEqual([1429, 1436, 1436, 1436, 1436, 1429]);
    expect(seg.segments.map((s) => s.n)).toEqual([4, 3, 2, 2, 2, 2]);
    expect(seg.segments[1]).toMatchObject({ t0: T0 + 300, t1: T0 + 308 });
  });

  it("erkennt den Flug (f -> l) mit Start- und Zielkarte", () => {
    expect(seg.flights).toEqual([{ from: { mapID: 1429, x: 4230, y: 6470 }, to: { mapID: 1436, x: 5600, y: 3000 }, t0: T0 + 15, t1: T0 + 300 }]);
  });

  it("führt Übergänge ohne Laufweg als hops, Zonenwechsel binnen 30 s als link", () => {
    expect(seg.hops.map((h) => h.reason)).toEqual(["flight", "death", "hearth", "jump"]);
    expect(seg.segments[5].link).toEqual({ mapID: 1436, x: 1010, y: 1010, t: T0 + 2004 });
    expect(seg.segments[4].link).toBeNull();
    expect(seg.marks.map((m) => m.kind)).toEqual(["takeoff", "landing", "death", "zone"]);
  });

  it("kein Sprung bei kurzer Pause oder kleiner Entfernung, und nie rückwärts in der Zeit", () => {
    const r = segmentTrail(parseTrail(["#~" + T0 + "~1\n0~100~100\n500~150~150\n510~5000~5000"]));
    expect(r.segments).toHaveLength(1);
    const back = segmentTrail(parseTrail(["#~" + T0 + "~1\n0~1~1\n100~2~2", "#~" + (T0 + 50) + "~1\n0~9~9\n200~3~3"]));
    const ts = back.segments.flatMap((s) => s.t);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
    expect(ts).toEqual([T0, T0 + 100, T0 + 250]);
  });

  it("ignoriert Unterbrechungen mit unbekanntem Grund oder ohne Zahl", () => {
    const r = segmentTrail(parseTrail(["#~" + T0 + "~1\n0~1~1\n10~2~2"]), { breaks: [{ t: T0 + 5, reason: "evil" }, { t: "x", reason: "hearth" }] });
    expect(r.segments).toHaveLength(1);
  });
});

describe("Zeitachse und Position", () => {
  const r = readCharacterTrail(sampleChar(), parseLog(sampleChar()));
  const tl = r.timeline;

  it("schrumpft Stillstand auf 12 s und den Flug auf 60 s", () => {
    expect(tl.t0).toBe(T0);
    expect(tl.t1).toBe(T0 + 2016);
    expect(tl.k).toEqual([IDLE.FLIGHT_KEEP, IDLE.KEEP, IDLE.KEEP]);
    expect(tl.length).toBe(2016 - (285 - 60) - (636 - 12) - (997 - 12));
  });

  it("toAxis und fromAxis sind zueinander invers und monoton", () => {
    let last = -1;
    for (let t = T0 - 10; t <= T0 + 2030; t += 7) {
      const q = toAxis(tl, t);
      expect(q).toBeGreaterThanOrEqual(last);
      last = q;
      if (t >= T0 && t <= tl.t1) expect(fromAxis(tl, q)).toBeCloseTo(t, 6);
    }
    expect(toAxis(tl, T0 + 15)).toBe(15);
    expect(toAxis(tl, T0 + 300)).toBe(75);
    expect(fromAxis(tl, 0)).toBe(T0);
    expect(fromAxis(tl, 1e9)).toBe(tl.t1);
    expect(toAxis(null, 5)).toBe(0);
  });

  it("findet die Position zum Zeitpunkt (linear innerhalb einer Strecke, in Lücken der letzte Punkt)", () => {
    expect(positionAt(r, T0 - 1)).toBeNull();
    expect(positionAt(r, T0 + 2.5)).toMatchObject({ segment: 0, mapID: 1429, x: 4205, y: 6495 });
    expect(positionAt(r, T0 + 100)).toMatchObject({ segment: 0, index: 3, x: 4230, y: 6470 });
    expect(positionAt(r, T0 + 302)).toMatchObject({ segment: 1, mapID: 1436, x: 5605, y: 3005 });
    expect(positionAt(r, T0 + 99999)).toMatchObject({ segment: 5, x: 4310, y: 6610 });
  });
});
