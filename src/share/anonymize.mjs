// „Andere Spieler ausblenden“ für Video, GIF und Bild (später auch Druck): Namen anderer Spieler werden IM MODELL ersetzt,
// bevor irgendetwas gezeichnet wird (kein Weichzeichnen). Jeder Name bekommt stabil „Gefährte 1…n“ (Reihenfolge des ersten
// Auftretens im Log). Zwei Stufen:
//   1. anonymizeChar: die Log-Zeilen des Charakters werden umgeschrieben (alle Felder, die laut README „Log format“ einen
//      Spielernamen tragen), heikle Zähler (mates, duels, pvp, trade, mail) fallen weg. Daraus entstehen Journal und Reise neu.
//   2. scrubJourney / scrubLabels: Netz darunter. Jeder Text, der in Marker, Kapitel, Kartennamen (data.names) oder
//      Ortsnamen des Pergament-Rückfalls fließt, wird noch einmal nach den gefundenen Namen durchsucht (ganzes Wort).
// Reine Daten, kein DOM. Der eigene Charaktername bleibt (er gehört dem Spieler, der teilt).
import { isTable, luaArray } from "../core/lua-parse.mjs";
import { safeText } from "../ui/safe-text.mjs";

// Felder mit Spielernamen: Kürzel -> [{ i: Feldindex nach '<dt>~<Kürzel>~', kind, when? }]
//   name    ganzes Feld ist ein Name ("Name" oder "Name-Realm")
//   members GI: "Name:KLASSE:Stufe,…"
//   people  LF: "guid,name-realm,class,race,level,sex,how;…"
// when(f): nur ersetzen, wenn die Bedingung gilt (z. B. DC.source nur ohne npcID = Spieler oder unbekannter Verursacher)
const empty = (v) => v === undefined || v === "" || v === "?";
export const NAME_FIELDS = Object.freeze({
  DC: [{ i: 1, kind: "name", when: (f) => empty(f[0]) }],
  DR: [{ i: 3, kind: "name", when: (f) => empty(f[2]) }],
  PK: [{ i: 0, kind: "name" }],
  PD: [{ i: 0, kind: "name" }],
  DU: [{ i: 0, kind: "name" }],
  TH: [{ i: 0, kind: "name" }],
  PM: [{ i: 0, kind: "name", when: (f) => f[4] !== "1" }], // Auktionshaus-Briefe tragen keinen Spielernamen
  PS: [{ i: 0, kind: "name" }],
  GM: [{ i: 0, kind: "name" }],
  GL: [{ i: 0, kind: "name" }],
  WB: [{ i: 0, kind: "name" }],
  WV: [{ i: 0, kind: "name" }],
  LG: [{ i: 3, kind: "name" }], // Empfänger von Gruppenbeute (Chronik: Dungeon-Beute)
  AH: [{ i: 7, kind: "name" }], // Käufer/Verkäufer laut Rechnung (nur wenn gesetzt, empty() greift in rewriteFields)
  GI: [{ i: 2, kind: "members" }],
  LF: [{ i: 6, kind: "people" }],
});

// Feldliste zu einem Kürzel aus der Datei; nur eigene Schlüssel ("constructor", "__proto__" … treffen nie den Prototyp)
const specsFor = (code) => (typeof code === "string" && Object.prototype.hasOwnProperty.call(NAME_FIELDS, code) ? NAME_FIELDS[code] : null);

// Zähler, deren Schlüssel oder Inhalte andere Spieler nennen. Die Schlüssel (Namen) werden durch neutrale Nummern ersetzt, die
// Werte bleiben: Medaillen wie „Gesellig“ (verschiedene Mitspieler) zählen vor und nach dem Ausblenden gleich.
export const SENSITIVE_COUNTERS = Object.freeze(["mates", "duels", "pvp", "trade", "mail"]);

const PSEUDO = { de: "Gefährte {0}", en: "Companion {0}" };
export function pseudonym(lang, n) {
  return (PSEUDO[lang] || PSEUDO.en).replace("{0}", String(n));
}

// Eindeutig kein Spielername, sondern eine Spielfigur der Welt: Spielernamen enthalten nie Leerzeichen (nur mit "-Realm"
// dahinter wäre es ein Spieler), und „Auktionshaus“/„Doktor“ & Co. nennt kein Spieler so. Im Zweifel wird ersetzt.
const NPC_WORDS = /(^|[\s-])(auktionshaus|auction house|doktor|doctor|arzt)($|[\s-])/i;
export function looksLikeNpc(name) {
  if (typeof name !== "string") return false;
  const s = name.trim();
  if (!s) return false;
  if (/^\S+-\S+$/.test(s)) return false; // Name-Realm: Spieler
  if (NPC_WORDS.test(s)) return true;
  if (/\s/.test(s)) return !/^\S+\s.*-\S+$/.test(s); // Leerzeichen: Figur der Welt, außer mit Realm hinten
  return false;
}

// Name aus einem Feld: gesäubert, ohne Leerraum; "?" und Leeres sind kein Name
function cleanName(raw) {
  if (typeof raw !== "string") return null;
  const s = safeText(raw, 80).trim();
  return s && s !== "?" ? s : null;
}

// "Name-Realm" -> ["Name-Realm", "Name"]; der Grundname allein wird mit erfasst (Anzeigen ohne Realm)
function nameForms(name) {
  const out = [name];
  const dash = name.indexOf("-");
  if (dash > 0) out.push(name.slice(0, dash));
  return out;
}

function splitMembers(v) {
  return typeof v === "string" && v ? v.split(",") : [];
}

function splitPeople(v) {
  return typeof v === "string" && v ? v.split(";") : [];
}

// Log-Blöcke eines Charakters -> Zeilen mit Kopf, ohne die Reihenfolge zu ändern
function eachLine(char, fn) {
  for (const block of luaArray(isTable(char) ? char.log : null)) {
    if (typeof block !== "string") continue;
    const lines = block.split("\n");
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split("~");
      if (parts.length >= 2) fn(parts[1], parts.slice(2), Number(parts[0]), lines[0]);
    }
  }
}

// alle fremden Namen in Log-Reihenfolge (nach Zeit sortiert wie parseLog) -> Liste ohne Doppel
export function collectForeignNames(char) {
  const own = isTable(char) && isTable(char.info) ? cleanName(char.info.name) : null;
  const found = [];
  let ln = 0;
  for (const block of luaArray(isTable(char) ? char.log : null)) {
    if (typeof block !== "string") continue;
    const lines = block.split("\n");
    const head = /^#~(-?\d+)~/.exec(lines[0] || "");
    const epoch = head ? Number(head[1]) : 0;
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split("~");
      if (parts.length < 2) continue;
      const specs = specsFor(parts[1]);
      if (!specs) continue;
      const f = parts.slice(2);
      const t = epoch + (Number(parts[0]) || 0);
      for (const sp of specs) {
        if (sp.when && !sp.when(f)) continue;
        const v = f[sp.i];
        const names = sp.kind === "name" ? [v] : sp.kind === "members" ? splitMembers(v).map((m) => m.split(":")[0]) : splitPeople(v).map((p) => p.split(",")[1]);
        for (const n of names) {
          const c = cleanName(n);
          if (c && !looksLikeNpc(c)) found.push({ t, ln: ln++, name: c });
        }
      }
    }
  }
  found.sort((a, b) => a.t - b.t || a.ln - b.ln);
  const seen = new Set();
  const out = [];
  for (const { name } of found) {
    const base = nameForms(name)[nameForms(name).length - 1];
    if (own && (name === own || base === own)) continue;
    if (seen.has(base)) continue;
    seen.add(base);
    out.push(name);
  }
  return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Anonymisierer für einen Charakter: names (Liste der fremden Namen), alias(name), scrub(text)
export function createAnonymizer(char, lang = "de") {
  const names = collectForeignNames(char);
  const own = isTable(char) && isTable(char.info) ? cleanName(char.info.name) : null;
  const byForm = new Map(); // Namensform -> Pseudonym
  names.forEach((n, i) => {
    for (const form of nameForms(n)) if (!byForm.has(form) && form !== own) byForm.set(form, pseudonym(lang, i + 1));
  });
  // längste Formen zuerst, ganze Wörter (Buchstaben/Ziffern davor/danach verhindern den Treffer)
  const forms = [...byForm.keys()].filter((f) => f.length >= 2).sort((a, b) => b.length - a.length);
  const re = forms.length ? new RegExp("(?<![\\p{L}\\p{N}])(" + forms.map(escapeRe).join("|") + ")(?![\\p{L}\\p{N}])", "giu") : null;
  const lower = new Map([...byForm].map(([k, v]) => [k.toLowerCase(), v]));
  let extra = byForm.size;
  const alias = (raw) => {
    const c = cleanName(raw);
    if (!c || looksLikeNpc(c)) return raw;
    const hit = byForm.get(c) || byForm.get(nameForms(c).pop());
    if (hit) return hit;
    // unbekannter Name in einem Namensfeld: trotzdem ersetzen (lieber ein Gefährte zu viel als ein Name zu viel)
    extra++;
    const p = pseudonym(lang, extra);
    byForm.set(c, p);
    return p;
  };
  const scrub = (text) => {
    if (typeof text !== "string" || !re) return text;
    return text.replace(re, (m) => lower.get(m.toLowerCase()) || m);
  };
  return { names, alias, scrub, lang };
}

// Log-Zeile umschreiben (Felder nach dem Kürzel)
function rewriteFields(code, f, anon) {
  const specs = specsFor(code);
  if (!specs) return f;
  const out = f.slice();
  for (const sp of specs) {
    if (sp.when && !sp.when(f)) continue;
    const v = out[sp.i];
    if (empty(v)) continue;
    if (sp.kind === "name") out[sp.i] = anon.alias(v);
    else if (sp.kind === "members") out[sp.i] = splitMembers(v).map((m) => {
      const p = m.split(":");
      p[0] = anon.alias(p[0]);
      return p.join(":");
    }).join(",");
    else out[sp.i] = splitPeople(v).map((pp) => {
      const p = pp.split(",");
      if (p.length > 1) p[1] = anon.alias(p[1]);
      p[0] = ""; // guid des anderen Spielers fällt weg
      return p.join(",");
    }).join(";");
  }
  return out;
}

// Kopie des Charakters mit ersetzten Namen im Log; heikle Zähler fallen weg. Das Original bleibt unverändert.
export function anonymizeChar(char, anon) {
  if (!isTable(char)) return char;
  const log = Object.create(null);
  let k = 0;
  for (const block of luaArray(char.log)) {
    if (typeof block !== "string") continue;
    const lines = block.split("\n");
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split("~");
      if (parts.length < 3 || !specsFor(parts[1])) continue;
      lines[i] = [parts[0], parts[1], ...rewriteFields(parts[1], parts.slice(2), anon)].join("~");
    }
    log[String(++k)] = lines.join("\n");
  }
  const copy = Object.assign(Object.create(null), char);
  copy.log = log;
  if (isTable(char.counters)) {
    const c = Object.assign(Object.create(null), char.counters);
    for (const key of SENSITIVE_COUNTERS) {
      const src = Object.prototype.hasOwnProperty.call(c, key) ? c[key] : null;
      if (isTable(src)) {
        // gleiche Werte, aber ohne Namen als Schlüssel (Reihenfolge der Einträge bleibt)
        const neutral = Object.create(null);
        let n = 0;
        for (const k of Object.keys(src)) neutral["#" + ++n] = src[k];
        c[key] = neutral;
      } else delete c[key];
    }
    copy.counters = c;
  }
  return copy;
}

// Pseudonyme in Lesereihenfolge neu nummerieren: Der erste Name, den man in der Ansicht liest, ist „Gefährte 1“, der nächste
// „Gefährte 2“ … (die Nummern aus dem ganzen Log wären sonst bei 7, 12, 31 …). Gleicher Name behält seine Nummer.
// -> (text) => text; die Funktion merkt sich die Zuordnung, ruft man sie in Lesereihenfolge auf.
export function createRenumberer(lang = "de") {
  const word = (PSEUDO[lang] || PSEUDO.en).replace(" {0}", "");
  const re = new RegExp("(?<![\\p{L}\\p{N}])" + escapeRe(word) + " (\\d{1,6})(?![\\p{L}\\p{N}])", "gu");
  const map = new Map();
  return (text) => {
    if (typeof text !== "string" || !text.includes(word)) return text;
    return text.replace(re, (m, n) => {
      if (!map.has(n)) map.set(n, map.size + 1);
      return pseudonym(lang, map.get(n));
    });
  };
}

const scrubField = (anon, v) => (typeof v === "string" ? anon.scrub(v) : v);

// Reise-Daten (prepareJourney) nachsäubern: Marker, Kapitel, Kartennamen aus der Datei. Gibt eine Kopie zurück.
export function scrubJourney(data, anon) {
  const markers = data.markers.map((m) => ({ ...m, name: scrubField(anon, m.name), place: scrubField(anon, m.place), extra: scrubField(anon, m.extra) }));
  const chapters = data.chapters.map((c) => ({ ...c, name: scrubField(anon, c.name) }));
  const names = new Map([...data.names].map(([id, n]) => [id, scrubField(anon, n)]));
  return { ...data, markers, chapters, names };
}

// Ortsnamen des Pergament-Rückfalls (buildLabels) vor prepareMapScene nachsäubern
export function scrubLabels(labels, anon) {
  return (Array.isArray(labels) ? labels : []).map((l) => ({ ...l, text: scrubField(anon, l.text) }));
}

// ---------------------------------------------------------------- zentrale Stelle für jede Ansicht/jeden Export
// Schlüssel, deren Wert in jedem Modell ein Spielername ist (auch Modelle späterer Etappen: Chronik-Gruppen, Beute-
// Würfe, Druck). Ihr Wert wird immer ersetzt, auch wenn der Name nicht im Log stand.
export const PLAYER_KEYS = Object.freeze(["who", "opponent", "partner", "sender", "recipient", "player", "member", "mate"]);
// Listen von Personen-Objekten: das Feld "name" jedes Eintrags ist ein Spielername
export const PEOPLE_LISTS = Object.freeze(["group", "members", "people", "mates", "party", "raid"]);

const plain = (v) => v !== null && typeof v === "object" && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

// tiefe Kopie eines Modells mit ersetzten Namen: Werte unter PLAYER_KEYS und "name" in PEOPLE_LISTS werden ersetzt
// (alias), jeder andere Text wird nach bekannten Namen durchsucht (scrub). Zyklen und geteilte Objekte bleiben geteilt.
export function anonymizeModel(model, anon) {
  const memo = new Map();
  const walk = (v, key, inPeople) => {
    if (typeof v === "string") {
      if (PLAYER_KEYS.includes(key) || (inPeople && key === "name")) return anon.alias(v);
      return anon.scrub(v);
    }
    if (v === null || typeof v !== "object") return v;
    if (memo.has(v)) return memo.get(v);
    if (Array.isArray(v)) {
      const out = [];
      memo.set(v, out);
      const people = PEOPLE_LISTS.includes(key);
      for (const x of v) out.push(walk(x, people ? "" : key, people));
      return out;
    }
    if (v instanceof Map) {
      const out = new Map();
      memo.set(v, out);
      for (const [k, x] of v) out.set(typeof k === "string" ? walk(k, key, inPeople) : k, walk(x, key, inPeople));
      return out;
    }
    if (v instanceof Set) {
      const out = new Set();
      memo.set(v, out);
      for (const x of v) out.add(walk(x, key, inPeople));
      return out;
    }
    if (!plain(v)) return v;
    const out = Object.create(Object.getPrototypeOf(v));
    memo.set(v, out);
    const people = PEOPLE_LISTS.includes(key);
    for (const k of Object.keys(v)) out[k] = walk(v[k], k, inPeople || people);
    return out;
  };
  return walk(model, "", false);
}

// Einstieg für Teilen und (nach W5/W7) Chronik und Druck: Charakter aus der Datei -> anonymisierter Charakter und neu
// gebautes, tief nachgesäubertes Journal. buildJournal wird hereingereicht (core/journal-model), damit dieses Modul ohne
// den Kern testbar bleibt. -> { char, journal, anon }
export function anonymizeForExport({ char, lang = "de", buildJournal }) {
  const anon = createAnonymizer(char, lang);
  const anonChar = anonymizeChar(char, anon);
  const db = Object.create(null);
  db.chars = Object.create(null);
  db.chars.anon = anonChar;
  const journal = anonymizeModel(buildJournal(db, "anon"), anon);
  return { char: anonChar, journal, anon };
}
