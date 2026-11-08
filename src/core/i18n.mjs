// Herkunft: EveN_ForeverChronicle/tools/journal-export/src/i18n.mjs (kopiert mit scripts/sync-core.mjs).
// NICHT HIER BEARBEITEN: Pflege im Addon-Repo, danach `npm run sync-core`. Commit siehe SOURCE.txt.
// Interface texts German/English and number/date formats of the export page. Placeholders: {0}, {1}, ...
// Data from the file (names, notes) is never translated.

export const TEXTS = {
  de: {
    appTitle: "Ink & Embers · Tagebuch-Export",
    appLead: "Euer Reisetagebuch als Seite zum Lesen, Teilen und Drucken.",
    dropTitle: "SavedVariables-Datei hierher ziehen",
    dropOr: "oder",
    dropPick: "Datei auswählen",
    dropHint: "Die Datei heißt InkAndEmbers.lua und liegt im Spielordner unter WTF\\Account\\<Konto>\\SavedVariables\\ (bei Forever im Ordner _forever_, sonst _retail_). Am besten nach dem Ausloggen nehmen, dann ist alles gesichert.",
    privacy: "Alles bleibt auf Eurem Rechner: Die Datei wird nur hier im Browser gelesen, nichts wird hochgeladen.",
    reading: "Lese die Datei …",
    loadedFile: "Geladen: {0}",
    otherFile: "Andere Datei",
    chooseChar: "Wessen Tagebuch soll es sein?",
    charLevel: "Stufe {0}",
    charLines: "{0} Einträge",
    language: "Sprache",
    print: "Als PDF drucken",
    printHint: "Im Druckfenster „Als PDF speichern“ wählen. Für das Pergament „Hintergrundgrafiken“ einschalten.",
    errEmpty: "Die Datei ist leer.",
    errTooBig: "Die Datei ist zu groß (über 64 MB). Ist es wirklich InkAndEmbers.lua?",
    errNotLua: "Die Datei lässt sich nicht lesen (Zeile {0}). Ist es die richtige Datei aus dem Ordner SavedVariables, und nicht beschädigt?",
    errNoData: "In dieser Datei stehen keine Ink-&-Embers-Daten. Gesucht wird InkAndEmbers.lua (nicht InkAndEmbers.lua.bak oder eine andere Addon-Datei).",
    errNoChars: "Die Datei enthält noch keinen Charakter. Einmal mit Ink & Embers einloggen und wieder ausloggen, dann ist er da.",
    errUnknownChar: "Diesen Charakter gibt es in der Datei nicht.",
    errRead: "Die Datei konnte nicht gelesen werden.",
    errInternal: "Beim Gestalten des Tagebuchs ist etwas schiefgegangen: {0}",
    schemaWarn: "Die Datei stammt aus einer neueren Ink-&-Embers-Version (Format {0}). Einiges fehlt hier vielleicht.",
    journalOf: "Das Reisetagebuch von",
    journalKicker: "Reisetagebuch",
    levelN: "Stufe {0}",
    played: "Gespielte Zeit",
    period: "Unterwegs",
    periodValue: "{0} – {1}",
    flavorForever: "World of Warcraft: Forever",
    flavorRetail: "World of Warcraft",
    contents: "Inhalt",
    chapter: "Kapitel {0}",
    unknownZone: "Unbekannte Lande",
    highlights: "Höhepunkte",
    highlightsLead: "Die Augenblicke, an die man sich erinnert.",
    statistics: "Bilanz der Reise",
    notes: "Notizen",
    notesLead: "Von eigener Hand.",
    noEntries: "In diesem Tagebuch steht noch nichts. Nach dem nächsten Ausflug (und Ausloggen) füllt es sich.",
    arrived: "Auf Stufe {1} betrat {0} {2}.",
    arrivedNoLevel: "{0} betrat {1}.",
    leftAt: "Als der Weg weiterführte, war {0} Stufe {1}.",
    standsToday: "Hier steht {0} heute, auf Stufe {1}.",
    dates: "{0} – {1}",
    oneDay: "{0}",
    activeTime: "rund {0} unterwegs",
    factQuests: "{0} Aufträge erfüllt",
    factQuest1: "1 Auftrag erfüllt",
    factKills: "{0} Gegner besiegt",
    factKill1: "1 Gegner besiegt",
    factDeaths: "{0}-mal gefallen",
    factDeath1: "einmal gefallen",
    via: "Abstecher: {0}",
    placesFound: "Entdeckte Orte",
    morePlaces: "und {0} weitere",
    moreHighlights: "… und {0} weitere Momente",
    hlLevel: "Stufe {0} erreicht",
    hlDeath: "Gefallen",
    hlDeathBy: "Gefallen durch {0}",
    hlBoss: "Boss bezwungen: {0}",
    hlBossNo: "Einen Boss bezwungen",
    hlBossIn: "in {0}",
    hlFind: "Fund: {0}",
    hlFindNo: "Ein seltener Fund",
    hlHome: "Neues Zuhause: {0}",
    hlPlan: "Vorhaben erfüllt: {0}",
    guessed: "vermutet",
    cause: {
      fall: "Tödlicher Sturz",
      drown: "Ertrunken",
      fatigue: "Vor Erschöpfung zusammengebrochen",
      lava: "In der Lava umgekommen",
      fire: "Im Feuer umgekommen",
      slime: "Im Schleim umgekommen",
      environment: "Von der Umgebung bezwungen",
    },
    moment: {
      first_rare: ["Erster seltener Gegner: {0}", "Erster seltener Gegner"],
      first_elite: ["Erster Elitegegner: {0}", "Erster Elitegegner"],
      first_boss: ["Erster Boss: {0}", "Erster Boss"],
      first_dungeon: ["Erster Dungeon: {0}", "Erster Dungeon"],
      first_raid: ["Erster Schlachtzug: {0}", "Erster Schlachtzug"],
      continent: ["Neuer Kontinent: {0}", "Ein neuer Kontinent"],
      first_blue: ["Erster blauer Gegenstand: {0}", "Erster blauer Gegenstand"],
      first_epic: ["Erster epischer Gegenstand: {0}", "Erster epischer Gegenstand"],
      first_bag: ["Erste Tasche: {0}", "Erste Tasche"],
      first_fish: ["Erster Fang: {0}", "Erster Fang"],
      mount: ["Reittier gelernt: {0}", "Ein Reittier gelernt"],
      reputation: ["Ruf gewonnen: {0}", "Neue Rufstufe"],
      profession: ["Beruf: {0}", "Ein Beruf"],
      kill: ["Besiegt: {0}", "Ein gefährlicher Gegner besiegt"],
      close_win: ["Knapper Sieg", "Knapper Sieg"],
    },
    st: {
      level: "Stufe",
      played: "Gespielte Zeit",
      kills: "Gegner besiegt",
      fights: "Kämpfe",
      closeWins: "Knappe Siege",
      deaths: "Tode",
      quests: "Aufträge erfüllt",
      questsSub: "{0} angenommen · {1} abgebrochen",
      goldIn: "Gold eingenommen",
      goldOut: "Gold ausgegeben",
      goldBalance: "Im Beutel",
      zones: "Gebiete betreten",
      subzones: "Orte gesehen",
      discoveries: "Entdeckungen",
      flights: "Flüge",
      flightPoints: "Neue Flugpunkte",
      books: "Bücher gelesen",
      finds: "Funde",
      findsSub: "{0} grün · {1} blau · {2} episch · {3} legendär",
      topEnemy: "Meistbesiegt",
      topEnemyValue: "{0} × {1}",
      sessions: "Sitzungen",
      campfires: "Lagerfeuer-Runden",
      plans: "Vorhaben erfüllt",
      instances: "Instanzen besucht",
      hearth: "Ruhestein benutzt",
      xp: "Erfahrung gesammelt",
    },
    noteMeta: "{0} · {1} · Stufe {2}",
    pinned: "angeheftet",
    colophon: "Aufgeschrieben von Ink & Embers. Erstellt am {0}.",
    fontsNote: "Schriften: Spectral und Caveat (SIL Open Font License 1.1).",
    dur: { d: "{0} T.", h: "{0} Std.", m: "{0} Min." },
    coins: ["G", "S", "K"],
    raid: ["Stern", "Kreis", "Diamant", "Dreieck", "Mond", "Quadrat", "Kreuz", "Totenkopf"],
  },
  en: {
    appTitle: "Ink & Embers · Journal export",
    appLead: "Your travel journal as a page to read, share and print.",
    dropTitle: "Drop your SavedVariables file here",
    dropOr: "or",
    dropPick: "Choose file",
    dropHint: "The file is called InkAndEmbers.lua and lives in the game folder under WTF\\Account\\<account>\\SavedVariables\\ (in _forever_ for Forever, otherwise _retail_). Take it after logging out, then everything is saved.",
    privacy: "Everything stays on your computer: the file is only read here in the browser, nothing is uploaded.",
    reading: "Reading the file …",
    loadedFile: "Loaded: {0}",
    otherFile: "Other file",
    chooseChar: "Whose journal shall it be?",
    charLevel: "Level {0}",
    charLines: "{0} entries",
    language: "Language",
    print: "Print as PDF",
    printHint: "Choose “Save as PDF” in the print dialog. Turn on “Background graphics” for the parchment.",
    errEmpty: "The file is empty.",
    errTooBig: "The file is too large (over 64 MB). Is it really InkAndEmbers.lua?",
    errNotLua: "The file cannot be read (line {0}). Is it the right file from the SavedVariables folder, and not damaged?",
    errNoData: "This file holds no Ink & Embers data. Look for InkAndEmbers.lua (not InkAndEmbers.lua.bak or another addon's file).",
    errNoChars: "The file has no character yet. Log in once with Ink & Embers and log out again, then it is there.",
    errUnknownChar: "This character is not in the file.",
    errRead: "The file could not be read.",
    errInternal: "Something went wrong while laying out the journal: {0}",
    schemaWarn: "The file comes from a newer Ink & Embers version (format {0}). Some things may be missing here.",
    journalOf: "The Travel Journal of",
    journalKicker: "Travel journal",
    levelN: "Level {0}",
    played: "Time played",
    period: "On the road",
    periodValue: "{0} – {1}",
    flavorForever: "World of Warcraft: Forever",
    flavorRetail: "World of Warcraft",
    contents: "Contents",
    chapter: "Chapter {0}",
    unknownZone: "Unknown lands",
    highlights: "Highlights",
    highlightsLead: "The moments worth remembering.",
    statistics: "The journey in numbers",
    notes: "Notes",
    notesLead: "In your own hand.",
    noEntries: "Nothing is written in this journal yet. After the next outing (and logging out) it fills up.",
    arrived: "{0} arrived in {2} at level {1}.",
    arrivedNoLevel: "{0} arrived in {1}.",
    leftAt: "When the road led on, {0} had reached level {1}.",
    standsToday: "This is where {0} stands today, at level {1}.",
    dates: "{0} – {1}",
    oneDay: "{0}",
    activeTime: "about {0} on the road",
    factQuests: "{0} quests completed",
    factQuest1: "1 quest completed",
    factKills: "{0} foes defeated",
    factKill1: "1 foe defeated",
    factDeaths: "fell {0} times",
    factDeath1: "fell once",
    via: "Detours: {0}",
    placesFound: "Places discovered",
    morePlaces: "and {0} more",
    moreHighlights: "… and {0} more moments",
    hlLevel: "Reached level {0}",
    hlDeath: "Fell",
    hlDeathBy: "Fell to {0}",
    hlBoss: "Boss defeated: {0}",
    hlBossNo: "Defeated a boss",
    hlBossIn: "in {0}",
    hlFind: "Found: {0}",
    hlFindNo: "A rare find",
    hlHome: "New home: {0}",
    hlPlan: "Plan done: {0}",
    guessed: "guessed",
    cause: {
      fall: "A deadly fall",
      drown: "Drowned",
      fatigue: "Collapsed from fatigue",
      lava: "Perished in lava",
      fire: "Perished in fire",
      slime: "Perished in slime",
      environment: "Overcome by the surroundings",
    },
    moment: {
      first_rare: ["First rare foe: {0}", "First rare foe"],
      first_elite: ["First elite foe: {0}", "First elite foe"],
      first_boss: ["First boss: {0}", "First boss"],
      first_dungeon: ["First dungeon: {0}", "First dungeon"],
      first_raid: ["First raid: {0}", "First raid"],
      continent: ["New continent: {0}", "A new continent"],
      first_blue: ["First blue item: {0}", "First blue item"],
      first_epic: ["First epic item: {0}", "First epic item"],
      first_bag: ["First bag: {0}", "First bag"],
      first_fish: ["First catch: {0}", "First catch"],
      mount: ["Mount learned: {0}", "Learned a mount"],
      reputation: ["Reputation gained: {0}", "New reputation standing"],
      profession: ["Profession: {0}", "A profession"],
      kill: ["Defeated: {0}", "Defeated a dangerous foe"],
      close_win: ["Close win", "Close win"],
    },
    st: {
      level: "Level",
      played: "Time played",
      kills: "Foes defeated",
      fights: "Fights",
      closeWins: "Close wins",
      deaths: "Deaths",
      quests: "Quests completed",
      questsSub: "{0} accepted · {1} abandoned",
      goldIn: "Gold earned",
      goldOut: "Gold spent",
      goldBalance: "In the purse",
      zones: "Zones entered",
      subzones: "Places seen",
      discoveries: "Discoveries",
      flights: "Flights",
      flightPoints: "New flight points",
      books: "Books read",
      finds: "Finds",
      findsSub: "{0} green · {1} blue · {2} epic · {3} legendary",
      topEnemy: "Most defeated",
      topEnemyValue: "{0} × {1}",
      sessions: "Sessions",
      campfires: "Campfire rounds",
      plans: "Plans done",
      instances: "Instances visited",
      hearth: "Hearthstone used",
      xp: "Experience gathered",
    },
    noteMeta: "{0} · {1} · level {2}",
    pinned: "pinned",
    colophon: "Written down by Ink & Embers. Made on {0}.",
    fontsNote: "Fonts: Spectral and Caveat (SIL Open Font License 1.1).",
    dur: { d: "{0} d", h: "{0} h", m: "{0} min" },
    coins: ["g", "s", "c"],
    raid: ["Star", "Circle", "Diamond", "Triangle", "Moon", "Square", "Cross", "Skull"],
  },
};

export function normLang(l) {
  return l === "en" ? "en" : "de";
}

// text by dotted key with placeholders {0}, {1} ... (unknown key -> the key, never a crash)
// walk a dotted key through the text table; only own keys count (no "constructor", "__proto__", "toString" from the prototype)
function lookup(table, key) {
  let v = table;
  for (const part of String(key).split(".")) v = v && typeof v === "object" && Object.hasOwn(v, part) ? v[part] : undefined;
  return v;
}

export function tr(lang, key, ...args) {
  let v = lookup(TEXTS[normLang(lang)], key);
  if (v === undefined) v = lookup(TEXTS.de, key);
  if (typeof v !== "string") return String(key);
  return v.replace(/\{(\d+)\}/g, (m, i) => (args[Number(i)] === undefined || args[Number(i)] === null ? "" : String(args[Number(i)])));
}

export function raw(lang, key) {
  return lookup(TEXTS[normLang(lang)], key);
}

function locale(lang) {
  return normLang(lang) === "en" ? "en-GB" : "de-DE";
}

export function fmtNumber(lang, n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "–";
  return new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 0 }).format(n);
}

export function fmtDate(lang, epoch, withYear = true) {
  if (typeof epoch !== "number" || !Number.isFinite(epoch)) return "–";
  const opts = withYear ? { day: "numeric", month: "long", year: "numeric" } : { day: "numeric", month: "long" };
  return new Intl.DateTimeFormat(locale(lang), opts).format(new Date(epoch * 1000));
}

export function fmtShortDate(lang, epoch) {
  if (typeof epoch !== "number" || !Number.isFinite(epoch)) return "–";
  return new Intl.DateTimeFormat(locale(lang), { day: "2-digit", month: "2-digit", year: "2-digit" }).format(new Date(epoch * 1000));
}

// seconds -> "3 T. 4 Std." / "2 Std. 15 Min." (two largest units)
export function fmtDuration(lang, sec) {
  if (typeof sec !== "number" || !Number.isFinite(sec) || sec < 0) return "–";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const u = raw(lang, "dur");
  const parts = [];
  if (d > 0) parts.push(u.d.replace("{0}", fmtNumber(lang, d)));
  if (h > 0) parts.push(u.h.replace("{0}", String(h)));
  if (d === 0 && (m > 0 || parts.length === 0)) parts.push(u.m.replace("{0}", String(m)));
  return parts.slice(0, 2).join(" ");
}

// copper -> [{ n, unit, kind }] (gold, silver, copper; zero places left out, at least one)
export function moneyParts(lang, copper) {
  if (typeof copper !== "number" || !Number.isFinite(copper)) return [];
  const c = Math.abs(Math.round(copper));
  const g = Math.floor(c / 10000);
  const s = Math.floor((c % 10000) / 100);
  const k = c % 100;
  const units = raw(lang, "coins");
  const out = [];
  if (g > 0) out.push({ n: fmtNumber(lang, g), unit: units[0], kind: "gold" });
  if (s > 0) out.push({ n: String(s), unit: units[1], kind: "silver" });
  if (k > 0 || out.length === 0) out.push({ n: String(k), unit: units[2], kind: "copper" });
  return out;
}

export function roman(n) {
  if (!Number.isInteger(n) || n <= 0 || n >= 4000) return String(n);
  const table = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let out = "";
  for (const [v, s] of table) {
    while (n >= v) {
      out += s;
      n -= v;
    }
  }
  return out;
}
