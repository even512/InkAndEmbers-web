// Vor-/Nachname und Regelwerk statt Realm-Shard (WoW Forever): Hilfen, Charakterwahl, Kopf, Steckbrief, Dungeon-Gruppe
// und Anonymisierung. Retail bleibt unverändert (Realm sichtbar, Mitspielernamen roh).
import { describe, it, expect } from "vitest";
import { fakeEnv, findAll, makeFile } from "./helpers/fake-dom.mjs";
import { makeDb, GUID, thanenOpts, luaText } from "./helpers/chronik-sv.mjs";
import { startApp } from "../src/ui/app.mjs";
import { renderChronicle } from "../src/chronik/view.mjs";
import { buildChronik } from "../src/chronik/model.mjs";
import { playerName, isShardPart, rulesetText, extrasOf, shownIdentity, shownJournal, buildJournalX } from "../src/ui/names.mjs";
import { createAnonymizer, looksLikeNpc, anonymizeChar } from "../src/share/anonymize.mjs";

const SHARD = "CAMWOW EU4 Realm 10 RP";
const hasCls = (n, c) => typeof n.className === "string" && n.className.split(" ").includes(c);
const byClass = (root, c) => findAll(root, (n) => hasCls(n, c));

// Datei mit einem Charakter; info.* nach Bedarf (project 18 = Forever, 1 = Retail)
function fileText(info, lines) {
  const db = makeDb({ info, lines: lines || ["0~PL~0~0~1~login"] });
  const root = { locale: "deDE", schema: 1, meta: { tzOffset: 0 }, chars: { [GUID]: db.chars[GUID] } };
  return luaText("EveNChronicleDB", root);
}

async function boot(info, language = "de-DE", lines) {
  const env = fakeEnv({ language });
  const app = startApp(env.doc, env.win);
  await app.loadFile(makeFile("InkAndEmbers.lua", fileText(info, lines)));
  return { ...env, app };
}

describe("Hilfen", () => {
  it("playerName: Nachname ja, Shard nein, Retail unverändert", () => {
    expect(playerName("Alma-Barrowstone", true)).toBe("Alma Barrowstone");
    expect(playerName("Alma-Realm 10 RP", true)).toBe("Alma");
    expect(playerName("Alma-Realm10", true)).toBe("Alma");
    expect(playerName("Alma", true)).toBe("Alma");
    expect(playerName("Alma-", true)).toBe("Alma");
    expect(playerName("Alma-Testrealm", false)).toBe("Alma-Testrealm");
    expect(playerName(undefined, true)).toBeUndefined();
    expect(isShardPart("EU4")).toBe(true);
    expect(isShardPart("Barrowstone")).toBe(false);
  });

  it("rulesetText: bekannte Schlüssel, zweisprachig; Unbekanntes und Prototyp-Namen ergeben nichts", () => {
    expect(rulesetText("de", "rp")).toBe("Rollenspiel (PvE)");
    expect(rulesetText("en", "rp")).toBe("Roleplaying (PvE)");
    expect(rulesetText("de", "hardcore")).toBe("Hardcore");
    expect(rulesetText("de", "pvp")).toBe("PvP");
    expect(rulesetText("en", "pve")).toBe("PvE");
    for (const k of ["constructor", "__proto__", "foo", "", null, 5]) expect(rulesetText("de", k)).toBeNull();
  });

  it("extrasOf: project 18 = Forever, project 1 = Retail, ohne project entscheidet die Interface-Nummer im Log", () => {
    const c = (info, lines) => makeDb({ info, lines: lines || [] }).chars[GUID];
    expect(extrasOf(c({ project: 18, surname: "Barrowstone", ruleset: "rp" }))).toEqual({ surname: "Barrowstone", ruleset: "rp", forever: true });
    expect(extrasOf(c({ project: 1 })).forever).toBe(false);
    expect(extrasOf(c({}, ["0~L~1~1.15.8~61000~16001~deDE~3600"])).forever).toBe(true);
    expect(extrasOf(c({}, ["0~L~1~11.0.0~58000~110000~deDE~3600"])).forever).toBe(false);
    expect(extrasOf(c({})).forever).toBe(false);
    // ungültige Werte werden verworfen
    expect(extrasOf(c({ project: 18, surname: 5, ruleset: "bogus" }))).toEqual({ surname: null, ruleset: null, forever: true });
    expect(extrasOf(c({ project: 18, surname: "  ", ruleset: "__proto__" }))).toEqual({ surname: null, ruleset: null, forever: true });
    expect(extrasOf(null)).toEqual({ surname: null, ruleset: null, forever: false });
  });

  it("shownIdentity: Forever mit/ohne Nachname und Regelwerk; Retail mit Realm", () => {
    const fv = { name: "Lenu", realm: SHARD, forever: true, surname: "Barrowstone", ruleset: "rp" };
    expect(shownIdentity(fv, "de")).toEqual({ name: "Lenu Barrowstone", place: "Rollenspiel (PvE)" });
    expect(shownIdentity({ ...fv, surname: null, ruleset: null }, "de")).toEqual({ name: "Lenu", place: null });
    expect(shownIdentity({ name: "Mirela", realm: "Blackrock", forever: false }, "de")).toEqual({ name: "Mirela", place: "Blackrock" });
    expect(shownIdentity({ name: "Mirela", realm: null, forever: false }, "de")).toEqual({ name: "Mirela", place: null });
    const j = { ...fv, level: 5 };
    expect(shownJournal(j, "en")).toMatchObject({ name: "Lenu Barrowstone", realm: "Roleplaying (PvE)", level: 5 });
    expect(shownJournal({ name: "M", realm: "R", forever: false }, "de").realm).toBe("R");
  });
});

describe("App: Charakterwahl und Kopf", () => {
  it("Forever mit Nachname und Regelwerk: Vollname, Regelwerk, nirgends der Shard", async () => {
    const { appRoot, app } = await boot({ name: "Lenu", realm: SHARD, project: 18, surname: "Barrowstone", ruleset: "rp" });
    expect(app.state.error).toBeNull();
    expect(byClass(appRoot, "journal-name")[0].textContent).toBe("Lenu Barrowstone");
    expect(byClass(appRoot, "hero-meta")[0].textContent).toContain("Rollenspiel (PvE)");
    const opt = findAll(appRoot, (n) => n.tagName === "OPTION")[0].textContent;
    expect(opt).toContain("Lenu Barrowstone");
    expect(opt).toContain("Rollenspiel (PvE)");
    expect(appRoot.textContent).not.toContain("CAMWOW");
    expect(appRoot.textContent).not.toContain("Realm 10");
  });

  it("Forever, EN: Regelwerk englisch", async () => {
    const { appRoot } = await boot({ name: "Lenu", realm: SHARD, project: 18, surname: "Barrowstone", ruleset: "pvp" }, "en-GB");
    expect(byClass(appRoot, "hero-meta")[0].textContent).toContain("PvP");
    expect(appRoot.textContent).not.toContain("CAMWOW");
  });

  it("alte Forever-Datei ohne surname/ruleset: nur Vorname, Shard weggelassen, kein Fehler", async () => {
    const { appRoot, app } = await boot({ name: "Lenu", realm: SHARD, project: 18 });
    expect(app.state.error).toBeNull();
    expect(byClass(appRoot, "journal-name")[0].textContent).toBe("Lenu");
    expect(appRoot.textContent).not.toContain("CAMWOW");
  });

  it("alte Forever-Datei ganz ohne project: erkannt am Interface im Log, Shard trotzdem weg", async () => {
    const { appRoot, app } = await boot({ name: "Lenu", realm: SHARD }, "de-DE", ["0~L~1~1.15.8~61000~16001~deDE~3600", "0~PL~0~0~1~login"]);
    expect(app.state.error).toBeNull();
    expect(appRoot.textContent).not.toContain("CAMWOW");
  });

  it("Retail (project 1): Realm bleibt sichtbar, kein Nachname-Zusatz", async () => {
    const { appRoot } = await boot({ name: "Mirela", realm: "Blackrock", project: 1, surname: "Ignoriert", ruleset: "rp" });
    expect(byClass(appRoot, "journal-name")[0].textContent).toBe("Mirela");
    expect(byClass(appRoot, "hero-meta")[0].textContent).toContain("Blackrock");
    expect(appRoot.textContent).not.toContain("Rollenspiel");
    expect(findAll(appRoot, (n) => n.tagName === "OPTION")[0].textContent).toContain("Blackrock");
  });

  it("Schadtext im Nachnamen wird nur als Text und gesäubert gezeigt", async () => {
    const { appRoot } = await boot({ name: "Lenu", project: 18, surname: "<b>Evil‮</b>", ruleset: "rp" });
    expect(byClass(appRoot, "journal-name")[0].textContent).toBe("Lenu <b>Evil</b>");
    expect(findAll(appRoot, (x) => x.tagName === "B")).toHaveLength(0);
  });
});

describe("Chronik: Steckbrief und Dungeon-Gruppe", () => {
  function chronik(info) {
    const opts = thanenOpts();
    opts.info = info;
    const db = makeDb(opts);
    const journal = buildJournalX(db, GUID);
    const env = fakeEnv({ language: "de-DE" });
    return renderChronicle(env.doc, { model: buildChronik(db, GUID, journal), journal, lang: "de" });
  }

  it("Forever: Steckbrief mit Regelwerk statt Realm, Gruppe als Vorname Nachname", () => {
    const view = chronik({ name: "Lenu", realm: SHARD, project: 18, surname: "Barrowstone", ruleset: "rp" });
    const prof = byClass(view, "prof-page")[0].textContent;
    expect(prof).toContain("Lenu Barrowstone");
    expect(prof).toContain("Regelwerk");
    expect(prof).toContain("Rollenspiel (PvE)");
    expect(prof).not.toContain("Realm");
    expect(view.textContent).not.toContain("CAMWOW");
    const run = byClass(view, "dg-run")[0].textContent;
    expect(run).toContain("Alma Testrealm");
    expect(run).not.toContain("Alma-Testrealm");
  });

  it("Forever ohne Regelwerk: keine Zeile, kein Shard", () => {
    const view = chronik({ name: "Lenu", realm: SHARD, project: 18 });
    const prof = byClass(view, "prof-page")[0].textContent;
    expect(prof).not.toContain("Regelwerk");
    expect(prof).not.toContain("Realm");
    expect(view.textContent).not.toContain("CAMWOW");
  });

  it("Retail: Realm und Mitspielernamen wie bisher", () => {
    const view = chronik({ name: "Mirela", realm: "Blackrock", project: 1 });
    const prof = byClass(view, "prof-page")[0].textContent;
    expect(prof).toContain("Realm");
    expect(prof).toContain("Blackrock");
    expect(byClass(view, "dg-run")[0].textContent).toContain("Alma-Testrealm");
  });
});

describe("Anonymisierung mit Vollnamen", () => {
  const char = makeDb({ info: { name: "Lenu", project: 18 }, lines: ["1~GM~Kaelira-Barrowstone~PRIEST~6~2", "2~GM~Torvak-Realm10~MAGE~6~2"] }).chars[GUID];

  it("looksLikeNpc: Vollname mit Leerzeichen ist ein Spieler, sobald die Schreibweise bekannt ist", () => {
    expect(looksLikeNpc("Kaelira Barrowstone")).toBe(true);
    expect(looksLikeNpc("Kaelira Barrowstone", new Set(["Kaelira Barrowstone"]))).toBe(false);
    expect(looksLikeNpc("Auktionshaus der Allianz", new Set(["Kaelira Barrowstone"]))).toBe(true);
    expect(looksLikeNpc("Kaelira-Barrowstone")).toBe(false);
  });

  it("Anzeigeform Vorname Nachname wird als Spieler ersetzt; ein Shard wird nicht zum Nachnamen", () => {
    const anon = createAnonymizer(char, "de");
    expect(anon.names).toEqual(["Kaelira-Barrowstone", "Torvak-Realm10"]);
    expect(anon.alias("Kaelira Barrowstone")).toBe("Gefährte 1");
    expect(anon.alias("Kaelira-Barrowstone")).toBe("Gefährte 1");
    expect(anon.scrub("Mit Kaelira Barrowstone und Kaelira unterwegs")).toBe("Mit Gefährte 1 und Gefährte 1 unterwegs");
    expect(anon.scrub("Torvak kam")).toBe("Gefährte 2 kam");
    expect(anon.alias("Stadtwache Lenu")).toBe("Stadtwache Lenu");
    const out = anonymizeChar(char, anon);
    expect(JSON.stringify(out.log)).not.toContain("Kaelira");
  });
});

describe("Druck: Titelseite und Anonymisierung", () => {
  it("Forever: Vollname und Regelwerk auf der Titelseite; mit Ausblenden fehlen die Gruppennamen samt Nachname", async () => {
    const { buildPrintBook } = await import("../src/ui/print.mjs");
    const opts = thanenOpts();
    opts.info = { name: "Lenu", realm: SHARD, project: 18, surname: "Barrowstone", ruleset: "pvp" };
    const db = makeDb(opts);
    const char = db.chars[GUID];
    const journal = buildJournalX(db, GUID);
    const { doc, win } = fakeEnv({ language: "de-DE" });
    const plain = await buildPrintBook(doc, win, { db, guid: GUID, journal, char, lang: "de", anonymize: false });
    expect(byClass(plain.element, "print-name")[0].textContent).toBe("Lenu Barrowstone");
    expect(byClass(plain.element, "print-meta")[0].textContent).toContain("PvP");
    expect(plain.element.textContent).not.toContain("CAMWOW");
    expect(plain.element.textContent).toContain("Alma Testrealm");
    const anon = await buildPrintBook(doc, win, { db, guid: GUID, journal, char, lang: "de", anonymize: true });
    const text = anon.element.textContent;
    expect(byClass(anon.element, "print-name")[0].textContent).toBe("Lenu Barrowstone");
    expect(text).not.toContain("Alma");
    expect(text).not.toContain("Testrealm");
    expect(text).not.toContain("CAMWOW");
  });
});
