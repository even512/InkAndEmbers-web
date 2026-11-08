// Synthetische Positionsspur für Tests und Vorschauen (keine echten Spielerdaten): je Kapitel ein Zufallsweg auf der
// Karte des Kapitels, deterministisch über einen Startwert. Ausgabe als Trail-Blöcke "#~<epoch>~<mapID>\n<dt>~<x>~<y>…".
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readSavedVariables, buildJournal } from "../../src/core/journal-model.mjs";

// kleiner deterministischer Zufall (mulberry32)
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// chapters: [{ mapID, t0, t1 }] -> Blöcke (je höchstens 500 Punkte, Punkt alle step Sekunden)
export function synthTrail(chapters, { seed = 7, step = 20, maxPoints = 240 } = {}) {
  const r = rng(seed);
  const blocks = [];
  for (const c of chapters) {
    const n = Math.max(2, Math.min(maxPoints, Math.floor((c.t1 - c.t0) / step)));
    let x = 3500 + Math.floor(r() * 3000), y = 3500 + Math.floor(r() * 3000);
    let dir = r() * Math.PI * 2;
    let lines = [];
    let head = c.t0;
    for (let i = 0; i < n; i++) {
      dir += (r() - 0.5) * 0.9;
      x = Math.max(300, Math.min(9700, Math.round(x + Math.cos(dir) * 60)));
      y = Math.max(300, Math.min(9700, Math.round(y + Math.sin(dir) * 60)));
      if (x <= 300 || x >= 9700 || y <= 300 || y >= 9700) dir += Math.PI / 2;
      const t = c.t0 + i * step;
      lines.push(t - head + "~" + x + "~" + y);
      if (lines.length >= 500) {
        blocks.push("#~" + head + "~" + c.mapID + "\n" + lines.join("\n"));
        head = t + step;
        lines = [];
      }
    }
    if (lines.length) blocks.push("#~" + head + "~" + c.mapID + "\n" + lines.join("\n"));
  }
  return blocks;
}

const luaStr = (s) => '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n") + '"';

// Lua-Text: den leeren Trail des ersten Charakters durch blocks ersetzen
export function withTrail(text, blocks) {
  const empty = '["trail"] = {\n},';
  if (!text.includes(empty)) throw new Error("kein leerer Trail in der Fixture");
  return text.replace(empty, '["trail"] = {\n' + blocks.map((b) => luaStr(b) + ",").join("\n") + "\n},");
}

// Beispiel-Datei des Exports mit einer Spur je Kapitel des ersten Charakters
export function sampleWithTrail() {
  const text = readFileSync(fileURLToPath(new URL("../fixtures/journal-export-sample.lua", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
  const { db } = readSavedVariables(text);
  const guid = Object.keys(db.chars).sort()[0];
  const j = buildJournal(db, guid);
  const chapters = j.chapters.map((c, i) => ({ mapID: Number(c.zone), t0: c.start, t1: j.chapters[i + 1] ? j.chapters[i + 1].start - 60 : c.end }));
  return withTrail(text, synthTrail(chapters.filter((c) => Number.isInteger(c.mapID) && c.t1 > c.t0)));
}
