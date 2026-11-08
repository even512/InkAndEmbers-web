// Identität eines Charakters in der Oberfläche: Volks-Porträt (Addon-Kunst aus public/img/) und Klasse als Text in Klassenfarbe.
// Sicherheit: Werte aus der Datei wählen nur aus festen Listen; kein Dateiwert gelangt in einen Pfad oder ein Klassenattribut.
import { el } from "../core/render.mjs";

// Porträts des Addons (Media/Narrator_<id>.tga), Zuordnung wie Begleiter.narratorForRace im Addon
export const PORTRAITS = Object.freeze(["human", "dwarf", "nightelf", "gnome", "orc", "undead", "tauren", "troll", "skyborne"]);
const RACE_TOKEN = { Human: "human", Dwarf: "dwarf", NightElf: "nightelf", Gnome: "gnome", Orc: "orc", Scourge: "undead", Undead: "undead", Tauren: "tauren", Troll: "troll" };
// lokalisierte Volksnamen (deDE/enUS, auch weibliche Formen), falls die Datei kein raceFile hat
const RACE_NAME = [
  [/^mensch|^human/i, "human"], [/^zwerg|^dwarf/i, "dwarf"], [/^nachtelf|^night ?elf/i, "nightelf"], [/^gnom|^gnome/i, "gnome"],
  [/^orc|^ork/i, "orc"], [/^untot|^undead|^verlassen|^forsaken/i, "undead"], [/^tauren/i, "tauren"], [/^troll/i, "troll"],
];

// Porträt-ID aus raceFile (Token), Volksname und Fraktion; unbekannt: Horde -> orc, sonst human (wie im Addon)
export function portraitId({ raceFile, race, faction } = {}) {
  if (typeof raceFile === "string") {
    if (Object.prototype.hasOwnProperty.call(RACE_TOKEN, raceFile)) return RACE_TOKEN[raceFile];
    if (raceFile.toLowerCase().includes("sky")) return "skyborne";
  }
  if (typeof race === "string") {
    if (race.toLowerCase().includes("sky")) return "skyborne";
    for (const [re, id] of RACE_NAME) if (re.test(race.trim())) return id;
  }
  return faction === "Horde" ? "orc" : "human";
}

export const portraitSrc = (id) => "img/portrait-" + (PORTRAITS.includes(id) ? id : "human") + ".webp";

// Bild aus public/img/ (nur feste Namen); dekorativ, wenn kein alt angegeben ist
export function icon(doc, name, cls, size, alt = "") {
  const img = doc.createElement("img");
  if (cls) img.className = cls;
  img.setAttribute("src", "img/" + name + ".webp");
  img.setAttribute("alt", alt);
  if (size) {
    img.setAttribute("width", String(size[0]));
    img.setAttribute("height", String(size[1] ?? size[0]));
  }
  img.setAttribute("decoding", "async");
  return img;
}

export function portraitImg(doc, info, cls = "portrait", size = 80) {
  const img = doc.createElement("img");
  img.className = cls;
  img.setAttribute("src", portraitSrc(portraitId(info)));
  img.setAttribute("alt", "");
  img.setAttribute("width", String(size));
  img.setAttribute("height", String(size));
  img.setAttribute("decoding", "async");
  return img;
}

export const CLASS_FILES = Object.freeze(["WARRIOR", "PALADIN", "HUNTER", "ROGUE", "PRIEST", "SHAMAN", "MAGE", "WARLOCK", "DRUID", "DEATHKNIGHT", "MONK", "DEMONHUNTER", "EVOKER"]);

// CSS-Klasse für die Klassenfarbe oder "" (nur bekannte Tokens)
export function classColorClass(classFile) {
  const k = typeof classFile === "string" ? classFile.toUpperCase() : "";
  return CLASS_FILES.includes(k) ? "cls cls-" + k : "";
}

// Klassenname als Span in Klassenfarbe (Text bereits gesäubert übergeben)
export function classSpan(doc, classFile, text) {
  return el(doc, "span", classColorClass(classFile) || "cls", text);
}
