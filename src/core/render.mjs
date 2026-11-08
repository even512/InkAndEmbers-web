// Herkunft: EveN_ForeverChronicle/tools/journal-export/src/render.mjs (kopiert mit scripts/sync-core.mjs).
// NICHT HIER BEARBEITEN: Pflege im Addon-Repo, danach `npm run sync-core`. Commit siehe SOURCE.txt.
// Lays out the journal as DOM nodes. Safety: every text from the file goes in as a text node (createTextNode);
// attributes are only set from constants of this file. No HTML strings anywhere.
import { tr, raw, fmtNumber, fmtDate, fmtShortDate, fmtDuration, moneyParts, roman } from "./i18n.mjs";

export const CHAPTER_HIGHLIGHTS_MAX = 10;
export const PAGE_HIGHLIGHTS_MAX = 40;
export const PLACES_MAX = 18;
export const NOTE_BODY_MAX = 4000;
export const TEXT_MAX = 300;

const QUALITY_CLASS = { 2: "q-uncommon", 3: "q-rare", 4: "q-epic", 5: "q-legendary" };
const ICON = { level: "▲", death: "✝", boss: "♛", find: "◆", moment: "✦", home: "⌂", plan: "✓" };
const RAID_GLYPH = ["★", "●", "◆", "▲", "☾", "■", "✖", "☠"];
const NOTE_ICONS = { stufe: "▲", meilenstein: "✦", tod: "✝", selten: "◈", elite: "❖", boss: "♛", foto: "◉", ruhestein: "⌂", flug: "➶", kampf: "⚔" };
const NOTE_COLORS = { schwarz: "ink-black", rot: "ink-red", blau: "ink-blue", gruen: "ink-green" };

// element with class and children (strings become text nodes, null/false are skipped, arrays are flattened)
export function el(doc, tag, cls, ...children) {
  const node = doc.createElement(tag);
  if (cls) node.className = cls;
  append(doc, node, children);
  return node;
}

function append(doc, node, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(doc, node, c);
    else if (typeof c === "string" || typeof c === "number") node.appendChild(doc.createTextNode(String(c)));
    else node.appendChild(c);
  }
}

// text from the file: control characters out, length capped (it still only ever becomes a text node)
export function clean(s, max = TEXT_MAX) {
  if (typeof s !== "string") return "";
  // eslint-disable-next-line no-control-regex
  let out = s.replace(/[\u0000-\u0008\u000B-\u001F\u007F‪-‮⁦-⁩]/g, "");
  if (out.length > max) out = out.slice(0, max - 1) + "…";
  return out;
}

function money(doc, lang, copper, cls) {
  const parts = moneyParts(lang, copper);
  if (!parts.length) return el(doc, "span", "money", "–");
  return el(doc, "span", "money" + (cls ? " " + cls : ""), parts.map((p) => el(doc, "span", "coin " + p.kind, p.n, el(doc, "span", "unit", p.unit))));
}

// text of a highlight -> { icon, text, tone, sub }
export function highlightLine(lang, h) {
  const name = h.name ? clean(h.name) : null;
  switch (h.kind) {
    case "level":
      return { icon: ICON.level, text: tr(lang, "hlLevel", h.level ?? "?"), tone: h.major ? "tone-gold" : "tone-ochre", sub: h.place ? clean(h.place) : null };
    case "death": {
      let text;
      if (h.killer) text = tr(lang, "hlDeathBy", clean(h.killer));
      else if (h.cause && raw(lang, "cause." + h.cause)) text = tr(lang, "cause." + h.cause);
      else text = tr(lang, "hlDeath");
      const sub = [h.place ? clean(h.place) : null, h.guess ? tr(lang, "guessed") : null].filter(Boolean).join(" · ") || null;
      return { icon: ICON.death, text, tone: "tone-red", sub };
    }
    case "boss":
      return { icon: ICON.boss, text: name ? tr(lang, "hlBoss", name) : tr(lang, "hlBossNo"), tone: "tone-red", sub: h.instance ? tr(lang, "hlBossIn", clean(h.instance)) : null };
    case "find":
      return { icon: ICON.find, text: h.item ? tr(lang, "hlFind", clean(h.item)) : tr(lang, "hlFindNo"), tone: QUALITY_CLASS[h.quality] || "tone-ochre", sub: null };
    case "home":
      return { icon: ICON.home, text: tr(lang, "hlHome", name || "?"), tone: "tone-blue", sub: null };
    case "plan":
      return { icon: ICON.plan, text: tr(lang, "hlPlan", name || "?"), tone: "tone-green", sub: null };
    case "moment": {
      const pair = raw(lang, "moment." + h.moment);
      let text = Array.isArray(pair) ? (name ? pair[0].replace("{0}", name) : pair[1]) : name || "";
      if (h.moment === "profession" && h.detail && /^\d+$/.test(h.detail)) text += " (" + h.detail + ")";
      const tone = h.moment === "first_blue" || h.moment === "first_epic" ? QUALITY_CLASS[h.quality] || "tone-blue" : h.moment === "kill" || h.moment === "close_win" ? "tone-red" : "tone-ochre";
      return { icon: ICON.moment, text, tone, sub: h.place && clean(h.place) !== name ? clean(h.place) : null };
    }
    default:
      return { icon: "·", text: "", tone: "", sub: null };
  }
}

function highlightItem(doc, lang, h, withDate) {
  const line = highlightLine(lang, h);
  return el(
    doc,
    "li",
    "moment " + line.tone,
    el(doc, "span", "moment-icon", line.icon),
    el(doc, "span", "moment-body", el(doc, "span", "moment-text", line.text), line.sub ? el(doc, "span", "moment-sub", line.sub) : null),
    withDate ? el(doc, "span", "moment-date", fmtShortDate(lang, h.t)) : null,
  );
}

// global highlight selection: no plans, no rare/elite kills, finds only epic+, with many level-ups only every tenth
export function selectHighlights(journal) {
  let list = journal.highlights.filter((h) => h.kind !== "plan" && !(h.kind === "find" && (h.quality || 0) < 4) && !(h.kind === "moment" && (h.moment === "kill" || h.moment === "close_win")));
  const levels = list.filter((h) => h.kind === "level");
  if (levels.length > 12) {
    const last = levels[levels.length - 1];
    list = list.filter((h) => h.kind !== "level" || h.major || h === last);
  }
  const more = Math.max(0, list.length - PAGE_HIGHLIGHTS_MAX);
  return { list: list.slice(0, PAGE_HIGHLIGHTS_MAX), more };
}

function charName(j) {
  return clean(j.name, 40) || "?";
}

function titlePage(doc, lang, j) {
  const initial = (charName(j).match(/\p{L}/u) || ["?"])[0].toUpperCase();
  const who = [j.race ? clean(j.race, 40) : null, j.cls ? clean(j.cls, 40) : null].filter(Boolean).join(" · ");
  const meta = [j.level !== null ? tr(lang, "levelN", j.level) : null, j.realm ? clean(j.realm, 40) : null].filter(Boolean).join(" · ");
  const flavor = j.flavor === "forever" ? tr(lang, "flavorForever") : j.flavor === "retail" ? tr(lang, "flavorRetail") : null;
  const facts = el(doc, "dl", "title-facts");
  if (j.firstT && j.lastT) append(doc, facts, [el(doc, "dt", null, tr(lang, "period")), el(doc, "dd", null, tr(lang, "periodValue", fmtDate(lang, j.firstT), fmtDate(lang, j.lastT)))]);
  if (j.played !== null) append(doc, facts, [el(doc, "dt", null, tr(lang, "played")), el(doc, "dd", null, fmtDuration(lang, j.played))]);
  return el(
    doc,
    "section",
    "page title-page",
    el(doc, "div", "title-frame",
      el(doc, "p", "title-kicker", tr(lang, "journalKicker")),
      el(doc, "div", "seal", el(doc, "span", "seal-letter", initial)),
      el(doc, "p", "title-of", tr(lang, "journalOf")),
      el(doc, "h1", "title-name", charName(j)),
      who ? el(doc, "p", "title-who", who) : null,
      meta ? el(doc, "p", "title-meta", meta) : null,
      el(doc, "div", "rule ornament", "❦"),
      facts,
      flavor ? el(doc, "p", "title-flavor", flavor) : null,
    ),
  );
}

function contentsPage(doc, lang, j, sections) {
  const ol = el(doc, "ol", "toc");
  for (const c of j.chapters) {
    const lv = levelRange(c);
    ol.appendChild(
      el(doc, "li", "toc-row",
        el(doc, "span", "toc-num", roman(c.n)),
        el(doc, "span", "toc-title", zoneTitle(lang, c)),
        el(doc, "span", "toc-dots"),
        el(doc, "span", "toc-meta", lv ? tr(lang, "levelN", lv) : ""),
      ),
    );
  }
  for (const s of sections) {
    ol.appendChild(el(doc, "li", "toc-row toc-extra", el(doc, "span", "toc-num", "✦"), el(doc, "span", "toc-title", s), el(doc, "span", "toc-dots"), el(doc, "span", "toc-meta", "")));
  }
  return el(doc, "section", "page contents-page", el(doc, "h2", "page-title", tr(lang, "contents")), ol);
}

function levelRange(c) {
  if (c.minLevel === null) return null;
  return c.minLevel === c.maxLevel ? String(c.minLevel) : c.minLevel + "–" + c.maxLevel;
}

function zoneTitle(lang, c) {
  return c.zoneName ? clean(c.zoneName, 80) : tr(lang, "unknownZone");
}

function chapterPage(doc, lang, j, c, isLast) {
  const name = charName(j);
  const zone = zoneTitle(lang, c);
  const lede = [];
  lede.push(c.minLevel !== null ? tr(lang, "arrived", name, c.minLevel, zone) : tr(lang, "arrivedNoLevel", name, zone));
  if (isLast && c.maxLevel !== null) lede.push(tr(lang, "standsToday", name, c.maxLevel));
  else if (c.maxLevel !== null && c.maxLevel > (c.minLevel ?? c.maxLevel)) lede.push(tr(lang, "leftAt", name, c.maxLevel));

  const sameDay = fmtDate(lang, c.start) === fmtDate(lang, c.end);
  const dates = sameDay ? tr(lang, "oneDay", fmtDate(lang, c.start)) : tr(lang, "dates", fmtDate(lang, c.start), fmtDate(lang, c.end));
  const active = c.active >= 60 ? tr(lang, "activeTime", fmtDuration(lang, c.active)) : null;

  const facts = el(doc, "ul", "facts");
  if (c.quests) facts.appendChild(el(doc, "li", "fact", c.quests === 1 ? tr(lang, "factQuest1") : tr(lang, "factQuests", fmtNumber(lang, c.quests))));
  if (c.kills) facts.appendChild(el(doc, "li", "fact", c.kills === 1 ? tr(lang, "factKill1") : tr(lang, "factKills", fmtNumber(lang, c.kills))));
  if (c.deaths) facts.appendChild(el(doc, "li", "fact fact-red", c.deaths === 1 ? tr(lang, "factDeath1") : tr(lang, "factDeaths", fmtNumber(lang, c.deaths))));

  const plans = c.highlights.filter((h) => h.kind === "plan");
  const rest = c.highlights.filter((h) => h.kind !== "plan");
  const moments = el(doc, "ol", "moments");
  for (const h of rest.slice(0, CHAPTER_HIGHLIGHTS_MAX)) moments.appendChild(highlightItem(doc, lang, h, true));
  if (rest.length > CHAPTER_HIGHLIGHTS_MAX) moments.appendChild(el(doc, "li", "moment more", tr(lang, "moreHighlights", rest.length - CHAPTER_HIGHLIGHTS_MAX)));
  if (plans.length) {
    const shown = plans.slice(0, 4).map((p) => clean(p.name, 80)).join(" · ");
    const extra = plans.length > 4 ? " " + tr(lang, "morePlaces", plans.length - 4) : "";
    moments.appendChild(el(doc, "li", "moment tone-green", el(doc, "span", "moment-icon", ICON.plan), el(doc, "span", "moment-body", el(doc, "span", "moment-text", tr(lang, "hlPlan", shown + extra)))));
  }

  const places = c.subzones.concat(c.discoveries.filter((d) => !c.subzones.includes(d)));
  const aside = places.length
    ? el(doc, "aside", "places",
        el(doc, "h3", "places-title", tr(lang, "placesFound")),
        el(doc, "ul", "places-list", places.slice(0, PLACES_MAX).map((p) => el(doc, "li", null, clean(p, 60)))),
        places.length > PLACES_MAX ? el(doc, "p", "places-more", tr(lang, "morePlaces", places.length - PLACES_MAX)) : null,
      )
    : null;

  return el(
    doc,
    "section",
    "page chapter",
    el(doc, "header", "chapter-head",
      el(doc, "p", "chapter-kicker", tr(lang, "chapter", roman(c.n))),
      el(doc, "h2", "chapter-title", zone),
      el(doc, "p", "chapter-dates", [dates, active].filter(Boolean).join(" · ")),
    ),
    el(doc, "p", "lede", lede.join(" ")),
    facts.childNodes.length ? facts : null,
    c.via.length ? el(doc, "p", "via", tr(lang, "via", c.via.slice(0, 8).map((v) => clean(v, 60)).join(", "))) : null,
    el(doc, "div", "chapter-body" + (aside ? "" : " single"), moments.childNodes.length ? moments : null, aside),
  );
}

function highlightsPage(doc, lang, j) {
  const { list, more } = selectHighlights(j);
  if (!list.length) return null;
  const ol = el(doc, "ol", "moments timeline", list.map((h) => highlightItem(doc, lang, h, true)));
  if (more) ol.appendChild(el(doc, "li", "moment more", tr(lang, "moreHighlights", more)));
  return el(doc, "section", "page highlights-page", el(doc, "h2", "page-title", tr(lang, "highlights")), el(doc, "p", "page-lead", tr(lang, "highlightsLead")), ol);
}

function statCard(doc, label, value, sub, cls) {
  return el(doc, "div", "stat" + (cls ? " " + cls : ""), el(doc, "div", "stat-value", value), el(doc, "div", "stat-label", label), sub ? el(doc, "div", "stat-sub", sub) : null);
}

function statsPage(doc, lang, j) {
  const s = j.stats;
  const n = (v) => fmtNumber(lang, v);
  const grid = el(doc, "div", "stats-grid");
  const add = (card) => grid.appendChild(card);
  if (j.level !== null) add(statCard(doc, tr(lang, "st.level"), String(j.level), null, "stat-big"));
  if (j.played !== null) add(statCard(doc, tr(lang, "st.played"), fmtDuration(lang, j.played), null, "stat-big"));
  add(statCard(doc, tr(lang, "st.kills"), n(s.kills), s.fights ? tr(lang, "st.fights") + ": " + n(s.fights) : null, "stat-big"));
  add(statCard(doc, tr(lang, "st.quests"), n(s.questsDone), tr(lang, "st.questsSub", n(s.questsAccepted), n(s.questsAbandoned)), "stat-big"));
  add(statCard(doc, tr(lang, "st.deaths"), n(s.deaths), null, s.deaths ? "stat-red" : null));
  if (s.closeWins) add(statCard(doc, tr(lang, "st.closeWins"), n(s.closeWins)));
  add(statCard(doc, tr(lang, "st.goldIn"), money(doc, lang, s.goldIn)));
  add(statCard(doc, tr(lang, "st.goldOut"), money(doc, lang, s.goldOut)));
  if (s.goldBalance !== null) add(statCard(doc, tr(lang, "st.goldBalance"), money(doc, lang, s.goldBalance)));
  if (s.xp) add(statCard(doc, tr(lang, "st.xp"), n(s.xp)));
  add(statCard(doc, tr(lang, "st.zones"), n(s.zones)));
  if (s.subzones) add(statCard(doc, tr(lang, "st.subzones"), n(s.subzones)));
  if (s.discoveries) add(statCard(doc, tr(lang, "st.discoveries"), n(s.discoveries)));
  if (s.instances) add(statCard(doc, tr(lang, "st.instances"), n(s.instances)));
  if (s.flights) add(statCard(doc, tr(lang, "st.flights"), n(s.flights)));
  if (s.flightPoints) add(statCard(doc, tr(lang, "st.flightPoints"), n(s.flightPoints)));
  if (s.hearthstones) add(statCard(doc, tr(lang, "st.hearth"), n(s.hearthstones)));
  if (s.booksRead) add(statCard(doc, tr(lang, "st.books"), n(s.booksRead)));
  const findsTotal = s.finds[2] + s.finds[3] + s.finds[4] + s.finds[5];
  if (findsTotal) add(statCard(doc, tr(lang, "st.finds"), n(findsTotal), tr(lang, "st.findsSub", n(s.finds[2]), n(s.finds[3]), n(s.finds[4]), n(s.finds[5]))));
  if (s.topEnemy && s.topEnemy.name) add(statCard(doc, tr(lang, "st.topEnemy"), clean(s.topEnemy.name, 60), "× " + n(s.topEnemy.count), "stat-wide"));
  if (s.campfires) add(statCard(doc, tr(lang, "st.campfires"), n(s.campfires)));
  if (s.plansDone) add(statCard(doc, tr(lang, "st.plans"), n(s.plansDone)));
  if (s.sessions) add(statCard(doc, tr(lang, "st.sessions"), n(s.sessions)));
  return el(doc, "section", "page stats-page", el(doc, "h2", "page-title", tr(lang, "statistics")), grid);
}

// --- notes (addon markup, see addon/InkAndEmbers/journal/model/NoteMarkup.lua) ---------------------------------

// one line of note text -> inline nodes (links shown as their text, colours, raid marks, map icons, **emphasis**)
export function noteInline(doc, lang, line) {
  // WoW escapes: link -> [text], texture out, colour codes out, "||" -> "|"
  let s = line
    .replace(/\|H[a-z]+:[\w:-]*\|h\[([^|\]\n]*)\]\|h/gi, "\u0001$1\u0002")
    .replace(/\|T[^|]*\|t/g, "")
    .replace(/\|c[0-9a-fA-F]{8}/g, "")
    .replace(/\|r/g, "")
    .replace(/\|\|/g, "|");
  const out = [];
  const stack = [{ node: null, children: out }];
  const top = () => stack[stack.length - 1].children;
  const re = /\u0001([^\u0002]*)\u0002|\{(schwarz|rot|blau|gruen)\}|\{\/\}|\{rt([1-8])\}|\{([a-z]+)\}|\*\*/g;
  let last = 0;
  let emph = null;
  let m;
  const text = (t) => {
    if (t) top().push(doc.createTextNode(t));
  };
  while ((m = re.exec(s)) !== null) {
    text(s.slice(last, m.index));
    last = re.lastIndex;
    if (m[1] !== undefined) {
      top().push(el(doc, "span", "note-link", "[" + m[1] + "]"));
    } else if (m[2]) {
      const span = el(doc, "span", NOTE_COLORS[m[2]]);
      top().push(span);
      stack.push({ node: span, children: [] });
    } else if (m[0] === "{/}") {
      if (stack.length > 1 && stack[stack.length - 1].node.className !== "note-emph") {
        const f = stack.pop();
        append(doc, f.node, f.children);
      }
    } else if (m[3]) {
      const i = Number(m[3]) - 1;
      top().push(el(doc, "span", "raid-mark rt" + m[3], RAID_GLYPH[i]));
    } else if (m[4]) {
      if (NOTE_ICONS[m[4]]) top().push(el(doc, "span", "note-icon", NOTE_ICONS[m[4]]));
      else text(m[0]);
    } else if (m[0] === "**") {
      if (emph) {
        while (stack.length > 1) {
          const f = stack.pop();
          append(doc, f.node, f.children);
          if (f.node === emph) break;
        }
        emph = null;
      } else {
        emph = el(doc, "strong", "note-emph");
        top().push(emph);
        stack.push({ node: emph, children: [] });
      }
    }
  }
  text(s.slice(last));
  while (stack.length > 1) {
    const f = stack.pop();
    append(doc, f.node, f.children);
  }
  return out;
}

export function renderNoteBody(doc, lang, body) {
  const box = el(doc, "div", "note-body");
  const lines = clean(String(body || "").replace(/\r\n?/g, "\n"), NOTE_BODY_MAX).split("\n");
  let list = null;
  for (const line of lines) {
    let m;
    if ((m = /^-\s+(.*)$/.exec(line)) || (m = /^\[( |x|X)\]\s?(.*)$/.exec(line))) {
      if (!list) {
        list = el(doc, "ul", "note-list");
        box.appendChild(list);
      }
      if (m.length === 2) list.appendChild(el(doc, "li", "note-bullet", noteInline(doc, lang, m[1])));
      else list.appendChild(el(doc, "li", "note-check" + (m[1] === " " ? "" : " done"), el(doc, "span", "check-box", m[1] === " " ? "☐" : "☑"), noteInline(doc, lang, m[2])));
      continue;
    }
    list = null;
    if (/^---+\s*$/.test(line)) box.appendChild(el(doc, "hr", "note-rule"));
    else if ((m = /^#\s+(.*)$/.exec(line))) box.appendChild(el(doc, "h4", "note-head", noteInline(doc, lang, m[1])));
    else if (line.trim() === "") box.appendChild(el(doc, "div", "note-gap"));
    else box.appendChild(el(doc, "p", "note-line", noteInline(doc, lang, line)));
  }
  return box;
}

function notesPage(doc, lang, j) {
  if (!j.notes.length) return null;
  const list = el(doc, "div", "notes");
  for (const n of j.notes) {
    const meta = tr(lang, "noteMeta", fmtDate(lang, n.created), n.zone ? clean(n.zone, 60) : "–", n.level ?? "?");
    list.appendChild(
      el(doc, "article", "note" + (n.pinned ? " pinned" : ""),
        n.pinned ? el(doc, "span", "note-pin", tr(lang, "pinned")) : null,
        n.title ? el(doc, "h3", "note-title", clean(n.title, 80)) : null,
        el(doc, "p", "note-meta", meta),
        renderNoteBody(doc, lang, n.body),
      ),
    );
  }
  return el(doc, "section", "page notes-page", el(doc, "h2", "page-title", tr(lang, "notes")), el(doc, "p", "page-lead", tr(lang, "notesLead")), list);
}

// the whole book -> <div class="book">
export function renderJournal(doc, journal, lang, now = Date.now() / 1000) {
  const book = el(doc, "div", "book");
  book.setAttribute("lang", lang === "en" ? "en" : "de");
  book.appendChild(titlePage(doc, lang, journal));
  const hl = highlightsPage(doc, lang, journal);
  const st = statsPage(doc, lang, journal);
  const nt = notesPage(doc, lang, journal);
  const extras = [hl ? tr(lang, "highlights") : null, tr(lang, "statistics"), nt ? tr(lang, "notes") : null].filter(Boolean);
  if (journal.chapters.length) {
    book.appendChild(contentsPage(doc, lang, journal, extras));
  } else {
    book.appendChild(el(doc, "section", "page empty-page", el(doc, "p", "lede", tr(lang, "noEntries"))));
  }
  journal.chapters.forEach((c, i) => book.appendChild(chapterPage(doc, lang, journal, c, i === journal.chapters.length - 1)));
  if (hl) book.appendChild(hl);
  book.appendChild(st);
  if (nt) book.appendChild(nt);
  book.appendChild(el(doc, "footer", "colophon", el(doc, "p", null, tr(lang, "colophon", fmtDate(lang, now))), el(doc, "p", "fonts-note", tr(lang, "fontsNote"))));
  return book;
}
