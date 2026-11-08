// Druckansicht (Drucken / PDF): ein eigenes Buch für den Druck, A4, jedes Kapitel auf einer neuen Seite, keine
// Bedienelemente. Inhalt: Titelseite mit der ganzen Reise als Kartenbild, Steckbrief, die Kapitel des Tagebuchs mit einem
// Standbild der Kapitelroute, Höhepunkte, Medaillen, Stufenfluss, Dungeons, Tode, Bilanz und Notizen.
// „Andere Spieler ausblenden“ ersetzt die Namen IM MODELL (anonymize.mjs) bevor irgendetwas entsteht; zusätzlich läuft am
// Ende ein Netz über alle Textknoten des Buches.
// Sicherheit: nur DOM über el()/Textknoten; Karten-Standbilder entstehen im Canvas (drawFrame, Texte durch safeText) und
// werden als blob:-URL eingebunden (img-src blob: laut CSP); Kartenbilder nur aus maps/ der eigenen Seite.
import { buildJournal } from "../core/journal-model.mjs";
import { fmtDate } from "../core/i18n.mjs";
import { el } from "../core/render.mjs";
import { createAnonymizer, anonymizeChar, anonymizeModel, scrubJourney, createRenumberer } from "../share/anonymize.mjs";
import { sceneCache, mapTitle } from "../share/frames.mjs";
import { buildChronik } from "../chronik/model.mjs";
import { chronikModel } from "../chronik/index.mjs";
import { renderChronicle } from "../chronik/view.mjs";
import { chooseMap } from "../map/scene.mjs";
import { drawFrame, fitView, transformFor, DEFAULT_ASPECT } from "../map/renderer.mjs";
import { displayMap } from "../geo/map-geo.mjs";
import { prepareJourney, mapImageCandidates } from "./journey.mjs";
import { loadImage, loadIcons, loadFonts } from "./share-panel.mjs";
import { t } from "./texts.mjs";
import { safeText } from "./safe-text.mjs";
import { portraitImg, classSpan } from "./identity.mjs";

// Standbild: 900 × 600 CSS-Pixel (passt auf die A4-Satzbreite), 1,5-fach gerastert, als JPEG
export const STILL = Object.freeze({ width: 900, height: 600, pixelRatio: 1.5, quality: 0.88 });
export const PRINT_CHAPTER_MAPS_MAX = 60; // mehr Kapitel bekommen kein eigenes Kartenbild mehr (Speicher)
const EXPAND_MAX = 400; // höchstens so oft „Mehr anzeigen“/Dungeon-Details aufklappen

const hasClass = (node, cls) => !!node && typeof node.className === "string" && node.className.split(" ").includes(cls);

// Attribut lesen (echtes DOM: getAttribute; Test-DOM: attributes-Objekt)
function attr(node, name) {
  if (!node) return null;
  if (typeof node.getAttribute === "function") return node.getAttribute(name);
  const a = node.attributes;
  return a && typeof a === "object" && Object.prototype.hasOwnProperty.call(a, name) ? a[name] : null;
}

function walk(node, fn) {
  fn(node);
  if (node && node.childNodes) for (const c of [...node.childNodes]) walk(c, fn);
}

// ---------------------------------------------------------------- Daten (mit oder ohne Anonymisierung)

// -> { db, journal, char, chronik, data, anon }
export function printData({ db, guid, journal, char, lang, anonymize }) {
  if (!anonymize) {
    return { db, journal, char, chronik: chronikModel(db, guid, journal), data: prepareJourney(journal, char), anon: null };
  }
  const anon = createAnonymizer(char, lang);
  const aChar = anonymizeChar(char, anon);
  // flache Kopie der Datei: nur dieser Charakter, mit umgeschriebenem Log (meta/diag bleiben für Sitzungen und Medaillen)
  const adb = Object.assign(Object.create(null), db);
  adb.chars = Object.create(null);
  adb.chars[guid] = aChar;
  const aJournal = anonymizeModel(buildJournal(adb, guid), anon);
  return {
    db: adb,
    journal: aJournal,
    char: aChar,
    chronik: buildChronik(adb, guid, aJournal),
    data: scrubJourney(prepareJourney(aJournal, aChar), anon),
    anon,
  };
}

// ---------------------------------------------------------------- Karten-Standbilder

// letzter Index mit arr[i] <= v, sonst -1
function lastLE(arr, v) {
  let lo = 0, hi = arr.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= v) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}

// Ausschnitt einer Szene auf die Zeit t0..t1 (Epochen): Linien, Flüge, Marker; Grenzen neu aus den behaltenen Punkten
export function sliceScene(scene, t0, t1) {
  if (!scene) return null;
  const lo = Number.isFinite(t0) ? t0 : -Infinity, hi = Number.isFinite(t1) ? t1 : Infinity;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const lines = [];
  for (const l of scene.lines) {
    const n = l.t.length;
    if (!n || l.t[n - 1] < lo || l.t[0] > hi) continue;
    const a = Math.max(0, lastLE(l.t, lo - 1e-9) + 1), b = lastLE(l.t, hi);
    if (b < a) continue;
    const out = { x: l.x.slice(a, b + 1), y: l.y.slice(a, b + 1), t: l.t.slice(a, b + 1) };
    for (let i = 0; i < out.x.length; i++) {
      const x = out.x[i], y = out.y[i];
      if (x < 0 || x > 1 || y < 0 || y > 1) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    lines.push(out);
  }
  const flights = scene.flights.filter((f) => f.t0 >= lo && f.t0 <= hi);
  const markers = scene.markers.filter((m) => m.t >= lo && m.t <= hi);
  return { ...scene, lines, flights, markers, bounds: x1 >= x0 ? { x0, x1, y0, y1 } : null };
}

// Ansicht so verschieben, dass das Bild ganz mit Karte gefüllt ist (kein Rand neben der Karte, wenn vergrößert)
export function fillView(view, aspect, width, height) {
  const T = transformFor({ width, height, aspect, view });
  const halfW = width / 2 / T.sx, halfH = height / 2 / T.sy;
  const fit = (c, half) => (half >= 0.5 ? 0.5 : Math.max(half, Math.min(1 - half, c)));
  return { ...view, cx: fit(view.cx, halfW), cy: fit(view.cy, halfH) };
}

// Standbild in ein (nicht eingehängtes) Canvas zeichnen -> Canvas oder null (Browser ohne Canvas)
export function drawStill(doc, { scene, image, icons, title, maxZoom = 3 }, size = STILL) {
  if (!scene || typeof doc.createElement !== "function") return null;
  const canvas = doc.createElement("canvas");
  const ctx = typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
  if (!ctx) return null;
  canvas.width = Math.round(size.width * size.pixelRatio);
  canvas.height = Math.round(size.height * size.pixelRatio);
  const aspect = image && image.naturalWidth > 0 && image.naturalHeight > 0 ? image.naturalWidth / image.naturalHeight : DEFAULT_ASPECT;
  const view = fillView(fitView(scene.bounds, aspect, size.width, size.height, 0.18, maxZoom), aspect, size.width, size.height);
  drawFrame(ctx, {
    width: size.width, height: size.height, pixelRatio: size.pixelRatio, scene, image, aspect, view,
    title: safeText(title || "", 60), theme: "light", timeline: null, highlight: null, icons, drawHead: false,
  }, Infinity);
  return canvas;
}

function canvasUrl(win, canvas, quality) {
  return new Promise((resolve) => {
    if (!canvas || typeof canvas.toBlob !== "function" || !win.URL || typeof win.URL.createObjectURL !== "function") return resolve(null);
    try {
      canvas.toBlob((blob) => resolve(blob ? win.URL.createObjectURL(blob) : null), "image/jpeg", quality);
    } catch {
      resolve(null); // Canvas nicht lesbar: dann eben ohne Bild
    }
  });
}

// ---------------------------------------------------------------- Buch

function figure(doc, url, caption, alt) {
  if (!url) return null;
  const img = doc.createElement("img");
  img.className = "print-map-img";
  img.setAttribute("src", url);
  img.setAttribute("alt", alt);
  img.setAttribute("width", String(STILL.width));
  img.setAttribute("height", String(STILL.height));
  return el(doc, "figure", "print-map", img, el(doc, "figcaption", "print-map-cap", caption));
}

function metaLine(doc, lang, j) {
  const parts = [];
  if (Number.isFinite(j.level)) parts.push(t(lang, "charSummaryLevel", j.level));
  if (j.race) parts.push(safeText(j.race, 40));
  if (j.cls) parts.push(classSpan(doc, j.classFile, safeText(j.cls, 40)));
  if (j.realm) parts.push(safeText(j.realm, 40));
  const out = [];
  parts.forEach((p, i) => {
    if (i) out.push(" · ");
    out.push(p);
  });
  return out;
}

function titlePage(doc, lang, P, tripFigure, info) {
  const j = P.journal;
  const span = Number.isFinite(j.firstT) && Number.isFinite(j.lastT) ? t(lang, "printSpan", fmtDate(lang, j.firstT), fmtDate(lang, j.lastT)) : null;
  const page = el(doc, "section", "print-page print-title",
    el(doc, "p", "print-eyebrow", t(lang, "printEyebrow")),
    el(doc, "div", "print-who",
      portraitImg(doc, info, "print-portrait", 96),
      el(doc, "div", "print-who-text",
        el(doc, "h1", "print-name", safeText(j.name, 40)),
        el(doc, "p", "print-meta", metaLine(doc, lang, j)),
        span ? el(doc, "p", "print-span", span) : null,
      ),
    ),
    tripFigure,
    P.anon ? el(doc, "p", "print-anon-note", t(lang, "printAnonNote")) : null,
  );
  return page;
}

// alle „Mehr anzeigen“ und Dungeon-Details aufklappen (im Druck gibt es keine Knöpfe)
export function expandForPrint(root) {
  for (let round = 0; round < EXPAND_MAX; round++) {
    let clicked = false;
    walk(root, (n) => {
      if (clicked || !n || n.nodeType !== 1) return;
      if (hasClass(n, "chron-more") && typeof n.click === "function") {
        n.click();
        clicked = true;
      }
    });
    if (!clicked) break;
  }
  let opened = 0;
  walk(root, (n) => {
    if (opened >= EXPAND_MAX || !n || n.nodeType !== 1 || !hasClass(n, "dg-toggle")) return;
    if (attr(n, "aria-expanded") === "false" && typeof n.click === "function") {
      n.click();
      opened++;
    }
  });
}

// Netz: jeden Textknoten und jedes alt/aria-label/title noch einmal nach fremden Namen durchsuchen. Danach werden die
// Pseudonyme in Lesereihenfolge neu nummeriert: der erste Fremde im Buch ist „Gefährte 1“, der nächste „Gefährte 2“ …
const TEXT_ATTRS = ["alt", "aria-label", "title"];
export function scrubTree(root, anon) {
  if (!anon) return;
  const renumber = createRenumberer(anon.lang);
  const fix = (v) => renumber(anon.scrub(v));
  walk(root, (n) => {
    if (n && n.nodeType === 3 && typeof n.data === "string") {
      const s = fix(n.data);
      if (s !== n.data) n.data = s;
    } else if (n && n.nodeType === 1 && typeof n.setAttribute === "function") {
      for (const name of TEXT_ATTRS) {
        const v = attr(n, name);
        if (typeof v !== "string" || !v) continue;
        const s = fix(v);
        if (s !== v) n.setAttribute(name, s);
      }
    }
  });
}

// Druckbuch bauen. opts: { db, guid, journal, char, lang, anonymize, info: { raceFile, race, faction } }
// -> { element, urls } (urls: blob:-Adressen der Standbilder, nach dem Druck freigeben)
export async function buildPrintBook(doc, win, opts) {
  const lang = opts.lang;
  const P = printData(opts);
  const urls = [];
  const data = P.data;
  const hasTrail = data.trail.segments.length > 0;
  const canDraw = hasTrail && typeof doc.createElement === "function";

  // Kartenbilder, Symbole und Schrift nur laden, wenn gezeichnet wird
  const images = new Map();
  let icons = null;
  const scenes = sceneCache(data, P.anon);
  const imageFor = async (mapID) => {
    if (!images.has(mapID)) {
      const m = displayMap(mapID);
      images.set(mapID, m && m.art && m.mapID === mapID ? await loadImage(win, mapImageCandidates(mapID, lang)) : null);
    }
    return images.get(mapID);
  };
  const still = async (mapID, t0, t1, caption, alt, maxZoom) => {
    if (!canDraw || !mapID) return null;
    const full = scenes(mapID);
    const scene = sliceScene(full, t0, t1);
    if (!scene || !scene.lines.length) return null;
    const image = await imageFor(mapID);
    const canvas = drawStill(doc, { scene, image, icons, title: mapTitle(data, mapID, lang), maxZoom });
    const url = await canvasUrl(win, canvas, STILL.quality);
    if (url) urls.push(url);
    return figure(doc, url, caption, alt);
  };

  if (canDraw) {
    icons = await loadIcons(win);
    await loadFonts(doc);
  }

  // Titelseite: ganze Reise auf dem Kontinent, auf dem sie endet
  let tripFig = null;
  if (canDraw) {
    const last = data.trail.segments[data.trail.segments.length - 1];
    const cont = chooseMap("continent", last.mapID);
    if (cont) {
      const name = mapTitle(data, cont.mapID, lang);
      tripFig = await still(cont.mapID, -Infinity, Infinity, t(lang, "printTripMap", name), t(lang, "printTripAlt", name), 4);
    }
  }

  const view = renderChronicle(doc, { model: P.chronik, journal: P.journal, lang });
  expandForPrint(view);
  const bookNode = (() => {
    let found = null;
    walk(view, (n) => {
      if (!found && hasClass(n, "chron-book")) found = n;
    });
    return found;
  })();
  const parts = { profile: null, medals: null, flow: null, dungeons: null, deaths: null, stats: null, chapters: [], highlights: null, notes: null };
  for (const n of bookNode ? [...bookNode.childNodes] : []) {
    const sec = attr(n, "data-section");
    if (sec && Object.prototype.hasOwnProperty.call(parts, sec) && sec !== "chapters") parts[sec] = n;
    else if (hasClass(n, "stats-page")) parts.stats = n;
    else if (hasClass(n, "chapter")) parts.chapters.push(n);
    else if (hasClass(n, "highlights-page")) parts.highlights = n;
    else if (hasClass(n, "notes-page")) parts.notes = n;
  }

  // Kapitel: Standbild der Kapitelroute nach dem Kapitelkopf (Kapitel i des Tagebuchs = i-te Kapitelseite)
  const jch = Array.isArray(P.journal.chapters) ? P.journal.chapters : [];
  for (let i = 0; i < parts.chapters.length && i < PRINT_CHAPTER_MAPS_MAX; i++) {
    const src = jch[i];
    const dc = src ? data.chapters.find((c) => c.t0 === src.start) : null;
    if (!dc || !dc.mapID) continue;
    const zone = chooseMap("zone", dc.mapID);
    if (!zone) continue;
    const name = mapTitle(data, zone.mapID, lang);
    const fig = await still(zone.mapID, dc.t0, dc.t1, t(lang, "printChapterMap", name), t(lang, "printChapterAlt", dc.n, name), 2.5);
    if (!fig) continue;
    const node = parts.chapters[i];
    const kids = [...node.childNodes];
    const head = kids.find((c) => hasClass(c, "chapter-head")) || null;
    while (node.firstChild) node.removeChild(node.firstChild);
    for (const k of kids) {
      node.appendChild(k);
      if (k === head) node.appendChild(fig);
    }
    if (!head) node.appendChild(fig);
  }

  const book = el(doc, "div", "print-book chron-book");
  book.setAttribute("lang", lang === "en" ? "en" : "de");
  const info = opts.info || {};
  book.appendChild(titlePage(doc, lang, P, tripFig, info));
  for (const n of [parts.profile, ...parts.chapters, parts.highlights, parts.medals, parts.flow, parts.dungeons, parts.deaths, parts.stats, parts.notes]) {
    if (!n) continue;
    if (!hasClass(n, "print-page")) n.className = (n.className ? n.className + " " : "") + "print-page";
    book.appendChild(n);
  }
  book.appendChild(el(doc, "footer", "print-colophon",
    el(doc, "p", null, t(lang, "printColophon", fmtDate(lang, Date.now() / 1000))),
    el(doc, "p", null, t(lang, "footer")),
  ));
  scrubTree(book, P.anon);
  return { element: book, urls, anonymized: !!P.anon };
}
