// Chronik-Ansicht: Aufbau, Zweisprachigkeit, Lazy-Bereiche, "Mehr anzeigen", Sicherheit (XSS-Fall, nur erlaubte Elemente/Attribute)
// und Einbindung in die App (Reiter "Chronik").
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { fakeEnv, findAll, makeFile } from "./helpers/fake-dom.mjs";
import { model, thanenOpts, L, T0 } from "./helpers/chronik-sv.mjs";
import { renderChronicle, PAGE_STEP } from "../src/chronik/view.mjs";
import { renderChroniclePanel } from "../src/chronik/index.mjs";
import { CHRONIK_TEXTS, ct, hasCt } from "../src/chronik/texts.mjs";
import { MEDAL_TEXTS, DIFFICULTY } from "../src/chronik/medal-texts.mjs";
import { startApp } from "../src/ui/app.mjs";

const SAMPLE = readFileSync(fileURLToPath(new URL("./fixtures/journal-export-sample.lua", import.meta.url)), "utf8");
const ROOT = fileURLToPath(new URL("..", import.meta.url));

const ALLOWED_TAGS = new Set(["DIV", "SECTION", "H1", "H2", "H3", "H4", "P", "SPAN", "BUTTON", "UL", "OL", "LI", "DL", "DT", "DD", "DETAILS", "SUMMARY", "NAV", "ARTICLE", "ASIDE", "HEADER", "STRONG", "HR", "IMG", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD"]);
const ALLOWED_ATTRS = new Set(["lang", "type", "role", "aria-label", "data-pct", "data-section", "data-target", "open", "aria-current", "aria-expanded", "aria-controls", "id", "colspan", "scope", "data-label", "src", "alt", "width", "height", "decoding"]);
// Bilder nur aus public/img/ mit festem Namen (Addon-Kunst), nie aus Dateidaten
const IMG_SRC = /^img\/(seal-([1-9]|[12]\d|3[0-5])|ring-(bronze|silver|gold|legendary)|portrait-(human|dwarf|nightelf|gnome|orc|undead|tauren|troll|skyborne)|emblem-(boss|elite|normal)|map-(level|milestone|death|boss|rare|photo|hearth|current))\.webp$/;
const FORBIDDEN_CHARS = ["‮", "‪", "‭", "​", "⁦", "⁩", " "];

const hasCls = (n, c) => n.className.split(" ").includes(c);
const byClass = (root, c) => findAll(root, (n) => hasCls(n, c));

function render(opts, lang = "de") {
  const env = fakeEnv({ language: lang });
  const { db, journal, m } = model(opts);
  const view = renderChronicle(env.doc, { model: m, journal, lang });
  return { ...env, view, m, db, journal };
}

describe("Aufbau der Ansicht", () => {
  const thanen = thanenOpts();
  const { view } = render(thanen);

  it("hat Sprungleiste und Buch mit Steckbrief, Medaillen, Stufenfluss, Dungeons, Tode, Bilanz, Kapitel", () => {
    const keys = findAll(view, (n) => n.attributes["data-section"]).map((n) => n.attributes["data-section"]);
    expect(keys).toEqual(["profile", "medals", "flow", "dungeons", "deaths"]);
    expect(byClass(view, "stats-page")).toHaveLength(1);
    expect(byClass(view, "chapter").length).toBeGreaterThan(0);
    const nav = byClass(view, "chron-nav-btn").map((b) => b.textContent);
    expect(nav.slice(0, 7)).toEqual(["Steckbrief", "Medaillen", "Stufenfluss", "Dungeons", "Tode", "Bilanz", "Kapitel"]);
    expect(byClass(view, "chron-nav")[0].attributes["aria-label"]).toBe("Springe zu");
    expect(hasCls(byClass(view, "chron-nav")[0], "no-print")).toBe(true);
  });

  it("Steckbrief zeigt Name, Volk/Klasse, Stufe, Realm, Spielzeit und unterwegs seit", () => {
    const p = byClass(view, "prof-page")[0];
    const text = p.textContent;
    for (const s of ["Testa", "Mensch · Paladin", "Probenwacht", "Unterwegs seit", "Spielzeit", "Stufe"]) expect(text).toContain(s);
  });

  it("Medaillen: alle 35 Karten in 9 Familien, verdiente mit Stufe, offene mit Voraussetzung", () => {
    expect(byClass(view, "medal-card")).toHaveLength(35); // ohne Client-Kennung (keine L-Zeile) bleibt „Um Haaresbreite“ sichtbar
    expect(byClass(view, "medal-family")).toHaveLength(9);
    const cards = byClass(view, "medal-card");
    const open = cards.find((c) => c.textContent.includes("Weltenbummler"));
    expect(open.textContent).toContain("Verschiedene Gebiete betreten.");
    expect(open.textContent).toContain("Bronze · 6 Gebiete");
    expect(hasCls(open, "locked")).toBe(true);
    expect(byClass(view, "medal-count")[0].textContent).toMatch(/^\d+ von 35 Medaillen · \d+ von 93 Stufen$/);
    // Medaillenbild: Motiv aus dem Katalog + Ring; offene Medaille mit dem Ring der ersten Stufe
    const imgs = findAll(open, (n) => n.tagName === "IMG").map((n) => n.attributes.src);
    expect(imgs).toEqual(["img/seal-1.webp", "img/ring-bronze.webp"]);
    expect(byClass(open, "medal-bar-fill")[0].attributes["data-pct"]).toBeDefined();
  });

  it("Stufenfluss: eine Zeile je Stufe, Balken mit Prozentbreite (data-pct), Tode als Punkte", () => {
    const rows = byClass(view, "flow-row");
    expect(rows.length).toBeGreaterThan(0);
    const widths = byClass(view, "flow-bar").map((b) => Number(b.attributes["data-pct"]));
    expect(widths.length).toBeGreaterThan(0);
    for (const w of widths) expect(w).toBeGreaterThan(0), expect(w).toBeLessThanOrEqual(100);
    expect(Math.max(...widths)).toBe(100);
  });

  it("Dungeons: der Lauf mit Name, Schwierigkeit, Bossen, Tode, Gruppe, Funden und Quests", () => {
    const run = byClass(view, "dg-run")[0];
    const text = run.textContent;
    for (const s of ["Die Halle der Thanen", "Normal", "4 Bosse besiegt", "3 Tode", "Faldrim Anvilmar", "1 Fehlversuch", "Alma-Testrealm", "Hexenmeister", "Golembrustschutz", "Faldrims Ende", "Tiefe Funde", "Plünderer der Dunkeleisenzwerge"]) {
      expect(text, s).toContain(s);
    }
    expect(text).not.toContain("Carl-");
    expect(hasCls(byClass(run, "dg-badge").find((b) => b.textContent === "3 Tode"), "red")).toBe(true);
    // echte Tabelle mit Kopf, Emblem und beschrifteten Zellen
    expect(run.tagName).toBe("TBODY");
    const table = findAll(view, (n) => n.tagName === "TABLE")[0];
    expect(findAll(table, (n) => n.tagName === "TH").map((n) => n.textContent)).toEqual(["Dungeon", "Stufe", "Dauer", "Bosse", "Tode", "Datum"]);
    expect(byClass(run, "dg-emblem")[0].attributes.src).toBe("img/emblem-boss.webp");
    expect(findAll(run, (n) => n.attributes["data-label"] === "Bosse")[0].textContent).toBe("4");
  });

  it("Tode: Liste mit Ort und Ursache, neueste zuerst", () => {
    const rows = byClass(view, "death-row");
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain("Gefallen durch Plünderer der Dunkeleisenzwerge");
    expect(rows[0].textContent).toContain("Der Dunkeleisenvorstoß");
    expect(rows[2].textContent).toContain("Die Halle der Thanen");
  });

  it("englische Ansicht: Beschriftungen und Medaillen-Namen auf Englisch", () => {
    const { view: en } = render(thanen, "en");
    const t = en.textContent;
    for (const s of ["Character sheet", "Medals of the journey", "Level flow", "Experience sources", "Globetrotter", "Hall of ", "4 bosses defeated", "No tier yet (0 of 3)"]) {
      if (s === "Hall of ") continue; // der Dungeon-Name steht in der Datei (deutsch) und wird nicht übersetzt
      expect(t, s).toContain(s);
    }
    expect(t).toContain("Die Halle der Thanen");
    expect(byClass(en, "chron-nav-btn")[0].textContent).toBe("Character sheet");
  });
});

describe("Leere Zustände", () => {
  it("Datei ohne Dungeon, Tode und Quellen zeigt Hinweise statt leerer Flächen", () => {
    const { view } = render({ lines: [L(0, "L", 1, "x", 1, 16001, "deDE", 3600)] });
    const t = view.textContent;
    expect(t).toContain("Noch kein Dungeon besucht.");
    expect(t).toContain("Noch nie gestorben.");
    expect(t).toContain("Noch keine Erfahrung festgehalten.");
    expect(t).toContain("Noch keine Stufe abgeschlossen.");
  });
});

describe("Lazy und Mehr anzeigen", () => {
  it("nur der erste Lauf ist aufgeklappt gebaut; die anderen bauen ihren Rumpf beim Aufklappen", () => {
    const lines = [];
    for (let i = 0; i < 3; i++) lines.push(L(i * 10000, "IE", 3065, "party", 1, 5, 20, 1, "", "", 0), L(i * 10000 + 600, "IL", 3065, 600, 4, 0, 0, 0));
    const { view } = render({ lines, sessions: [{ start: T0 - 10, stop: T0 + 90000 }], snapshots: { instances: { 3065: { name: "Kalte Halle" } } } });
    const runs = byClass(view, "dg-run");
    expect(runs).toHaveLength(3);
    expect(byClass(runs[0], "dg-body")).toHaveLength(1);
    expect(byClass(runs[0], "dg-toggle")[0].attributes["aria-expanded"]).toBe("true");
    expect(byClass(runs[1], "dg-body")).toHaveLength(0);
    const toggle = byClass(runs[1], "dg-toggle")[0];
    expect(toggle.attributes["aria-expanded"]).toBe("false");
    toggle.click();
    expect(toggle.attributes["aria-expanded"]).toBe("true");
    toggle.click();
    expect(toggle.attributes["aria-expanded"]).toBe("false");
    expect(byClass(runs[1], "dg-body")).toHaveLength(1);
    expect(runs[1].textContent).toContain("Kalte Halle");
  });

  it("viele Tode: erst eine Seite, dann Schaltfläche 'Mehr anzeigen' mit Restzahl", () => {
    const lines = Array.from({ length: 30 }, (_, i) => L(10 + i * 10, "DE", 5, 1429));
    const { view } = render({ lines });
    expect(byClass(view, "death-row")).toHaveLength(PAGE_STEP);
    const btn = byClass(view, "chron-more")[0];
    expect(btn.textContent).toBe("Mehr anzeigen (18 weitere)");
    expect(btn.tagName).toBe("BUTTON");
    btn.click();
    expect(byClass(view, "death-row")).toHaveLength(PAGE_STEP * 2);
    byClass(view, "chron-more")[0].click();
    expect(byClass(view, "death-row")).toHaveLength(30);
    expect(byClass(view, "chron-more")).toHaveLength(0);
  });

  it("die Sprungleiste springt per scrollIntoView, wenn der Browser es kann, und bricht sonst nicht ab", () => {
    const { view } = render({ lines: [L(0, "L", 1, "x", 1, 16001, "deDE", 3600)] });
    const target = findAll(view, (n) => n.attributes["data-section"] === "medals")[0];
    let called = null;
    target.scrollIntoView = (o) => (called = o);
    byClass(view, "chron-nav-btn").find((b) => b.attributes["data-target"] === "medals").click();
    expect(called).toMatchObject({ block: "start" });
    byClass(view, "chron-nav-btn")[3].click(); // ohne scrollIntoView: nichts passiert
  });
});

describe("Sicherheit (Schadtext in allen angezeigten Feldern)", () => {
  const EVIL = "<script>alert(1)</script>‮​⁦X⁩";
  const rename = (s) => s.replace(/Alma/g, "Alma" + EVIL).replace(/Faldrim Anvilmar/g, EVIL).replace(/Die Halle der Thanen/g, EVIL + "Halle").replace(/Golembrustschutz/g, "<img src=x onerror=alert(2)>").replace(/Magmatus/g, "__proto__").replace(/Faldrims Ende/g, EVIL).replace(/Der Dunkeleisenvorstoß/g, "<b>Ort</b>‮");
  const { view, m } = render(thanenOpts(rename));
  const env = fakeEnv();

  it("zeigt den Text als Text: keine Skript-/Bild-/Link-Elemente, nur erlaubte Elemente und Attribute", () => {
    const all = findAll(view, () => true);
    expect(all.length).toBeGreaterThan(300);
    for (const n of all) {
      expect(ALLOWED_TAGS.has(n.tagName), n.tagName).toBe(true);
      for (const k of Object.keys(n.attributes)) expect(ALLOWED_ATTRS.has(k), k).toBe(true);
    }
    expect(findAll(view, (n) => ["SCRIPT", "IFRAME", "A", "STYLE"].includes(n.tagName))).toHaveLength(0);
    const imgs = findAll(view, (n) => n.tagName === "IMG");
    expect(imgs.length).toBeGreaterThan(30);
    for (const n of imgs) {
      expect(n.attributes.src, n.attributes.src).toMatch(IMG_SRC);
      expect(n.attributes.alt).toBe("");
    }
    const text = view.textContent;
    expect(text).toContain("<script>alert(1)</script>");
    expect(text).toContain("<img src=x onerror=alert(2)>");
    expect(text).toContain("<b>Ort</b>");
    for (const bad of FORBIDDEN_CHARS) expect(text.includes(bad), bad.codePointAt(0).toString(16)).toBe(false);
    void env;
  });

  it("legt keine style-Attribute an und setzt Breiten nur über data-pct/CSSOM", () => {
    for (const n of findAll(view, () => true)) expect(Object.keys(n.attributes)).not.toContain("style");
  });

  it("das Modell behält den Rohtext (Bereinigung geschieht erst bei der Anzeige)", () => {
    expect(m.dungeons.runs[0].name).toContain("<script>");
  });

  it("kein Quelltext in src/chronik benutzt HTML-Zeichenketten oder Code-Auswertung", () => {
    const dir = join(ROOT, "src", "chronik");
    const files = readdirSync(dir).filter((f) => f.endsWith(".mjs") && statSync(join(dir, f)).isFile());
    const forbidden = /\b(innerHTML|outerHTML|insertAdjacentHTML|createContextualFragment|srcdoc)\b|document\s*\.\s*write|\beval\s*\(|new\s+Function|\bfetch\s*\(|console\./;
    for (const f of files) expect(forbidden.test(readFileSync(join(dir, f), "utf8")), f).toBe(false);
  });
});

describe("Fehler in der Ansicht", () => {
  it("ein Fehler beim Aufbau wird zum verständlichen Hinweis (role=alert), ohne Stacktrace", () => {
    const env = fakeEnv();
    const { db, journal } = model({ lines: [L(0, "L", 1, "x", 1, 16001, "deDE", 3600)] });
    const node = renderChroniclePanel(env.doc, { db, guid: "gibtsnicht", journal: { ...journal }, lang: "de" });
    expect(node.attributes.role).toBe("alert");
    expect(node.textContent).toContain("Die Chronik konnte aus dieser Datei nicht aufgebaut werden");
    expect(node.textContent).not.toMatch(/TypeError|at .*\.mjs/);
  });
});

describe("Texte", () => {
  const keys = (o) => Object.keys(o).sort();
  const slots = (s) => (s.match(/\{\d+\}/g) || []).sort().join(",");

  it("Deutsch und Englisch haben dieselben Schlüssel und Platzhalter (Ansicht, Medaillen, Schwierigkeitsgrade)", () => {
    for (const [de, en] of [[CHRONIK_TEXTS.de, CHRONIK_TEXTS.en], [MEDAL_TEXTS.de, MEDAL_TEXTS.en]]) {
      expect(keys(de)).toEqual(keys(en));
      for (const k of keys(de)) expect(slots(de[k]), k).toBe(slots(en[k]));
    }
    expect(keys(DIFFICULTY.de)).toEqual(keys(DIFFICULTY.en));
  });

  it("jeder in der Ansicht benutzte Schlüssel existiert in beiden Sprachen", () => {
    const src = readFileSync(join(ROOT, "src", "chronik", "view.mjs"), "utf8");
    // Schlüssel mit berechnetem Ende ("u_" + id, "title_" + id ...) sind unten je Medaille geprüft
    const used = new Set([...src.matchAll(/\bctn?\(lang, "([A-Za-z_.]+)"(?!\s*\+)/g)].map((x) => x[1]).filter((k) => !/[_.]$/.test(k)));
    expect(used.size).toBeGreaterThan(60);
    for (const k of used) {
      for (const lang of ["de", "en"]) {
        // Mehrzahl-Schlüssel stehen als <k>_one/_other
        const ok = [k, k + "_one", k + "_other"].some((kk) => hasCt(lang, kk));
        expect(ok, k + "/" + lang).toBe(true);
      }
    }
  });

  it("jede Medaille hat Titel, Voraussetzung (und Einheit bei gestuften) in beiden Sprachen", () => {
    const { m } = model({ lines: [L(0, "L", 1, "x", 1, 16001, "deDE", 3600)] });
    for (const e of m.medals.list) {
      for (const lang of ["de", "en"]) {
        expect(ct(lang, "title_" + e.id), e.id).not.toBe("title_" + e.id);
        expect(ct(lang, "need_" + e.id), e.id).not.toBe("need_" + e.id);
        if (e.stepped && e.unit === "count") expect(ct(lang, "u_" + e.id + "_other", 5), e.id).not.toBe("u_" + e.id + "_other");
      }
    }
  });
});

describe("Einbindung in die App", () => {
  async function boot(lang = "de-DE") {
    const env = fakeEnv({ language: lang });
    const app = startApp(env.doc, env.win);
    await app.loadFile(makeFile("InkAndEmbers.lua", SAMPLE));
    return { ...env, app };
  }

  it("der Reiter 'Chronik & Statistik' zeigt die Ansicht, Reise ist die Reise-Ansicht; die Sprache wirkt auf die Ansicht", async () => {
    const { app, appRoot } = await boot();
    expect(byClass(appRoot, "chron-book")).toHaveLength(0);
    findAll(appRoot, (n) => hasCls(n, "tab-btn"))[1].click();
    expect(app.state.view).toBe("chronicle");
    expect(byClass(appRoot, "chron-book")).toHaveLength(1);
    expect(byClass(appRoot, "prof-name")[0].textContent).toBe("Mirela");
    expect(byClass(appRoot, "medal-card")).toHaveLength(34); // Forever-Datei: „Um Haaresbreite“ verborgen wie im Addon
    findAll(appRoot, (n) => hasCls(n, "lang-btn"))[1].click();
    expect(byClass(appRoot, "chron-nav-btn")[0].textContent).toBe("Character sheet");
    findAll(appRoot, (n) => hasCls(n, "tab-btn"))[0].click();
    expect(byClass(appRoot, "chron-book")).toHaveLength(0);
    expect(byClass(appRoot, "journey-panel")).toHaveLength(1);
  });

  it("wechselt den Charakter und die Ansicht folgt", async () => {
    const env = fakeEnv();
    const app = startApp(env.doc, env.win);
    await app.loadFile(makeFile("InkAndEmbers.lua", readFileSync(join(ROOT, "tests", "fixtures", "xss.lua"), "utf8")));
    findAll(env.appRoot, (n) => hasCls(n, "tab-btn"))[1].click();
    expect(byClass(env.appRoot, "prof-name")).toHaveLength(1);
    const first = byClass(env.appRoot, "prof-name")[0].textContent;
    const sel = byClass(env.appRoot, "char-select")[0];
    const other = findAll(sel, (n) => n.tagName === "OPTION").find((o) => !o.selected);
    sel.value = other.value;
    sel.dispatch("change", {});
    expect(byClass(env.appRoot, "prof-name")[0].textContent).not.toBe(first);
  });
});
