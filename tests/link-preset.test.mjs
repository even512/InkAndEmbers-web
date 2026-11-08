// Vorauswahl per Link aus dem Addon (#c=Name-Realm&v=journey|chronicle): Prüfung, Zuordnung, Ablauf auf der Seite
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseLinkFragment, matchLinkCharacter } from "../src/ui/link-preset.mjs";
import { startApp } from "../src/ui/app.mjs";
import { fakeEnv, findAll, makeFile } from "./helpers/fake-dom.mjs";

const fixture = (n) => readFileSync(fileURLToPath(new URL("./fixtures/" + n, import.meta.url)), "utf8");
const SAMPLE = fixture("journal-export-sample.lua"); // Mirela (zuletzt gespielt) und Grumbold, beide Musterwacht
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
    expect(parseLinkFragment("#c=Mirela-Musterwacht&v=journey")).toEqual({ c: "Mirela-Musterwacht", v: "journey" });
    expect(parseLinkFragment("#c=Z%C3%B6e-Azjol-Nerub&v=chronicle")).toEqual({ c: "Zöe-Azjol-Nerub", v: "chronicle" });
    expect(parseLinkFragment("#c=Mirela-Der%20Rat%20von%20Dalaran")).toEqual({ c: "Mirela-Der Rat von Dalaran", v: "journey" });
    expect(parseLinkFragment("#c=Mirela-Kul%20Tiras&v=journey")?.c).toBe("Mirela-Kul Tiras");
    expect(parseLinkFragment("#c=Mirela-Drak'thul&v=journey")?.c).toBe("Mirela-Drak'thul");
  });

  it("weist Ungültiges ab: leer, zu lang, fremde Zeichen, unbekannte Ansicht, kein c", () => {
    for (const h of ["", "#", "#v=journey", "#c=&v=journey", "#c=Mirela-Realm&v=map", "#c=Mirela-Realm&v=", "#c=" + "a".repeat(81) + "&v=journey",
      "#c=Mirela_Realm", "#c=Mirela%2FRealm", "#c=Mirela-Realm1", "#c=Mirela%0A-Realm", "#c=Mirela%00", "#c=Mirela%3B-Realm"]) {
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

describe("matchLinkCharacter", () => {
  const chars = [
    { guid: "g1", name: "Mirela", realm: "Kul Tiras" },
    { guid: "g2", name: "Zoë", realm: "Azjol-Nerub" },
    { guid: "g3", name: "Mirela", realm: "Der Rat von Dalaran" },
  ];
  it("ordnet Groß/Klein-tolerant zu und kommt mit und ohne Leerzeichen im Realm klar", () => {
    expect(matchLinkCharacter(chars, "Mirela-Kul Tiras")).toBe("g1");
    expect(matchLinkCharacter(chars, "mirela-kultiras")).toBe("g1");
    expect(matchLinkCharacter(chars, "MIRELA-DERRATVONDALARAN")).toBe("g3");
    expect(matchLinkCharacter(chars, "Zoë-Azjol-Nerub")).toBe("g2");
    expect(matchLinkCharacter(chars, "zoë-azjolnerub")).toBe("g2");
  });
  it("liefert null ohne Treffer", () => {
    expect(matchLinkCharacter(chars, "Mirela-Unbekannt")).toBeNull();
    expect(matchLinkCharacter(chars, "Nobody-Kul Tiras")).toBeNull();
    expect(matchLinkCharacter([], "Mirela-Kul Tiras")).toBeNull();
  });
});

describe("Seite mit Link aus dem Addon", () => {
  it("zeigt auf der Startseite den Hinweis (DE/EN) als Text und nichts ohne Fragment", () => {
    const de = boot("#c=Grumbold-Musterwacht&v=journey", { language: "de-DE" });
    expect(byClass(de.appRoot, "link-hint")[0].textContent).toBe("Ihr kommt aus dem Spiel: zieht jetzt Eure Datei hierher.");
    const en = boot("#c=Grumbold-Musterwacht&v=journey", { language: "en-US" });
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
});
