// Datei-Eingang: Typ-, Größen- und Tiefenlimits, verständliche Fehler, Ablegen von Ordnern/mehreren Dateien
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadSvFile, checkFileMeta, errorMessage, LoadError, MAX_FILE_BYTES } from "../src/ui/load-file.mjs";
import { pickDroppedFile, hasFiles } from "../src/ui/drop.mjs";
import { makeFile } from "./helpers/fake-dom.mjs";

const fixture = (n) => readFileSync(fileURLToPath(new URL("./fixtures/" + n, import.meta.url)), "utf8");
const SAMPLE = fixture("journal-export-sample.lua");

async function codeOf(promise) {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(LoadError);
    return e;
  }
  throw new Error("kein Fehler geworfen");
}

describe("Datei laden", () => {
  it("liest die synthetische Beispiel-Datei: Charaktere, Sprache, Name", async () => {
    const r = await loadSvFile(makeFile("InkAndEmbers.lua", SAMPLE, { type: "" }));
    expect(r.name).toBe("InkAndEmbers.lua");
    expect(r.characters.length).toBeGreaterThanOrEqual(1);
    expect(r.characters[0].name).toBe("Mirela");
    expect(r.language).toBe("de");
    expect(r.schemaWarning).toBeNull();
  });

  it("akzeptiert text/plain und Großschreibung der Endung", async () => {
    await loadSvFile(makeFile("InkAndEmbers.LUA", SAMPLE, { type: "text/plain" }));
  });

  it("weist falsche Endungen ab, ohne zu lesen", async () => {
    for (const n of ["InkAndEmbers.lua.bak", "InkAndEmbers.zip", "InkAndEmbers", "x.lua.txt"]) {
      const f = makeFile(n, SAMPLE);
      const e = await codeOf(loadSvFile(f));
      expect(e.code, n).toBe("notLuaFile");
      expect(f.reads).toBe(0);
    }
  });

  it("weist fremde MIME-Typen ab", async () => {
    const f = makeFile("InkAndEmbers.lua", SAMPLE, { type: "image/png" });
    const e = await codeOf(loadSvFile(f));
    expect(e.code).toBe("badType");
    expect(f.reads).toBe(0);
  });

  it("weist leere Dateien ab (Größe 0 und nur Leerraum)", async () => {
    expect((await codeOf(loadSvFile(makeFile("a.lua", "")))).code).toBe("empty");
    expect((await codeOf(loadSvFile(makeFile("a.lua", "  \n\n ")))).code).toBe("empty");
  });

  it("weist zu große Dateien ab, ohne sie zu lesen (Limit 50 MB)", async () => {
    expect(MAX_FILE_BYTES).toBe(50 * 1024 * 1024);
    const f = makeFile("InkAndEmbers.lua", "x", { size: MAX_FILE_BYTES + 1 });
    const e = await codeOf(loadSvFile(f));
    expect(e.code).toBe("tooBig");
    expect(f.reads).toBe(0);
    expect(() => checkFileMeta(makeFile("a.lua", "x", { size: MAX_FILE_BYTES }))).not.toThrow();
  });

  it("erkennt Binärdaten", async () => {
    const e = await codeOf(loadSvFile(makeFile("a.lua", "EveNChronicleDB = {\u0000\u0001\u0002}")));
    expect(e.code).toBe("binary");
  });

  it("meldet kaputtes Lua mit Zeilennummer", async () => {
    const e = await codeOf(loadSvFile(makeFile("a.lua", "EveNChronicleDB = {\n[\"a\"] = ,\n}")));
    expect(e.code).toBe("notLua");
    expect(e.args[0]).toBe(2);
    expect(errorMessage(e)).toEqual({ key: "errNotLua", args: [2] });
  });

  it("begrenzt die Verschachtelungstiefe (Tabellen-Bombe)", async () => {
    const deep = "EveNChronicleDB = " + "{".repeat(500) + "}".repeat(500);
    const e = await codeOf(loadSvFile(makeFile("a.lua", deep)));
    expect(e.code).toBe("notLua");
  });

  it("erkennt Dateien ohne Addon-Daten und ohne Charakter", async () => {
    expect((await codeOf(loadSvFile(makeFile("a.lua", "SomethingElse = {}")))).code).toBe("noData");
    expect((await codeOf(loadSvFile(makeFile("a.lua", "EveNChronicleDB = { [\"chars\"] = {} }")))).code).toBe("noChars");
  });

  it("meldet eine neuere Schema-Version als Hinweis, liest aber weiter", async () => {
    const r = await loadSvFile(makeFile("a.lua", SAMPLE.replace('["schema"] = 1', '["schema"] = 99')));
    expect(r.schemaWarning).toBe(99);
    expect(r.characters.length).toBeGreaterThan(0);
  });

  it("macht aus Lesefehlern und Unerwartetem LoadErrors", async () => {
    const broken = { name: "a.lua", type: "", size: 10, text: async () => { throw new Error("boom"); } };
    expect((await codeOf(loadSvFile(broken))).code).toBe("read");
    expect((await codeOf(loadSvFile(null))).code).toBe("noFile");
    expect(errorMessage(new Error("kaputt"))).toEqual({ key: "errInternal", args: ["kaputt"] });
  });

  it("jeder Fehlercode hat einen Text in beiden Sprachen", async () => {
    const { t } = await import("../src/ui/texts.mjs");
    for (const code of ["noFile", "folder", "notLuaFile", "badType", "empty", "tooBig", "binary", "notLua", "noData", "noChars", "unknownChar", "read", "internal"]) {
      const m = errorMessage(new LoadError(code, ["x"]));
      for (const lang of ["de", "en"]) {
        const text = t(lang, m.key, ...m.args);
        expect(text, code + "/" + lang).not.toBe(m.key);
        expect(text.length).toBeGreaterThan(10);
      }
    }
  });
});

describe("Ablegen", () => {
  const items = (arr) => arr.map((isDir) => ({ kind: "file", webkitGetAsEntry: () => ({ isDirectory: isDir }) }));

  it("nimmt die erste .lua-Datei und zählt alle", () => {
    const a = { name: "readme.txt" };
    const b = { name: "InkAndEmbers.lua" };
    const r = pickDroppedFile({ files: [a, b], items: [] });
    expect(r.file).toBe(b);
    expect(r.count).toBe(2);
    expect(pickDroppedFile({ files: [a] }).file).toBe(a);
  });

  it("weist Ordner und Leeres ab", () => {
    expect(() => pickDroppedFile({ files: [{ name: "Ordner" }], items: items([true]) })).toThrow(LoadError);
    try {
      pickDroppedFile({ files: [{ name: "Ordner" }], items: items([true]) });
    } catch (e) {
      expect(e.code).toBe("folder");
    }
    expect(() => pickDroppedFile({ files: [], items: [] })).toThrow(/noFile/);
    expect(() => pickDroppedFile(null)).toThrow(/noFile/);
  });

  it("Ordner plus Datei: die Datei zählt", () => {
    const f = { name: "InkAndEmbers.lua" };
    expect(pickDroppedFile({ files: [{ name: "o" }, f], items: items([true, false]) }).file).toBe(f);
  });

  it("zeigt die Ablegefläche nur bei Dateien", () => {
    expect(hasFiles({ types: ["Files"] })).toBe(true);
    expect(hasFiles({ types: ["text/plain"] })).toBe(false);
    expect(hasFiles(null)).toBe(false);
  });
});
