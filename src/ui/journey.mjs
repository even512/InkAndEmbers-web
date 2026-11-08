// Reise-Ansicht: Karte (Canvas) mit Route, Flügen und Markern, Zoom/Pan (Maus, Rad, Touch, Tastatur), Tooltips,
// Kapitelleiste je Zone, Umschalter Zone/Kontinent, Wiedergabe 20/60/180× mit Zeitleiste und mitlaufender Stufe,
// Datum und Spielzeit. Gezeichnet wird mit map/renderer.mjs (dieselbe Routine nutzt das Video in W6).
// Sicherheit: Texte aus der Datei nur über Textknoten (el) bzw. safeText ins Canvas; Kartenbilder nur aus maps/ der
// eigenen Seite (img-src 'self'), der Pfad besteht nur aus einer geprüften Zahl. Keine Netzwerkanfragen sonst.
import { parseLog } from "../core/journal-model.mjs";
import { fmtDate, fmtDuration, fmtNumber } from "../core/i18n.mjs";
import { el } from "../core/render.mjs";
import { readCharacterTrail, fromAxis, positionAt } from "../trail/parse-trail.mjs";
import { mapInfo } from "../geo/map-geo.mjs";
import { buildMarkers, buildChapters, buildLabels, prepareMapScene, chooseMap, chapterAtAxis, levelTrack, levelAt, playedTrack, playedAt } from "../map/scene.mjs";
import { drawFrame, fitView, zoomAt, panBy, clampView, hitMarker, DEFAULT_ASPECT, ZOOM_STEP, MARKER_STYLE } from "../map/renderer.mjs";
import * as PB from "../map/playback.mjs";
import { t } from "./texts.mjs";
import { safeText } from "./safe-text.mjs";

// Kartenbilder je Sprache (Ortsnamen stehen im Bild): maps/forever/<de|en>/<uiMapID>.webp, Rückfall en, dann Pergament
export const MAP_DIR = "maps/forever/";
export const MAP_LANGS = Object.freeze(["de", "en"]);
const DRAG_START = 4;
const isMapId = (id) => Number.isInteger(id) && id > 0 && id <= 1e6;

// Pfad des Kartenbilds (relativ zur Seite, gleiche Herkunft) oder null; Sprache nur aus der festen Liste
export function mapImageUrl(mapID, lang = "en") {
  if (!isMapId(mapID) || !MAP_LANGS.includes(lang)) return null;
  return MAP_DIR + lang + "/" + mapID + ".webp";
}

// Reihenfolge der Versuche: Sprache der Seite, dann Englisch
export function mapImageCandidates(mapID, lang) {
  const langs = MAP_LANGS.includes(lang) && lang !== "en" ? [lang, "en"] : ["en"];
  return langs.map((l) => mapImageUrl(mapID, l)).filter(Boolean);
}

// Tooltip-Zeilen eines Markers: [Titel, ...Zeilen] (alles schon gesäubert, nur als Text auszugeben)
export function markerLines(lang, m) {
  const name = m.name ? safeText(m.name, 80) : t(lang, "jUnknown");
  const lines = [];
  if (m.kind === "level") lines.push(t(lang, "jMkLevel", Number.isFinite(m.level) ? m.level : "?"));
  else if (m.kind === "death") {
    lines.push(Number.isFinite(m.level) ? t(lang, "jMkDeathLevel", m.level) : t(lang, "jMkDeath"));
    if (m.name) lines.push(t(lang, "jMkKiller", safeText(m.name, 80)));
  } else if (m.kind === "boss") {
    lines.push(t(lang, "jMkBoss", name));
    if (m.extra) lines.push(safeText(m.extra, 80));
  } else if (m.kind === "rare") lines.push(t(lang, "jMkRare", name));
  else lines.push(t(lang, "jMkDiscovery", name));
  if (m.place) lines.push(safeText(m.place, 80));
  lines.push(fmtDate(lang, m.t));
  return lines;
}

// Tooltip als DOM-Knoten (nur Textknoten)
export function markerTip(doc, lang, m) {
  const [head, ...rest] = markerLines(lang, m);
  return [el(doc, "span", "tip-title", head), ...rest.map((l) => el(doc, "span", "tip-line", l))];
}

// Daten einer Reise vorbereiten (ohne DOM): Spur, Marker, Kapitel, Stufe/Spielzeit
export function prepareJourney(journal, char) {
  const events = parseLog(char);
  const trail = readCharacterTrail(char, events);
  const markers = buildMarkers(journal, events, trail);
  const chapters = buildChapters(journal, trail);
  const names = new Map();
  for (const c of chapters) if (c.mapID && c.name && !names.has(c.mapID)) names.set(c.mapID, c.name);
  return { events, trail, markers, chapters, names, levels: levelTrack(journal, events), played: playedTrack(events, trail) };
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// Text eines Knotens ersetzen (nur Textknoten)
function setText(doc, node, s) {
  clear(node);
  node.appendChild(doc.createTextNode(String(s)));
}

export function createJourneyView(doc, win, { journal, char, lang }) {
  const data = prepareJourney(journal, char);
  const hasTrail = data.trail.segments.length > 0;
  const tl = data.trail.timeline;
  const S = {
    lang,
    mode: "zone", // zone | continent
    chapter: -1, // -1 = ganze Reise
    pb: PB.createPlayback(PB.DEFAULT_SPEED),
    map: null, // { mapID, art }
    view: { cx: 0.5, cy: 0.5, zoom: 1 },
    hover: null,
    width: 0,
    height: 0,
    raf: 0,
    last: 0,
    destroyed: false,
  };
  PB.setRange(S.pb, 0, tl.length);
  const scenes = new Map(); // mapID -> Szene
  const images = new Map(); // "<lang>:<mapID>" -> { status: loading|ok|missing, img }
  const imgKey = (map) => S.lang + ":" + map.mapID;
  // Bild der aktuellen Karte; lädt die neue Sprache noch, bleibt das Bild der vorigen stehen (kein Aufblitzen)
  const curImage = () => {
    if (!S.map) return null;
    const e = images.get(imgKey(S.map));
    if (e && e.status !== "loading") return e;
    for (const [k, v] of images) if (k.endsWith(":" + S.map.mapID) && v.status === "ok") return v;
    return e || null;
  };
  const darkQuery = win.matchMedia ? win.matchMedia("(prefers-color-scheme: dark)") : null;

  const root = el(doc, "section", "view-panel journey-panel");
  const title = el(doc, "h2", "panel-title journey-title");
  const modeBar = el(doc, "div", "seg mode-switch");
  modeBar.setAttribute("role", "group");
  const head = el(doc, "div", "journey-head", title, modeBar);
  const chapterBar = el(doc, "div", "chapter-bar");
  chapterBar.setAttribute("role", "group");
  const canvas = doc.createElement("canvas");
  canvas.className = "map-canvas";
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "img");
  const tip = el(doc, "div", "map-tip");
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  const zoomIn = el(doc, "button", "map-tool", "+");
  const zoomOut = el(doc, "button", "map-tool", "−");
  const zoomReset = el(doc, "button", "map-tool", "⤢");
  for (const b of [zoomIn, zoomOut, zoomReset]) b.type = "button";
  const tools = el(doc, "div", "map-tools", zoomIn, zoomOut, zoomReset);
  const noArt = el(doc, "p", "map-note");
  noArt.hidden = true;
  const frame = el(doc, "div", "map-frame", canvas, tools, tip, noArt);
  const playBtn = el(doc, "button", "btn primary play-btn");
  playBtn.type = "button";
  const speedBar = el(doc, "div", "seg speed-switch");
  speedBar.setAttribute("role", "group");
  const scrub = doc.createElement("input");
  scrub.type = "range";
  scrub.className = "scrub";
  scrub.min = "0";
  scrub.max = "1000";
  scrub.step = "1";
  const info = el(doc, "p", "play-info");
  const playback = el(doc, "div", "playback", playBtn, speedBar, scrub, info);
  const legend = el(doc, "p", "map-legend");
  const notes = el(doc, "div", "journey-notes");
  const emptyMsg = el(doc, "p", "panel-soon journey-empty");

  const ctx = canvas.getContext ? canvas.getContext("2d") : null;

  // ---------------------------------------------------------------- Daten der aktuellen Stelle
  const epochAt = (p) => fromAxis(tl, p);
  const cutAxis = () => PB.drawAxis(S.pb);
  const nowEpoch = () => {
    const a = cutAxis();
    return a === Infinity ? tl.t1 : epochAt(a);
  };

  function baseMapID() {
    if (S.chapter >= 0 && data.chapters[S.chapter] && data.chapters[S.chapter].mapID) return data.chapters[S.chapter].mapID;
    const p = positionAt(data.trail, nowEpoch());
    if (p) return p.mapID;
    return data.trail.segments.length ? data.trail.segments[data.trail.segments.length - 1].mapID : null;
  }

  function sceneFor(mapID) {
    if (!scenes.has(mapID)) {
      const labels = buildLabels(mapID, { events: data.events, trail: data.trail, names: data.names });
      scenes.set(mapID, prepareMapScene(data.trail, mapID, { markers: data.markers, labels }));
    }
    return scenes.get(mapID);
  }

  function imageFor(map) {
    if (!map) return null;
    const key = imgKey(map);
    let e = images.get(key);
    if (!e) {
      const urls = map.art ? mapImageCandidates(map.mapID, S.lang) : [];
      if (!urls.length || typeof win.Image !== "function") e = { status: "missing", img: null };
      else {
        e = { status: "loading", img: null };
        images.set(key, e);
        const hadArt = [...images.entries()].some(([k, v]) => k !== key && k.endsWith(":" + map.mapID) && v.status === "ok");
                const attempt = (i) => {
          if (i >= urls.length) {
            e.status = "missing";
            draw();
            return;
          }
          const img = new win.Image();
          img.decoding = "async";
          img.addEventListener("load", () => {
            if (!(img.naturalWidth > 0)) return attempt(i + 1);
            e.img = img;
            e.status = "ok";
            if (!hadArt && S.map && S.map.mapID === map.mapID) resetView();
            draw();
          });
          img.addEventListener("error", () => attempt(i + 1));
          img.src = urls[i];
        };
        attempt(0);
      }
      images.set(key, e);
    }
    return e;
  }

  function aspect() {
    const e = curImage();
    return e && e.status === "ok" ? e.img.naturalWidth / e.img.naturalHeight : DEFAULT_ASPECT;
  }

  function frameState() {
    const e = curImage();
    const info = S.map ? mapInfo(S.map.mapID) : null;
    return {
      width: S.width,
      height: S.height,
      pixelRatio: Math.min(3, win.devicePixelRatio || 1),
      scene: S.map ? sceneFor(S.map.mapID) : null,
      image: e && e.status === "ok" ? e.img : null,
      aspect: aspect(),
      view: S.view,
      title: (S.map && data.names.get(S.map.mapID)) || (info ? info.name : S.map ? "#" + S.map.mapID : ""),
      theme: darkQuery && darkQuery.matches ? "dark" : "light",
      timeline: tl,
      highlight: S.hover,
    };
  }

  function resetView() {
    if (!S.map) return;
    const sc = sceneFor(S.map.mapID);
    S.view = S.mode === "continent" ? fitView(sc.bounds, aspect(), S.width || 900, S.height || 600, 0.15) : { cx: 0.5, cy: 0.5, zoom: 1 };
  }

  // Karte passend zur Stelle wählen; Wechsel setzt die Ansicht zurück
  function syncMap() {
    const next = chooseMap(S.mode, baseMapID());
    if (!next) return false;
    if (S.map && S.map.mapID === next.mapID) return false;
    S.map = next;
    S.hover = null;
    tip.hidden = true;
    imageFor(next);
    resetView();
    return true;
  }

  // ---------------------------------------------------------------- Zeichnen
  function measure() {
    const r = frame.getBoundingClientRect ? frame.getBoundingClientRect() : null;
    const w = r && r.width > 0 ? Math.round(r.width) : 900;
    const h = r && r.height > 0 ? Math.round(r.height) : 600;
    if (w === S.width && h === S.height) return false;
    S.width = w;
    S.height = h;
    const pr = Math.min(3, win.devicePixelRatio || 1);
    canvas.width = Math.round(w * pr);
    canvas.height = Math.round(h * pr);
    return true;
  }

  function draw() {
    if (S.destroyed || !ctx) return;
    const first = S.width === 0;
    measure();
    if (first) resetView();
    drawFrame(ctx, frameState(), cutAxis());
    const e = curImage();
    noArt.hidden = !(e && e.status === "missing");
  }

  function updateInfo() {
    const a = cutAxis();
    const ep = nowEpoch();
    const lvl = levelAt(data.levels, ep);
    const played = playedAt(data.played, ep);
    const parts = [];
    if (lvl !== null) parts.push(t(S.lang, "jInfoLevel", lvl));
    parts.push(fmtDate(S.lang, ep));
    if (played !== null) parts.push(t(S.lang, "jInfoPlayed", fmtDuration(S.lang, played)));
    const text = parts.join(" · ");
    setText(doc, info, text);
    scrub.value = String(Math.round(PB.frac(S.pb) * 1000));
    scrub.setAttribute("aria-valuetext", text);
    setText(doc, playBtn, t(S.lang, S.pb.playing ? "jPause" : "jPlay"));
    playBtn.setAttribute("aria-pressed", S.pb.playing ? "true" : "false");
    // laufendes Kapitel in der Leiste markieren
    const cur = S.chapter >= 0 ? S.chapter : chapterAtAxis(data.chapters, a === Infinity ? tl.length : a);
    for (const chip of chapterBar.childNodes) {
      if (!chip.dataset) continue;
      const idx = Number(chip.dataset.idx);
      chip.classList.toggle("current", idx === cur && S.chapter < 0 && idx >= 0);
    }
  }

  function tickFrame(now) {
    S.raf = 0;
    if (S.destroyed) return;
    const dt = S.last ? Math.min(0.25, (now - S.last) / 1000) : 0;
    S.last = now;
    PB.step(S.pb, dt);
    syncMap();
    draw();
    updateInfo();
    if (S.pb.playing) loop();
    else S.last = 0;
  }

  function loop() {
    if (S.raf || S.destroyed || typeof win.requestAnimationFrame !== "function") return;
    S.raf = win.requestAnimationFrame(tickFrame);
  }

  function refresh() {
    syncMap();
    draw();
    updateInfo();
  }

  // ---------------------------------------------------------------- Bedienelemente
  function segButton(bar, label, active, onClick, hint) {
    const b = el(doc, "button", "seg-btn" + (active ? " active" : ""), label);
    b.type = "button";
    b.setAttribute("aria-pressed", active ? "true" : "false");
    if (hint) b.setAttribute("aria-label", label + " – " + hint);
    b.addEventListener("click", onClick);
    bar.appendChild(b);
    return b;
  }


  function selectChapter(i) {
    S.chapter = i;
    PB.pause(S.pb);
    if (i >= 0 && data.chapters[i]) PB.setRange(S.pb, data.chapters[i].a0, Math.max(data.chapters[i].a1, data.chapters[i].a0));
    else PB.setRange(S.pb, 0, tl.length);
    S.map = null;
    buildControls();
    refresh();
  }

  function buildControls() {
    const L = S.lang;
    setText(doc, title, t(L, "journeyTitle"));
    clear(modeBar);
    modeBar.setAttribute("aria-label", t(L, "jModeLabel"));
    for (const [mode, key] of [["zone", "jModeZone"], ["continent", "jModeContinent"]]) {
      segButton(modeBar, t(L, key), S.mode === mode, () => {
        if (S.mode === mode) return;
        S.mode = mode;
        S.map = null;
        buildControls();
        refresh();
      });
    }
    clear(chapterBar);
    chapterBar.setAttribute("aria-label", t(L, "jChapters"));
    const chip = (idx, label, sub) => {
      const b = el(doc, "button", "chapter-chip" + (S.chapter === idx ? " active" : ""), el(doc, "span", "chip-num", label), sub ? el(doc, "span", "chip-name", sub) : null);
      b.type = "button";
      if (b.dataset) b.dataset.idx = String(idx);
      b.setAttribute("aria-pressed", S.chapter === idx ? "true" : "false");
      b.addEventListener("click", () => selectChapter(idx));
      chapterBar.appendChild(b);
    };
    chip(-1, t(L, "jWholeTrip"), null);
    data.chapters.forEach((c, i) => {
      const lv = c.minLevel !== null && c.maxLevel !== null ? (c.minLevel === c.maxLevel ? t(L, "jLevelSpan", c.minLevel) : t(L, "jLevelRange", c.minLevel, c.maxLevel)) : null;
      chip(i, t(L, "jChapterChip", fmtNumber(L, c.n)) + (lv ? " · " + lv : ""), c.name || t(L, "jUnknown"));
    });
    clear(speedBar);
    speedBar.setAttribute("aria-label", t(L, "jSpeedLabel"));
    for (const sp of PB.SPEEDS) {
      segButton(speedBar, t(L, PB.SPEED_KEYS[sp]), S.pb.speed === sp, () => {
        PB.setSpeed(S.pb, sp);
        buildControls();
        updateInfo();
      }, t(L, "jSpeedHint", sp));
    }
    scrub.setAttribute("aria-label", t(L, "jScrub"));
    zoomIn.setAttribute("aria-label", t(L, "jZoomIn"));
    zoomOut.setAttribute("aria-label", t(L, "jZoomOut"));
    zoomReset.setAttribute("aria-label", t(L, "jZoomReset"));
    setText(doc, noArt, t(L, "jNoArt"));
    const mapName = S.map ? frameState().title : "";
    canvas.setAttribute("aria-label", t(L, "jMapLabel", mapName));
    clear(legend);
    legend.setAttribute("aria-label", t(L, "jLegend"));
    legend.appendChild(el(doc, "span", "leg leg-route", t(L, "jLegRoute")));
    legend.appendChild(el(doc, "span", "leg leg-flight", t(L, "jLegFlight")));
    for (const [kind, key] of [["level", "jLegLevel"], ["death", "jLegDeath"], ["boss", "jLegBoss"], ["rare", "jLegRare"], ["discovery", "jLegDiscovery"]]) {
      legend.appendChild(el(doc, "span", "leg leg-" + kind, el(doc, "span", "leg-dot", MARKER_STYLE[kind].glyph || "▲"), t(L, key)));
    }
    clear(notes);
    const dropped = data.trail.stats ? data.trail.stats.linesDropped + data.trail.stats.blocksDropped : 0;
    if (dropped > 0) notes.appendChild(el(doc, "p", "notice", t(L, "jDropped", fmtNumber(L, dropped))));
    updateInfo();
  }

  playBtn.addEventListener("click", () => {
    PB.toggle(S.pb);
    S.last = 0;
    updateInfo();
    if (S.pb.playing) loop();
    else refresh();
  });
  scrub.addEventListener("input", () => {
    PB.pause(S.pb);
    PB.seek(S.pb, Number(scrub.value) / 1000);
    if (Number(scrub.value) >= 1000) S.pb.p = S.pb.p1;
    refresh();
  });

  const zoomCenter = (f) => {
    S.view = zoomAt(frameState(), f, S.width / 2, S.height / 2);
    draw();
  };
  zoomIn.addEventListener("click", () => zoomCenter(ZOOM_STEP));
  zoomOut.addEventListener("click", () => zoomCenter(1 / ZOOM_STEP));
  zoomReset.addEventListener("click", () => {
    resetView();
    draw();
  });

  // ---------------------------------------------------------------- Zoom/Pan und Tooltips auf der Karte
  const pointers = new Map();
  let drag = null; // { x, y, moved, pinch }
  const local = (e) => {
    const r = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { left: 0, top: 0 };
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function showTip(m, x, y) {
    if (m === S.hover && !tip.hidden) return;
    S.hover = m;
    clear(tip);
    if (!m) {
      tip.hidden = true;
      draw();
      return;
    }
    for (const n of markerTip(doc, S.lang, m)) tip.appendChild(n);
    tip.hidden = false;
    if (tip.style) {
      const left = Math.max(8, Math.min(S.width - 220, x + 14));
      tip.style.left = left + "px";
      tip.style.top = Math.max(8, y - 12) + "px";
    }
    draw();
  }

  function hoverAt(x, y) {
    showTip(hitMarker(frameState(), cutAxis(), x, y), x, y);
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (canvas.setPointerCapture) {
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* egal */
      }
    }
    const p = local(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 1) drag = { x: p.x, y: p.y, moved: false, pinch: null };
    else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      drag = { moved: true, pinch: { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 } };
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    const p = local(e);
    if (!pointers.has(e.pointerId)) {
      if (e.pointerType !== "touch") hoverAt(p.x, p.y);
      return;
    }
    pointers.set(e.pointerId, p);
    if (!drag) return;
    if (drag.pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const st = frameState();
      S.view = panBy({ ...st, view: zoomAt(st, d / drag.pinch.d, mx, my) }, mx - drag.pinch.mx, my - drag.pinch.my);
      drag.pinch = { d, mx, my };
      draw();
      return;
    }
    const dx = p.x - drag.x, dy = p.y - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_START) return;
    drag.moved = true;
    S.view = panBy(frameState(), dx, dy);
    drag.x = p.x;
    drag.y = p.y;
    if (!tip.hidden) showTip(null);
    draw();
  });
  const endPointer = (e) => {
    const p = local(e);
    const wasTap = drag && !drag.moved && pointers.size === 1;
    pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      if (wasTap) hoverAt(p.x, p.y);
      drag = null;
    } else if (pointers.size === 1) {
      const [only] = [...pointers.values()];
      drag = { x: only.x, y: only.y, moved: true, pinch: null };
    }
  };
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("pointerleave", (e) => {
    if (e.pointerType !== "touch" && !pointers.size) showTip(null);
  });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const p = local(e);
    S.view = zoomAt(frameState(), e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, p.x, p.y);
    if (!tip.hidden) showTip(null);
    draw();
  }, { passive: false });
  canvas.addEventListener("dblclick", () => {
    resetView();
    draw();
  });
  canvas.addEventListener("keydown", (e) => {
    const step = 60;
    let handled = true;
    if (e.key === "+" || e.key === "=") zoomCenter(ZOOM_STEP);
    else if (e.key === "-" || e.key === "_") zoomCenter(1 / ZOOM_STEP);
    else if (e.key === "0") {
      resetView();
      draw();
    } else if (e.key === "ArrowLeft") S.view = panBy(frameState(), step, 0);
    else if (e.key === "ArrowRight") S.view = panBy(frameState(), -step, 0);
    else if (e.key === "ArrowUp") S.view = panBy(frameState(), 0, step);
    else if (e.key === "ArrowDown") S.view = panBy(frameState(), 0, -step);
    else if (e.key === " ") playBtn.click();
    else handled = false;
    if (handled) {
      if (e.preventDefault) e.preventDefault();
      draw();
    }
  });

  let resizeObs = null;
  if (typeof win.ResizeObserver === "function") {
    resizeObs = new win.ResizeObserver(() => {
      if (measure()) {
        S.view = clampView(S.view);
        draw();
      }
    });
    resizeObs.observe(frame);
  }
  const onTheme = () => draw();
  if (darkQuery && darkQuery.addEventListener) darkQuery.addEventListener("change", onTheme);

  // ---------------------------------------------------------------- Aufbau
  if (!hasTrail) {
    setText(doc, title, t(lang, "journeyTitle"));
    setText(doc, emptyMsg, t(lang, "jNoTrail", safeText(journal && journal.name, 40)));
    root.appendChild(el(doc, "div", "journey-head", title));
    root.appendChild(emptyMsg);
  } else {
    root.appendChild(head);
    root.appendChild(chapterBar);
    root.appendChild(frame);
    if (!ctx) frame.appendChild(el(doc, "p", "map-note", t(lang, "jNoCanvas")));
    root.appendChild(playback);
    root.appendChild(legend);
    root.appendChild(notes);
    buildControls();
    syncMap();
    buildControls(); // Kartenname im aria-label
    if (typeof win.requestAnimationFrame === "function") win.requestAnimationFrame(() => draw());
  }

  return {
    element: root,
    state: S,
    data,
    setLang(l) {
      if (l === S.lang) return;
      S.lang = l;
      if (!hasTrail) {
        setText(doc, title, t(l, "journeyTitle"));
        setText(doc, emptyMsg, t(l, "jNoTrail", safeText(journal && journal.name, 40)));
        return;
      }
      buildControls();
      imageFor(S.map); // Kartenbild in der neuen Sprache (Ortsnamen im Bild)
      draw();
      if (!tip.hidden && S.hover) {
        const m = S.hover;
        S.hover = null;
        showTip(m, 0, 0);
      }
    },
    shown() {
      S.width = 0;
      if (typeof win.requestAnimationFrame === "function") win.requestAnimationFrame(() => draw());
      else draw();
    },
    pause() {
      PB.pause(S.pb);
      updateInfo();
    },
    destroy() {
      S.destroyed = true;
      PB.pause(S.pb);
      if (S.raf && win.cancelAnimationFrame) win.cancelAnimationFrame(S.raf);
      if (resizeObs) resizeObs.disconnect();
      if (darkQuery && darkQuery.removeEventListener) darkQuery.removeEventListener("change", onTheme);
    },
  };
}
