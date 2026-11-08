// Chronik-Modell: Medaillen (Regeln und Schwellen wie im Addon), Dungeon-Läufe (echte Probe "Halle der Thanen" aus dem Addon),
// Stufenfluss, Erfahrungsquellen, Tode, Steckbrief. Daten sind synthetisch (keine echten Spielerdaten).
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { model, medal, makeDb, thanenOpts, THANEN, L, block, GUID, T0 } from "./helpers/chronik-sv.mjs";
import { MEDAL_STEPS, SEALS, TOUGH_DEATHS } from "../src/chronik/medals.mjs";
import { dungeonDetail, dungeonGroup } from "../src/chronik/dungeons.mjs";
import { fld, num } from "../src/chronik/log.mjs";

const ADDON_CHRONIK = fileURLToPath(new URL("../../EveN_ForeverChronicle/addon/InkAndEmbers/journal/model/Chronik.lua", import.meta.url));

// n Zeilen derselben Art im Abstand von 10 s
const rep = (n, make, from = 10) => Array.from({ length: n }, (_, i) => make(from + i * 10, i));

describe("Medaillen: Katalog", () => {
  it("35 Medaillen in 9 Familien, 29 mit drei Stufen und 6 einmalige: zusammen 93 Stufen", () => {
    const { m } = model({ lines: [L(0, "L", 1, "x", 1, 16001, "deDE", 3600)] });
    expect(m.medals.list).toHaveLength(35);
    expect(m.medals.total).toBe(35);
    expect(m.medals.stepsTotal).toBe(93);
    expect(m.medals.families).toHaveLength(9);
    expect(SEALS.filter((s) => s.steps)).toHaveLength(29);
    expect(SEALS.filter((s) => !s.steps).map((s) => s.id).sort()).toEqual(["continent", "epic", "guild", "level60", "mount", "raid"]);
    expect(m.medals.earned).toBe(0);
  });

  it.skipIf(!existsSync(ADDON_CHRONIK))("die Schwellen sind dieselben wie in Chronik.lua (MEDAL_STEPS, TOUGH_DEATHS)", () => {
    const src = readFileSync(ADDON_CHRONIK, "utf8").replace(/\r\n/g, "\n");
    const block = /Chronik\.MEDAL_STEPS = \{([\s\S]*?)\n\}/.exec(src)[1];
    const parsed = {};
    for (const mm of block.matchAll(/^\s*(\w+) = \{ ([^}]*) \}/gm)) {
      parsed[mm[1]] = mm[2].split(",").map((p) => p.split("*").reduce((a, b) => a * Number(b.trim()), 1));
    }
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(MEDAL_STEPS).sort());
    for (const id of Object.keys(parsed)) expect(MEDAL_STEPS[id], id).toEqual(parsed[id]);
    const tough = /Chronik\.TOUGH_DEATHS = \{ ([^}]*) \}/.exec(src)[1].split(",").map(Number);
    expect(TOUGH_DEATHS).toEqual(tough);
  });
});

describe("Medaillen: Regeln (gespiegelt aus den Addon-Tests)", () => {
  it("Ehrenhändel: nur ein gewonnenes Duell zählt", () => {
    const lost = ["loss", "fled", "opp_fled", "unknown"].map((r, i) => L(10 + i, "DU", "Bob", r, 8, 1420));
    expect(medal(model({ lines: lost }).m, "duel").earned).toBe(false);
    const won = model({ lines: [...lost, L(30, "LV", 9, 1420, 0, 0, ""), L(31, "DU", "Bob", "win", 9, 1420)] }).m;
    expect(medal(won, "duel")).toMatchObject({ earned: true, count: 1, value: 1 });
    expect(medal(won, "duel").steps[0].level).toBe(9);
  });

  it("Am Ziel der Reise: Stufe 60 (LV), nicht Stufe 59", () => {
    expect(medal(model({ lines: [L(5, "LV", 59, 1420, 5000, 5000, "")] }).m, "level60").earned).toBe(false);
    const m = model({ lines: [L(5, "LV", 59, 1420, 5000, 5000, ""), L(9, "LV", 60, 1420, 5000, 5000, "")] }).m;
    expect(medal(m, "level60")).toMatchObject({ earned: true, tier: "legendary" });
    expect(medal(m, "level60").steps[0].level).toBe(60);
  });

  it("Handwerker: erst ab Fertigkeit 150; ein später erster Eintrag auf 225 bricht Bronze und Silber", () => {
    const early = [L(5, "MO", "profession", "Schmiedekunst", 1, 5, 1420, ""), L(6, "MO", "profession", "Schmiedekunst", 75, 12, 1420, ""), L(7, "MO", "profession", "Kraeuterkunde", 75, 14, 1420, "")];
    expect(medal(model({ lines: early }).m, "profession").earned).toBe(false);
    const m = model({ lines: [...early, L(8, "MO", "profession", "Schmiedekunst", 150, 21, 1420, "")] }).m;
    expect(medal(m, "profession")).toMatchObject({ count: 1, value: 150 });
    expect(medal(m, "profession").steps[0].level).toBe(21);
    const late = model({ lines: [L(5, "MO", "profession", "Alchemie", 225, 40, 1420, "")] }).m;
    expect(medal(late, "profession")).toMatchObject({ count: 2, value: 225 });
    // Waffenfertigkeiten (SK ohne Höchstwert) zählen nicht, ein Beruf aus SK mit Höchstwert schon
    expect(medal(model({ lines: [L(5, "SK", "Schwerter", 140, "", 0, 5, "")] }).m, "profession").value).toBe(0);
    expect(medal(model({ lines: [L(5, "SK", "Alchemie", 160, 300, 171, 5, "")] }).m, "profession").value).toBe(160);
  });

  it("Freund der Fremden: erst ab Wohlwollend (6), Freundlich (5) reicht nicht", () => {
    const m5 = model({ lines: [L(5, "MO", "reputation", 72, 5, 3, 1420, ""), L(6, "MO", "reputation", 69, 5, 4, 1420, "")] }).m;
    expect(medal(m5, "reputation")).toMatchObject({ earned: false, value: 5 });
    const m6 = model({ lines: [L(5, "MO", "reputation", 72, 6, 22, 1420, "")] }).m;
    expect(medal(m6, "reputation")).toMatchObject({ count: 1, value: 6 });
    expect(medal(m6, "reputation").steps[0].level).toBe(22);
    expect(medal(model({ lines: [L(5, "MO", "reputation", 72, 8, 22, 1420, "")] }).m, "reputation").count).toBe(3);
  });

  it("Jenseits des Meeres: der Startkontinent zählt nicht, erst der zweite; Schnappschüsse genügen ohne Datum", () => {
    expect(medal(model({ lines: [L(5, "MO", "continent", 1, "", 1, 1420, "")] }).m, "continent").earned).toBe(false);
    const two = model({ lines: [L(5, "MO", "continent", 1, "", 1, 1420, ""), L(60, "MO", "continent", 2, "", 18, 1429, "")] }).m;
    expect(medal(two, "continent")).toMatchObject({ earned: true, tier: "silver" });
    expect(medal(two, "continent").steps[0].level).toBe(18);
    const one = model({ lines: [L(5, "SZ", 1, "Ort", 1)], snapshots: { continents: { 1: { seen: true, at: 5 } } } }).m;
    expect(medal(one, "continent")).toMatchObject({ earned: false, continents: 1 });
    const snap = model({ lines: [L(5, "SZ", 1, "Ort", 1)], snapshots: { continents: { 1: { seen: true, at: 5 }, 2: { seen: true, at: 9 } } } }).m;
    expect(medal(snap, "continent").earned).toBe(true);
    expect(medal(snap, "continent").steps[0].level).toBeNull();
  });

  it("Bossbezwinger: nur echte Bosse (Begegnung besiegt, Weltboss), nicht jeder ??-Gegner; dieselbe Begegnung zählt einmal", () => {
    const base = [
      L(5, "KI", 3001, -1, "normal", 1420, "", "self", "pk", "", 20),
      L(6, "KI", 3002, -1, "elite", 1420, "", "self", "pk", "", 20),
      L(7, "KI", 3003, 12, "elite", 1420, "", "self", "pk", "", 12),
      L(8, "MO", "first_boss", 3001, "normal", 20, 1420, ""),
      L(9, "IB", 7, 0, 60, 5, 1, 33),
    ];
    expect(medal(model({ lines: base }).m, "boss").value).toBe(0);
    expect(medal(model({ lines: [...base, L(10, "KI", 3004, -1, "worldboss", 1420, "", "self", "pk", "", 30)] }).m, "boss").value).toBe(1);
    const enc = model({ lines: [L(5, "IB", 7, 1, 90, 5, 1, 33), L(6, "IB", 7, 1, 90, 5, 1, 33), L(7, "MO", "boss", 7, "", 20, 1420, "")] }).m;
    expect(medal(enc, "boss").value).toBe(1);
  });

  it("Zählmedaillen: Bronze bei 75 Quests mit dem Beleg der 75. Abgabe, Silber bei 250", () => {
    const lines = [L(1, "LV", 5, 1429, 0, 0, "Wald"), ...rep(75, (t, i) => L(t, "QT", 1000 + i, 5, 5, 1429, 10, 1, "", "", "", 0, 0))];
    const e = medal(model({ lines }).m, "quests");
    expect(e).toMatchObject({ value: 75, count: 1, tier: "bronze", need: { tier: "silver", value: 250 } });
    expect(e.steps[0]).toMatchObject({ at: T0 + 10 + 74 * 10, level: 5 });
    const more = medal(model({ lines: rep(250, (t, i) => L(t, "QT", 1000 + i, 5, 5, 1429, 10, 1, "", "", "", 0, 0)) }).m, "quests");
    expect(more).toMatchObject({ value: 250, count: 2, tier: "silver" });
  });

  it("einmal verdient bleibt verdient: gespeicherte Stufen (snapshots.medals) zählen mit Datum und Stufe", () => {
    const m = model({ lines: [L(1, "QT", 1, 5, 5, 1429, 10, 1, "", "", "", 0, 0)], snapshots: { medals: { "quests:gold": { t: T0 + 5, level: 12 } } } }).m;
    const e = medal(m, "quests");
    expect(e).toMatchObject({ value: 1, count: 1, tier: "gold" });
    expect(e.steps[2]).toMatchObject({ at: T0 + 5, level: 12 });
  });

  it("Zähler ohne Logzeile (Angeln, Sammeln, Mitspieler, Emotes) kommen aus counters", () => {
    const m = model({ lines: [L(1, "LV", 5, 1429, 0, 0, "")], counters: { fishing: { a: 5, b: 7 }, gather: { erz: 100 }, mates: { x: 1, y: 2, z: 3 }, emotes: { e: 25 } } }).m;
    expect(medal(m, "angler")).toMatchObject({ value: 12, count: 1 });
    expect(medal(m, "gatherer")).toMatchObject({ value: 100, count: 1 });
    expect(medal(m, "companions")).toMatchObject({ value: 3, count: 0 });
    expect(medal(m, "social")).toMatchObject({ value: 25, count: 1 });
  });

  it("Unverwüstlich: Stufe 20 mit höchstens 10 Toden; mit 11 ist Bronze weg und Silber das nächste Ziel", () => {
    const deaths = (n) => rep(n, (t) => L(t, "DE", 5, 1429));
    const lv = [L(2000, "LV", 20, 1429, 0, 0, "")];
    expect(medal(model({ lines: [...deaths(10), ...lv] }).m, "tough")).toMatchObject({ count: 1, value: 20 });
    const e = medal(model({ lines: [...deaths(11), ...lv] }).m, "tough");
    expect(e.count).toBe(0);
    expect(e.need).toMatchObject({ tier: "silver", value: 40 });
    expect(e.toughDeaths).toBe(11);
    expect(medal(model({ lines: [...deaths(26), ...lv] }).m, "tough").noMore).toBe(false); // Gold (Stufe 60, 50 Tode) bleibt erreichbar
    expect(medal(model({ lines: [...deaths(51), ...lv] }).m, "tough")).toMatchObject({ noMore: true, need: null });
  });

  it("Ohne Fehltritt: längste Folge ganzer Stufen; nach einem Tod zählt erst die nächste volle Stufe", () => {
    const lvs = (from, to, t0) => Array.from({ length: to - from + 1 }, (_, i) => L(t0 + i, "LV", from + i, 1429, 0, 0, ""));
    const lines = [...lvs(2, 5, 10), L(30, "DE", 5, 1429), ...lvs(6, 8, 40)];
    const e = medal(model({ lines }).m, "flawless");
    expect(e).toMatchObject({ value: 4, count: 1 }); // 2,3,4,5 = 4; nach dem Tod: 6 zählt nicht, 7 und 8 = 2
    expect(e.run).toBe(2);
    expect(medal(model({ lines: [...lvs(2, 3, 10)] }).m, "flawless").count).toBe(0);
  });

  it("Lange unverwundet: aktive Spielzeit zwischen zwei Toden (Sitzungen), Bronze ab 3 Stunden", () => {
    const sessions = [{ start: T0, stop: T0 + 4 * 3600 }];
    const lines = [L(0, "LV", 2, 1429, 0, 0, ""), L(4 * 3600, "LV", 3, 1429, 0, 0, "")];
    const e = medal(model({ lines, sessions }).m, "unscathed");
    expect(e).toMatchObject({ value: 4 * 3600, count: 1 });
    expect(e.steps[0].at).toBeGreaterThanOrEqual(T0 + 3 * 3600 - 30);
    expect(e.steps[0].at).toBeLessThanOrEqual(T0 + 3 * 3600 + 30);
    const split = medal(model({ lines: [...lines, L(2 * 3600, "DE", 2, 1429)], sessions }).m, "unscathed");
    expect(split).toMatchObject({ value: 2 * 3600, count: 0 });
  });

  it("Vermögen, Blau, Rast, Ruhebonus, Dungeons: Zählweise wie im Addon", () => {
    const lines = [
      L(1, "GD", 100, 120000, "loot", 5, 1429), // 12 Gold
      L(2, "GD", -50, 20000, "buy", 5, 1429), // höchster Stand zählt, nicht der letzte
      L(3, "LT", "123", 1, 3, "mob", "", 5, 1429),
      L(4, "RA", "inn", 1429, 0, 0, 5, 0, ""),
      L(5, "RA", "fire", 1429, 0, 0, 5, 0, ""),
      L(6, "XP", "kill", 100, 40, "", "Wolf", "", 5, 1429, "msg"),
      L(7, "XP", "kill", 100, 9999, "", "Wolf", "", 5, 1429, "unclear"),
      L(8, "IE", 3065, "party", 1, 5, 17, 0, 2, 0, 0),
      L(9, "IE", 3065, "party", 1, 5, 17, 0, 2, 0, 0),
      L(10, "IE", 1, "raid", 14, 5, 17, 0, 2, 0, 0),
    ];
    const m = model({ lines }).m;
    expect(medal(m, "fortune")).toMatchObject({ value: 12, count: 1 });
    expect(medal(m, "blue")).toMatchObject({ value: 1, count: 1 });
    expect(medal(m, "regular").value).toBe(1);
    expect(medal(m, "campfire").value).toBe(1);
    expect(medal(m, "rested").value).toBe(40); // "unclear" zählt nicht
    expect(medal(m, "dungeon")).toMatchObject({ value: 1, count: 1 }); // dieselbe Instanz zweimal = einmal; der Raid zählt hier nicht
    expect(medal(m, "raid").earned).toBe(true);
  });

  it("Retail: Handwerker und Um Haaresbreite sind verborgen, solange nichts verdient ist", () => {
    const retail = model({ lines: [L(0, "L", 1, "x", 1, 120105, "deDE", 3600)] }).m;
    expect(medal(retail, "profession").hidden).toBe(true);
    expect(medal(retail, "close_win").hidden).toBe(true);
    expect(retail.medals.total).toBe(33);
    expect(retail.maxLevel).toBe(90);
    const forever = model({ lines: [L(0, "L", 1, "x", 1, 16001, "deDE", 3600)] }).m;
    expect(medal(forever, "profession").hidden).toBeUndefined();
    expect(forever.maxLevel).toBe(60);
  });
});

describe("Dungeons: echte Probe 'Halle der Thanen' aus dem Addon", () => {
  const { m } = model(thanenOpts());
  const run = m.dungeons.runs[0];

  it("vier Besuche mit kurzen Pausen sind EIN Durchlauf: Name, Schwierigkeit, Dauer, vier Bosse (ein Fehlversuch), drei Tode", () => {
    expect(m.dungeons.count).toBe(1);
    expect(run).toMatchObject({ name: "Die Halle der Thanen", difficultyID: 1, visits: 4, level0: 17, endKnown: true, kills: 39 + 15 + 9 + 28 });
    expect(run.seconds).toBe(1643 + 581 + 402 + 1136);
    expect(run.t1 - run.t0).toBeGreaterThan(run.seconds); // mit den Pausen zwischen den Besuchen
    expect(run.intervals).toHaveLength(8);
    expect(run.bossesDefeated).toBe(4);
    expect(run.bossesFromCount).toBe(false);
    expect(run.bosses.map((b) => b.name)).toEqual(["Faldrim Anvilmar", "Infurnus", "Plünderung", "Durgen Dirgehammer"]);
    expect(run.bosses[1]).toMatchObject({ id: 3495, attempts: 2, wipes: 1, defeated: true, seconds: 21 });
    expect(run.bosses.filter((b) => b.wipes > 0)).toHaveLength(1);
    expect(run.deathsCount).toBe(3);
  });

  it("Details: Tode mit Ursache aus DC, Funde ab Grün (nur im Dungeon), Quests, Stufe und Erfahrung aus dem Log", () => {
    const d = dungeonDetail(m.ctx, run);
    expect(d.deaths.map((x) => x.cause)).toEqual(["enemy", "enemy", "enemy"]);
    expect(d.deaths.map((x) => x.foe)).toEqual(["Plünderer der Dunkeleisenzwerge", "Magmatus", "Plünderer der Dunkeleisenzwerge"]);
    expect(d.deaths[1].sub).toBe("Der Dunkeleisenvorstoß");
    expect(d.loot.map((x) => x.name)).toEqual(["Katakombenumhang", "Golembrustschutz", "Veteranen-Gamaschen"]);
    expect(d.loot.map((x) => x.quality)).toEqual([2, 3, 2]);
    expect(d.loot.some((x) => x.itemID === 279898 || x.itemID === 279895)).toBe(false); // das Stück aus der Stadt danach nicht
    expect(d.quests.map((q) => q.title)).toEqual(["Faldrims Ende", "Tiefe Funde"]);
    expect(d.quests[0]).toMatchObject({ done: true, accepted: true, xp: 2300 });
    expect(d.quests[1]).toMatchObject({ done: false, accepted: true });
    expect(d.level1).toBe(18);
    // erwartete Erfahrung unabhängig gezählt: XP-Zeilen in den Besuchen (IE..IL)
    const inside = [];
    let open = null;
    for (const b of THANEN.blocks)
      for (const l of b.lines) {
        const p = l.split("~");
        const t = b.start + Number(p[0]);
        if (p[1] === "IE") open = t;
        else if (p[1] === "IL") {
          if (open !== null) inside.push([open, t]);
          open = null;
        }
      }
    let sum = 0;
    for (const b of THANEN.blocks)
      for (const l of b.lines) {
        const p = l.split("~");
        const t = b.start + Number(p[0]);
        if (p[1] === "XP" && p[10] !== "unclear" && inside.some(([a, z]) => t >= a && t <= z)) sum += Number(p[3]);
      }
    expect(d.xp).toBe(sum);
    expect(d.xp).toBeGreaterThan(0);
  });

  it("Gruppe: nur wer bei einem Bosssieg dabei war (Carl ging vor dem ersten Boss, Fritz schon vorher)", () => {
    const g = dungeonGroup(m.ctx, run);
    expect(g.map((x) => x.name.split("-")[0]).sort()).toEqual(["Alma", "Bruno", "Dora", "Emil"]);
    expect(g.find((x) => x.name.startsWith("Alma"))).toMatchObject({ cls: "WARLOCK" });
    expect(g.some((x) => x.name.startsWith("Carl") || x.name.startsWith("Fritz"))).toBe(false);
    expect(g[0].seconds).toBeGreaterThanOrEqual(g[g.length - 1].seconds);
  });

  it("Tod im Dungeon ohne Kartenangabe: Ort ist die Instanz aus dem Besuch", () => {
    expect(m.deaths).toHaveLength(3);
    expect(m.deaths[0]).toMatchObject({ place: "Die Halle der Thanen", instance: "Die Halle der Thanen", cause: "enemy", foe: "Plünderer der Dunkeleisenzwerge" });
    expect(m.deaths[1].place).toBe("Der Dunkeleisenvorstoß");
  });
});

describe("Dungeons: Zusammenfassen, Pausen, Sonderfälle", () => {
  const visit = (t, dur, id, diff = 1, extra = {}) => [L(t, "IE", id, "party", diff, 5, extra.level ?? 20, 1, "", "", extra.resumed ? 1 : 0), ...(extra.open ? [] : [L(t + dur, "IL", id, extra.nilSeconds ? "" : dur, extra.kills ?? 5, extra.deaths ?? 0, extra.bosses ?? 0, 0)])];
  const runsOf = (lines, sessions) => model({ lines, sessions: sessions || [{ start: T0 - 100, stop: T0 + 90000 }] }).m.dungeons.runs;

  it("Pause-Grenze: genau 30 Minuten bleibt ein Durchlauf, eine Sekunde mehr trennt; andere Schwierigkeit und andere Instanz trennen", () => {
    const lines = [
      ...visit(0, 600, 100),
      ...visit(600 + 1800, 300, 100), // Pause exakt 1800 s
      ...visit(2700 + 1801, 300, 100), // 1801 s: neuer Durchlauf
      ...visit(5000, 100, 100, 2), // heroisch: eigener Durchlauf
      ...visit(5200, 100, 200, 2), // andere Instanz
      ...visit(5400, 100, 100, 2), // zurück, aber dazwischen eine andere Instanz
    ];
    const runs = runsOf(lines);
    expect(runs.map((r) => [r.instanceID, r.difficultyID, r.visits])).toEqual([[100, 2, 1], [200, 2, 1], [100, 2, 1], [100, 1, 1], [100, 1, 2]]);
    expect(runs[4].seconds).toBe(900);
  });

  it("offener Besuch (Absturz ohne IL) endet mit der Sitzung; Fortsetzung nach /reload bleibt ein Besuch; ohne Boss-Zeilen zählt die Zahl des Sammlers", () => {
    const lines = [
      ...visit(0, 0, 100, 1, { open: true }),
      ...visit(6000, 0, 300, 1, { open: true }),
      L(6100, "IE", 300, "party", 1, 5, 21, 1, "", "", 1),
      L(6400, "IL", 300, 400, 7, 0, 1, 0),
    ];
    const runs = runsOf(lines, [{ start: T0 - 100, stop: T0 + 5000 }, { start: T0 + 5900, stop: T0 + 7000 }]);
    expect(runs).toHaveLength(2);
    expect(runs[1]).toMatchObject({ instanceID: 100, visits: 1, endKnown: false });
    expect(runs[0]).toMatchObject({ instanceID: 300, visits: 1, endKnown: true, seconds: 400, level1: 21, bossesDefeated: 1, bossesFromCount: true });
  });

  it("IL ohne Dauer (beim nächsten Login nachgetragen): unbekanntes Ende, keine Offline-Zeit in der Dauer", () => {
    const lines = [L(0, "IE", 100, "party", 1, 5, 20, 1, "", "", 0), L(40100, "IL", 100, "", 5, 0, 0, 0)];
    const runs = runsOf(lines, [{ start: T0 - 100, stop: T0 + 5000 }, { start: T0 + 40000, stop: T0 + 50000 }]);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ endKnown: false, seconds: 5000 });
  });

  it("ein Boss nur mit Fehlversuchen bleibt in der Liste, ohne als besiegt zu zählen; fremde Instanz-ID wird ignoriert", () => {
    const lines = [
      L(0, "IE", 100, "party", 1, 5, 20, 1, "", "", 0),
      L(100, "IB", 11, 0, 30, 5, 1, 100),
      L(200, "IB", 11, 0, 31, 5, 1, 100),
      L(300, "IB", 12, 1, 40, 5, 1, 100),
      L(350, "IB", 99, 1, 40, 5, 1, 555),
      L(400, "IL", 100, 400, 3, 0, 1, 0),
    ];
    const run = runsOf(lines)[0];
    expect(run.bosses.map((b) => [b.id, b.defeated, b.wipes])).toEqual([[11, false, 2], [12, true, 0]]);
    expect(run.bossesDefeated).toBe(1);
  });

  it("keine Instanzen: leere Liste, kein Fehler", () => {
    const { m } = model({ lines: [L(0, "L", 1, "x", 1, 16001, "deDE", 3600)] });
    expect(m.dungeons).toMatchObject({ count: 0, runs: [], truncated: false });
  });
});

describe("Stufenfluss, Erfahrungsquellen, Tode, Steckbrief", () => {
  const lines = [
    L(0, "L", 1, "x", 1, 16001, "deDE", 3600),
    L(10, "PL", 600, 0, 2, "levelup"),
    L(10, "LV", 2, 1429, 0, 0, ""),
    L(20, "DE", 2, 1429),
    L(30, "DE", 2, 1429),
    L(40, "PL", 2300, 0, 3, "levelup"),
    L(40, "LV", 3, 1429, 0, 0, ""),
    L(50, "DE", 3, 1429),
    L(55, "DE", "", 1429),
    L(60, "PL", 3950, 0, 4, "levelup"),
    L(60, "LV", 4, 1429, 0, 0, ""),
    L(70, "PL", 4000, 50, 4, "played"),
  ];
  const { m } = model({ lines, counters: { afk: { seconds: 90, phases: 2 } }, sessions: [{ start: T0, stop: T0 + 100 }, { start: T0 + 150, stop: T0 + 160 }] });

  it("Dauern aus PL (Stufe 1 beginnt bei 0), laufende Stufe, Summe = Spielzeit, schnellste/langsamste Stufe", () => {
    expect(m.flow.cols.map((c) => [c.level, c.seconds, c.deaths])).toEqual([[1, 600, 0], [2, 1700, 2], [3, 1650, 1], [4, 50, 0]]);
    expect(m.flow.cols[3].current).toBe(true);
    expect(m.flow.total).toBe(m.profile.played);
    expect(m.flow).toMatchObject({ fastest: 1, slowest: 2, deathsNoLevel: 1, deathsTotal: 4 });
  });

  it("Steckbrief: Name, Stufe, Spielzeit aus der letzten /played-Antwort, Sitzungen, Abwesenheit erst ab einer Minute", () => {
    expect(m.profile).toMatchObject({ name: "Testa", level: 4, played: 4000, playedExact: true, sessions: 2, race: "Mensch", cls: "Paladin", realm: "Probenwacht" });
    expect(m.profile.afk).toEqual({ seconds: 90, phases: 2 });
    expect(model({ lines, counters: { afk: { seconds: 30, phases: 1 } } }).m.profile.afk).toBeNull();
  });

  it("Erfahrungsquellen: Anteile je Quelle, Ruhebonus und unklare Sprünge getrennt", () => {
    const xp = [
      L(1, "XP", "quest", 3000, "", "", "", 5, 5, 1429, "msg"),
      L(2, "XP", "kill", 1000, 200, "", "Wolf", "", 5, 1429, "msg"),
      L(3, "XP", "explore", 500, "", "", "Ort", "", 5, 1429, "msg"),
      L(4, "XP", "gibtsnicht", 500, "", "", "", "", 5, 1429, "diff"),
      L(5, "XP", "", "", "", "", "", "", 6, 1429, "unclear"),
      L(6, "XP", "kill", "", "", "", "", "", 6, 1429, "unclear"),
    ];
    const s = model({ lines: xp }).m.sources;
    expect(s.total).toBe(5000);
    expect(s.parts.map((p) => [p.key, p.amount, Math.round(p.pct)])).toEqual([["quest", 3000, 60], ["kill", 1000, 20], ["explore", 500, 10], ["other", 500, 10]]);
    expect(s.rested).toBe(200);
    expect(s.unclear).toBe(2);
    expect(model({ lines: [L(0, "L", 1, "x", 1, 16001, "deDE", 3600)] }).m.sources).toMatchObject({ total: 0, parts: [], unclear: 0 });
  });

  it("Tode: Ursache nur aus einer DC-Zeile bis 5 Sekunden danach; Fremdname aus npcs, 'vermutet' als Merkmal", () => {
    const dl = [
      L(10, "DE", 7, 1429, 0, 0, 0, 1, "Mondbruch"),
      L(12, "DC", 55, "", 1, "enemy", 1, 10, 100),
      L(100, "DE", 7, 1429),
      L(107, "DC", 55, "", 1, "enemy", 0, 10, 100), // zu spät
      L(200, "DE", 8, 1429),
      L(201, "DC", "", "Sturzbach", "", "fall", 0, 10, 100),
    ];
    const d = model({ lines: dl, npcs: { 55: "Gnoll" } }).m.deaths;
    expect(d).toHaveLength(3);
    expect(d[0]).toMatchObject({ level: 7, place: "Mondbruch", cause: "enemy", foe: "Gnoll", guess: true, combat: true });
    expect(d[1]).toMatchObject({ cause: null, foe: null });
    expect(d[2]).toMatchObject({ level: 8, cause: "fall", foe: "Sturzbach" });
  });

  it("Datei ohne Ereignisse und ohne /played: kein Fehler, leere Zustände", () => {
    const { m: empty } = model({ lines: [] });
    expect(empty.profile.level).toBe(1);
    expect(empty.flow.complete).toBe(0);
    expect(empty.deaths).toEqual([]);
    expect(empty.medals.earned).toBe(0);
  });

  it("beschädigte Zeilen (Text statt Zahl, fehlende Felder, unbekannte Kürzel) werfen nichts", () => {
    const junk = [L(1, "LV", "abc"), L(2, "QT"), L(3, "ZZ", 1), L(5, "IE", "x", "party"), L(6, "IL"), L(7, "DE", "?"), L(8, "WB"), L(9, "XP", "kill", "NaN"), "kaputt", L(10, "KI", "", "", "", "", "", "", "", "", "99999")];
    expect(() => model({ lines: junk })).not.toThrow();
  });

  it("Zeilenkürzel wie constructor oder __proto__ treffen keine Eigenschaft von Object (Feldzugriff der Chronik)", () => {
    for (const code of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(fld({ code, f: ["1", "2"] }, "level")).toBeNull();
      expect(num({ code, f: ["1", "2"] }, "level")).toBeNull();
    }
  });
});
