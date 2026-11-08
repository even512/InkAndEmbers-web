// Design-Einbau „Nah am Addon, entschlackt“: Reiter mit Bronze-Lesezeichen (Tastatur), Charakter-Kopf mit Volks-Porträt und
// Klassenfarbe, Fehler mit nächstem Schritt, Reise mit Kapitelnamen in der Sprache der Seite, Marker als Knöpfe mit Addon-Symbol,
// Kennzahlen, Legende; keine Caveat-Schrift mehr; alle Bilder der Seite liegen in public/img/.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { startApp } from "../src/ui/app.mjs";
import { createJourneyView, journeyStats, markerIcon, placeName } from "../src/ui/journey.mjs";
import { portraitId, portraitSrc, classColorClass, PORTRAITS, CLASS_FILES } from "../src/ui/identity.mjs";
import { zoneName, ZONE_NAMES } from "../src/geo/zone-names.mjs";
import { drawFrame } from "../src/map/renderer.mjs";
import { prepareMapScene } from "../src/map/scene.mjs";
import { openFile, buildJournal } from "../src/core/journal-model.mjs";
import { SEALS } from "../src/chronik/medals.mjs";
import { fakeEnv, findAll, makeFile } from "./helpers/fake-dom.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const fixture = (n) => readFileSync(join(ROOT, "tests", "fixtures", n), "utf8");
const TRAIL = fixture("trail-sample.lua");
const SAMPLE = fixture("journal-export-sample.lua");
// synthetische Spur mit Stufe, Tod und Entdeckung (Marker) in Elwynn
const MARKED = `EveNChronicleDB = {
["schema"] = 1, ["locale"] = "deDE",
["chars"] = { ["Player-0000-00000009"] = {
["info"] = { ["name"] = "Wegfinder", ["lastSeen"] = 1793002100 },
["log"] = { "#~1793000000~1\\n0~L~1~11500~70170~11500~deDE~0\\n0~PL~3600~60~5\\n8~LV~10~1429~4210~6490~Goldhain\\n10~DE~10~1429~4220~6480~0~1~Wald~~~1\\n12~EX~Turm~20~1429~6" },
["trail"] = { "#~1793000000~1429\\n0~4200~6500\\n5~4210~6490\\n10~4220~6480\\n15~4230~6470\\n200~4400~6400" },
} } }`;
const hasCls = (n, c) => typeof n.className === "string" && n.className.split(" ").includes(c);
const byClass = (root, c) => findAll(root, (n) => hasCls(n, c));

async function boot(text, language = "de-DE") {
  const env = fakeEnv({ language });
  const app = startApp(env.doc, env.win);
  await app.loadFile(makeFile("InkAndEmbers.lua", text));
  return { ...env, app };
}

function load(text) {
  const { db, characters } = openFile(text);
  const guid = characters[0].guid;
  return { journal: buildJournal(db, guid), char: db.chars[guid] };
}

// Aufzeichnender 2D-Kontext (nur Aufrufe)
function recordingCtx() {
  const calls = [];
  const ctx = new Proxy({ calls }, {
    get(target, k) {
      if (k in target) return target[k];
      if (k === "measureText") return (s) => ({ width: String(s).length * 7 });
      return (...a) => calls.push([k, ...a]);
    },
    set(target, k, v) {
      target[k] = v;
      return true;
    },
  });
  return ctx;
}

describe("Kopfleiste, Charakter-Kopf und Reiter", () => {
  it("Kopfleiste mit Buch-Symbol und Marke; Kopf mit Porträt, Name, Klasse in Klassenfarbe und beschriftetem Auswahlfeld", async () => {
    const { appRoot } = await boot(TRAIL);
    const brand = byClass(appRoot, "brand")[0];
    expect(findAll(brand, (n) => n.tagName === "IMG")[0].attributes.src).toBe("img/book-icon.webp");
    expect(brand.textContent).toBe("Ink & EmbersTagebuch im Browser");
    const hero = byClass(appRoot, "hero")[0];
    expect(byClass(hero, "portrait")[0].attributes.src).toBe("img/portrait-human.webp");
    expect(byClass(hero, "journal-name")[0].textContent).toBe("Wegfinder");
    const cls = byClass(hero, "cls")[0];
    expect(cls.textContent).toBe("Krieger");
    expect(hasCls(cls, "cls-WARRIOR")).toBe(true);
    const label = findAll(hero, (n) => n.tagName === "LABEL")[0];
    expect(label.textContent).toBe("Charakter");
    expect(label.attributes.for).toBe("char-select");
    const sel = byClass(hero, "char-select")[0];
    expect(sel.attributes.id).toBe("char-select");
    // Beschriftung vollständig, ohne Klasse (die steht schon im Kopf), nicht abgeschnitten
    expect(findAll(sel, (n) => n.tagName === "OPTION")[0].textContent).toBe("Wegfinder – Testreich");
  });

  it("Reiter sind eine tablist mit Bronzekappen; Pfeiltasten wechseln, nur der aktive ist per Tab erreichbar", async () => {
    const { appRoot, app } = await boot(TRAIL);
    const list = findAll(appRoot, (n) => n.attributes.role === "tablist")[0];
    const tabs = byClass(list, "tab-btn");
    expect(tabs.map((b) => b.attributes.role)).toEqual(["tab", "tab"]);
    expect(tabs.map((b) => b.attributes["aria-selected"])).toEqual(["true", "false"]);
    expect(tabs.map((b) => b.attributes.tabindex)).toEqual(["0", "-1"]);
    expect(tabs.map((b) => findAll(b, (n) => n.tagName === "IMG")[0].attributes.src)).toEqual(["img/tab-reise.webp", "img/tab-chronik.webp"]);
    const panel = byClass(appRoot, "view-panel")[0];
    expect(panel.attributes.role).toBe("tabpanel");
    expect(panel.attributes["aria-labelledby"]).toBe("tab-journey");
    tabs[0].dispatch("keydown", { key: "ArrowRight", preventDefault() {} });
    expect(app.state.view).toBe("chronicle");
    const again = byClass(appRoot, "tab-btn");
    expect(again[1].attributes["aria-selected"]).toBe("true");
    again[1].dispatch("keydown", { key: "Home", preventDefault() {} });
    expect(app.state.view).toBe("journey");
  });

  it("Fehler: role=alert mit Ursache und einem Knopf für den nächsten Schritt", async () => {
    const env = fakeEnv({ language: "de-DE" });
    const app = startApp(env.doc, env.win);
    await app.loadFile(makeFile("notizen.txt", "x"));
    const alert = byClass(env.appRoot, "alert")[0];
    expect(alert.attributes.role).toBe("alert");
    const btn = findAll(alert, (n) => n.tagName === "BUTTON")[0];
    expect(btn.textContent).toBe("Andere Datei wählen");
  });

  it("Einstieg ohne Datei: Ablegefläche mit Addon-Symbol und Datenschutz-Hinweis", () => {
    const env = fakeEnv({ language: "en-US" });
    startApp(env.doc, env.win);
    const drop = byClass(env.appRoot, "dropzone")[0];
    expect(findAll(drop, (n) => n.tagName === "IMG")).toHaveLength(1);
    expect(byClass(env.appRoot, "intro-title")[0].textContent).toBe("Your travel journal in the browser");
    expect(byClass(env.appRoot, "privacy")).toHaveLength(1);
  });
});

describe("Volks-Porträt und Klassenfarbe", () => {
  it("wählt das Porträt aus raceFile, Volksname oder Fraktion (wie das Addon), nie aus freiem Text", () => {
    expect(portraitId({ raceFile: "NightElf" })).toBe("nightelf");
    expect(portraitId({ raceFile: "Scourge" })).toBe("undead");
    expect(portraitId({ raceFile: "SkybornePeople" })).toBe("skyborne");
    expect(portraitId({ race: "Nachtelfe" })).toBe("nightelf");
    expect(portraitId({ race: "Untote" })).toBe("undead");
    expect(portraitId({ race: "Zwergin" })).toBe("dwarf");
    expect(portraitId({ race: "Blutelf", faction: "Horde" })).toBe("orc");
    expect(portraitId({ race: "<img src=x>" })).toBe("human");
    expect(portraitSrc("../../etc")).toBe("img/portrait-human.webp");
    for (const id of PORTRAITS) expect(existsSync(join(ROOT, "public", portraitSrc(id))), id).toBe(true);
  });

  it("Klassenfarbe nur für bekannte Klassen-Tokens", () => {
    expect(classColorClass("DRUID")).toBe("cls cls-DRUID");
    expect(classColorClass("druid")).toBe("cls cls-DRUID");
    expect(classColorClass("x onclick")).toBe("");
    expect(classColorClass(null)).toBe("");
    const css = readFileSync(join(ROOT, "src", "ui", "tokens.css"), "utf8");
    for (const k of CLASS_FILES) expect(css.match(new RegExp("--cls-" + k + ":", "g")), k).toHaveLength(2); // hell und dunkel
  });

  it("die Klassenfarben erreichen auf hellem und dunklem Papier mindestens 4.5:1", () => {
    const css = readFileSync(join(ROOT, "src", "ui", "tokens.css"), "utf8");
    const dark = css.indexOf("prefers-color-scheme: dark");
    const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const lum = (h) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    for (const m of css.matchAll(/--cls-([A-Z]+): (#[0-9A-F]{6});/g)) {
      const paper = m.index > dark ? "#1F150E" : "#F4EBD6";
      expect(ratio(m[2], paper), m[1] + " auf " + paper).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("Reise im neuen Design", () => {
  it("Kapitelnamen in der Sprache der Seite (Addon-Tabelle), nicht die englischen Indexnamen", () => {
    expect(zoneName(1429, "de")).toBe("Wald von Elwynn");
    expect(zoneName(1429, "en")).toBe("Elwynn Forest");
    expect(zoneName(999999, "de")).toBeNull();
    expect(zoneName("1429", "de")).toBeNull();
    expect(placeName("de", 999999, "Fallback")).toBe("Fallback");
    expect(Object.keys(ZONE_NAMES).length).toBeGreaterThan(90);
    const { journal, char } = load(TRAIL);
    const env = fakeEnv({ language: "de-DE" });
    const view = createJourneyView(env.doc, env.win, { journal, char, lang: "de" });
    const chips = byClass(view.element, "chapter-chip").map((b) => b.textContent);
    expect(chips[0]).toBe("Ganze Reise");
    expect(chips.slice(1).join("|")).toMatch(/Wald von Elwynn/);
    expect(chips.join("|")).not.toMatch(/Elwynn Forest/);
    view.setLang("en");
    expect(byClass(view.element, "chapter-chip").map((b) => b.textContent).join("|")).toMatch(/Elwynn Forest/);
    // Kapitel wählen: Überschrift und Kennzahlen folgen
    byClass(view.element, "chapter-chip")[1].click();
    expect(byClass(view.element, "journey-title")[0].textContent).toBe(placeName("en", view.data.chapters[0].mapID, view.data.chapters[0].name));
    expect(byClass(view.element, "aside-title")[0].textContent).toBe("In this chapter");
    view.destroy();
  });

  it("Marker sind Knöpfe mit Addon-Symbol und sprechendem aria-label; die Leinwand zeichnet sie nicht doppelt", () => {
    const { journal, char } = load(MARKED);
    const env = fakeEnv({ language: "de-DE" });
    const view = createJourneyView(env.doc, env.win, { journal, char, lang: "de" });
    const pins = byClass(view.element, "map-pin");
    expect(pins.length).toBeGreaterThan(0);
    expect(pins.map((p) => findAll(p, (n) => n.tagName === "IMG")[0].attributes.src)).toEqual(expect.arrayContaining(["img/map-milestone.webp", "img/map-death.webp", "img/map-photo.webp"]));
    expect(pins.find((p) => /Stufe 10 erreicht/.test(p.attributes["aria-label"]))).toBeTruthy();
    for (const p of pins) {
      expect(p.tagName).toBe("BUTTON");
      expect(p.attributes["aria-label"].length).toBeGreaterThan(3);
      expect(findAll(p, (n) => n.tagName === "IMG")[0].attributes.src).toMatch(/^img\/map-(level|milestone|death|boss|rare|photo)\.webp$/);
    }
    expect(markerIcon({ kind: "level", level: 20 })).toBe("map-milestone");
    expect(markerIcon({ kind: "level", level: 7 })).toBe("map-level");
    expect(markerIcon({ kind: "discovery" })).toBe("map-photo");
    // Legende mit den echten Symbolen
    const legendImgs = findAll(byClass(view.element, "map-legend")[0], (n) => n.tagName === "IMG").map((n) => n.attributes.src);
    expect(legendImgs).toEqual(["img/map-level.webp", "img/map-milestone.webp", "img/map-death.webp", "img/map-boss.webp", "img/map-rare.webp", "img/map-photo.webp"]);
    view.destroy();
  });

  it("Kennzahlen der ganzen Reise und eines Kapitels", () => {
    const { journal } = load(SAMPLE);
    const trip = journeyStats(journal, null);
    expect(trip.quests).toBe(journal.stats.questsDone);
    expect(trip.kills).toBe(journal.stats.kills);
    const ch = journal.chapters[0];
    const s = journeyStats(journal, { t0: ch.start, minLevel: ch.minLevel, maxLevel: ch.maxLevel });
    expect(s).toMatchObject({ quests: ch.quests, kills: ch.kills, deaths: ch.deaths, places: ch.discoveries.length, played: ch.active });
    expect(journeyStats(journal, { t0: -1, minLevel: null, maxLevel: null }).quests).toBeNull();
  });

  it("Renderer: drawMarkers=false lässt die Marker weg, Symbole werden als Bild gezeichnet", () => {
    const { journal, char } = load(MARKED);
    const env = fakeEnv();
    const view = createJourneyView(env.doc, env.win, { journal, char, lang: "de" });
    const scene = prepareMapScene(view.data.trail, 1429, { markers: view.data.markers });
    view.destroy();
    expect(scene.markers.length).toBeGreaterThan(0);
    const st = { width: 900, height: 600, scene, view: { cx: 0.5, cy: 0.5, zoom: 1 } };
    const plain = recordingCtx();
    drawFrame(plain, st);
    const none = recordingCtx();
    drawFrame(none, { ...st, drawMarkers: false });
    const arcs = (c) => c.calls.filter((x) => x[0] === "arc").length;
    expect(arcs(none)).toBeLessThan(arcs(plain));
    const img = { width: 64, height: 64 };
    const withIcons = recordingCtx();
    drawFrame(withIcons, { ...st, icons: new Map([["level", img], ["milestone", img], ["death", img], ["boss", img], ["rare", img], ["discovery", img]]) });
    expect(withIcons.calls.filter((x) => x[0] === "drawImage" && x[1] === img).length).toBe(scene.markers.length);
  });
});

describe("Schrift und Bilder", () => {
  function walk(dir, out = []) {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p, out);
      else out.push(p);
    }
    return out;
  }

  it("Caveat ist vollständig entfernt (Dateien, @font-face, Canvas, Hinweise)", () => {
    expect(existsSync(join(ROOT, "public", "fonts", "Caveat-Bold.ttf"))).toBe(false);
    expect(existsSync(join(ROOT, "public", "fonts", "OFL-Caveat.txt"))).toBe(false);
    const files = [...walk(join(ROOT, "src")).filter((f) => !f.includes(join("src", "core"))), join(ROOT, "THIRD-PARTY.md"), join(ROOT, "README.md"), join(ROOT, "index.html")];
    for (const f of files) expect(/caveat/i.test(readFileSync(f, "utf8")), f).toBe(false);
  });

  it("alle Bildnamen der Seite gibt es in public/img/, und public/img/ trägt den Lizenzhinweis", () => {
    const names = ["book-icon", "tab-reise", "tab-chronik", "map-level", "map-milestone", "map-death", "map-boss", "map-rare", "map-photo", "map-current", "map-hearth", "emblem-boss", "emblem-normal", "ring-bronze", "ring-silver", "ring-gold", "ring-legendary"];
    for (let i = 1; i <= SEALS.length; i++) names.push("seal-" + i);
    for (const n of names) expect(existsSync(join(ROOT, "public", "img", n + ".webp")), n).toBe(true);
    expect(readFileSync(join(ROOT, "THIRD-PARTY.md"), "utf8")).toMatch(/public\/img\/.*alle Rechte vorbehalten/);
    expect(readFileSync(join(ROOT, "public", "img", "LICENSE-NOTE.md"), "utf8")).toMatch(/alle Rechte vorbehalten/);
  });
});
