// Fuzz- und XSS-Tests (W7): zufällig verstümmelte, riesige, tief verschachtelte und zeilenreiche SV-Dateien, Bidi-/Zero-
// Width-Namen und Prototyp-Kürzel laufen durch die ganze Kette (Datei laden -> Tagebuch -> Reise -> Chronik -> Druckbuch ->
// Seite). Erwartet: kein Absturz (nur die eigenen LoadError-Meldungen), alles nur als Textknoten, keine Steuerzeichen im Text,
// keine fremden Tags/Attribute. Das Test-DOM wirft bei innerHTML/outerHTML/insertAdjacentHTML.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadSvFile, LoadError, errorMessage, MAX_FILE_BYTES } from "../src/ui/load-file.mjs";
import { buildJournal, parseLog } from "../src/core/journal-model.mjs";
import { prepareJourney, createJourneyView } from "../src/ui/journey.mjs";
import { renderChroniclePanel } from "../src/chronik/index.mjs";
import { buildPrintBook } from "../src/ui/print.mjs";
import { startApp } from "../src/ui/app.mjs";
import { STRIP } from "../src/ui/safe-text.mjs";
import { t } from "../src/ui/texts.mjs";
import { fakeEnv, findAll, makeFile } from "./helpers/fake-dom.mjs";
import { rng, sampleWithTrail } from "./helpers/trail-gen.mjs";

const read = (n) => readFileSync(fileURLToPath(new URL("./fixtures/" + n, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
const BASES = {
  sample: read("journal-export-sample.lua"),
  trail: read("trail-sample.lua"),
  xss: read("xss.lua"),
  withTrail: sampleWithTrail(),
};

const LOAD_CODES = new Set(["noFile", "folder", "notLuaFile", "badType", "empty", "tooBig", "binary", "notLua", "noData", "noChars", "unknownChar", "read"]);
const TAGS = new Set(["DIV", "SECTION", "ARTICLE", "HEADER", "FOOTER", "MAIN", "NAV", "ASIDE", "FIGURE", "FIGCAPTION", "H1", "H2", "H3", "H4", "P", "SPAN", "STRONG", "EM", "B", "SMALL",
  "BUTTON", "SELECT", "OPTION", "INPUT", "LABEL", "UL", "OL", "LI", "DL", "DT", "DD", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "IMG", "CANVAS", "PROGRESS", "BODY", "HTML", "TIME", "ABBR", "BR", "HR"]);
const BAD_ATTR = /^on|^style$|^href$|^srcdoc$|^formaction$/i;
const SRC_OK = /^(img\/[a-z0-9-]+\.webp|blob:[\w:/.-]+)$/;

// Mutationen: Bereiche löschen/verdoppeln/abschneiden, Müll einfügen (Lua-Sonderzeichen, Bidi, Prototyp-Namen)
const JUNK = ["{", "}", "\"", "\\", "~", "\n", "]]", "[[", "--", "=", ",", "#~", "\\u{202E}", "\\u{200B}", "\\u{E0041}", "\u202e", "\u2066", "\u200b", "\u061c",
  "__proto__", "constructor", "toString", "<script>alert(1)</script>", "<img src=x onerror=alert(2)>", "9999999999", "-1", "NaN", "1e309", "\u0000"];
function mutate(text, r) {
  let s = text;
  const ops = 1 + Math.floor(r() * 6);
  for (let k = 0; k < ops; k++) {
    const i = Math.floor(r() * s.length), len = Math.floor(r() * 400);
    const op = Math.floor(r() * 5);
    if (op === 0) s = s.slice(0, i) + s.slice(i + len);
    else if (op === 1) s = s.slice(0, i) + JUNK[Math.floor(r() * JUNK.length)] + s.slice(i);
    else if (op === 2) s = s.slice(0, i) + s.slice(i, i + len) + s.slice(i);
    else if (op === 3) s = s.slice(0, Math.max(10, i));
    else s = s.slice(0, i) + s.charAt(i + 1) + s.charAt(i) + s.slice(i + 2);
  }
  return s;
}

// alles Erzeugte prüfen: Tags, Attribute, Textknoten ohne Steuer-/Bidi-/Zero-Width-Zeichen
function checkDom(created, label) {
  for (const n of created) {
    expect(TAGS.has(n.tagName), label + ": Tag " + n.tagName).toBe(true);
    for (const [k, v] of Object.entries(n.attributes)) {
      expect(BAD_ATTR.test(k), label + ": Attribut " + k).toBe(false);
      if (k === "src") expect(SRC_OK.test(v) || /^maps\/forever\/(de|en)\/\d+\.webp$/.test(v), label + ": src " + v).toBe(true);
      STRIP.lastIndex = 0;
      expect(STRIP.test(v), label + ": Steuerzeichen in " + k).toBe(false);
    }
    for (const c of n.childNodes) {
      if (c.nodeType !== 3) continue;
      STRIP.lastIndex = 0;
      expect(STRIP.test(c.data), label + ": Steuerzeichen im Text " + JSON.stringify(c.data.slice(0, 40))).toBe(false);
    }
  }
}

// ganze Kette für einen Dateitext; -> "loaded" | Fehlercode
async function runChain(text, label) {
  const { doc, win } = fakeEnv({ language: "de-DE" });
  let opened;
  try {
    opened = await loadSvFile(makeFile("InkAndEmbers.lua", text));
  } catch (e) {
    expect(e, label).toBeInstanceOf(LoadError);
    expect(LOAD_CODES.has(e.code), label + ": " + e.code).toBe(true);
    expect(t("de", errorMessage(e).key)).not.toBe(errorMessage(e).key); // es gibt einen verständlichen Text
    return e.code;
  }
  for (const c of opened.characters.slice(0, 3)) {
    let journal;
    try {
      journal = buildJournal(opened.db, c.guid);
    } catch (e) {
      expect(e && e.name, label + " buildJournal").toBe("ExportError");
      continue;
    }
    const char = opened.db.chars[c.guid];
    parseLog(char);
    prepareJourney(journal, char);
    renderChroniclePanel(doc, { db: opened.db, guid: c.guid, journal, lang: "de" });
    const view = createJourneyView(doc, win, { journal, char, lang: "de" });
    view.setLang("en");
    view.destroy();
    for (const anonymize of [false, true]) await buildPrintBook(doc, win, { db: opened.db, guid: c.guid, journal, char, lang: "de", anonymize });
  }
  checkDom(doc.created, label);
  return "loaded";
}

describe("Fuzz: verstümmelte SV-Dateien", () => {
  for (const [name, base] of Object.entries(BASES)) {
    it(name + ": 40 zufällige Verstümmelungen stürzen nicht ab und zeigen nur Text", async () => {
      const r = rng(name.length * 7919 + 13);
      const seen = new Set();
      for (let i = 0; i < 40; i++) seen.add(await runChain(mutate(base, r), name + "#" + i));
      expect(seen.size).toBeGreaterThan(0);
    }, 60000);
  }
});

describe("Fuzz: Größe, Tiefe, Zeilen", () => {
  it("über 50 MB wird ohne Lesen abgewiesen", async () => {
    const f = makeFile("InkAndEmbers.lua", "", { size: MAX_FILE_BYTES + 1 });
    await expect(loadSvFile(f)).rejects.toMatchObject({ code: "tooBig" });
    expect(f.reads).toBe(0);
  });

  it("tief verschachtelte Tabellen enden mit einer Meldung, nicht mit einem Stapelüberlauf", async () => {
    for (const depth of [150, 5000, 100000]) {
      const text = "EveNChronicleDB = " + "{".repeat(depth) + "}".repeat(depth) + "\n";
      expect(await runChain(text, "Tiefe " + depth)).toBe("notLua");
    }
    const keyed = "EveNChronicleDB = " + '{["a"]='.repeat(3000) + "1" + "}".repeat(3000);
    expect(await runChain(keyed, "Tiefe Schlüssel")).toBe("notLua");
  });

  it("viele Zeilen und eine riesige Spur laufen durch (Obergrenzen greifen)", async () => {
    const lines = ["0~L~1~1.15.8~61000~16001~deDE~3600"];
    for (let i = 1; i < 60000; i++) lines.push(i + "~" + (i % 3 === 0 ? "KI~299~Junger Wolf~1~2~3" : i % 3 === 1 ? "XP~10~kill" : "SZ~1429~Ort " + (i % 50) + "~1"));
    const blocks = [];
    for (let b = 0; b < 300; b++) {
      const pts = [];
      for (let i = 0; i < 500; i++) pts.push(i + "~" + ((b * 37 + i * 13) % 9999) + "~" + ((b * 53 + i * 7) % 9999));
      blocks.push("#~" + (1793000000 + b * 1000) + "~1429\\n" + pts.join("\\n"));
    }
    const text = 'EveNChronicleDB = {["schema"]=1,["chars"]={["Player-1-0000BIG"]={["info"]={["name"]="Riese",["lastSeen"]=1793400000},["log"]={"#~1793000000~1\\n'
      + lines.join("\\n") + '"},["trail"]={' + blocks.map((b) => '"' + b + '"').join(",") + "}}}}\n";
    expect(text.length).toBeGreaterThan(2_000_000);
    const t0 = Date.now();
    expect(await runChain(text, "riesig")).toBe("loaded");
    expect(Date.now() - t0).toBeLessThan(45000);
  }, 60000);

  it("Millionen Leerzeilen und eine endlose Zeichenkette ergeben eine Meldung", async () => {
    expect(await runChain("\n".repeat(1_000_000), "Leerzeilen")).toMatch(/^(empty|notLua|noData)$/);
    expect(await runChain('EveNChronicleDB = "' + "x".repeat(3_000_000), "offene Zeichenkette")).toBe("notLua");
  });
});

describe("XSS: Bidi-/Zero-Width-Namen und Prototyp-Kürzel", () => {
  const evilName = "\u202eAdmin\u200b\u2066<script>alert(1)</script>\u061c\u180e\u206a" + String.fromCodePoint(0xe0041) + "\ufeff";
  const luaEsc = (s) => [...s].map((ch) => (ch.codePointAt(0) > 126 ? "\\u{" + ch.codePointAt(0).toString(16) + "}" : ch === '"' ? '\\"' : ch)).join("");
  const proto = ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf", "prototype"];
  const logLines = ["0~L~1~1.15.8~61000~16001~deDE~3600", "1~ZN~1429~3~1429~1415~1~4117~5241"];
  proto.forEach((p, i) => logLines.push(10 + i + "~" + p + "~" + p + "~" + p, 20 + i + "~KI~" + p + "~" + p + "~1~2~" + p, 30 + i + "~GI~2~" + p + ":" + p + ":5," + luaEsc(evilName) + ":MAGE:7"));
  logLines.push("40~DU~" + luaEsc(evilName) + "~win~5~1429", "41~LG~2589~1~9~" + luaEsc(evilName) + "~MAGE~need", "42~LT~constructor~1~99~mob~~5", "43~DE~5~1429~4000~4000~" + luaEsc(evilName));
  const text = "EveNChronicleDB = {\n" + '["schema"]=1,["locale"]="deDE",["chars"]={\n'
    + '["Player-1-0000XSS"]={["info"]={["name"]="' + luaEsc(evilName) + '",["realm"]="' + luaEsc(evilName) + '",["class"]="__proto__",["classFile"]="constructor",["race"]="toString",["raceFile"]="__proto__",["lastSeen"]=1793100000,["firstSeen"]=1793000000},'
    + '["log"]={"#~1793000000~1\\n' + logLines.join("\\n") + '"},'
    + '["trail"]={"#~1793000000~1429\\n0~4000~4000\\n10~4100~4100~constructor\\n20~4200~4200~d","#~1793000100~__proto__\\n0~1~1"},'
    + '["counters"]={["mates"]={["__proto__"]=1,["constructor"]=2}},'
    + '["snapshots"]={["items"]={["constructor"]={["name"]="x"},["2589"]={["name"]="' + luaEsc(evilName) + '",["quality"]=99}},["maps"]={["__proto__"]={["name"]="' + luaEsc(evilName) + '"}}},'
    + '["npcs"]={["__proto__"]="' + luaEsc(evilName) + '"}},'
    + '["__proto__"]={["info"]={["name"]="__proto__",["lastSeen"]=1}}}}\n';

  it("die ganze Kette zeigt alles nur als Text, ohne Steuerzeichen und ohne Prototyp-Verschmutzung", async () => {
    expect(await runChain(text, "xss")).toBe("loaded");
    expect({}.polluted).toBeUndefined();
    expect(Object.prototype.toString.call({})).toBe("[object Object]");
  });

  it("die Seite: Name im Kopf ohne Bidi-Zeichen, Skript-Tag nur als Text, Druck und Lizenzen ohne Absturz", async () => {
    const env = fakeEnv({ language: "de-DE" });
    env.win.print = () => {};
    const app = startApp(env.doc, env.win);
    await app.loadFile(makeFile("InkAndEmbers.lua", text));
    expect(app.state.error).toBeNull();
    const name = findAll(env.appRoot, (n) => n.className === "journal-name")[0];
    expect(name.textContent).toContain("<script>alert(1)</script>");
    expect(findAll(env.appRoot, (n) => n.tagName === "SCRIPT")).toHaveLength(0);
    findAll(env.appRoot, (n) => n.className.split(" ").includes("tab-btn"))[1].click();
    await app.startPrint();
    app.showPage("licenses");
    checkDom(env.doc.created, "Seite");
  });
});
