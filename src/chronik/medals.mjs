// Medaillen der Reise (35 Medaillen in 9 Familien, 29 davon in drei Stufen Bronze/Silber/Gold, 6 einmalige mit fester Stufe;
// zusammen 93 Stufen). Portiert aus addon/InkAndEmbers/journal/model/Chronik.lua (MEDAL_STEPS, SEALS, EVAL.*, sealEntry): dieselben
// Schwellen, dieselbe Zählweise, dieselben Belege. Reine Berechnung auf den Zeilen des Charakters, keine Texte, kein DOM.
// Unterschied zum Addon: der Index (Listen/Zähler) wird hier aus den Zeilen selbst gebildet; "Tode" gibt es als Medaille nicht.
import { isTable } from "../core/lua-parse.mjs";
import { fld, num, levelOf, validLevel, toNum, posId, snapGroup, bsearchLE, counterValue, isFiniteNum, activeSeconds } from "./log.mjs";

export const TIER_ORDER = ["bronze", "silver", "gold"];

// Schwellen Bronze / Silber / Gold (Bezugskurve: Classic 1-60)
export const MEDAL_STEPS = {
  explorer: [6, 15, 26], // verschiedene Gebiete (ZN mapType 3)
  pathfinder: [60, 180, 350], // entdeckte Orte (SZ)
  flightmaster: [5, 12, 20], // entdeckte Flugpunkte (FP)
  frequent_flyer: [10, 60, 150], // Flüge (TF)
  hunter: [1500, 5000, 9000], // besiegte Gegner (KI)
  elite_hunter: [25, 150, 400], // Elite (KI elite/rareelite)
  rare_hunter: [1, 5, 12], // Seltene (KI rare/rareelite)
  close_win: [5, 20, 50], // knappe Siege (KF close)
  duel: [1, 10, 30], // gewonnene Duelle (DU win)
  quests: [75, 250, 500], // abgegebene Quests (QT)
  reputation: [6, 7, 8], // beste Rufstufe: Wohlwollend / Respektvoll / Ehrfürchtig
  books: [3, 12, 30], // Bücher mit mindestens zwei Seiten (BK)
  profession: [150, 225, 300], // bester Beruf
  fortune: [10, 100, 300], // höchster Kontostand in Gold
  blue: [1, 10, 25], // seltene (blaue) Stücke (LT Güte 3)
  angler: [10, 100, 400], // gefangene Fische (counters.fishing)
  gatherer: [100, 750, 2000], // gesammelt (counters.gather)
  companions: [5, 25, 60], // verschiedene Mitspieler (counters.mates)
  social: [25, 150, 500], // Emotes (counters.emotes)
  regular: [40, 150, 350], // Rasten im Gasthaus/der Stadt (RA inn)
  campfire: [3, 15, 50], // Rasten am Lagerfeuer (RA fire)
  rested: [20000, 150000, 400000], // Erfahrung mit Ruhebonus
  hearth: [15, 60, 150], // Ruhestein-Benutzungen (HS)
  tough: [20, 40, 60], // Stufe mit höchstens TOUGH_DEATHS[k] Toden bis dahin
  flawless: [3, 6, 10], // Stufen am Stück ohne Tod
  unscathed: [3 * 3600, 8 * 3600, 16 * 3600], // aktive Spielzeit am Stück ohne Tod (s)
  dungeon: [1, 5, 10], // verschiedene Dungeons (IE party)
  boss: [5, 25, 60], // verschiedene Bosse
  plans: [1, 5, 15], // erfüllte eigene Vorhaben (VE)
};
export const TOUGH_DEATHS = [10, 25, 50];
export const CONTINENT_SEAL = 2;

// Familien in Rasterreihenfolge
export const FAMILIES = ["travel", "combat", "lore", "treasure", "fellows", "rest", "survival", "instance", "moments"];

// Katalog: id, Familie, steps = Schwellen (fehlt: einmalige Medaille mit fester Stufe tier), unit = Art der Zahl für die Anzeige
export const SEALS = [
  { id: "explorer", family: "travel", steps: MEDAL_STEPS.explorer },
  { id: "pathfinder", family: "travel", steps: MEDAL_STEPS.pathfinder },
  { id: "continent", family: "travel", tier: "silver" },
  { id: "flightmaster", family: "travel", steps: MEDAL_STEPS.flightmaster },
  { id: "frequent_flyer", family: "travel", steps: MEDAL_STEPS.frequent_flyer },
  { id: "hunter", family: "combat", steps: MEDAL_STEPS.hunter },
  { id: "elite_hunter", family: "combat", steps: MEDAL_STEPS.elite_hunter },
  { id: "rare_hunter", family: "combat", steps: MEDAL_STEPS.rare_hunter },
  { id: "close_win", family: "combat", steps: MEDAL_STEPS.close_win, retailHidden: true, needsHealth: true },
  { id: "duel", family: "combat", steps: MEDAL_STEPS.duel },
  { id: "quests", family: "lore", steps: MEDAL_STEPS.quests },
  { id: "reputation", family: "lore", steps: MEDAL_STEPS.reputation, unit: "standing" },
  { id: "books", family: "lore", steps: MEDAL_STEPS.books },
  { id: "profession", family: "lore", steps: MEDAL_STEPS.profession, unit: "skill", retailHidden: true },
  { id: "fortune", family: "treasure", steps: MEDAL_STEPS.fortune, unit: "gold" },
  { id: "blue", family: "treasure", steps: MEDAL_STEPS.blue },
  { id: "epic", family: "treasure", tier: "gold" },
  { id: "angler", family: "treasure", steps: MEDAL_STEPS.angler },
  { id: "gatherer", family: "treasure", steps: MEDAL_STEPS.gatherer },
  { id: "guild", family: "fellows", tier: "bronze" },
  { id: "companions", family: "fellows", steps: MEDAL_STEPS.companions },
  { id: "social", family: "fellows", steps: MEDAL_STEPS.social },
  { id: "regular", family: "rest", steps: MEDAL_STEPS.regular },
  { id: "campfire", family: "rest", steps: MEDAL_STEPS.campfire },
  { id: "rested", family: "rest", steps: MEDAL_STEPS.rested, unit: "ep" },
  { id: "hearth", family: "rest", steps: MEDAL_STEPS.hearth },
  { id: "tough", family: "survival", steps: MEDAL_STEPS.tough, unit: "tough" },
  { id: "flawless", family: "survival", steps: MEDAL_STEPS.flawless },
  { id: "unscathed", family: "survival", steps: MEDAL_STEPS.unscathed, unit: "duration" },
  { id: "dungeon", family: "instance", steps: MEDAL_STEPS.dungeon },
  { id: "boss", family: "instance", steps: MEDAL_STEPS.boss },
  { id: "raid", family: "instance", tier: "gold" },
  { id: "mount", family: "moments", tier: "gold" },
  { id: "plans", family: "moments", steps: MEDAL_STEPS.plans },
  { id: "level60", family: "moments", tier: "legendary" },
];

// Zähler ohne Logzeile (counters des Charakters): id -> Zählergruppe
const LIVE = { angler: ["fishing", false], gatherer: ["gather", false], companions: ["mates", true], social: ["emotes", false] };

// höchste Stufe des Clients: Forever 60; Retail nach Interface-Nummer (Annahme: 90 ab Midnight, 80 ab The War Within, sonst 70)
export function maxLevelFor(flavor, iface) {
  if (flavor !== "retail") return 60;
  if (typeof iface === "number" && iface >= 120000) return 90;
  if (typeof iface === "number" && iface >= 110000) return 80;
  return 70;
}

function medalCtx(ctx) {
  const C = { ctx, char: ctx.char };
  const lvT = [];
  const lvL = [];
  const lvRec = [];
  for (const ev of ctx.list("LV")) {
    const L = levelOf(ev);
    if (L !== null && isFiniteNum(ev.t)) {
      lvT.push(ev.t);
      lvL.push(L);
      lvRec.push(ev);
    }
  }
  Object.assign(C, { lvT, lvL, lvRec });
  // Stufe zum Zeitpunkt t aus den Stufenaufstiegen (vor dem ersten: eine darunter)
  C.levelAt = (t) => {
    if (!isFiniteNum(t) || lvT.length === 0) return null;
    const i = bsearchLE(lvT, t);
    if (i < 0) return lvL[0] > 1 ? lvL[0] - 1 : null;
    return lvL[i];
  };
  const zoneOf = (ev) => {
    const sub = fld(ev, "sub");
    if (sub) return sub;
    const m = posId(fld(ev, "mapID"));
    return m ? ctx.mapName(m) : null;
  };
  C.hit = (ev) => ({ t: ev.t, level: levelOf(ev) ?? C.levelAt(ev.t), zone: zoneOf(ev) });
  C.at = (t) => ({ t, level: C.levelAt(t) });
  C.list = (code) => ctx.list(code);
  C.filter = (code, test) => ctx.list(code).filter((ev) => !test || test(ev));
  // erste Zeile je Schlüssel (verschiedene Gebiete, Dungeons, Bücher ...), in Logreihenfolge
  C.distinct = (code, keyOf) => {
    const out = [];
    const seen = new Set();
    for (const ev of ctx.list(code)) {
      const k = keyOf(ev);
      if (k !== null && k !== undefined && !seen.has(k)) {
        seen.add(k);
        out.push(ev);
      }
    }
    return out;
  };
  const mo = new Map();
  for (const ev of ctx.list("MO")) {
    const k = fld(ev, "kind");
    if (!k) continue;
    if (!mo.has(k)) mo.set(k, []);
    mo.get(k).push(ev);
  }
  C.moList = (kind) => mo.get(kind) || [];
  C.mo = (kind, min) => {
    for (const ev of C.moList(kind)) {
      if (min === undefined) return ev;
      const d = num(ev, "detail");
      if (d !== null && d >= min) return ev;
    }
    return null;
  };
  const ki = new Map();
  for (const ev of ctx.list("KI")) {
    const c = fld(ev, "cls");
    if (!c) continue;
    if (!ki.has(c)) ki.set(c, []);
    ki.get(c).push(ev);
  }
  C.ki = (...classes) => ctx.list("KI").filter((ev) => classes.includes(fld(ev, "cls")));
  C.kiClass = (c) => ki.get(c) || [];
  const moments = snapGroup(ctx.char, "moments") || {};
  // snapshots.moments[kind]: erstes Mal ohne Ort
  C.snap = (kind) => {
    const e = moments[kind];
    if (!isTable(e) || e.seen !== true) return null;
    return { t: toNum(e.at), level: validLevel(e.level) };
  };
  return C;
}

// Belege einer zählenden Medaille: Stufe k ist verdient, wenn value >= steps[k]; Beleg = die steps[k]-te Zeile (sonst {})
function byRecords(C, steps, value, recs) {
  return steps.map((need) => (value >= need ? (recs && recs[need - 1] ? C.hit(recs[need - 1]) : {}) : null));
}

function byTimes(C, steps, value, times) {
  return steps.map((need) => {
    if (value < need) return null;
    const t = times && times[need - 1];
    return isFiniteNum(t) ? C.at(t) : {};
  });
}

const countOf = (code, test) => (C, steps) => {
  const recs = C.filter(code, test);
  return [recs.length, byRecords(C, steps, recs.length, recs)];
};

function bestDetail(C, kind) {
  let best = null;
  for (const ev of C.moList(kind)) {
    const d = num(ev, "detail");
    if (d !== null && (best === null || d > best)) best = d;
  }
  return best;
}

const onceOf = (hit) => [hit ? 1 : 0, [hit || null]];

// Güte einer Beutezeile: Feld quality, sonst Güte des Gegenstands im Schnappschuss; null = unbekannt
function lootQuality(C, ev) {
  const q = num(ev, "quality");
  if (q !== null) return q;
  const snap = C.ctx.itemSnap(fld(ev, "item"));
  return snap ? toNum(snap.quality) : null;
}

// Auswertung je Medaille: (C, steps) -> [Zählwert, Belege je Stufe]
const EVAL = {};
EVAL.explorer = (C, steps) => {
  const recs = C.distinct("ZN", (ev) => (fld(ev, "mapType") === "3" ? posId(fld(ev, "mapID")) : null));
  return [recs.length, byRecords(C, steps, recs.length, recs)];
};
EVAL.pathfinder = countOf("SZ");
EVAL.flightmaster = countOf("FP");
EVAL.frequent_flyer = countOf("TF");
EVAL.hunter = (C, steps) => {
  const recs = C.list("KI");
  return [recs.length, byRecords(C, steps, recs.length, recs)];
};
EVAL.elite_hunter = (C, steps) => {
  const recs = C.ki("elite", "rareelite");
  return [recs.length, byRecords(C, steps, recs.length, recs)];
};
EVAL.rare_hunter = (C, steps) => {
  const recs = C.ki("rare", "rareelite");
  return [recs.length, byRecords(C, steps, recs.length, recs)];
};
EVAL.close_win = countOf("KF", (ev) => fld(ev, "close") === "1");
EVAL.duel = countOf("DU", (ev) => fld(ev, "result") === "win");
EVAL.quests = countOf("QT");
EVAL.reputation = (C, steps) => {
  const best = bestDetail(C, "reputation") ?? 0;
  const earned = steps.map((need) => {
    const ev = C.mo("reputation", need);
    return ev ? C.hit(ev) : null;
  });
  return [best, earned];
};
EVAL.books = (C, steps) => {
  const recs = C.distinct("BK", (ev) => {
    const p = num(ev, "page");
    return p === null || p < 2 ? null : fld(ev, "key");
  });
  return [recs.length, byRecords(C, steps, recs.length, recs)];
};
EVAL.profession = (C, steps) => {
  let value = bestDetail(C, "profession") ?? 0;
  for (const ev of C.list("SK")) {
    const rank = num(ev, "rank");
    const cap = num(ev, "max");
    if (rank !== null && cap !== null && rank >= 0 && rank > value) value = rank;
  }
  const earned = steps.map((need) => {
    const ev = C.mo("profession", need);
    if (ev) return C.hit(ev);
    return value >= need ? {} : null;
  });
  return [Math.floor(value), earned];
};
EVAL.fortune = (C, steps) => {
  let peak = 0;
  for (const ev of C.list("GD")) {
    const b = num(ev, "balance");
    if (b !== null && b > peak) peak = b;
  }
  const value = peak > 0 ? Math.floor(peak / 10000) : 0;
  const gd = C.list("GD");
  const earned = steps.map((need) => {
    if (value < need) return null;
    for (const ev of gd) {
      const b = num(ev, "balance");
      if (b !== null && b >= need * 10000) return C.hit(ev);
    }
    return {};
  });
  return [value, earned];
};
EVAL.blue = (C, steps) => {
  const recs = C.list("LT").filter((ev) => lootQuality(C, ev) === 3);
  let value = recs.length;
  const earned = byRecords(C, steps, value, recs);
  if (value === 0) {
    // ältere Daten: der Moment "erstes seltenes Stück" ohne LT-Zeile
    const mo = C.mo("first_blue");
    const hit = mo ? C.hit(mo) : C.snap("first_blue");
    if (hit) {
      value = 1;
      earned[0] = hit;
    }
  }
  return [value, earned];
};
EVAL.epic = (C) => {
  const mo = C.mo("first_epic");
  if (mo) return onceOf(C.hit(mo));
  for (const ev of C.list("LT")) {
    const q = num(ev, "quality");
    if (q !== null && q >= 4) return onceOf(C.hit(ev));
  }
  return onceOf(C.snap("first_epic"));
};
EVAL.guild = (C) => {
  const ev = C.filter("GU", (x) => ["join", "seen", "change"].includes(fld(x, "action")))[0];
  return onceOf(ev ? C.hit(ev) : null);
};
EVAL.regular = (C, steps) => {
  const times = C.filter("RA", (ev) => fld(ev, "kind") === "inn").map((ev) => ev.t);
  return [times.length, byTimes(C, steps, times.length, times)];
};
EVAL.campfire = (C, steps) => {
  const times = C.filter("RA", (ev) => fld(ev, "kind") === "fire").map((ev) => ev.t);
  return [times.length, byTimes(C, steps, times.length, times)];
};
EVAL.rested = (C, steps) => {
  let sum = 0;
  for (const ev of C.list("XP")) {
    if (fld(ev, "via") === "unclear") continue;
    const r = num(ev, "rested");
    if (r !== null) sum += r;
  }
  const value = sum > 0 ? Math.floor(sum) : 0;
  return [value, byTimes(C, steps, value, null)];
};
EVAL.hearth = countOf("HS");
// tough: Stufe steps[k] erreicht mit höchstens TOUGH_DEATHS[k] Toden bis dahin (jede Stufe für sich)
EVAL.tough = (C, steps) => {
  const deathT = C.list("DE").map((ev) => ev.t).filter(isFiniteNum).sort((a, b) => a - b);
  const earned = steps.map((L, k) => {
    for (let i = 0; i < C.lvL.length; i++) {
      if (C.lvL[i] >= L) {
        const before = bsearchLE(deathT, C.lvT[i] - 0.001) + 1;
        return before <= (TOUGH_DEATHS[k] ?? 0) ? C.hit(C.lvRec[i]) : null;
      }
    }
    return null;
  });
  C.toughDeaths = deathT.length;
  return [C.lvL.length ? C.lvL[C.lvL.length - 1] : 1, earned];
};
// flawless: längste Folge ganzer Stufen ohne Tod (nach einem Tod zählt erst die nächste volle Stufe)
EVAL.flawless = (C, steps) => {
  const evs = [];
  C.lvT.forEach((t, i) => evs.push({ t, lv: i }));
  for (const ev of C.list("DE")) if (isFiniteNum(ev.t)) evs.push({ t: ev.t, de: true });
  evs.sort((a, b) => (a.t !== b.t ? a.t - b.t : (a.de ? 0 : 1) - (b.de ? 0 : 1))); // gleiche Sekunde: erst der Tod
  let run = 0;
  let best = 0;
  let clean = true;
  let top = 0;
  const earned = steps.map(() => null);
  for (const e of evs) {
    if (e.de) {
      run = 0;
      clean = false;
    } else if (C.lvL[e.lv] <= top) {
      // dieselbe Stufe noch einmal (doppelte LV-Zeile): zählt nicht
    } else if (clean) {
      run++;
      if (run > best) {
        best = run;
        steps.forEach((need, k) => {
          if (!earned[k] && run >= need) earned[k] = C.hit(C.lvRec[e.lv]);
        });
      }
    } else {
      clean = true;
    }
    if (e.lv !== undefined && C.lvL[e.lv] > top) top = C.lvL[e.lv];
  }
  C.flawlessRun = run;
  C.flawlessTop = top;
  return [best, earned];
};
// unscathed: längste aktive Spielzeit zwischen zwei Toden (oder seit dem Start bis zur letzten Zeile)
EVAL.unscathed = (C, steps) => {
  const { ctx } = C;
  const earned = steps.map(() => null);
  const start = ctx.startT;
  if (!isFiniteNum(start)) return [0, earned];
  const bounds = [start];
  for (const ev of C.list("DE")) if (isFiniteNum(ev.t) && ev.t >= start) bounds.push(ev.t);
  bounds.sort((a, b) => a - b);
  const stop = isFiniteNum(ctx.lastT) ? ctx.lastT : start;
  bounds.push(Math.max(stop, bounds[bounds.length - 1]));
  let best = 0;
  for (let i = 0; i < bounds.length - 1; i++) {
    const a = bounds[i];
    const b = bounds[i + 1];
    const len = activeSeconds(ctx.sessions, a, b);
    if (len > best) best = len;
    steps.forEach((need, k) => {
      if (earned[k] || len < need) return;
      let lo = a;
      let hi = b; // kleinste Zeit t mit aktiver Zeit [a, t] >= need
      for (let n = 0; n < 40 && hi - lo > 30; n++) {
        const mid = Math.floor((lo + hi) / 2);
        if (activeSeconds(ctx.sessions, a, mid) >= need) hi = mid;
        else lo = mid;
      }
      earned[k] = C.at(hi);
    });
  }
  C.unscathedNow = activeSeconds(ctx.sessions, bounds[bounds.length - 2], bounds[bounds.length - 1]);
  return [Math.floor(best), earned];
};
EVAL.dungeon = (C, steps) => {
  const recs = C.distinct("IE", (ev) => (fld(ev, "type") === "party" ? posId(fld(ev, "instanceID")) ?? fld(ev, "instanceID") : null));
  return [recs.length, byRecords(C, steps, recs.length, recs)];
};
// boss: verschiedene Begegnungen (IB Sieg, MO boss = encounterID) und Weltbosse (KI worldboss), nach Zeit
EVAL.boss = (C, steps) => {
  const hits = [];
  const seen = new Set();
  const add = (key, ev) => {
    if (key && !seen.has(key)) {
      seen.add(key);
      hits.push(C.hit(ev));
    }
  };
  for (const ev of C.list("IB")) if (fld(ev, "success") === "1") add("e" + fld(ev, "encounterID"), ev);
  for (const ev of C.moList("boss")) add("e" + fld(ev, "value"), ev);
  for (const ev of C.kiClass("worldboss")) add("n" + fld(ev, "npcID"), ev);
  hits.sort((a, b) => (isFiniteNum(a.t) ? a.t : 0) - (isFiniteNum(b.t) ? b.t : 0));
  return [hits.length, steps.map((need) => (hits.length >= need ? hits[need - 1] : null))];
};
EVAL.raid = (C) => {
  const ev = C.filter("IE", (x) => fld(x, "type") === "raid")[0];
  if (ev) return onceOf(C.hit(ev));
  const mo = C.mo("first_raid");
  return onceOf(mo ? C.hit(mo) : C.snap("first_raid"));
};
EVAL.mount = (C) => {
  const mo = C.mo("mount");
  return onceOf(mo ? C.hit(mo) : C.snap("mount"));
};
EVAL.plans = countOf("VE");
// continent: der erste erfasste Kontinent ist der Start, verdient mit dem zweiten (MO continent oder Schnappschüsse)
EVAL.continent = (C) => {
  const list = C.moList("continent");
  if (list.length >= CONTINENT_SEAL) return onceOf(C.hit(list[CONTINENT_SEAL - 1]));
  const c = snapGroup(C.char, "continents");
  let seen = 0;
  if (c) for (const k of Object.keys(c)) if (isTable(c[k])) seen++;
  C.continents = Math.max(list.length, seen);
  if (seen >= CONTINENT_SEAL) return [1, [{}]];
  return [0, [null]];
};
EVAL.level60 = (C) => {
  const top = C.maxLevel;
  for (const code of ["LV", "PL"]) {
    for (const ev of C.list(code)) {
      const L = levelOf(ev);
      if (L !== null && L >= top) return onceOf(C.hit(ev));
    }
  }
  return onceOf(null);
};

// Stufen, die schon gespeichert wurden (snapshots.medals["<id>:<tier>"] = { t, level }): einmal verdient bleibt verdient
function savedMedals(char) {
  const g = snapGroup(char, "medals");
  return g || {};
}

function entryOf(seal, C, value, earned, saved) {
  const tiers = seal.steps ? TIER_ORDER : [seal.tier];
  const e = { id: seal.id, family: seal.family, stepped: !!seal.steps, max: tiers.length, value, steps: [], count: 0, tier: null, unit: seal.unit || "count" };
  let top = null;
  tiers.forEach((tier, k) => {
    let ev = earned[k] || null;
    const p = saved[seal.id + ":" + tier];
    const saveT = isTable(p) ? toNum(p.t) : null;
    if (!ev && isTable(p)) ev = { t: saveT, level: p.level };
    if (ev && !isFiniteNum(ev.t) && isTable(p) && saveT !== null) ev = { t: saveT, level: ev.level ?? p.level, zone: ev.zone };
    if (ev) {
      const s = { tier, k, at: isFiniteNum(ev.t) ? ev.t : null, level: validLevel(ev.level), zone: typeof ev.zone === "string" && ev.zone ? ev.zone : null };
      e.steps[k] = s;
      e.count++;
      top = s;
    }
  });
  if (top) e.tier = top.tier;
  else if (!seal.steps) e.tier = seal.tier;
  e.earned = e.count > 0;
  e.need = null; // nächste offene Stufe: { k, tier, value } oder null
  e.noMore = false;
  if (seal.steps) {
    for (let k = 0; k < seal.steps.length; k++) {
      const reachable = !(seal.id === "tough" && (C.toughDeaths || 0) > (TOUGH_DEATHS[k] ?? 0));
      if (!e.steps[k] && reachable) {
        e.need = { k, tier: TIER_ORDER[k], value: seal.steps[k] };
        break;
      }
    }
    if (!e.need && e.count < seal.steps.length) e.noMore = true;
  }
  if (seal.id === "tough") e.toughDeaths = C.toughDeaths || 0;
  if (seal.id === "flawless") e.run = C.flawlessRun || 0;
  if (seal.id === "unscathed") e.runNow = C.unscathedNow || 0;
  if (seal.id === "continent" && !top) e.continents = C.continents || 0;
  return e;
}

// Kann der Client das Leben am Kampfende lesen? Wie ns.closeWinReadable im Addon aus db.diag (hpEnd "secret"/"ok",
// state.healthSecret). Ohne Angabe: in Forever nein (dort sind die Werte geheim, das Addon blendet „Um Haaresbreite“ aus).
export function healthReadable(db, flavor) {
  const diag = db && isTable(db.diag) ? db.diag : null;
  if (diag) {
    if (diag.hpEnd === "secret") return false;
    if (diag.hpEnd === "ok") return true;
    if (isTable(diag.state) && diag.state.healthSecret === true) return false;
  }
  return flavor !== "forever";
}

// Alle Medaillen: { list, families, earned (Medaillen mit mindestens einer Stufe), total, steps, stepsTotal }
export function buildMedals(ctx, { flavor = null, maxLevel = 60, level = null } = {}) {
  const C = medalCtx(ctx);
  C.maxLevel = maxLevel;
  const saved = savedMedals(ctx.char);
  const fam = new Map(FAMILIES.map((id) => [id, { id, earned: 0, total: 0, steps: 0, stepsTotal: 0 }]));
  const list = [];
  let earned = 0;
  let steps = 0;
  let stepsTotal = 0;
  let hiddenN = 0;
  for (const seal of SEALS) {
    let value;
    let proofs;
    const live = LIVE[seal.id];
    if (live) {
      value = counterValue(ctx.char, live[0], live[1]);
      proofs = byTimes(C, seal.steps, value, null);
    } else {
      [value, proofs] = EVAL[seal.id](C, seal.steps);
    }
    const e = entryOf(seal, C, value || 0, proofs, saved);
    if (seal.id === "level60" && !e.earned && isFiniteNum(level)) e.level = Math.min(Math.floor(level), maxLevel);
    if (seal.id === "level60") e.top = maxLevel;
    const f = fam.get(seal.family);
    // auf dem Client nicht erreichbare Medaillen bleiben verborgen, solange nichts davon verdient ist (Retail; „Um Haaresbreite“
    // auch, wenn das Leben am Kampfende nicht lesbar ist, wie in Forever)
    if (e.count === 0 && ((seal.retailHidden && flavor === "retail") || (seal.needsHealth && !healthReadable(ctx.db, flavor)))) {
      e.hidden = true;
      hiddenN++;
    } else {
      if (e.earned) earned++;
      steps += e.count;
      stepsTotal += e.max;
      f.total++;
      f.steps += e.count;
      f.stepsTotal += e.max;
      if (e.earned) f.earned++;
    }
    list.push(e);
  }
  return { list, families: FAMILIES.map((id) => fam.get(id)), earned, total: SEALS.length - hiddenN, steps, stepsTotal };
}
