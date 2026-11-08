// Steckbrief, Stufenfluss, Erfahrungsquellen und Tode. Portiert aus addon/InkAndEmbers/journal/model/Chronik.lua
// (levelTimes, buildStatic, flowOf, buildSources, profileOf, afk) und der Todesliste der Dungeon-Seite. Keine Texte, kein DOM.
import { isTable } from "../core/lua-parse.mjs";
import { fld, num, toNum, levelOf, posId, isFiniteNum, activeSeconds } from "./log.mjs";

export const XP_SOURCES = ["quest", "kill", "explore", "other"]; // Reihenfolge der Anzeige
export const DEATH_WINDOW = 5; // Sekunden: die Ursachenzeile (DC) gehört zum Tod, wenn sie so dicht folgt

// Stufe jetzt: letzte LV-Zeile, sonst letzte PL-Zeile, sonst Stufe aus dem Tagebuchmodell, sonst 1
function currentLevel(ctx, fallback) {
  for (const code of ["LV", "PL"]) {
    const l = ctx.list(code);
    for (let i = l.length - 1; i >= 0; i--) {
      const L = levelOf(l[i]);
      if (L !== null) return L;
    }
  }
  return fallback || 1;
}

// letzte Antwort auf /played: { total, t } oder null
function lastPlayed(ctx) {
  const l = ctx.list("PL");
  for (let i = l.length - 1; i >= 0; i--) {
    const total = num(l[i], "total");
    if (total !== null && total >= 0 && isFiniteNum(l[i].t)) return { total, t: l[i].t };
  }
  return null;
}

// Zeiten je Stufe: reach[L] = Spielzeit beim Erreichen von L (PL: total - thisLevel), at[L] = Zeitpunkt (LV)
function levelTimes(ctx) {
  const reach = new Map();
  const at = new Map();
  for (const ev of ctx.list("PL")) {
    const L = levelOf(ev);
    const total = num(ev, "total");
    const cur = num(ev, "thisLevel");
    if (L !== null && total !== null && cur !== null && total >= 0 && cur >= 0 && cur <= total && !reach.has(L)) reach.set(L, total - cur);
  }
  for (const ev of ctx.list("LV")) {
    const L = levelOf(ev);
    if (L !== null && !at.has(L) && isFiniteNum(ev.t)) at.set(L, ev.t);
  }
  return { reach, at };
}

function deathsByLevel(ctx) {
  const by = new Map();
  let noLevel = 0;
  for (const ev of ctx.list("DE")) {
    const L = levelOf(ev);
    if (L === null) noLevel++;
    else by.set(L, (by.get(L) || 0) + 1);
  }
  return { by, noLevel, total: ctx.list("DE").length };
}

// Stufenfluss: je Stufe die Dauer (Spielzeit), die Tode und die Markierungen schnellste/langsamste
export function buildFlow(ctx, level, played) {
  const { reach, at } = levelTimes(ctx);
  let top = 0;
  for (const L of reach.keys()) top = Math.max(top, L);
  for (const L of at.keys()) top = Math.max(top, L);
  if (!reach.has(1) && reach.has(2)) reach.set(1, 0); // die Spielzeit zählt ab der Erstellung: Stufe 1 beginnt bei 0
  const dur = new Map();
  const approx = new Set();
  for (let L = 1; L < top; L++) {
    let d = null;
    if (reach.has(L) && reach.has(L + 1)) d = reach.get(L + 1) - reach.get(L);
    else {
      const t0 = L === 1 ? ctx.startT : at.get(L);
      const t1 = at.get(L + 1);
      if (isFiniteNum(t0) && isFiniteNum(t1) && t1 > t0) d = activeSeconds(ctx.sessions, t0, t1);
      if (d !== null) approx.add(L); // keine /played-Antwort: nur die Zeit aus dem Log, die Anzeige sagt "ca."
    }
    if (d !== null && Number.isFinite(d) && d >= 0) dur.set(L, d);
  }
  const deaths = deathsByLevel(ctx);
  // laufende Stufe: Spielzeit seit dem Erreichen
  let curDur = null;
  if (played !== null && reach.has(level)) curDur = played - reach.get(level);
  else if (at.has(level) || level === 1) {
    const t0 = at.has(level) ? at.get(level) : ctx.startT;
    if (isFiniteNum(t0) && isFiniteNum(ctx.lastT) && ctx.lastT > t0) curDur = activeSeconds(ctx.sessions, t0, ctx.lastT);
  }
  if (curDur !== null && (!Number.isFinite(curDur) || curDur < 0)) curDur = null;

  const first = Math.max(1, level - 59);
  let fastL = null;
  let slowL = null;
  let complete = 0;
  for (let L = first; L < level; L++) {
    const d = dur.get(L);
    if (d === undefined) continue;
    complete++;
    if (fastL === null || d < dur.get(fastL)) fastL = L;
    if (slowL === null || d > dur.get(slowL)) slowL = L;
  }
  const cols = [];
  let shownDeaths = 0;
  let maxSeconds = 0;
  let total = 0;
  for (let L = first; L <= level; L++) {
    const current = L === level;
    const seconds = current ? curDur : dur.has(L) ? dur.get(L) : null;
    const n = deaths.by.get(L) || 0;
    shownDeaths += n;
    if (seconds !== null) {
      total += seconds;
      if (!current && seconds > maxSeconds) maxSeconds = seconds; // die laufende Stufe bestimmt die Skala nicht (wie im Addon)
    }
    cols.push({ level: L, seconds, approx: !current && approx.has(L), deaths: n, current, fastest: L === fastL && complete >= 2, slowest: L === slowL && slowL !== fastL && complete >= 2 });
  }
  if (maxSeconds === 0 && curDur !== null) maxSeconds = curDur;
  return { cols, level, total, maxSeconds, complete, deaths: shownDeaths, deathsNoLevel: deaths.total - shownDeaths, deathsTotal: deaths.total, fastest: complete >= 2 ? fastL : null, slowest: complete >= 2 && slowL !== fastL ? slowL : null, current: curDur };
}

// Erfahrungsquellen aus den XP-Zeilen (ohne "unclear": Sprünge über mehrere Stufen ohne Betrag)
export function buildSources(ctx) {
  const amounts = new Map(XP_SOURCES.map((k) => [k, 0]));
  let rested = 0;
  let unclear = 0;
  for (const ev of ctx.list("XP")) {
    if (fld(ev, "via") === "unclear") {
      unclear++;
      continue;
    }
    const src = XP_SOURCES.includes(fld(ev, "source")) ? fld(ev, "source") : "other";
    const amount = num(ev, "amount") ?? 0;
    const r = num(ev, "rested") ?? 0;
    rested += r;
    if (amount > 0) amounts.set(src, amounts.get(src) + amount);
  }
  let total = 0;
  for (const v of amounts.values()) total += v;
  const parts = [];
  for (const key of XP_SOURCES) {
    const amount = amounts.get(key);
    if (amount > 0) parts.push({ key, amount, pct: (amount / total) * 100 });
  }
  return { total, parts, rested: rested > 0 ? rested : 0, unclear };
}

// Ursache zum Tod: die nächste DC-Zeile nach der DE-Zeile (innerhalb DEATH_WINDOW, vor dem nächsten Tod)
function causeOf(ctx, dcList, de, nextDe) {
  const after = (a, b) => a.t > b.t || (a.t === b.t && a.ln > b.ln);
  let lo = 0;
  let hi = dcList.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (after(dcList[mid], de)) hi = mid;
    else lo = mid + 1;
  }
  const r = dcList[lo];
  if (!r || r.t - de.t > DEATH_WINDOW || (nextDe && after(r, nextDe))) return null;
  const npcID = posId(fld(r, "npcID"));
  return { cause: fld(r, "cause"), guess: fld(r, "guess") === "1", foe: (npcID && ctx.npcName(npcID)) || fld(r, "source") };
}

// Todesliste: Zeit, Stufe, Ort (Unterzone, Karte oder Instanz), Ursache. instanceAt(t) -> instanceID | null aus den Instanzbesuchen
export function buildDeaths(ctx, instanceAt) {
  const des = ctx.list("DE");
  const dc = ctx.list("DC");
  const out = [];
  des.forEach((ev, i) => {
    const c = causeOf(ctx, dc, ev, des[i + 1]) || {};
    const mapID = posId(fld(ev, "mapID"));
    let place = fld(ev, "sub") || (mapID ? ctx.mapName(mapID) : null);
    let instance = null;
    if (fld(ev, "instance") === "1") {
      const id = posId(fld(ev, "instanceID")) || instanceAt(ev.t);
      instance = id ? ctx.instanceName(id) : null;
      if (!place) place = instance;
    }
    out.push({ t: ev.t, level: levelOf(ev), place, instance, cause: c.cause || null, foe: c.foe || null, guess: !!c.guess, combat: fld(ev, "combat") === "1" });
  });
  return out;
}

// Steckbrief
export function buildProfile(ctx, journal) {
  const info = ctx.info;
  const level = currentLevel(ctx, journal.level);
  const lp = lastPlayed(ctx);
  let played = null;
  let exact = false;
  if (lp) {
    const extra = ctx.sessions.t0.length && isFiniteNum(ctx.lastT) && ctx.lastT > lp.t ? activeSeconds(ctx.sessions, lp.t, ctx.lastT) : 0;
    played = lp.total + extra;
    exact = true;
  } else if (isFiniteNum(ctx.startT) && isFiniteNum(ctx.lastT) && ctx.lastT > ctx.startT) {
    played = activeSeconds(ctx.sessions, ctx.startT, ctx.lastT);
  }
  let sessions = 0;
  const meta = isTable(ctx.db.meta) ? ctx.db.meta : null;
  if (meta && isTable(meta.sessions)) for (const k of Object.keys(meta.sessions)) if (isTable(meta.sessions[k]) && meta.sessions[k].guid === ctx.guid) sessions++;
  const afkCounter = isTable(ctx.char.counters) && isTable(ctx.char.counters.afk) ? ctx.char.counters.afk : null;
  const afkSeconds = afkCounter ? Math.floor(Math.max(0, toNum(afkCounter.seconds) ?? 0)) : 0;
  const afkPhases = afkCounter ? Math.floor(Math.max(0, toNum(afkCounter.phases) ?? 0)) : 0;
  const lineCount = toNum(ctx.char.lineCount);
  return {
    name: journal.name,
    race: journal.race,
    cls: journal.cls,
    classFile: journal.classFile,
    faction: journal.factionName || journal.faction,
    realm: journal.realm,
    level,
    played,
    playedExact: exact,
    since: toNum(info.firstSeen) ?? journal.firstT,
    lastT: ctx.lastT,
    sessions,
    entries: lineCount !== null && lineCount >= 0 ? lineCount : ctx.events.length,
    afk: afkSeconds >= 60 ? { seconds: afkSeconds, phases: afkPhases } : null,
    flavor: journal.flavor,
  };
}
