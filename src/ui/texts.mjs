// Oberflächentexte der Webseite (Deutsch/Englisch). Was schon in src/core/i18n.mjs steht (Datei-Fehler, Charakterwahl,
// Sprachschalter ...), wird von dort genommen; hier stehen nur die Texte, die nur die Seite braucht.
// Platzhalter: {0}, {1}, ... Texte aus der Datei (Namen, Notizen) werden nie übersetzt.
import { tr as coreTr, normLang } from "../core/i18n.mjs";

export const WEB_TEXTS = {
  de: {
    siteTitle: "Ink & Embers · Tagebuch im Browser",
    siteLead: "Euer Reisetagebuch aus World of Warcraft: Karte, Route, Chronik und Statistik – zum Lesen, Drucken und Teilen.",
    tabJourney: "Reise",
    tabChronicle: "Chronik & Statistik",
    tabsLabel: "Ansichten",
    journeyTitle: "Die Reise",
    journeySoon: "Hier erscheint bald die Karte mit der gelaufenen Route, den Markern und der Wiedergabe.",
    chronicleTitle: "Chronik & Statistik",
    chronicleSoon: "Hier erscheinen bald Steckbrief, Medaillen, Stufenfluss, Erfahrungsquellen, Dungeons und Tode.",
    charSummaryLevel: "Stufe {0}",
    charSummaryLines: "{0} Einträge im Tagebuch",
    fileCount: "Es wurden {0} Dateien abgelegt; gelesen wurde nur „{1}“.",
    footer: "Fanprojekt, nicht mit Blizzard Entertainment verbunden. World of Warcraft und Kartenkunst © Blizzard Entertainment.",
    footerPrivacy: "Nichts wird hochgeladen, die Seite sendet keine Daten und benutzt keine Werbung oder Statistik.",
    errNoFile: "Es wurde keine Datei erkannt. Bitte die Datei InkAndEmbers.lua ziehen, nicht Text oder einen Link.",
    errFolder: "Das ist ein Ordner. Bitte die Datei InkAndEmbers.lua selbst hineinziehen (sie liegt im Ordner SavedVariables).",
    errNotLuaFile: "Das ist keine .lua-Datei („{0}“). Gesucht wird InkAndEmbers.lua aus dem Ordner SavedVariables (nicht .bak oder .zip).",
    errBadType: "Der Dateityp „{0}“ wird nicht gelesen. InkAndEmbers.lua ist eine reine Textdatei.",
    errBinary: "Die Datei enthält keinen lesbaren Text. Ist es wirklich InkAndEmbers.lua und nicht beschädigt?",
    errTooBigWeb: "Die Datei ist zu groß (über {0} MB). Ist es wirklich InkAndEmbers.lua?",
  },
  en: {
    siteTitle: "Ink & Embers · Journal in the browser",
    siteLead: "Your World of Warcraft travel journal: map, route, chronicle and statistics – to read, print and share.",
    tabJourney: "Journey",
    tabChronicle: "Chronicle & statistics",
    tabsLabel: "Views",
    journeyTitle: "The journey",
    journeySoon: "The map with your route, markers and playback will appear here soon.",
    chronicleTitle: "Chronicle & statistics",
    chronicleSoon: "Character sheet, medals, level flow, experience sources, dungeons and deaths will appear here soon.",
    charSummaryLevel: "Level {0}",
    charSummaryLines: "{0} entries in the journal",
    fileCount: "{0} files were dropped; only \"{1}\" was read.",
    footer: "Fan project, not affiliated with Blizzard Entertainment. World of Warcraft and map artwork © Blizzard Entertainment.",
    footerPrivacy: "Nothing is uploaded. The page sends no data and uses no advertising or analytics.",
    errNoFile: "No file was recognised. Please drop the file InkAndEmbers.lua, not text or a link.",
    errFolder: "That is a folder. Please drop the file InkAndEmbers.lua itself (it lives in the SavedVariables folder).",
    errNotLuaFile: "That is not a .lua file (\"{0}\"). The page needs InkAndEmbers.lua from the SavedVariables folder (not .bak or .zip).",
    errBadType: "The file type \"{0}\" is not read. InkAndEmbers.lua is a plain text file.",
    errBinary: "The file does not contain readable text. Is it really InkAndEmbers.lua and not damaged?",
    errTooBigWeb: "The file is too large (over {0} MB). Is it really InkAndEmbers.lua?",
  },
};

// Text nach Schlüssel: erst Webseiten-Texte der Sprache, dann Deutsch, dann der Kern (core/i18n); unbekannt -> der Schlüssel.
export function t(lang, key, ...args) {
  const l = normLang(lang);
  let v = WEB_TEXTS[l][key];
  if (v === undefined) v = WEB_TEXTS.de[key];
  if (typeof v !== "string") return coreTr(l, key, ...args);
  return v.replace(/\{(\d+)\}/g, (m, i) => (args[Number(i)] === undefined || args[Number(i)] === null ? "" : String(args[Number(i)])));
}
