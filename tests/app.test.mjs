// Seite: Laden, Charakterwahl, Sprache, Fehleranzeige und der XSS-Fall (Fremdtext nur als Text)
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startApp } from "../src/ui/app.mjs";
import { fakeEnv, findAll, makeFile, tick } from "./helpers/fake-dom.mjs";

const fixture = (n) => readFileSync(fileURLToPath(new URL("./fixtures/" + n, import.meta.url)), "utf8");
const SAMPLE = fixture("journal-export-sample.lua");
const XSS = fixture("xss.lua");

const ALLOWED_TAGS = new Set(["DIV", "SECTION", "HEADER", "FOOTER", "MAIN", "H1", "H2", "P", "SPAN", "BUTTON", "SELECT", "OPTION", "INPUT", "BODY", "HTML"]);
const ALLOWED_ATTRS = new Set(["lang", "type", "role", "aria-label", "aria-pressed", "aria-hidden", "accept", "tabindex"]);

function boot(opts) {
  const env = fakeEnv(opts);
  const app = startApp(env.doc, env.win);
  return { ...env, app };
}

const byClass = (root, cls) => findAll(root, (n) => n.className.split(" ").includes(cls));

describe("Seite", () => {
  it("zeigt zuerst die Ablegefläche, Fußzeile mit Blizzard-Hinweis und die Sprache des Browsers", () => {
    const en = boot({ language: "en-US" });
    expect(en.doc.documentElement.attributes.lang).toBe("en");
    expect(en.appRoot.textContent).toContain("Drop");
    const de = boot({ language: "de-DE" });
    expect(de.doc.documentElement.attributes.lang).toBe("de");
    expect(byClass(de.appRoot, "dropzone")).toHaveLength(1);
    expect(byClass(de.appRoot, "site-footer")[0].textContent).toContain("Fanprojekt, nicht mit Blizzard Entertainment verbunden");
    expect(byClass(en.appRoot, "site-footer")[0].textContent).toContain("not affiliated with Blizzard Entertainment");
  });

  it("lädt die Datei und zeigt den zuletzt gespielten Charakter mit dem Platzhalter für die Reise und der Chronik", async () => {
    const { app, appRoot, doc } = boot({ language: "de-DE" });
    await app.loadFile(makeFile("InkAndEmbers.lua", SAMPLE));
    expect(app.state.error).toBeNull();
    expect(app.state.guid).toBe(app.state.file.characters[0].guid);
    expect(byClass(appRoot, "journal-name")[0].textContent).toBe("Mirela");
    expect(byClass(appRoot, "dropzone")).toHaveLength(0);
    expect(byClass(appRoot, "placeholder")[0].textContent).toContain("Die Reise");
    findAll(appRoot, (n) => n.className.split(" ").includes("tab-btn"))[1].click();
    expect(byClass(appRoot, "chron-book")).toHaveLength(1); // Chronik & Statistik (src/chronik)
    expect(byClass(appRoot, "placeholder")).toHaveLength(0);
    expect(doc.title).toContain("Mirela");
  });

  it("schaltet die Sprache um und merkt sie sich (nur de/en)", async () => {
    const { app, appRoot, doc, store } = boot({ language: "de-DE" });
    await app.loadFile(makeFile("InkAndEmbers.lua", SAMPLE));
    const enBtn = findAll(appRoot, (n) => n.className.split(" ").includes("lang-btn"))[1];
    enBtn.click();
    expect(app.state.lang).toBe("en");
    expect(doc.documentElement.attributes.lang).toBe("en");
    expect(byClass(appRoot, "tab-btn")[0].textContent).toBe("Journey");
    expect(store.get("iae-lang")).toBe("en");
    // eine gespeicherte Sprache gewinnt gegen Browser und Datei
    const again = boot({ language: "de-DE", stored: { "iae-lang": "en" } });
    await again.app.loadFile(makeFile("InkAndEmbers.lua", SAMPLE));
    expect(again.app.state.lang).toBe("en");
  });

  it("nimmt ohne Wahl die Sprache aus der Datei", async () => {
    const { app } = boot({ language: "en-US" });
    await app.loadFile(makeFile("InkAndEmbers.lua", SAMPLE));
    expect(app.state.lang).toBe("de");
  });

  it("wechselt den Charakter über das Auswahlfeld", async () => {
    const { app, appRoot } = boot();
    await app.loadFile(makeFile("InkAndEmbers.lua", XSS));
    const sel = byClass(appRoot, "char-select")[0];
    const options = findAll(sel, (n) => n.tagName === "OPTION");
    expect(options).toHaveLength(2);
    const other = options.find((o) => !o.selected);
    sel.value = other.value;
    sel.dispatch("change", {});
    expect(app.state.guid).toBe(other.value);
    expect(byClass(appRoot, "journal-name")).toHaveLength(1);
  });

  it("zeigt Fehler als Hinweis mit role=alert und behält die geladene Datei", async () => {
    const { app, appRoot } = boot({ language: "de-DE" });
    await app.loadFile(makeFile("InkAndEmbers.lua", SAMPLE));
    await app.loadFile(makeFile("notizen.txt", "hallo"));
    const alert = byClass(appRoot, "alert")[0];
    expect(alert.attributes.role).toBe("alert");
    expect(alert.textContent).toContain("keine .lua-Datei");
    expect(byClass(appRoot, "journal-name")).toHaveLength(1);
  });

  it("zeigt bei falscher Datei als Erstes die Ablegefläche mit Fehler", async () => {
    const { app, appRoot } = boot({ language: "en-US" });
    await app.loadFile(makeFile("InkAndEmbers.lua", "SomethingElse = {}"));
    expect(byClass(appRoot, "alert")[0].textContent).toContain("Embers");
    expect(byClass(appRoot, "dropzone")).toHaveLength(1);
  });

  it("verarbeitet Ablegen: Ordner -> Fehler, mehrere Dateien -> Hinweis, nur die letzte Auswahl zählt", async () => {
    const { app, appRoot, win } = boot({ language: "de-DE" });
    const dropEvent = (dt) => ({ preventDefault() {}, dataTransfer: dt });
    win.dispatch("drop", dropEvent({ files: [{ name: "Ordner" }], items: [{ kind: "file", webkitGetAsEntry: () => ({ isDirectory: true }) }] }));
    expect(byClass(appRoot, "alert")[0].textContent).toContain("Ordner");
    win.dispatch("drop", dropEvent({ files: [makeFile("a.txt", "x"), makeFile("InkAndEmbers.lua", SAMPLE)], items: [] }));
    await tick();
    await tick();
    expect(app.state.error).toBeNull();
    expect(byClass(appRoot, "notice")[0].textContent).toContain("2 Dateien");
    expect(byClass(appRoot, "journal-name")[0].textContent).toBe("Mirela");
  });

  it("verwirft das Ergebnis einer überholten Auswahl", async () => {
    const { app } = boot();
    let release;
    const slow = { name: "InkAndEmbers.lua", type: "", size: 100, text: () => new Promise((r) => { release = () => r(SAMPLE); }) };
    const first = app.loadFile(slow);
    await app.loadFile(makeFile("InkAndEmbers.lua", XSS));
    release();
    await first;
    expect(app.state.file.characters.some((c) => c.name === "Mirela")).toBe(false);
  });
});

describe("Sicherheit der Anzeige (XSS-Fixture)", () => {
  it("zeigt Schadtext nur als Text: keine Skript-/Bild-Elemente, keine Attribute aus Dateidaten", async () => {
    const { app, appRoot, doc } = boot({ language: "de-DE" });
    await app.loadFile(makeFile("InkAndEmbers.lua", XSS));
    expect(app.state.error).toBeNull();
    for (const n of doc.created) expect(ALLOWED_TAGS.has(n.tagName), n.tagName).toBe(true);
    for (const n of doc.created) for (const k of Object.keys(n.attributes)) expect(ALLOWED_ATTRS.has(k), k).toBe(true);
    expect(findAll(appRoot, (n) => ["SCRIPT", "IMG", "IFRAME", "A"].includes(n.tagName))).toHaveLength(0);
    // der Text ist da, aber als Text (Zeichen erhalten), Bidi-/Zero-Width-Zeichen sind entfernt
    const name = byClass(appRoot, "journal-name")[0].textContent;
    expect(name).toContain("<script>alert(1)</script>");
    expect(name).toBe("<script>alert(1)</script>Malory");
    expect(appRoot.textContent).toContain("<img src=x onerror=\"alert(2)\">");
    const all = appRoot.textContent;
    for (const bad of ["\u202e", "\u200b", "\u2066", "\u2069"]) expect(all.includes(bad), bad.codePointAt(0).toString(16)).toBe(false);
  });

  it("legt über __proto__/constructor als Schlüssel keine Prototyp-Eigenschaften an", async () => {
    const { app } = boot();
    await app.loadFile(makeFile("InkAndEmbers.lua", XSS));
    expect(Object.getPrototypeOf(app.state.file.db.chars)).toBeNull();
    expect({}.polluted).toBeUndefined();
    expect(app.state.file.characters.map((c) => c.guid)).toContain("__proto__");
    expect(Object.getPrototypeOf(app.state.file.db.chars.__proto__)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, "info")).toBe(false);
  });

  it("zeigt den Dateinamen bereinigt (Bidi, Länge)", async () => {
    const { app, appRoot } = boot({ language: "de-DE" });
    const name = "evil\u202egnp." + "x".repeat(200) + ".lua";
    await app.loadFile(makeFile(name, SAMPLE));
    const shown = byClass(appRoot, "file-name")[0].textContent;
    expect(shown.includes("\u202e")).toBe(false);
    expect(shown.length).toBeLessThan(120);
  });
});
