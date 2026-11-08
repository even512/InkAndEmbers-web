// Anzeige von Namen und Regelwerk (WoW Forever): "Vorname Nachname" statt nur Vorname, das Regelwerk statt des Realm-Shards.
// Der Shard ("CAMWOW EU4 Realm 10 RP") ist ein versteckter technischer Name und wird in Forever NIE angezeigt. In Retail
// bleibt alles wie bisher (Realm sichtbar, Mitspieler unverändert). Reine Logik ohne DOM; der Kern (src/core) bleibt unberührt:
// Die Zusatzfelder (surname, ruleset, forever) hängen hier am Ergebnis von buildJournal/listCharacters, die Anzeige-Schicht
// tauscht name/realm erst beim Zeichnen aus (shownJournal, shownIdentity).
import { isTable, luaArray } from "../core/lua-parse.mjs";
import { buildJournal, parseLog, fnum } from "../core/journal-model.mjs";
import { safeText } from "./safe-text.mjs";

export const FOREVER_PROJECT = 18;
export const RULESETS = Object.freeze(["hardcore", "rp", "pvp", "pve"]);
const SURNAME_MAX = 40;

const RULESET_TEXT = {
  de: { hardcore: "Hardcore", rp: "Rollenspiel (PvE)", pvp: "PvP", pve: "PvE" },
  en: { hardcore: "Hardcore", rp: "Roleplaying (PvE)", pvp: "PvP", pve: "PvE" },
};

// Regelwerk-Schlüssel -> Anzeigetext (nur bekannte Schlüssel; sonst null)
export function rulesetText(lang, key) {
  const tbl = RULESET_TEXT[lang === "en" ? "en" : "de"];
  return typeof key === "string" && Object.hasOwn(tbl, key) ? tbl[key] : null;
}

// Zweiter Namensteil ist ein Shard/Realm-Rest und kein Nachname: leer oder mit Ziffern/Leerzeichen
export function isShardPart(s) {
  return typeof s !== "string" || s === "" || /[\d\s]/.test(s);
}

// "Vorname-Nachname" -> "Vorname Nachname"; mit Shard hinten ("Vorname-Realm 10 RP") nur der Vorname. Nur in Forever.
export function playerName(raw, forever) {
  if (!forever || typeof raw !== "string") return raw;
  const i = raw.indexOf("-");
  if (i <= 0) return raw;
  const rest = raw.slice(i + 1);
  return isShardPart(rest) ? raw.slice(0, i) : raw.slice(0, i) + " " + rest;
}

// Nachname aus info.surname: nur ein nichtleerer String, gesäubert und begrenzt
function cleanSurname(v) {
  if (typeof v !== "string") return null;
  const s = safeText(v, SURNAME_MAX).trim();
  return s !== "" && s !== "?" ? s : null;
}

// neueste Flavor-Angabe aus dem Log ("L"-Zeile, Interface-Nummer): "forever" | "retail" | null (wie buildJournal)
function logFlavor(char) {
  const blocks = luaArray(isTable(char) ? char.log : null);
  for (let i = blocks.length - 1; i >= 0 && i >= blocks.length - 12; i--) {
    if (typeof blocks[i] !== "string") continue;
    const evs = parseLog({ log: { 1: blocks[i] } });
    for (let k = evs.length - 1; k >= 0; k--) {
      if (evs[k].code !== "L") continue;
      const iface = fnum(evs[k], "interface");
      if (iface !== null) return iface >= 100000 ? "retail" : "forever";
    }
  }
  return null;
}

// Zusatzfelder eines Charakters aus der Datei: { surname, ruleset, forever }
export function extrasOf(char) {
  const info = isTable(char) && isTable(char.info) ? char.info : {};
  const ruleset = typeof info.ruleset === "string" && RULESETS.includes(info.ruleset) ? info.ruleset : null;
  // info.project (ab 1.0.9): 18 = WoW Forever. Ältere Dateien haben es nicht: dann entscheidet die Interface-Nummer im Log.
  const proj = info.project === undefined || info.project === null || info.project === "" ? NaN : Number(info.project);
  const forever = Number.isFinite(proj) ? proj === FOREVER_PROJECT : logFlavor(char) === "forever";
  return { surname: cleanSurname(info.surname), ruleset, forever };
}

// buildJournal + Zusatzfelder (das Ergebnis bleibt ein flaches Objekt; Identität bleibt für Zwischenspeicher stabil)
export function buildJournalX(db, guid) {
  const j = buildJournal(db, guid);
  const ex = extrasOf(db && db.chars ? db.chars[guid] : null);
  j.surname = ex.surname;
  j.ruleset = ex.ruleset;
  j.forever = ex.forever || j.flavor === "forever";
  return j;
}

// Zeilen von listCharacters (openFile) um die Zusatzfelder ergänzen; name/realm bleiben roh (der Link-Abgleich braucht sie)
export function withExtras(db, characters) {
  return characters.map((c) => Object.assign({}, c, extrasOf(db && db.chars ? db.chars[c.guid] : null)));
}

// Anzeige-Identität eines Charakters/Journals -> { name, place } (place: Realm in Retail, Regelwerk in Forever, sonst null)
export function shownIdentity(c, lang) {
  if (!c || !c.forever) return { name: c ? c.name : "?", place: c && c.realm ? c.realm : null };
  const name = c.surname && typeof c.name === "string" && c.name !== "?" ? c.name + " " + c.surname : c.name;
  return { name, place: rulesetText(lang, c.ruleset) };
}

// flache Kopie mit angezeigtem Namen/Regelwerk, wenn Forever; sonst dasselbe Objekt (core/render liest name und realm)
export function shownJournal(j, lang) {
  if (!j || !j.forever) return j;
  const s = shownIdentity(j, lang);
  return Object.assign({}, j, { name: s.name, realm: s.place });
}
