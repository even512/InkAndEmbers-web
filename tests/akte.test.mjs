// K2 auf der Webseite: Kapitelregel (R1* + R3) und Akte wie im Addon (Kern aus dem Addon-Repo, src/core/journal-model.mjs),
// Akte als oberste Ebene der Reise-Leiste, Sprung an den Anfang ohne Abspielen, Zonenwechsel beim Abspielen/Scrubben.
// Alles synthetisch bzw. der anonymisierte Zonenverlauf aus dem Addon-Repo (keine Namen, GUIDs oder echten Zeitpunkte).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readSavedVariables, buildJournal, zoneAt, flightAt, ACT_ANCHOR } from "../src/core/journal-model.mjs";
import { createJourneyView, prepareJourney, journeyStats, actTitle, actSubtitle, contentsBands } from "../src/ui/journey.mjs";
import { fakeEnv, findAll } from "./helpers/fake-dom.mjs";

const FIXTURE = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/k2-kapitel-verlauf.json", import.meta.url)), "utf8"));
const byClass = (root, cls) => findAll(root, (n) => typeof n.className === "string" && n.className.split(" ").includes(cls));

// Reise wie die Lua-Helfer des Addon-Tests: W(map, n, dt) = n Spurpunkte im Abstand dt, danach Ereignisse
function journey(names) {
  let now = 1793000000;
  let lvl = 1;
  let qid = 7000;
  const log = [now + "~PL~0~0~1~login"];
  const trail = [];
  const add = (line) => log.push(now + "~" + line);
  for (const id of Object.keys(names)) add("ZN~" + id + "~3~" + id + "~1415~1~5000~5000");
  const j = {
    W(map, n, dt = 60) {
      const pts = [];
      let start = null;
      for (let i = 1; i <= n; i++) {
        now += i === 1 ? 1 : dt;
        if (start === null) start = now;
        pts.push(now - start + "~" + (3000 + (i % 400) * 5) + "~" + (4000 + (i % 300) * 5));
      }
      now += dt - 1;
      trail.push("#~" + start + "~" + map + "\n" + pts.join("\n"));
      return j;
    },
    KILL: (map) => (add("KI~3000~5~normal~" + map + "~10~self~pk~~5~5000~5000"), j),
    QT: (map, n = 1) => {
      for (let i = 0; i < n; i++) add("QT~" + ++qid + "~" + lvl + "~5~" + map);
      return j;
    },
    LV: (map) => (add("LV~" + ++lvl + "~" + map + "~5000~5000~"), j),
    DE: (map) => (add("DE~" + lvl + "~" + map + "~4100~4600~0~1~"), j),
    raw: (line) => (add(line), j),
    get now() {
      return now;
    },
    db() {
      const luaStr = (s) => '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n") + '"';
      const maps = Object.entries(names).map(([id, nm]) => "[" + id + "] = { [\"name\"] = " + luaStr(nm) + " }").join(", ");
      const text = `EveNChronicleDB = { ["schema"] = 1, ["chars"] = { ["Player-1-0000AAAA"] = {
        ["info"] = { ["name"] = "Testa", ["firstSeen"] = 1793000000 },
        ["log"] = { ${luaStr("#~0~1\n" + log.join("\n"))} },
        ["trail"] = { ${trail.map(luaStr).join(", ")} },
        ["snapshots"] = { ["maps"] = { ${maps} } },
      } } }`;
      const { db } = readSavedVariables(text);
      return { db, char: db.chars["Player-1-0000AAAA"], journal: buildJournal(db, "Player-1-0000AAAA") };
    },
  };
  return j;
}

describe("K2-Web: Kapitelregel und Akte im Kern (gleich dem Addon)", () => {
  it("anonymisierter Verlauf: 20 Kapitel in 9 Akten", () => {
    const names = {};
    for (let z = 0; z < FIXTURE.zones; z++) names[9100 + z] = "Zone " + z;
    const r = journey(names);
    for (const [z, sec, lv, qt, de, other] of FIXTURE.visits) {
      const map = 9100 + z;
      const n = Math.max(1, Math.floor(sec / 60 + 0.5));
      r.W(map, n, Math.floor(sec / n));
      for (let i = 0; i < lv; i++) r.LV(map);
      r.QT(map, qt);
      for (let i = 0; i < de; i++) r.DE(map);
      if (other > 0) r.KILL(map);
    }
    const { journal } = r.db();
    expect(journal.chapters.length).toBe(20);
    expect(journal.acts.map((a) => [a.zoneName, a.chapters.length])).toEqual([
      ["Zone 0", 5], ["Zone 3", 1], ["Zone 7", 4], ["Zone 1", 1], ["Zone 3", 1],
      ["Zone 7", 2], ["Zone 2", 1], ["Zone 13", 4], ["Zone 3", 1],
    ]);
    // jeder Anker ist mindestens 100 min lang, jedes Kapitel gehört zu genau einem Akt
    for (const a of journal.acts) expect(journal.chapters[a.anchor].active).toBeGreaterThanOrEqual(ACT_ANCHOR);
    expect(journal.acts.flatMap((a) => a.chapters)).toEqual(journal.chapters.map((_, i) => i));
  });
});

// zwei Zonen mit Kartenbild (Forever-IDs): Elwynn mit Stufen, dazwischen ein Abstecher nach Westfall ohne Ereignis
function twoZones() {
  const r = journey({ 1429: "Wald von Elwynn", 1436: "Westfall" });
  r.W(1429, 60).KILL(1429).LV(1429);
  const tWest = r.now + 300;
  r.W(1436, 12);
  r.W(1429, 60).KILL(1429).LV(1429);
  return { ...r.db(), tWest };
}

describe("K2-Web: Reise-Leiste mit Akten", () => {
  it("prepareJourney liefert Akte mit Kapiteln, Titel 'Akt I · Zone', Untertitel mit Stufe und Dauer, Kennzahlen des Akts", () => {
    const { journal, char } = twoZones();
    const data = prepareJourney(journal, char);
    expect(data.chapters.length).toBe(1);
    expect(data.acts.length).toBe(1);
    expect(data.acts[0].chapters).toEqual([0]);
    expect(actTitle("de", data.acts[0])).toBe("Akt I · Wald von Elwynn");
    expect(actTitle("en", data.acts[0])).toBe("Act I · Elwynn Forest");
    expect(actSubtitle("de", data.acts[0])).toBe("St. 1–3 · 2 Std. 12 Min.");
    expect(journal.chapters[0].via).toEqual(["Westfall"]);
    const st = journeyStats(journal, null, data.acts[0]);
    expect([st.levels, st.kills, st.quests]).toEqual([[1, 3], 2, 0]);
  });

  it("Akt öffnen springt an den Anfang, die Karte folgt beim Scrubben der Zone (Abstecher) und bleibt bei Pause stehen", () => {
    const { journal, char, tWest } = twoZones();
    const env = fakeEnv({ language: "de-DE" });
    const view = createJourneyView(env.doc, env.win, { journal, char, lang: "de" });
    const S = view.state;
    // Inhaltsverzeichnis: nur ein Band -> keine Bandzeile; der letzte Akt ist aufgeklappt, Siegel aus public/img
    expect(byClass(view.element, "jtoc-band").length).toBe(0);
    expect(byClass(view.element, "jtoc-act").length).toBe(1);
    expect(byClass(view.element, "jtoc-act")[0].attributes["aria-expanded"]).toBe("true");
    expect(byClass(view.element, "jtoc-seal")[0].attributes.src).toBe("img/act-seal-1.webp");
    expect(byClass(view.element, "jtoc-act")[0].textContent).toBe("Wald von ElwynnSt. 1–3 · 2 Std. 12 Min.");
    expect(byClass(view.element, "jtoc-sum")[0].textContent).toMatch(/^1 Akt · 1 Kapitel · Stufe /);
    byClass(view.element, "jtoc-act")[0].click();
    expect([S.act, S.chapter, S.pb.playing, S.pb.p === S.pb.p0]).toEqual([0, -1, false, true]);
    expect(S.map.mapID).toBe(1429);
    expect(byClass(view.element, "journey-title")[0].textContent).toBe("Akt I · Wald von Elwynn");
    expect(byClass(view.element, "journey-figures")[0].textContent).toBe("Stufe 1–3 · 2 Std. 12 Min. · 0 Quests · 1 Kapitel");
    // Zeitleiste in den Abstecher: Karte wechselt nach Westfall
    expect(zoneAt(journal, tWest).zone).toBe("1436");
    expect(flightAt(journal, tWest)).toBeNull();
    const scrub = findAll(view.element, (n) => n.className === "scrub")[0];
    const frac = (t) => {
      const lo = view.data.acts[0].t0, hi = view.data.acts[0].t1;
      return Math.round(((t - lo) / (hi - lo)) * 1000);
    };
    scrub.value = String(frac(tWest));
    scrub.dispatch("input");
    expect(S.map.mapID).toBe(1436);
    expect(S.pb.playing).toBe(false); // Pause/Scrubben: Zone bleibt stehen, kein Abspielen
    // ganz ans Ende: wieder Elwynn (die Karte folgt auch zurück)
    scrub.value = "990";
    scrub.dispatch("input");
    expect(S.map.mapID).toBe(1429);
    // Kapitel wählen, Esc auf der Karte: zurück zum Akt (Esc auf dem Akt: nichts, wie im Addon)
    byClass(view.element, "jtoc-chapter")[0].click();
    expect(byClass(view.element, "journey-figures")[0].textContent).toBe("Akt I · Stufe 1–3 · 2 Std. 12 Min. · 0 Quests");
    const canvas = findAll(view.element, (n) => n.className === "map-canvas")[0];
    canvas.dispatch("keydown", { key: "Escape" });
    expect([S.act, S.chapter]).toEqual([0, -1]);
    canvas.dispatch("keydown", { key: "Escape" });
    expect([S.act, S.chapter]).toEqual([0, -1]);
    view.destroy();
  });

  it("Bände nach Startstufe der Akte (1–20 / 21–40 / 41–60), nur vorhandene, Akkordeon", () => {
    const acts = [1, 12, 22, 35, 45].map((lv) => ({ levelFrom: lv }));
    expect(contentsBands(acts).map((b) => [b.roman, b.from, b.to, b.acts])).toEqual([["I", 1, 20, [0, 1]], ["II", 21, 40, [2, 3]], ["III", 41, 60, [4]]]);
    expect(contentsBands([{ levelFrom: 25 }, { levelFrom: 70 }]).map((b) => [b.index, b.acts])).toEqual([[2, [0]], [3, [1]]]);
  });

  it("Symbole zeigen: nur auf der Kontinentkarte, blendet die Ereignis-Knöpfe aus", () => {
    const { journal, char } = twoZones();
    const env = fakeEnv({ language: "de-DE" });
    const view = createJourneyView(env.doc, env.win, { journal, char, lang: "de" });
    const label = byClass(view.element, "icons-label")[0];
    expect(label.hidden).toBe(true);
    byClass(view.element, "mode-switch")[0].childNodes[1].click(); // Kontinent
    expect(byClass(view.element, "icons-label")[0].hidden).toBe(false);
    expect(byClass(view.element, "icons-label")[0].textContent).toBe("Symbole zeigen");
    const box = byClass(view.element, "icons-toggle")[0];
    box.checked = false;
    box.dispatch("change");
    expect(view.state.showIcons).toBe(false);
    expect(byClass(view.element, "map-pin").every((p) => p.hidden)).toBe(true);
    view.destroy();
  });
});
