// Ansicht "Chronik & Statistik": Steckbrief, Medaillen, Stufenfluss, Erfahrungsquellen, Dungeons, Tode, dazu Bilanz, Kapitel,
// Höhepunkte und Notizen des Exports. Alles als DOM-Knoten; Texte aus der Datei gehen nur als Textknoten hinaus (el() nutzt
// createTextNode) und vorher durch clean(). Keine HTML-Zeichenketten, keine Attribute aus Dateidaten.
import { el, clean, renderJournal, highlightLine } from "../core/render.mjs";
import { fmtNumber, fmtDuration } from "../core/i18n.mjs";
import { ct, ctn, hasCt, difficultyName, standingName } from "./texts.mjs";
import { TIER_ORDER, TOUGH_DEATHS, MEDAL_STEPS, SEALS } from "./medals.mjs";
import { icon, portraitImg, classColorClass } from "../ui/identity.mjs";
import { shownIdentity, shownJournal, playerName, extrasOf } from "../ui/names.mjs";
import { XP_SOURCES } from "./stats.mjs";
import { dungeonDetail, dungeonGroup } from "./dungeons.mjs";

export const PAGE_STEP = 12; // so viele Läufe/Tode kommen je Klick auf "Mehr anzeigen" dazu
const FLOW_DOTS_MAX = 8;

// Medaillenbild = Motiv (Addon Media/Seals.tga, Zelle = Platz im Katalog, public/img/seal-<n>.webp) + Metallring der Stufe
// Motivzelle: Platz im Altkatalog; später hinzugekommene Medaillen tragen ihre Zelle im Katalogfeld cell
const SEAL_INDEX = new Map();
let sealCell = 0;
for (const s of SEALS) SEAL_INDEX.set(s.id, s.cell || ++sealCell);
const RINGS = new Set(["bronze", "silver", "gold", "legendary"]);
const QUALITY_CLASS = { 2: "chron-q2", 3: "chron-q3", 4: "chron-q4", 5: "chron-q5" };

// ---- kleine Helfer ---------------------------------------------------------------------------------------------------

const locale = (lang) => (lang === "en" ? "en-GB" : "de-DE");
const fmtCache = new Map();
function dtf(lang, kind) {
  const key = lang + kind;
  let f = fmtCache.get(key);
  if (!f) {
    const opts = kind === "date" ? { day: "2-digit", month: "2-digit", year: "numeric" } : { hour: "2-digit", minute: "2-digit" };
    f = new Intl.DateTimeFormat(locale(lang), opts);
    fmtCache.set(key, f);
  }
  return f;
}
const okTime = (t) => typeof t === "number" && Number.isFinite(t) && t > 0 && t < 4102444800;
const dateText = (lang, t) => (okTime(t) ? dtf(lang, "date").format(new Date(t * 1000)) : "–");
const timeText = (lang, t) => (okTime(t) ? dtf(lang, "time").format(new Date(t * 1000)) : "–");
const dateTimeText = (lang, t) => dateText(lang, t) + ", " + timeText(lang, t);

function setWidth(node, pct) {
  const v = Math.max(0, Math.min(100, pct));
  node.setAttribute("data-pct", v.toFixed(1));
  if (node.style) node.style.width = v.toFixed(1) + "%"; // per CSSOM, nicht als style-Attribut (CSP: style-src 'self')
}

// Dauer mit Sekunden für Kurzes (Bosskämpfe): unter einer Minute "19 s", sonst wie fmtDuration
function shortDur(lang, sec) {
  return typeof sec === "number" && sec >= 0 && sec < 60 ? Math.round(sec) + " s" : fmtDuration(lang, sec);
}

function classText(lang, cls) {
  if (!cls) return null;
  const key = "class." + String(cls).toUpperCase();
  return hasCt(lang, key) ? ct(lang, key) : clean(cls, 30);
}

function causeText(lang, d) {
  const line = highlightLine(lang, { kind: "death", killer: d.foe, cause: d.cause, place: null, guess: d.guess });
  return line.text;
}

function page(doc, key, cls, title, lead, ...children) {
  const s = el(doc, "section", "page chron-page " + cls, el(doc, "h2", "page-title", title), lead ? el(doc, "p", "page-lead", lead) : null, ...children);
  s.setAttribute("data-section", key);
  return s;
}

// Leerer Zustand: Addon-Symbol und ein Satz, was hier künftig steht
function emptyState(doc, art, text) {
  return el(doc, "div", "empty chron-empty", icon(doc, art, "empty-icon", [48, 48]), el(doc, "p", "empty-text", text));
}

// Liste mit "Mehr anzeigen": zeigt step Einträge, jeder Klick hängt die nächsten an (tag: Elementname oder fertiger Knoten)
function pagedList(doc, lang, tag, cls, items, render, step = PAGE_STEP) {
  const list = typeof tag === "string" ? el(doc, tag, cls) : tag;
  const wrap = el(doc, "div", "chron-paged", list);
  let shown = 0;
  let btn = null;
  const more = () => {
    const end = Math.min(items.length, shown + step);
    for (; shown < end; shown++) list.appendChild(render(items[shown], shown));
    if (btn) {
      wrap.removeChild(btn);
      btn = null;
    }
    if (shown < items.length) {
      btn = el(doc, "button", "btn chron-more no-print", ct(lang, "showMore", fmtNumber(lang, items.length - shown)));
      btn.type = "button";
      btn.addEventListener("click", more);
      wrap.appendChild(btn);
    }
  };
  more();
  return wrap;
}

// ---- Steckbrief ----------------------------------------------------------------------------------------------------------

function profilePage(doc, lang, m) {
  const p = m.profile;
  const who0 = shownIdentity(p, lang);
  const name = clean(who0.name, 60) || "?";
  const clsName = p.cls ? clean(p.cls, 40) : null;
  const clsTag = clsName ? el(doc, "span", classColorClass(p.classFile) || "cls", clsName) : null;
  const who = [p.race ? clean(p.race, 40) : null, clsTag].filter(Boolean).flatMap((x, i) => (i ? [" · ", x] : [x]));
  const facts = el(doc, "dl", "prof-facts");
  const row = (label, value) => {
    if (value === null || value === undefined || value === "") return;
    facts.appendChild(el(doc, "dt", null, label));
    facts.appendChild(el(doc, "dd", null, value));
  };
  row(ct(lang, "pfRace"), p.race ? clean(p.race, 40) : null);
  row(ct(lang, "pfClass"), clsName ? el(doc, "span", classColorClass(p.classFile) || "cls", clsName) : null);
  row(ct(lang, "pfFaction"), p.faction ? clean(p.faction, 40) : null);
  row(ct(lang, "pfLevel"), String(p.level));
  row(ct(lang, p.forever ? "pfRuleset" : "pfRealm"), who0.place ? clean(who0.place, 40) : null);
  row(ct(lang, p.playedExact ? "pfPlayed" : "pfPlayedApprox"), p.played !== null ? fmtDuration(lang, p.played) : ct(lang, "unknown"));
  row(ct(lang, "pfSince"), okTime(p.since) ? dateText(lang, p.since) : ct(lang, "unknown"));
  row(ct(lang, "pfLast"), okTime(p.lastT) ? dateText(lang, p.lastT) : null);
  row(ct(lang, "pfSessions"), p.sessions ? fmtNumber(lang, p.sessions) : null);
  row(ct(lang, "pfEntries"), fmtNumber(lang, p.entries));
  row(ct(lang, "pfAfk"), p.afk ? ct(lang, "pfAfkValue", fmtDuration(lang, p.afk.seconds), fmtNumber(lang, p.afk.phases)) : null);
  const md = m.medals;
  const info = m.ctx && m.ctx.info ? m.ctx.info : {};
  return page(doc, "profile", "prof-page", ct(lang, "profTitle"), null,
    el(doc, "div", "prof-head",
      portraitImg(doc, { raceFile: typeof info.raceFile === "string" ? info.raceFile : null, race: p.race, faction: typeof info.faction === "string" ? info.faction : null }, "prof-portrait", 96),
      el(doc, "div", "prof-who", el(doc, "h3", "prof-name", name), who.length ? el(doc, "p", "prof-race", who) : null,
        el(doc, "p", "prof-seals", ct(lang, "sealsLine", md.earned, md.total, md.steps, md.stepsTotal))),
    ),
    facts,
  );
}

// ---- Medaillen -----------------------------------------------------------------------------------------------------------

function unitText(lang, id, unit, n, k) {
  switch (unit) {
    case "standing":
      return standingName(lang, n);
    case "duration":
      return fmtDuration(lang, n);
    case "gold":
      return ct(lang, "u_fortune", fmtNumber(lang, n));
    case "ep":
      return ct(lang, "u_rested", fmtNumber(lang, n));
    case "skill":
      return ct(lang, "u_profession", fmtNumber(lang, n));
    case "tough":
      return ct(lang, "u_tough", fmtNumber(lang, n), TOUGH_DEATHS[k] ?? 0);
    default:
      return ct(lang, "u_" + id + (n === 1 ? "_one" : "_other"), fmtNumber(lang, n));
  }
}

// Zahl in der Fortschrittszeile (ohne Einheit)
function plainValue(lang, unit, n) {
  if (unit === "standing") return standingName(lang, n);
  if (unit === "duration") return fmtDuration(lang, n);
  return fmtNumber(lang, n);
}

function evidenceText(lang, s) {
  const parts = [s.at !== null ? ct(lang, "medEarnedAt", dateTimeText(lang, s.at)) : ct(lang, "medEarned")];
  if (s.level) parts.push(ct(lang, "medEvLevel", s.level));
  if (s.zone) parts.push(clean(s.zone, 40));
  return parts.join(" · ");
}

function progressText(lang, m, maxLevel) {
  if (m.stepped) {
    if (m.unknown && !m.earned) return ct(lang, "medUnknown");
    if (m.need) {
      const tierName = ct(lang, "tierName_" + m.need.tier);
      let line;
      if (m.id === "tough") {
        return ctn(lang, "medTough", m.toughDeaths, fmtNumber(lang, m.need.value), TOUGH_DEATHS[m.need.k], tierName);
      }
      if (m.id === "reputation") {
        line = m.value >= 1
          ? ct(lang, "medRepBest", standingName(lang, m.value), standingName(lang, m.need.value), tierName)
          : ct(lang, "medRepNone", standingName(lang, m.need.value), tierName);
        return line;
      }
      line = ct(lang, "medProgress", plainValue(lang, m.unit, Math.min(m.value, m.need.value)), plainValue(lang, m.unit, m.need.value), tierName);
      if (m.id === "flawless" && m.run > 0 && m.run < m.value) line = ct(lang, "medFlawlessRun", line, fmtNumber(lang, m.run));
      if (m.id === "unscathed" && m.runNow > 0 && m.runNow < m.value) line = ct(lang, "medUnscathedNow", line, fmtDuration(lang, m.runNow));
      return line;
    }
    if (m.noMore) return ct(lang, "medNoMore");
    return m.count >= m.max ? ct(lang, "medAllSteps") : null;
  }
  if (m.earned) return null;
  if (m.id === "continent" && m.continents > 0) return ct(lang, "medContinents", Math.min(m.continents, 2), 2);
  if (m.id === "level60" && m.level) return ct(lang, "medLevelProgress", m.level, m.top || maxLevel);
  return ct(lang, "medNotEarned");
}

// Anteil bis zur nächsten Stufe (0..1) oder null, wenn kein Balken passt
function progressShare(m) {
  if (!m.stepped || !m.need || m.id === "tough" || (m.unknown && !m.earned)) return null;
  const v = Number(m.value), n = Number(m.need.value);
  return Number.isFinite(v) && Number.isFinite(n) && n > 0 ? Math.max(0, Math.min(1, v / n)) : null;
}

function medalSeal(doc, m) {
  const tier = m.earned && RINGS.has(m.tier) ? m.tier : "bronze"; // noch nicht verdient: Ring der ersten Stufe, entsättigt
  const n = SEAL_INDEX.get(m.id) || 1;
  return el(doc, "span", "medal-seal", icon(doc, "seal-" + n, "medal-motif", [64, 64]), icon(doc, "ring-" + tier, "medal-ring", [64, 64]));
}

function medalCard(doc, lang, m, maxLevel) {
  const tier = m.tier || "bronze";
  const need = m.id === "level60" ? ct(lang, "need_level60", m.top || maxLevel) : ct(lang, "need_" + m.id);
  const li = el(doc, "li", "medal-card " + (m.earned ? "earned tier-" + tier : "locked"));
  li.appendChild(medalSeal(doc, m));
  const body = el(doc, "div", "medal-body");
  body.appendChild(el(doc, "h4", "medal-title", ct(lang, "title_" + m.id)));
  let tierLine;
  if (m.stepped) tierLine = m.earned ? ct(lang, "medTierCount", ct(lang, "tier_" + tier), m.count, m.max) : ct(lang, "medNoStep", m.max);
  else tierLine = m.earned ? ct(lang, "tier_" + tier) : ct(lang, "medToEarn", ct(lang, "tier_" + tier));
  body.appendChild(el(doc, "p", "medal-tier tier-text-" + tier, tierLine));
  body.appendChild(el(doc, "p", "medal-need", need));
  if (m.stepped) {
    const steps = el(doc, "ul", "medal-steps");
    TIER_ORDER.forEach((tn, k) => {
      const s = m.steps[k];
      const threshold = unitSteps(m)[k];
      steps.appendChild(
        el(doc, "li", "medal-step tier-text-" + tn + (s ? " done" : ""),
          el(doc, "span", "step-text", ct(lang, "tierName_" + tn) + " · " + unitText(lang, m.id, m.unit, threshold, k)),
          s ? el(doc, "span", "step-proof", evidenceText(lang, s)) : null,
        ),
      );
    });
    body.appendChild(steps);
  } else if (m.steps[0]) {
    body.appendChild(el(doc, "p", "medal-proof", evidenceText(lang, m.steps[0])));
  }
  const prog = progressText(lang, m, maxLevel);
  const share = progressShare(m);
  if (share !== null) {
    const fill = el(doc, "span", "medal-bar-fill");
    setWidth(fill, share * 100);
    body.appendChild(el(doc, "span", "medal-bar", fill));
  }
  if (prog) body.appendChild(el(doc, "p", "medal-progress", prog));
  li.appendChild(body);
  return li;
}

const unitSteps = (m) => MEDAL_STEPS[m.id];

function medalsPage(doc, lang, m) {
  const md = m.medals;
  const byId = new Map(md.list.map((e) => [e.id, e]));
  const kids = [el(doc, "p", "medal-count", ct(lang, "sealsLine", md.earned, md.total, md.steps, md.stepsTotal))];
  for (const f of md.families) {
    const cards = md.list.filter((e) => e.family === f.id && !e.hidden);
    if (!cards.length) continue;
    kids.push(
      el(doc, "div", "medal-family",
        el(doc, "h3", "medal-family-title", el(doc, "span", "family-name", ct(lang, "fam_" + f.id)),
          el(doc, "span", "family-count", f.earned + " / " + f.total)),
        el(doc, "ul", "medal-grid", cards.map((e) => medalCard(doc, lang, byId.get(e.id), m.maxLevel))),
      ),
    );
  }
  const hidden = md.list.filter((e) => e.hidden).length;
  if (hidden) kids.push(el(doc, "p", "medal-hidden", ctn(lang, "medHidden", hidden)));
  return page(doc, "medals", "medal-page", ct(lang, "medTitle"), null, ...kids);
}

// ---- Stufenfluss und Erfahrungsquellen -----------------------------------------------------------------------------------

function deathDots(doc, lang, n) {
  const wrap = el(doc, "span", "flow-deaths");
  if (n <= 0) return wrap;
  wrap.appendChild(el(doc, "span", "visually-hidden", ctn(lang, "flowDeaths", n)));
  const shown = Math.min(n, FLOW_DOTS_MAX);
  for (let i = 0; i < shown; i++) wrap.appendChild(el(doc, "span", "flow-dot", "●"));
  if (n > shown) wrap.appendChild(el(doc, "span", "flow-dot-more", "+" + (n - shown)));
  return wrap;
}

function flowBlock(doc, lang, flow) {
  const box = el(doc, "div", "flow");
  if (flow.complete === 0) box.appendChild(emptyState(doc, "map-level", ct(lang, "flowEmpty")));
  const list = el(doc, "ol", "flow-list");
  for (const c of flow.cols) {
    const cls = "flow-row" + (c.current ? " current" : "") + (c.fastest ? " fastest" : "") + (c.slowest ? " slowest" : "");
    const fill = el(doc, "span", "flow-bar");
    if (c.seconds !== null && flow.maxSeconds > 0) setWidth(fill, Math.max(1.5, (c.seconds / flow.maxSeconds) * 100));
    let dur = c.seconds === null ? ct(lang, "flowUnknown") : shortDur(lang, c.seconds);
    if (c.approx && c.seconds !== null) dur = ct(lang, "flowApprox", dur);
    list.appendChild(
      el(doc, "li", cls,
        el(doc, "span", "flow-level", ct(lang, "flowLevel", c.level)),
        el(doc, "span", "flow-track", c.seconds === null ? null : fill),
        el(doc, "span", "flow-dur", dur, c.current ? el(doc, "span", "flow-now", " · " + ct(lang, "flowRunning")) : null),
        deathDots(doc, lang, c.deaths),
      ),
    );
  }
  box.appendChild(list);
  const notes = el(doc, "ul", "flow-notes");
  const byLevel = new Map(flow.cols.map((c) => [c.level, c]));
  if (flow.fastest !== null && byLevel.get(flow.fastest)) notes.appendChild(el(doc, "li", null, ct(lang, "flowFastest", flow.fastest, fmtDuration(lang, byLevel.get(flow.fastest).seconds))));
  if (flow.slowest !== null && byLevel.get(flow.slowest)) notes.appendChild(el(doc, "li", null, ct(lang, "flowSlowest", flow.slowest, fmtDuration(lang, byLevel.get(flow.slowest).seconds))));
  if (flow.deathsNoLevel > 0) notes.appendChild(el(doc, "li", null, ct(lang, "flowNoLevel", flow.deathsNoLevel)));
  if (notes.childNodes.length) box.appendChild(notes);
  return box;
}

function sourcesBlock(doc, lang, src) {
  const box = el(doc, "div", "src");
  box.appendChild(el(doc, "h3", "chron-sub", ct(lang, "srcTitle")));
  if (src.total <= 0) {
    box.appendChild(emptyState(doc, "map-milestone", ct(lang, "srcEmpty")));
    return box;
  }
  box.appendChild(el(doc, "p", "chron-lead-small", ct(lang, "srcLead") + " " + ct(lang, "srcTotal", fmtNumber(lang, src.total))));
  const bar = el(doc, "div", "src-bar");
  const legend = el(doc, "ul", "src-legend");
  for (const key of XP_SOURCES) {
    const part = src.parts.find((p) => p.key === key);
    if (!part) continue;
    const seg = el(doc, "span", "src-seg src-" + key);
    setWidth(seg, part.pct);
    bar.appendChild(seg);
    legend.appendChild(
      el(doc, "li", "src-item",
        el(doc, "span", "src-swatch src-" + key),
        el(doc, "span", "src-label", ct(lang, "src_" + key)),
        el(doc, "span", "src-amount", fmtNumber(lang, part.amount)),
        el(doc, "span", "src-pct", fmtNumber(lang, Math.round(part.pct)) + " %"),
      ),
    );
  }
  box.appendChild(bar);
  box.appendChild(legend);
  if (src.rested > 0) box.appendChild(el(doc, "p", "src-note", ct(lang, "srcRested", fmtNumber(lang, Math.round(src.rested)))));
  if (src.unclear > 0) box.appendChild(el(doc, "p", "src-note", ctn(lang, "srcUnclear", src.unclear)));
  return box;
}

function flowPage(doc, lang, m) {
  return page(doc, "flow", "flow-page", ct(lang, "flowTitle"), ct(lang, "flowLead"), flowBlock(doc, lang, m.flow), sourcesBlock(doc, lang, m.sources));
}

// ---- Dungeons --------------------------------------------------------------------------------------------------------------

function whenText(lang, run) {
  const sameDay = dateText(lang, run.t0) === dateText(lang, run.t1);
  if (sameDay) return dateText(lang, run.t0) + ", " + timeText(lang, run.t0) + "–" + timeText(lang, run.t1);
  return dateTimeText(lang, run.t0) + " – " + dateTimeText(lang, run.t1);
}

// Forever-Datei? (Mitspielernamen werden dort als "Vorname Nachname" gezeigt); je Kontext einmal bestimmt
function foreverCtx(ctx) {
  if (ctx.forever === undefined) ctx.forever = extrasOf(ctx.char).forever;
  return ctx.forever;
}

function dungeonBody(doc, lang, ctx, run) {
  const d = dungeonDetail(ctx, run);
  const body = el(doc, "div", "dg-body");
  const facts = el(doc, "dl", "dg-facts");
  const row = (label, value) => {
    if (value === null || value === undefined || value === "") return;
    facts.appendChild(el(doc, "dt", null, label));
    facts.appendChild(el(doc, "dd", null, value));
  };
  row(ct(lang, "dgWhen"), whenText(lang, run) + (run.endKnown ? "" : " (" + ct(lang, "dgEndUnknown") + ")"));
  row(ct(lang, "dgDuration"), fmtDuration(lang, run.seconds) + (run.visits > 1 ? " · " + ctn(lang, "dgVisits", run.visits) : ""));
  const l0 = run.level0;
  const l1 = d.level1;
  if (l0 || l1) row(ct(lang, "dgLevel"), l0 && l1 && l0 !== l1 ? ct(lang, "dgLevelRange", l0, l1) : ct(lang, "dgLv", l1 || l0));
  row(ct(lang, "dgKills"), run.kills > 0 ? fmtNumber(lang, run.kills) : null);
  row(ct(lang, "dgXp"), d.xp !== null ? fmtNumber(lang, d.xp) : null);
  body.appendChild(facts);

  // Bosse
  const bossTitle = ct(lang, "dgSecBosses") + " · " + ctn(lang, "dgBosses", run.bossesDefeated);
  body.appendChild(el(doc, "h4", "dg-sec", bossTitle));
  if (run.bosses.length) {
    body.appendChild(
      el(doc, "ul", "dg-bosses", run.bosses.map((b) =>
        el(doc, "li", "dg-boss" + (b.defeated ? " won" : " lost"),
          el(doc, "span", "dg-mark", b.defeated ? "✓" : "✗"),
          el(doc, "span", "dg-boss-name", b.name ? clean(b.name, 60) : ct(lang, "dgUnknownBoss")),
          el(doc, "span", "dg-boss-sub", [b.defeated ? ct(lang, "dgBossWon") : ct(lang, "dgBossNot"), b.wipes > 0 ? ctn(lang, "dgTries", b.wipes) : null, b.seconds !== null ? shortDur(lang, b.seconds) : null].filter(Boolean).join(" · ")),
        ))),
    );
  } else if (run.bossesFromCount) {
    body.appendChild(el(doc, "p", "dg-note", ct(lang, "dgBossCountOnly", run.bossCount)));
  }

  // Gruppe
  const group = dungeonGroup(ctx, run);
  body.appendChild(el(doc, "h4", "dg-sec", ct(lang, "dgSecGroup")));
  if (group.length) {
    body.appendChild(
      el(doc, "ul", "dg-group", group.map((g) =>
        el(doc, "li", "dg-member",
          el(doc, "span", "dg-member-name", clean(playerName(g.name, foreverCtx(ctx)), 60)),
          el(doc, "span", "dg-member-sub", [g.cls ? el(doc, "span", classColorClass(g.cls) || "cls", classText(lang, g.cls)) : null, g.level ? ct(lang, "dgLv", g.level) : null, g.seconds ? fmtDuration(lang, g.seconds) : null].filter(Boolean).flatMap((x, i) => (i ? [" · ", x] : [x]))),
        ))),
    );
  } else {
    body.appendChild(el(doc, "p", "dg-note", ct(lang, "dgNoGroup")));
  }

  // Tode
  if (d.deaths.length) {
    body.appendChild(el(doc, "h4", "dg-sec", ct(lang, "dgSecDeaths") + " · " + d.deaths.length + (d.deathMore ? "+" : "")));
    const list = el(doc, "ul", "dg-deaths");
    for (const x of d.deaths) {
      const text = causeText(lang, x);
      list.appendChild(el(doc, "li", "dg-death", el(doc, "span", "dg-mark dead", "✝"), el(doc, "span", "dg-death-text", text), el(doc, "span", "dg-death-sub", [x.sub ? clean(x.sub, 60) : null, timeText(lang, x.t)].filter(Boolean).join(" · "))));
    }
    if (d.deathMore) list.appendChild(el(doc, "li", "dg-more", ct(lang, "dgMore", d.deathMore)));
    body.appendChild(list);
  }

  // Funde
  body.appendChild(el(doc, "h4", "dg-sec", ct(lang, "dgSecLoot")));
  if (d.loot.length) {
    const list = el(doc, "ul", "dg-loot");
    for (const e of d.loot) {
      const name = e.name ? clean(e.name, 70) : ct(lang, "dgItemFallback", e.itemID);
      const sub = [e.who ? clean(playerName(e.who, foreverCtx(ctx)), 60) : ct(lang, "dgYou"), e.cls ? classText(lang, e.cls) : null, e.roll && hasCt(lang, "roll." + e.roll) ? ct(lang, "roll." + e.roll) : null].filter(Boolean).join(" · ");
      list.appendChild(
        el(doc, "li", "dg-item " + (QUALITY_CLASS[e.quality] || ""),
          el(doc, "span", "dg-mark", "◆"),
          el(doc, "span", "dg-item-name", name + (e.count > 1 ? " ×" + e.count : "")),
          el(doc, "span", "dg-item-sub", sub),
        ),
      );
    }
    if (d.lootMore) list.appendChild(el(doc, "li", "dg-more", ct(lang, "dgMore", d.lootMore)));
    body.appendChild(list);
  } else body.appendChild(el(doc, "p", "dg-note", ct(lang, "dgNoLoot")));

  // Quests
  if (d.quests.length) {
    body.appendChild(el(doc, "h4", "dg-sec", ct(lang, "dgSecQuests")));
    const list = el(doc, "ul", "dg-quests");
    for (const q of d.quests) {
      const title = q.title ? clean(q.title, 80) : ct(lang, "dgQuestFallback", q.id);
      const sub = [q.done ? ct(lang, "dgQuestDone") : ct(lang, "dgQuestTaken"), q.done && q.xp ? ct(lang, "dgReward", fmtNumber(lang, q.xp)) : null].filter(Boolean).join(" · ");
      list.appendChild(el(doc, "li", "dg-quest" + (q.done ? " done" : ""), el(doc, "span", "dg-mark", q.done ? "✓" : "○"), el(doc, "span", "dg-quest-name", title), el(doc, "span", "dg-quest-sub", sub)));
    }
    if (d.questMore) list.appendChild(el(doc, "li", "dg-more", ct(lang, "dgMore", d.questMore)));
    body.appendChild(list);
  }
  return body;
}

// Emblem der Zeile (Addon Media/KillEmblems.tga): Boss besiegt = Boss-Emblem, sonst das schlichte
const runEmblem = (run) => (run.bossesDefeated > 0 ? "emblem-boss" : "emblem-normal");

// Zelle mit Beschriftung für die schmale Ansicht (data-label nur aus den eigenen Texten)
function cell(doc, cls, label, ...children) {
  const td = el(doc, "td", cls, ...children);
  if (label) td.setAttribute("data-label", label);
  return td;
}

// Ein Lauf = eine Tabellenzeile; der Knopf im Namen klappt die Einzelheiten (Bosse, Gruppe, Tode, Funde, Quests) darunter auf.
// Der Rumpf entsteht erst beim ersten Aufklappen; der erste Lauf ist offen und gleich fertig.
let runSeq = 0;
function dungeonRun(doc, lang, ctx, run, index) {
  const name = run.name ? clean(run.name, 60) : ct(lang, "dgUnknown");
  const diff = difficultyName(lang, run.difficultyID);
  const id = "dg-run-" + ++runSeq;
  const toggle = el(doc, "button", "dg-toggle", el(doc, "span", "dg-name", name));
  toggle.type = "button";
  toggle.setAttribute("aria-controls", id);
  const sub = [diff, run.endKnown ? null : ct(lang, "dgEndUnknown")].filter(Boolean).join(" · ");
  const deaths = run.deathsCount > 0
    ? el(doc, "span", "dg-badge red", ctn(lang, "dgDeaths", run.deathsCount))
    : el(doc, "span", "dg-badge", ct(lang, "dgNoDeaths"));
  const row = el(doc, "tr", "dg-row",
    cell(doc, "dg-cell-name", null,
      el(doc, "div", "dg-name-cell", icon(doc, runEmblem(run), "dg-emblem", [40, 40]),
        el(doc, "div", "dg-name-text", toggle, sub ? el(doc, "span", "dg-diff", sub) : null))),
    cell(doc, "r", ct(lang, "dgColLevel"), run.level0 ? String(run.level0) : "–"),
    cell(doc, "r", ct(lang, "dgColTime"), fmtDuration(lang, run.seconds)),
    cell(doc, "r", ct(lang, "dgColBosses"), el(doc, "span", "dg-badge", fmtNumber(lang, run.bossesDefeated))),
    cell(doc, "r", ct(lang, "dgColDeaths"), deaths),
    cell(doc, "r dg-date", ct(lang, "dgColDate"), dateText(lang, run.t0)),
  );
  const detailCell = el(doc, "td", "dg-detail-cell");
  detailCell.setAttribute("colspan", "6");
  const detail = el(doc, "tr", "dg-detail", detailCell);
  detail.setAttribute("id", id);
  const tbody = el(doc, "tbody", "dg-run", row, detail);
  let built = false;
  let open = false;
  const set = (v) => {
    open = v;
    if (open && !built) {
      built = true;
      detailCell.appendChild(dungeonBody(doc, lang, ctx, run));
    }
    detail.hidden = !open;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  };
  toggle.addEventListener("click", () => set(!open));
  set(index === 0);
  return tbody;
}

function dungeonsPage(doc, lang, m) {
  const dg = m.dungeons;
  const kids = [];
  if (!dg.count) kids.push(emptyState(doc, "emblem-normal", ct(lang, "dgEmpty")));
  else {
    kids.push(el(doc, "p", "dg-count", ctn(lang, "dgRuns", dg.count)));
    const head = el(doc, "tr", null,
      el(doc, "th", null, ct(lang, "dgColDungeon")),
      el(doc, "th", "r", ct(lang, "dgColLevel")),
      el(doc, "th", "r", ct(lang, "dgColTime")),
      el(doc, "th", "r", ct(lang, "dgColBosses")),
      el(doc, "th", "r", ct(lang, "dgColDeaths")),
      el(doc, "th", "r", ct(lang, "dgColDate")),
    );
    for (const th of head.childNodes) th.setAttribute("scope", "col");
    const table = el(doc, "table", "dg-table", el(doc, "thead", null, head));
    kids.push(pagedList(doc, lang, table, null, dg.runs, (run, i) => dungeonRun(doc, lang, m.ctx, run, i)));
    if (dg.truncated) kids.push(el(doc, "p", "dg-note", ct(lang, "dgTruncated")));
  }
  return page(doc, "dungeons", "dg-page", ct(lang, "dgTitle"), ct(lang, "dgLead"), ...kids);
}

// ---- Tode ------------------------------------------------------------------------------------------------------------------

function deathsPage(doc, lang, m) {
  const list = m.deaths.slice().reverse(); // neueste zuerst
  const kids = [];
  if (!list.length) kids.push(emptyState(doc, "map-hearth", ct(lang, "dtEmpty")));
  else {
    kids.push(el(doc, "p", "dg-count", ctn(lang, "dtCount", list.length)));
    kids.push(
      pagedList(doc, lang, "ol", "death-list", list, (d) => {
        const place = d.place ? clean(d.place, 60) : null;
        const sub = [place || ct(lang, "dtUnknownPlace"), d.instance && d.instance !== d.place ? ct(lang, "dtInstance", clean(d.instance, 60)) : null, d.level ? ct(lang, "dtLevel", d.level) : null, d.combat ? ct(lang, "dtCombat") : null]
          .filter(Boolean)
          .join(" · ");
        return el(doc, "li", "death-row",
          el(doc, "span", "death-icon", icon(doc, "map-death", "death-img", [28, 28])),
          el(doc, "span", "death-body", el(doc, "span", "death-text", causeText(lang, d)), el(doc, "span", "death-sub", sub)),
          el(doc, "span", "death-date", dateText(lang, d.t) + " " + timeText(lang, d.t)),
        );
      }),
    );
  }
  return page(doc, "deaths", "death-page", ct(lang, "dtTitle"), ct(lang, "dtLead"), ...kids);
}

// ---- Ganze Ansicht ---------------------------------------------------------------------------------------------------------

const hasClass = (node, cls) => typeof node.className === "string" && node.className.split(" ").includes(cls);

// Die Seiten des Export-Buches, die hier weiterbenutzt werden: Bilanz, Kapitel, Höhepunkte, Notizen (unverändert aus core/render)
function bookPages(doc, journal, lang) {
  const book = renderJournal(doc, journal, lang);
  const out = { stats: null, chapters: [], highlights: null, notes: null };
  for (const node of book.childNodes) {
    if (hasClass(node, "stats-page")) out.stats = node;
    else if (hasClass(node, "chapter")) out.chapters.push(node);
    else if (hasClass(node, "highlights-page")) out.highlights = node;
    else if (hasClass(node, "notes-page")) out.notes = node;
  }
  return out;
}

export function renderChronicle(doc, { model, journal, lang }) {
  const own = {
    profile: profilePage(doc, lang, model),
    medals: medalsPage(doc, lang, model),
    flow: flowPage(doc, lang, model),
    dungeons: dungeonsPage(doc, lang, model),
    deaths: deathsPage(doc, lang, model),
  };
  const core = bookPages(doc, shownJournal(journal, lang), lang);
  const sections = [
    ["profile", ct(lang, "navProfile"), [own.profile]],
    ["medals", ct(lang, "navMedals"), [own.medals]],
    ["flow", ct(lang, "navFlow"), [own.flow]],
    ["dungeons", ct(lang, "navDungeons"), [own.dungeons]],
    ["deaths", ct(lang, "navDeaths"), [own.deaths]],
    ["stats", ct(lang, "navStats"), core.stats ? [core.stats] : []],
    ["chapters", ct(lang, "navChapters"), core.chapters],
    ["highlights", ct(lang, "navHighlights"), core.highlights ? [core.highlights] : []],
    ["notes", ct(lang, "navNotes"), core.notes ? [core.notes] : []],
  ].filter(([, , nodes]) => nodes.length);

  const book = el(doc, "div", "book chron-book");
  book.setAttribute("lang", lang === "en" ? "en" : "de");
  const nav = el(doc, "nav", "subnav chron-nav no-print");
  nav.setAttribute("aria-label", ct(lang, "navLabel"));
  const win = doc.defaultView || null;
  const reduce = !!(win && typeof win.matchMedia === "function" && win.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const btns = [];
  for (const [key, label, nodes] of sections) {
    const b = el(doc, "button", "subnav-btn chron-nav-btn", label);
    b.type = "button";
    b.addEventListener("click", () => {
      for (const o of btns) o.setAttribute("aria-current", o === b ? "true" : "false");
      const target = nodes[0];
      if (target && typeof target.scrollIntoView === "function") target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    });
    b.setAttribute("data-target", key);
    b.setAttribute("aria-current", btns.length === 0 ? "true" : "false");
    btns.push(b);
    nav.appendChild(b);
    for (const n of nodes) book.appendChild(n);
  }
  const p = model.profile;
  const head = el(doc, "div", "sec-head chron-head",
    el(doc, "h2", "sec-title", ct(lang, "chronTitle")),
    p && p.entries ? el(doc, "p", "chron-entries", ct(lang, "chronEntries", fmtNumber(lang, p.entries))) : null,
  );
  return el(doc, "div", "chron-view", head, nav, book);
}
