// Kartennamen je uiMap auf Deutsch und Englisch: [deDE, enUS].
// Forever (uiMapID ab 1411): die echten Namen des Forever-Clients (wowf 1.60.1.70862, UiMap.Name_lang deDE/enUS von wago.tools,
//   src/geo/zone-names.forever.json, gebaut von scripts/build-map-index.mjs). Der Client hat Kartenmaterial wie 2004/2005:
//   Städte sind Eigennamen und heißen auch auf Deutsch englisch (Ironforge, Stormwind, Thunder Bluff, Undercity, Orgrimmar,
//   Darnassus), ebenso Ashenvale, Moonglade, Winterspring; andere Zonen deutsch (Wald von Elwynn, Dämmerwald, Westfall ...).
// Retail-Karten (uiMapID unter 1400, nur Rückfall für Dateien aus anderen Clients): Namen des Retail-Clients aus dem Addon
//   (EveN_ForeverChronicle/addon/InkAndEmbers/journal/MapSpace.lua, Tabelle NAMES, Stand e63c4e4), dort heißt es Eisenschmiede usw.
// Die Reise zeigt Kapitel- und Kartennamen damit in der Sprache der Seite statt der englischen Indexnamen (src/geo/index.json).
import FOREVER from "./zone-names.forever.json";

const RETAIL_NAMES = {
  1: ["Durotar","Durotar"],
  7: ["Mulgore","Mulgore"],
  10: ["Nördliches Brachland","Northern Barrens"],
  12: ["Kalimdor","Kalimdor"],
  13: ["Die Östlichen Königreiche","Eastern Kingdoms"],
  14: ["Arathihochland","Arathi Highlands"],
  15: ["Ödland","Badlands"],
  17: ["Verwüstete Lande","Blasted Lands"],
  18: ["Tirisfal","Tirisfal Glades"],
  21: ["Silberwald","Silverpine Forest"],
  22: ["Westliche Pestländer","Western Plaguelands"],
  23: ["Östliche Pestländer","Eastern Plaguelands"],
  25: ["Vorgebirge des Hügellands","Hillsbrad Foothills"],
  26: ["Hinterland","The Hinterlands"],
  27: ["Dun Morogh","Dun Morogh"],
  32: ["Sengende Schlucht","Searing Gorge"],
  36: ["Brennende Steppe","Burning Steppes"],
  37: ["Wald von Elwynn","Elwynn Forest"],
  42: ["Gebirgspass der Totenwinde","Deadwind Pass"],
  47: ["Dämmerwald","Duskwood"],
  48: ["Loch Modan","Loch Modan"],
  49: ["Rotkammgebirge","Redridge Mountains"],
  51: ["Sümpfe des Elends","Swamp of Sorrows"],
  52: ["Westfall","Westfall"],
  56: ["Sumpfland","Wetlands"],
  57: ["Teldrassil","Teldrassil"],
  62: ["Dunkelküste","Darkshore"],
  63: ["Eschental","Ashenvale"],
  64: ["Tausend Nadeln","Thousand Needles"],
  65: ["Steinkrallengebirge","Stonetalon Mountains"],
  66: ["Desolace","Desolace"],
  69: ["Feralas","Feralas"],
  70: ["Düstermarschen","Dustwallow Marsh"],
  71: ["Tanaris","Tanaris"],
  76: ["Azshara","Azshara"],
  77: ["Teufelswald","Felwood"],
  78: ["Krater von Un'Goro","Un'Goro Crater"],
  80: ["Mondlichtung","Moonglade"],
  81: ["Silithus","Silithus"],
  83: ["Winterquell","Winterspring"],
  84: ["Sturmwind","Stormwind City"],
  85: ["Orgrimmar","Orgrimmar"],
  87: ["Eisenschmiede","Ironforge"],
  88: ["Donnerfels","Thunder Bluff"],
  89: ["Darnassus","Darnassus"],
  90: ["Unterstadt","Undercity"],
  198: ["Der Hyjal","Mount Hyjal"],
  199: ["Südliches Brachland","Southern Barrens"],
  224: ["Schlingendorntal","Stranglethorn Vale"],
  947: ["Azeroth","Azeroth"],
};

// Forever überschreibt gleiche IDs; die Namen in der JSON-Datei sind schon gesäubert (cleanName im Build-Skript)
export const ZONE_NAMES = Object.freeze({ ...RETAIL_NAMES, ...FOREVER.names });

const isId = (v) => Number.isInteger(v) && v > 0 && v <= 1e6;

// Name der Karte in der Sprache lang ("de" | "en") oder null, wenn die Karte nicht in der Tabelle steht
export function zoneName(mapID, lang) {
  if (!isId(mapID) || !Object.prototype.hasOwnProperty.call(ZONE_NAMES, String(mapID))) return null;
  const pair = ZONE_NAMES[String(mapID)];
  return lang === "en" ? pair[1] : pair[0];
}
