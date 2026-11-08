// Vorauswahl per Link aus dem Addon (#g=<GUID>&v=journey|chronicle, Rückfall #c=Name-Realm): Prüfung, Zuordnung, Ablauf auf der Seite
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseLinkFragment, matchLinkCharacters, resolveLinkCharacter } from "../src/ui/link-preset.mjs";
import { startApp } from "../src/ui/app.mjs";
import { fakeEnv, findAll, makeFile } from "./helpers/fake-dom.mjs";

const fixture = (n) => readFileSync(fileURLToPath(new URL("./fixtures/" + n, import.meta.url)), "utf8");
const SAMPLE = fixture("journal-export-sample.lua"); // Mirela (Player-1-0000AAAA, zuletzt gespielt) und Grumbold (Player-1-0000BBBB), beide Musterwacht
// Zwei gleichnamige Charaktere auf demselben Realm (wie in WoW Forever): Grumbold wird zu „Mirela“
const TWINS = SAMPLE.replace('["name"] = "Grumbold"', '["name"] = "Mirela"');
const byClass = (root, cls) => findAll(root, (n) => n.className.split(" ").includes(cls));

function boot(hash, opts) {
  const env = fakeEnv(opts);
  const replaced = [];
  env.win.location = { hash, pathname: "/InkAndEmbers-web/", search: "" };
  env.win.history = { replaceState: (...a) => replaced.push(a) };
  const app = startApp(env.doc, env.win);
  return { ...env, app, replaced };
}

describe("parseLinkFragment", () => {
  it("liest gültige Links (URL-kodiert, Umlaute, Apostroph, Leerzeichen, Bindestrich im Realm)", () => {
    expect(parseLinkFragment("#c=Mirela-Musterwacht&v=journey")).toEqual({ g: null, c: "Mirela-Musterwacht", v: "journey" });
    expect(parseLinkFragment("#c=Z%C3%B6e-Azjol-Nerub&v=chronicle")).toEqual({ g: null, c: "Zöe-Azjol-Nerub", v: "chronicle" });
    expect(parseLinkFragment("#c=Mirela-Der%20Rat%20von%20Dalaran")).toEqual({ g: null, c: "Mirela-Der Rat von Dalaran", v: "journey" });
    expect(parseLinkFragment("#c=Mirela-Kul%20Tiras&v=journey")?.c).toBe("Mirela-Kul Tiras");
    expect(parseLinkFragment("#c=Mirela-Drak'thul&v=journey")?.c).toBe("Mirela-Drak'thul");
    expect(parseLinkFragment("#c=Mirela-Realm%2010%20RP&v=journey")).toEqual({ g: null, c: "Mirela-Realm 10 RP", v: "journey" });
  });

  it("liest die GUID streng (Groß/Klein tolerant) und lässt c als Rückfall daneben zu", () => {
    expect(parseLinkFragment("#g=Player-4802-01A2B3C4&v=chronicle")).toEqual({ g: "Player-4802-01A2B3C4", c: null, v: "chronicle" });
    expect(parseLinkFragment("#g=player-1-0000aaaa")).toEqual({ g: "player-1-0000aaaa", c: null, v: "journey" });
    expect(parseLinkFragment("#g=Player-1-0000AAAA&c=Mirela-Musterwacht")).toEqual({ g: "Player-1-0000AAAA", c: "Mirela-Musterwacht", v: "journey" });
  });

  it("weist ungültige GUIDs ab (auch wenn ein gültiges c daneben steht)", () => {
    for (const h of ["#g=", "#g=Player-1-0000AAA", "#g=Player-1234567-0000AAAA", "#g=Player--0000AAAA", "#g=Player-1-0000AAAG", "#g=Creature-0-1-2-3-4-5",
      "#g=Player-1-0000AAAA-extra", "#g=Player-1-" + "A".repeat(17), "#g=%20Player-1-0000AAAA", "#g=Player-1-0000AAAA%0A", "#g=Player-1-0000AAAA&v=map",
      "#g=Player-1-0000AAAA%22%3E%3Csvg%20onload%3D1%3E", "#g=<script>", "#g=Player-x-0000AAAA&c=Mirela-Musterwacht"]) {
      expect(parseLinkFragment(h), h).toBeNull();
    }
  });

  it("weist Ungültiges ab: leer, zu lang, fremde Zeichen, unbekannte Ansicht, kein c/g", () => {
    for (const h of ["", "#", "#v=journey", "#c=&v=journey", "#c=Mirela-Realm&v=map", "#c=Mirela-Realm&v=", "#c=" + "a".repeat(81) + "&v=journey",
      "#c=Mirela_Realm", "#c=Mirela%2FRealm", "#c=Mirela1-Realm", "#c=Mir3la", "#c=Mirela-Realm_1", "#c=Mirela-Realm%2F1","#c=Mirela%0A-Realm", "#c=Mirela%00", "#c=Mirela%3B-Realm"]) {
      expect(parseLinkFragment(h), h).toBeNull();
    }
    expect(parseLinkFragment(undefined)).toBeNull();
    expect(parseLinkFragment(42)).toBeNull();
    expect(parseLinkFragment("#c=" + "a".repeat(80))?.c).toHaveLength(80);
  });

  it("lässt keine Markup-/Skriptzeichen durch (XSS im Fragment)", () => {
    for (const h of ["#c=%3Cscript%3Ealert(1)%3C%2Fscript%3E", "#c=<img src=x onerror=alert(1)>", "#c=Mirela-Realm&v=journey\"><svg onload=1>",
      "#c=javascript:alert(1)", "#c=%22onmouseover%3D%22x", "#c=Mirela&v=%3Cb%3E", "#c=%E2%80%AEMirela"]) {
      expect(parseLinkFragment(h), h).toBeNull();
    }
  });
});

describe("matchLinkCharacters / resolveLinkCharacter", () => {
  const chars = [
    { guid: "g1", name: "Mirela", realm: "Kul Tiras" },
    { guid: "g2", name: "Zoë", realm: "Azjol-Nerub" },
    { guid: "g3", name: "Mirela", realm: "Der Rat von Dalaran" },
    { guid: "g4", name: "Mirela", realm: "Realm 10 RP" },
  ];
  it("ordnet Name-Realm Groß/Klein-tolerant zu und kommt mit und ohne Leerzeichen im Realm klar", () => {
    expect(matchLinkCharacters(chars, "Mirela-Kul Tiras")).toEqual(["g1"]);
    expect(matchLinkCharacters(chars, "mirela-kultiras")).toEqual(["g1"]);
    expect(matchLinkCharacters(chars, "MIRELA-DERRATVONDALARAN")).toEqual(["g3"]);
    expect(matchLinkCharacters(chars, "Zoë-Azjol-Nerub")).toEqual(["g2"]);
    expect(matchLinkCharacters(chars, "Mirela-Realm 10 RP")).toEqual(["g4"]);
    expect(matchLinkCharacters(chars, "mirela-realm10rp")).toEqual(["g4"]);
    expect(matchLinkCharacters(chars, "zoë-azjolnerub")).toEqual(["g2"]);
    expect(matchLinkCharacters(chars, "Mirela")).toEqual(["g1", "g3", "g4"]);
  });
  it("liefert eine leere Liste ohne Treffer", () => {
    expect(matchLinkCharacters(chars, "Mirela-Unbekannt")).toEqual([]);
    expect(matchLinkCharacters(chars, "Nobody-Kul Tiras")).toEqual([]);
    expect(matchLinkCharacters([], "Mirela-Kul Tiras")).toEqual([]);
  });

  const twins = [
    { guid: "Player-1-0000AAAA", name: "Lenu", realm: "CAMWOW EU4 Realm 10 RP" },
    { guid: "Player-1-0000BBBB", name: "Lenu", realm: "CAMWOW EU4 Realm 10 RP" },
  ];
  it("wählt per GUID exakt (Groß/Klein egal), auch bei gleichem Namen und Realm", () => {
    expect(resolveLinkCharacter(twins, { g: "Player-1-0000BBBB", c: null, v: "journey" })).toEqual({ status: "found", guid: "Player-1-0000BBBB" });
    expect(resolveLinkCharacter(twins, { g: "player-1-0000aaaa", c: null, v: "journey" })).toEqual({ status: "found", guid: "Player-1-0000AAAA" });
  });
  it("rät beim Rückfall c nie: mehrdeutig bleibt mehrdeutig, eindeutig wird gefunden", () => {
    expect(resolveLinkCharacter(twins, { g: null, c: "Lenu-CAMWOW EU4 Realm 10 RP", v: "journey" })).toEqual({ status: "ambiguous" });
    expect(resolveLinkCharacter(twins, { g: null, c: "Lenu", v: "journey" })).toEqual({ status: "ambiguous" });
    expect(resolveLinkCharacter(chars, { g: null, c: "Zoë-Azjol-Nerub", v: "journey" })).toEqual({ status: "found", guid: "g2" });
  });
  it("fällt bei unbekannter GUID nur auf ein eindeutiges c zurück, sonst keine Wahl", () => {
    expect(resolveLinkCharacter(chars, { g: "Player-9-FFFFFFFF", c: null, v: "journey" })).toEqual({ status: "none" });
    expect(resolveLinkCharacter(chars, { g: "Player-9-FFFFFFFF", c: "Zoë-Azjol-Nerub", v: "journey" })).toEqual({ status: "found", guid: "g2" });
    expect(resolveLinkCharacter(twins, { g: "Player-9-FFFFFFFF", c: "Lenu", v: "journey" })).toEqual({ status: "ambiguous" });
    expect(resolveLinkCharacter([], { g: "Player-1-0000AAAA", c: null, v: "journey" })).toEqual({ status: "none" });
    expect(resolveLinkCharacter(chars, null)).toEqual({ status: "none" });
  });
});

describe("Seite mit Link aus dem Addon", () => {
  it("zeigt auf der Startseite den Hinweis (DE/EN) als Text und nichts ohne Fragment", () => {
    const de = boot("#c=Grumbold-Musterwacht&v=journey", { language: "de-DE" });
    expect(byClass(de.appRoot, "link-hint")[0].textContent).toBe("Ihr kommt aus dem Spiel: zieht jetzt Eure Datei hierher.");
    const en = boot("#g=Player-1-0000BBBB&v=journey", { language: "en-US" });
    expect(byClass(en.appRoot, "link-hint")[0].textContent).toContain("You came from the game");
    expect(byClass(boot("", { language: "de-DE" }).appRoot, "link-hint")).toHaveLength(0);
    expect(byClass(boot("#c=<script>", { language: "de-DE" }).appRoot, "link-hint")).toHaveLength(0);
  });

  it("wählt bei zwei Charakteren den verlinkten (nicht den zuletzt gespielten) und entfernt das Fragment", async () => {
    const { app, appRoot, replaced } = boot("#c=grumbold-Musterwacht&v=journey", { language: "de-DE" });
    await app.loadFile(makeFile("InkAndEmbers.lua", SAMPLE));
    expect(app.state.file.characters.map((c) => c.name)).toEqual(["Mirela", "Grumbold"]);
    expect(byClass(appRoot, "journal-name")[0].textContent).toBe("Grumbold");
    expect(app.state.view).toBe("journey");
    expect(byClass(appRoot, "link-hint")).toHaveLength(0);
    expect(byClass(appRoot, "notice")).toHaveLength(0);
    expect(replaced).toEqual([[null, "", "/InkAndEmbers-web/"]]);
  });

  it("öffnet bei v=chronicle die Chronik", async () => {
    const { app, appRoot } = boot("#c=Grumbold-Muster%20wacht&v=chronicle", { language: "de-DE" });
    await app.loadFile(makeFile("InkAndEmbers.lua", SAMPLE));
    expect(byClass(appRoot, "journal-name")[0].textContent).toBe("Grumbold");
    expect(app.state.view).toBe("chronicle");
    expect(byClass(appRoot, "chron-book")).toHaveLength(1);
  });

  it("zeigt ohne Treffer die normale Auswahl und einen kurzen Hinweis", async () => {
    const { app, appRoot, replaced } = boot("#c=Niemand-Nirgendwo&v=chronicle", { language: "de-DE" });
    await app.loadFile(makeFile("InkAndEmbers.lua", SAMPLE));
    expect(byClass(appRoot, "journal-name")[0].textContent).toBe("Mirela");
    expect(app.state.view).toBe("journey");
    expect(byClass(appRoot, "notice")[0].textContent).toContain("nicht in dieser Datei");
    expect(replaced).toHaveLength(1);
  });

  it("behält den Link, wenn die Datei nicht lesbar ist, und nutzt ihn bei der nächsten guten Datei", async () => {
    const { app, appRoot, replaced } = boot("#c=Grumbold-Musterwacht&v=journey", { language: "de-DE" });
    await app.loadFile(makeFile("notizen.txt", "hallo"));
    expect(replaced).toHaveLength(0);
    await app.loadFile(makeFile("InkAndEmbers.lua", SAMPLE));
    expect(byClass(appRoot, "journal-name")[0].textContent).toBe("Grumbold");
  });

  it("verträgt eine Umgebung ohne location/history und ein unbrauchbares Fragment (XSS)", async () => {
    const plain = fakeEnv({ language: "de-DE" });
    const app = startApp(plain.doc, plain.win);
    await app.loadFile(makeFile("InkAndEmbers.lua", SAMPLE));
    expect(byClass(plain.appRoot, "journal-name")[0].textContent).toBe("Mirela");
    const evil = boot("#c=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E&v=journey", { language: "de-DE" });
    await evil.app.loadFile(makeFile("InkAndEmbers.lua", SAMPLE));
    expect(evil.appRoot.textContent).not.toContain("onerror");
    expect(byClass(evil.appRoot, "journal-name")[0].textContent).toBe("Mirela");
    expect(evil.replaced).toHaveLength(0);
  });

  it("wählt per GUID den verlinkten Charakter (nicht den zuletzt gespielten) und entfernt das Fragment", async () => {
    const { app, appRoot, replaced } = boot("#g=Player-1-0000BBBB&v=chronicle", { language: "de-DE" });
    await app.loadFile(makeFile("InkAndEmbers.lua", SAMPLE));
    expect(byClass(appRoot, "journal-name")[0].textContent).toBe("Grumbold");
    expect(app.state.view).toBe("chronicle");
    expect(byClass(appRoot, "notice")).toHaveLength(0);
    expect(replaced).toEqual([[null, "", "/InkAndEmbers-web/"]]);
  });

  it("trifft bei zwei gleichnamigen Charakteren per GUID genau den richtigen", async () => {
    for (const guid of ["Player-1-0000AAAA", "Player-1-0000BBBB"]) {
      const { app } = boot("#g=" + guid.toLowerCase() + "&v=journey", { language: "de-DE" });
      await app.loadFile(makeFile("InkAndEmbers.lua", TWINS));
      expect(app.state.file.characters.map((c) => c.name)).toEqual(["Mirela", "Mirela"]);
      expect(app.state.guid).toBe(guid);
    }
  });

  it("rät beim Rückfall c bei gleichnamigen Charakteren nicht: Hinweis und Kartenauswahl statt Tagebuch", async () => {
    const { app, appRoot, replaced } = boot("#c=Mirela-Musterwacht&v=chronicle", { language: "de-DE" });
    await app.loadFile(makeFile("InkAndEmbers.lua", TWINS));
    expect(app.state.guid).toBeNull();
    expect(byClass(appRoot, "journal-name")).toHaveLength(0);
    expect(byClass(appRoot, "char-card")).toHaveLength(2);
    expect(byClass(appRoot, "notice")[0].textContent).toBe("Mehrere Charaktere passen – bitte auswählen.");
    expect(replaced).toHaveLength(1);
    const en = boot("#c=Mirela-Musterwacht", { language: "en-US" });
    await en.app.loadFile(makeFile("InkAndEmbers.lua", TWINS));
    expect(byClass(en.appRoot, "notice")[0].textContent).toContain("Several characters match");
  });

  it("zeigt bei unbekannter GUID den normalen Hinweis und die Standardauswahl", async () => {
    const { app, appRoot } = boot("#g=Player-9-FFFFFFFF&v=journey", { language: "de-DE" });
    await app.loadFile(makeFile("InkAndEmbers.lua", SAMPLE));
    expect(byClass(appRoot, "journal-name")[0].textContent).toBe("Mirela");
    expect(byClass(appRoot, "notice")[0].textContent).toContain("nicht in dieser Datei");
  });

  it("ignoriert eine ungültige GUID im Link (kein Hinweis, keine Vorauswahl)", async () => {
    const { app, appRoot, replaced } = boot("#g=Player-1-0000BBBB%22%3E%3Csvg&v=journey", { language: "de-DE" });
    expect(byClass(appRoot, "link-hint")).toHaveLength(0);
    await app.loadFile(makeFile("InkAndEmbers.lua", SAMPLE));
    expect(byClass(appRoot, "journal-name")[0].textContent).toBe("Mirela");
    expect(replaced).toHaveLength(0);
  });
});
