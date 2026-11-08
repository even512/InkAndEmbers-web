// Dungeon-Läufe: faltet die Instanzbesuche (IE/IL) zu Läufen und sammelt, was darin geschah. Portiert aus
// addon/InkAndEmbers/journal/model/Dungeons.lua (visitsOf, build, bossesOf, detail, group) und Companions.lua (aggregate, between).
// Ein Lauf ist die Kette von Besuchen derselben Instanz und Schwierigkeit mit höchstens GAP Sekunden Pause (Geisterlauf, Verbindungsabbruch,
// kurzer Gang zum Händler). Reine Berechnung, keine Texte, kein DOM; Namen bleiben Rohtext aus der Datei.
import { fld, num, posId, isFiniteNum, eachIn, sessionEnd } from "./log.mjs";
import { itemIdOf } from "../core/journal-model.mjs";

export const GAP = 1800; // Sekunden: eine kürzere Pause zwischen zwei Besuchen derselben Instanz lässt es einen Lauf bleiben
export const RUNS_MAX = 600; // behaltene Läufe (die neuesten)
export const LOOT_MAX = 120;
export const QUEST_MAX = 60;
export const DEATH_MAX = 60;
export const MERGE_GAP = 300; // Sekunden: kürzere Lücke zwischen zwei Anwesenheiten desselben Mitspielers = eine Sitzung
export const MAX_EVENTS = 4000; // WB/WV-Zeilen, die gelesen werden

const before = (a, b) => a.t < b.t || (a.t === b.t && a.ln < b.ln);

// Besuche aus IE/IL. IE öffnet, IL schließt; ein wiederaufgenommenes IE (Reload/Login in der Instanz) setzt den offenen Besuch fort;
// ein neues IE bei offenem Besuch heißt: das IL fehlte (Absturz), der frühere Besuch endet mit seiner Sitzung.
function visitsOf(ctx) {
  const ie = ctx.list("IE");
  const il = ctx.list("IL");
  const out = [];
  let cur = null;
  const finish = (v, t1, seconds) => {
    if (t1 === null) {
      const e = sessionEnd(ctx.sessions, v.t0);
      t1 = Math.max(v.t0, e ?? v.t0);
      v.endKnown = false;
    } else v.endKnown = true;
    v.t1 = Math.max(t1, v.t0);
    v.seconds = isFiniteNum(seconds) && seconds >= 0 && seconds <= v.t1 - v.t0 + 3600 ? Math.floor(seconds) : Math.floor(v.t1 - v.t0);
    out.push(v);
  };
  let i = 0;
  let j = 0;
  while (i < ie.length || j < il.length) {
    const takeIE = i >= ie.length ? false : j >= il.length ? true : !before(il[j], ie[i]);
    if (takeIE) {
      const r = ie[i++];
      const rawId = num(r, "instanceID");
      if (rawId !== null && isFiniteNum(r.t)) {
        const id = Math.floor(rawId);
        const level = num(r, "level");
        const resumed = fld(r, "resumed") === "1";
        if (cur && resumed && cur.id === id) {
          cur.level1 = level ?? cur.level1;
          cur.group = Math.max(cur.group || 0, num(r, "group") || 0);
        } else {
          if (cur) finish(cur, null);
          cur = { id, kind: fld(r, "type"), diff: num(r, "difficultyID"), t0: r.t, level0: level, level1: level, group: num(r, "group") || 0 };
        }
      }
    } else {
      const r = il[j++];
      const id = num(r, "instanceID");
      if (cur && (id === null || Math.floor(id) === cur.id)) {
        const v = cur;
        cur = null;
        v.kills = num(r, "kills");
        v.deaths = num(r, "deaths");
        v.bossCount = num(r, "bosses");
        v.loot = num(r, "loot");
        // ohne Dauer: IL beim späteren Login für einen offenen Besuch geschrieben, r.t ist der Login, nicht das Ende
        const secs = num(r, "seconds");
        if (isFiniteNum(r.t) && secs !== null) finish(v, r.t, secs);
        else finish(v, null);
      }
    }
  }
  if (cur) finish(cur, null);
  out.sort((a, b) => a.t0 - b.t0);
  return out;
}

// Bosse eines Laufs aus den IB-Zeilen innerhalb seiner Besuche
function bossesOf(ctx, run) {
  const order = [];
  const by = new Map();
  let anon = 0;
  eachIn(ctx.list("IB"), run.intervals, (r) => {
    const inst = num(r, "instanceID");
    if (inst !== null && Math.floor(inst) !== run.instanceID) return;
    const rawId = num(r, "encounterID");
    const id = rawId === null ? null : Math.floor(rawId);
    const key = id !== null ? id : "?" + ++anon;
    let b = by.get(key);
    if (!b) {
      b = { id, name: id !== null ? ctx.encounterName(id) : null, attempts: 0, wipes: 0, defeated: false, t: r.t, seconds: null };
      by.set(key, b);
      order.push(b);
    }
    const ok = fld(r, "success");
    const secs = num(r, "seconds");
    b.attempts++;
    if (ok === "1") {
      if (!b.defeated) {
        b.defeated = true;
        b.t = r.t;
      }
      b.seconds = secs ?? b.seconds;
    } else if (ok === "0") {
      b.wipes++;
      if (!b.defeated) b.seconds = secs ?? b.seconds;
    }
  });
  return order;
}

function deathsIn(ctx, run) {
  let n = 0;
  eachIn(ctx.list("DE"), run.intervals, () => n++);
  return n;
}

// Alle Läufe, neueste zuerst: { runs, count, truncated, instanceAt(t) }
export function buildDungeons(ctx) {
  const visits = visitsOf(ctx);
  const runs = [];
  for (const v of visits) {
    const run = runs[runs.length - 1];
    if (run && run.instanceID === v.id && run.difficultyID === v.diff && v.t0 - run.t1 <= GAP && v.t0 >= run.t0) {
      run.t1 = Math.max(run.t1, v.t1);
      run.seconds += v.seconds;
      run.visits++;
      run.intervals.push(v.t0, v.t1);
      run.endKnown = run.endKnown && v.endKnown;
      run.level1 = v.level1 ?? run.level1;
      run.groupSize = Math.max(run.groupSize || 0, v.group || 0);
      run.kills += v.kills || 0;
      run.bossCount += v.bossCount || 0;
    } else {
      runs.push({
        key: Math.floor(v.t0) + ":" + v.id,
        instanceID: v.id,
        name: ctx.instanceName(v.id),
        kind: v.kind,
        difficultyID: v.diff,
        t0: v.t0,
        t1: v.t1,
        intervals: [v.t0, v.t1],
        seconds: v.seconds,
        visits: 1,
        endKnown: v.endKnown,
        level0: v.level0,
        level1: v.level1,
        groupSize: v.group || 0,
        kills: v.kills || 0,
        bossCount: v.bossCount || 0,
      });
    }
  }
  const truncated = runs.length > RUNS_MAX;
  const first = truncated ? runs.length - RUNS_MAX : 0;
  const out = [];
  for (let i = runs.length - 1; i >= first; i--) {
    const run = runs[i];
    run.bosses = bossesOf(ctx, run);
    const defeated = run.bosses.filter((b) => b.defeated).length;
    // keine Boss-Zeilen (der Client meldete die Ereignisse nicht): die Zahl, die der Sammler je Besuch führte
    run.bossesFromCount = run.bosses.length === 0 && run.bossCount > 0;
    run.bossesDefeated = run.bossesFromCount ? run.bossCount : defeated;
    run.deathsCount = deathsIn(ctx, run);
    out.push(run);
  }
  // Instanz zu einem Zeitpunkt (für Tode ohne Instanzangabe): der Besuch, der t umfasst
  const instanceAt = (t) => {
    for (let i = visits.length - 1; i >= 0; i--) {
      if (visits[i].t0 <= t) return t <= visits[i].t1 ? visits[i].id : null;
    }
    return null;
  };
  return { runs: out, count: out.length, truncated, instanceAt };
}

// Stufe am Ende: die höchste aus letztem Eintrag und den Stufenaufstiegen im Lauf
function endLevel(ctx, run) {
  let lv = run.level1 ?? null;
  eachIn(ctx.list("LV"), [run.t0, run.t1], (r) => {
    const l = num(r, "level");
    if (l !== null && (lv === null || l > lv)) lv = l;
  });
  return lv;
}

function causeOf(ctx, de, nextDe) {
  const dc = ctx.list("DC");
  const after = (a, b) => a.t > b.t || (a.t === b.t && a.ln > b.ln);
  let lo = 0;
  let hi = dc.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (after(dc[mid], de)) hi = mid;
    else lo = mid + 1;
  }
  const r = dc[lo];
  if (!r || r.t - de.t > 5 || (nextDe && after(r, nextDe))) return null;
  const npcID = posId(fld(r, "npcID"));
  return { cause: fld(r, "cause"), guess: fld(r, "guess") === "1", foe: (npcID && ctx.npcName(npcID)) || fld(r, "source") };
}

// Tode, Funde, Quests und Erfahrung eines Laufs (einmal je Lauf berechnet)
export function dungeonDetail(ctx, run) {
  if (run.detail) return run.detail;
  const d = { deaths: [], loot: [], quests: [], lootMore: 0, questMore: 0, deathMore: 0, xp: null, level1: endLevel(ctx, run) };
  run.detail = d;

  const de = ctx.list("DE");
  eachIn(de, run.intervals, (r, i) => {
    if (d.deaths.length >= DEATH_MAX) {
      d.deathMore++;
      return;
    }
    const c = causeOf(ctx, r, de[i + 1]) || {};
    d.deaths.push({ t: r.t, cause: c.cause || null, guess: !!c.guess, foe: c.foe || null, sub: fld(r, "sub") });
  });

  // Funde ab Grün: eigene (LT) und die der Gruppe (LG), nach Zeit gemischt; who = null heißt "Ihr"
  const found = [];
  const collect = (code, mine) => {
    eachIn(ctx.list(code), run.intervals, (r) => {
      const key = fld(r, "item");
      const itemID = key ? posId(itemIdOf(key)) : null;
      if (!itemID) return;
      const who = !mine ? fld(r, "who") : null;
      if (!mine && !who) return; // ein Gruppenfund ohne lesbaren Empfänger lässt sich niemandem zuordnen
      const snap = ctx.itemSnap(key);
      let q = num(r, "quality");
      if (q === null && snap && Number.isFinite(Number(snap.quality))) q = Number(snap.quality);
      if (q !== null && q < 2) return; // nur grün und besser
      const n = num(r, "count");
      found.push({
        t: r.t,
        seq: found.length,
        key,
        itemID,
        quality: q === null ? null : Math.floor(q),
        count: n !== null && n > 1 && n < 100000 ? Math.floor(n) : 1,
        name: snap && typeof snap.name === "string" && snap.name !== "" ? snap.name : null,
        source: mine ? fld(r, "source") : null,
        who,
        cls: !mine ? fld(r, "class") : null,
        roll: !mine ? fld(r, "roll") : null,
      });
    });
  };
  collect("LT", true);
  collect("LG", false);
  found.sort((a, b) => a.t - b.t || a.seq - b.seq);
  for (const e of found) {
    if (d.loot.length >= LOOT_MAX) d.lootMore++;
    else d.loot.push(e);
  }

  const byId = new Map();
  const order = [];
  const quest = (r) => {
    const rawId = num(r, "questID");
    if (rawId === null) return null;
    const id = Math.floor(rawId);
    let q = byId.get(id);
    if (!q) {
      if (order.length >= QUEST_MAX) {
        d.questMore++;
        return null;
      }
      q = { id, t: r.t, title: ctx.questTitle(id), accepted: false, done: false, xp: null };
      byId.set(id, q);
      order.push(q);
    }
    return q;
  };
  eachIn(ctx.list("QA"), run.intervals, (r) => {
    const q = quest(r);
    if (q) q.accepted = true;
  });
  eachIn(ctx.list("QT"), run.intervals, (r) => {
    const q = quest(r);
    if (q) {
      q.done = true;
      q.t = r.t;
      q.xp = num(r, "xp");
    }
  });
  order.sort((a, b) => a.t - b.t || a.id - b.id);
  d.quests = order;

  let xp = 0;
  let seen = false;
  eachIn(ctx.list("XP"), run.intervals, (r) => {
    if (fld(r, "via") === "unclear") return;
    const a = num(r, "amount");
    if (a !== null && a > 0) {
      xp += a;
      seen = true;
    }
  });
  d.xp = seen ? Math.floor(xp) : null;
  return d;
}

// --- Gruppe (WB/WV) -------------------------------------------------------------------------------------------------

function spanEnd(ctx, t) {
  const e = sessionEnd(ctx.sessions, t);
  if (e !== null) return e;
  return ctx.sessions.t0.length ? null : ctx.lastT; // ohne Sitzungsangaben: bis zur letzten Zeile
}

// Anwesenheit je Person: WB öffnet, WV schließt; ein zweites WB bei offener Anwesenheit schließt die alte am Ende ihrer Sitzung
function companionsOf(ctx) {
  const evs = ctx.list("WB").concat(ctx.list("WV")).sort((a, b) => a.t - b.t || a.ln - b.ln).slice(0, MAX_EVENTS);
  const people = [];
  const byName = new Map();
  const iv = new Map();
  const open = new Map();
  const close = (p, a, b) => {
    if (b < a) b = a;
    let l = iv.get(p);
    if (!l) iv.set(p, (l = []));
    const k = l.length;
    if (k >= 2 && a - l[k - 1] < MERGE_GAP) {
      if (b > l[k - 1]) l[k - 1] = b; // Lücke zu klein: dieselbe Sitzung
    } else l.push(a, b);
  };
  for (const ev of evs) {
    const name = fld(ev, "name");
    if (!name || !isFiniteNum(ev.t)) continue;
    const lv = num(ev, "level");
    let p = byName.get(name);
    if (!p) {
      p = { name, cls: fld(ev, "class"), race: fld(ev, "race"), level0: lv, level1: lv, t0: ev.t, t1: ev.t };
      byName.set(name, p);
      people.push(p);
    } else {
      p.cls = p.cls || fld(ev, "class");
      p.race = p.race || fld(ev, "race");
      if (lv !== null) {
        p.level0 = p.level0 ?? lv;
        p.level1 = lv;
      }
      p.t1 = ev.t;
    }
    if (ev.code === "WB") {
      const o = open.get(p);
      if (o !== undefined) {
        let e = spanEnd(ctx, o);
        if (e !== null && e >= ev.t) e = ev.t;
        close(p, o, e ?? o);
      }
      open.set(p, ev.t);
    } else {
      const o = open.get(p);
      if (o !== undefined) {
        close(p, o, ev.t);
        open.delete(p);
      }
    }
  }
  for (const [p, o] of open) close(p, o, Math.min(spanEnd(ctx, o) ?? o, isFiniteNum(ctx.lastT) ? ctx.lastT : o));
  for (const p of people) p.intervals = iv.get(p) || [];
  return people;
}

// Zeitfenster der gewonnenen Bosskämpfe eines Laufs: [t - Dauer, t]
function bossWinWindows(ctx, run) {
  const out = [];
  eachIn(ctx.list("IB"), run.intervals, (r) => {
    const inst = num(r, "instanceID");
    if (inst !== null && Math.floor(inst) !== run.instanceID) return;
    if (fld(r, "success") !== "1") return;
    const secs = num(r, "seconds");
    out.push(secs !== null && secs > 0 && secs < 86400 ? r.t - secs : r.t, r.t);
  });
  return out;
}

function touches(ivs, windows) {
  for (let k = 0; k < ivs.length; k += 2) {
    for (let w = 0; w < windows.length; w += 2) {
      if (ivs[k] <= windows[w + 1] && ivs[k + 1] >= windows[w]) return true;
    }
  }
  return false;
}

// Gruppe des Laufs: wer bei mindestens einem Bosssieg dabei war, die meiste Zeit zuerst. Kurze Gäste ohne Bosssieg und Läufe
// ohne Bosssieg haben keine Gruppe. Die Stufe nur, wenn sie rund um den Lauf gesehen wurde, nie geraten.
export function dungeonGroup(ctx, run, people) {
  if (run.group) return run.group;
  const out = [];
  run.group = out;
  const windows = bossWinWindows(ctx, run);
  if (windows.length === 0) return out;
  const all = people || (ctx.companions ||= companionsOf(ctx));
  const slack = 600;
  const rows = [];
  for (const p of all) {
    let s = 0;
    for (let k = 0; k < p.intervals.length; k += 2) {
      const a = Math.max(p.intervals[k], run.t0);
      const b = Math.min(p.intervals[k + 1], run.t1);
      if (b > a) s += b - a;
    }
    if (s > 0 && touches(p.intervals, windows)) rows.push({ p, seconds: s });
  }
  rows.sort((a, b) => b.seconds - a.seconds || (a.p.name < b.p.name ? -1 : 1));
  for (const { p, seconds } of rows) {
    let level = null;
    if (p.t0 >= run.t0 - slack && p.t0 <= run.t1 + slack) level = p.level0;
    else if (p.t1 >= run.t0 - slack && p.t1 <= run.t1 + slack) level = p.level1;
    out.push({ name: p.name, cls: p.cls, race: p.race, level, seconds });
  }
  return out;
}
