// Vorauswahl per Link aus dem Addon: https://…/InkAndEmbers-web/#g=<Charakter-GUID>&v=journey
// (Rückfall für ältere Links: #c=<Name>-<Realm>; Name+Realm ist in WoW Forever nicht eindeutig, die GUID schon.)
// Das Fragment (alles nach #) verlässt den Browser nie. Hier wird es streng geprüft, nie als HTML verwendet.

const MAX_LEN = 80;
const NAME_OK = /^[\p{L}\p{M}'’ ]+$/u; // Name: Buchstaben (auch Umlaute/Akzente), Apostroph, Leerzeichen
const REALM_OK = /^[\p{L}\p{M}'’ 0-9-]+$/u; // Realm zusätzlich Ziffern und Bindestrich (z. B. „Realm 10 RP“, „Azjol-Nerub“)
const GUID_OK = /^Player-\d{1,6}-[0-9A-F]{8,16}$/i; // GUID = Schlüssel von chars[guid] im SavedVariables-Speicher
const VIEWS = ["journey", "chronicle"];

// "#g=Player-1-0000AAAA&v=journey" -> { g: "Player-1-0000AAAA", c: null, v: "journey" }; "#c=Mirela-Gehennas" -> { g: null, c, v }
// oder null (ungültig/leer). Ist g vorhanden, aber ungültig, wird der ganze Link abgewiesen (kein stilles Umschwenken auf c).
export function parseLinkFragment(hash) {
  if (typeof hash !== "string" || hash.length < 4 || hash.length > 600) return null;
  let params;
  try {
    params = new URLSearchParams(hash.charAt(0) === "#" ? hash.slice(1) : hash);
  } catch {
    return null;
  }
  const vRaw = params.get("v");
  const v = vRaw === null ? "journey" : vRaw;
  if (!VIEWS.includes(v)) return null;
  const gRaw = params.get("g");
  let g = null;
  if (gRaw !== null) {
    if (!GUID_OK.test(gRaw)) return null;
    g = gRaw;
  }
  const cRaw = params.get("c");
  let c = null;
  if (cRaw !== null) {
    const name = cRaw.normalize("NFC").trim();
    if (name.length === 0 || name.length > MAX_LEN) return null;
    const cut = name.indexOf("-"); // der Name hat keinen Bindestrich, der Realm darf einen haben
    const who = cut < 0 ? name : name.slice(0, cut);
    if (!NAME_OK.test(who) || (cut >= 0 && !REALM_OK.test(name.slice(cut + 1)))) return null;
    c = name;
  }
  if (g === null && c === null) return null;
  return { g, c, v };
}

function squash(s, dropPunct) {
  let out = String(s || "").normalize("NFC").toLocaleLowerCase().replace(/\s+/g, "");
  if (dropPunct) out = out.replace(/['’-]/g, "");
  return out;
}

// Alle Charaktere zu "Name-Realm" (Groß/Klein egal, Leerzeichen im Realm egal); der Name hat keinen Bindestrich,
// der Realm darf einen haben (Azjol-Nerub). Gibt eine Liste von guids zurück (leer = kein Treffer).
export function matchLinkCharacters(characters, c) {
  if (!Array.isArray(characters) || typeof c !== "string") return [];
  const cut = c.indexOf("-");
  const name = squash(cut < 0 ? c : c.slice(0, cut), false);
  const realm = squash(cut < 0 ? "" : c.slice(cut + 1), true);
  const out = [];
  for (const ch of characters) {
    if (squash(ch.name, false) !== name) continue;
    if (realm === "" || squash(ch.realm, true) === realm) out.push(ch.guid);
  }
  return out;
}

// Vorauswahl auflösen: { status: "found", guid } | { status: "ambiguous" } | { status: "none" }.
// Zuerst die GUID (exakt, Groß/Klein tolerant); nur ohne GUID-Treffer der Rückfall c – und der nie durch Raten.
export function resolveLinkCharacter(characters, preset) {
  if (!Array.isArray(characters) || !preset) return { status: "none" };
  if (typeof preset.g === "string") {
    const want = preset.g.toUpperCase();
    const hit = characters.find((ch) => typeof ch.guid === "string" && ch.guid.toUpperCase() === want);
    if (hit) return { status: "found", guid: hit.guid };
  }
  if (typeof preset.c === "string") {
    const list = matchLinkCharacters(characters, preset.c);
    if (list.length === 1) return { status: "found", guid: list[0] };
    if (list.length > 1) return { status: "ambiguous" };
  }
  return { status: "none" };
}
