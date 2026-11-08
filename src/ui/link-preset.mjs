// Vorauswahl per Link aus dem Addon: https://…/InkAndEmbers-web/#c=<Name>-<Realm>&v=journey
// Das Fragment (alles nach #) verlässt den Browser nie. Hier wird es streng geprüft, nie als HTML verwendet.

const MAX_LEN = 80;
const NAME_OK = /^[\p{L}\p{M}'’ ]+$/u; // Name: Buchstaben (auch Umlaute/Akzente), Apostroph, Leerzeichen
const REALM_OK = /^[\p{L}\p{M}'’ 0-9-]+$/u; // Realm zusätzlich Ziffern und Bindestrich (z. B. „Realm 10 RP“, „Azjol-Nerub“)
const VIEWS = ["journey", "chronicle"];

// "#c=Mirela-Gehennas&v=journey" -> { c: "Mirela-Gehennas", v: "journey" } oder null (ungültig/leer)
export function parseLinkFragment(hash) {
  if (typeof hash !== "string" || hash.length < 4 || hash.length > 600) return null;
  let params;
  try {
    params = new URLSearchParams(hash.charAt(0) === "#" ? hash.slice(1) : hash);
  } catch {
    return null;
  }
  const c = params.get("c");
  if (typeof c !== "string") return null;
  const name = c.normalize("NFC").trim();
  if (name.length === 0 || name.length > MAX_LEN) return null;
  const cut = name.indexOf("-"); // der Name hat keinen Bindestrich, der Realm darf einen haben
  const who = cut < 0 ? name : name.slice(0, cut);
  if (!NAME_OK.test(who) || (cut >= 0 && !REALM_OK.test(name.slice(cut + 1)))) return null;
  const vRaw = params.get("v");
  const v = vRaw === null ? "journey" : vRaw;
  if (!VIEWS.includes(v)) return null;
  return { c: name, v };
}

function squash(s, dropPunct) {
  let out = String(s || "").normalize("NFC").toLocaleLowerCase().replace(/\s+/g, "");
  if (dropPunct) out = out.replace(/['’-]/g, "");
  return out;
}

// Charakter per "Name-Realm" finden (Groß/Klein egal, Leerzeichen im Realm egal); der Name hat keinen Bindestrich,
// der Realm darf einen haben (Azjol-Nerub). Gibt die guid zurück oder null.
export function matchLinkCharacter(characters, c) {
  if (!Array.isArray(characters) || typeof c !== "string") return null;
  const cut = c.indexOf("-");
  const name = squash(cut < 0 ? c : c.slice(0, cut), false);
  const realm = squash(cut < 0 ? "" : c.slice(cut + 1), true);
  for (const ch of characters) {
    if (squash(ch.name, false) !== name) continue;
    if (realm === "" || squash(ch.realm, true) === realm) return ch.guid;
  }
  return null;
}
