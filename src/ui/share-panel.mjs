// Teilen-Panel am Reise-Reiter: Ausschnitt (aktuelle Zone / Kontinent / ganze Reise), Zeitraum (ganze Reise oder ein
// Kapitel), Schalter „Andere Spieler ausblenden“, Knöpfe Video (MP4) / GIF / Bild (PNG), Fortschritt mit Abbrechen,
// danach Vorschau, Größe, „Teilen …“ (Web Share API, wo möglich) und immer „Herunterladen“.
// Sicherheit: Texte nur als Textknoten; Kartenbilder nur aus maps/ der eigenen Seite; das Ergebnis bleibt im Browser
// (Objekt-URL für Vorschau und Download, media-src/img-src blob: laut CSP). Anonymisierung im Modell vor dem Zeichnen.
import { buildJournal } from "../core/journal-model.mjs";
import { el } from "../core/render.mjs";
import { displayMap } from "../geo/map-geo.mjs";
import { anonymizeForExport, scrubJourney } from "../share/anonymize.mjs";
import { planTimeline, createFrameJob, renderFrame, fileName, VIDEO, GIF, SCOPES } from "../share/frames.mjs";
import { LIMIT_BYTES, videoBitrate, formatBytes } from "../share/limits.mjs";
import { probeH264, encodeMp4, recordWebm, recorderMime } from "../share/video-mp4.mjs";
import { encodeGifAt } from "../share/gif.mjs";
import { encodePng, PNG_SIZE } from "../share/png.mjs";
import { makeCanvas, makeFile, canShareFile, shareFile, downloadBlob } from "../share/share.mjs";
import { st } from "../share/share-texts.mjs";
import { safeText } from "./safe-text.mjs";

const SCOPE_KEYS = { zone: "shScopeZone", continent: "shScopeContinent", trip: "shScopeTrip" };

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function setText(doc, node, s) {
  clear(node);
  node.appendChild(doc.createTextNode(String(s)));
}

// Daten für die Erzeugung: ohne Schalter die Reise der Seite, mit Schalter neu aus dem anonymisierten Charakter
export function shareData({ data, char, lang, anonymize, prepareJourney }) {
  if (!anonymize) return { data, anon: null };
  const a = anonymizeForExport({ char, lang, buildJournal });
  return { data: scrubJourney(prepareJourney(a.journal, a.char), a.anon), anon: a.anon };
}

// Kartenbild laden (nur wenn die Karte laut Index Kunst hat); fehlt es, zeichnet der Renderer den Pergament-Rückfall
function loadImage(win, urls) {
  return new Promise((resolve) => {
    if (typeof win.Image !== "function" || !urls.length) return resolve(null);
    const attempt = (i) => {
      if (i >= urls.length) return resolve(null);
      const img = new win.Image();
      img.decoding = "async";
      img.addEventListener("load", () => (img.naturalWidth > 0 ? resolve(img) : attempt(i + 1)));
      img.addEventListener("error", () => attempt(i + 1));
      img.src = urls[i];
    };
    attempt(0);
  });
}

async function loadFonts(doc) {
  if (!doc.fonts || typeof doc.fonts.load !== "function") return;
  try {
    await Promise.all(["700 36px Caveat", "18px Spectral", "italic 600 17px Spectral", "700 11px Spectral"].map((f) => doc.fonts.load(f)));
  } catch {
    /* Ersatzschrift */
  }
}

const nextFrame = (win) => new Promise((r) => (typeof win.requestAnimationFrame === "function" ? win.requestAnimationFrame(() => r()) : win.setTimeout(r, 0)));

// opts: { journal, char, lang, data, prepareJourney, imageUrls(mapID, lang) -> [url], getContext() -> { mode, chapter, mapID } }
export function createSharePanel(doc, win, opts) {
  const S = { lang: opts.lang, scope: "zone", range: -1, anon: false, busy: null, result: null, url: null, notice: null };
  const data = opts.data;
  const tl = data.trail.timeline;
  const hasTrail = data.trail.segments.length > 0;

  const root = el(doc, "section", "share-panel");
  const title = el(doc, "h3", "share-title");
  const lead = el(doc, "p", "share-lead");
  const scopeBar = el(doc, "div", "seg share-scope");
  scopeBar.setAttribute("role", "group");
  const rangeLabel = el(doc, "label", "share-range-label");
  const rangeSel = doc.createElement("select");
  rangeSel.className = "share-range";
  const rangeText = el(doc, "span", "share-label");
  rangeLabel.appendChild(rangeText);
  rangeLabel.appendChild(rangeSel);
  const anonBox = doc.createElement("input");
  anonBox.type = "checkbox";
  anonBox.className = "share-anon";
  const anonText = el(doc, "span", "share-label");
  const anonLabel = el(doc, "label", "share-anon-label", anonBox, anonText);
  const anonHint = el(doc, "p", "share-hint");
  const options = el(doc, "div", "share-options", scopeBar, rangeLabel, anonLabel);
  const btnVideo = el(doc, "button", "btn primary share-btn");
  const btnGif = el(doc, "button", "btn share-btn");
  const btnPng = el(doc, "button", "btn share-btn");
  for (const b of [btnVideo, btnGif, btnPng]) b.type = "button";
  const actions = el(doc, "div", "share-actions", btnVideo, btnGif, btnPng);
  const progress = doc.createElement("progress");
  progress.className = "share-progress";
  progress.max = 1;
  progress.value = 0;
  const status = el(doc, "p", "share-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const cancelBtn = el(doc, "button", "btn share-cancel");
  cancelBtn.type = "button";
  const busyRow = el(doc, "div", "share-busy", progress, cancelBtn);
  busyRow.hidden = true;
  const notice = el(doc, "p", "notice share-notice");
  notice.hidden = true;
  const preview = el(doc, "div", "share-preview");
  const shareBtn = el(doc, "button", "btn primary share-send");
  const dlBtn = el(doc, "button", "btn share-download");
  shareBtn.type = "button";
  dlBtn.type = "button";
  const resultRow = el(doc, "div", "share-result", shareBtn, dlBtn);
  resultRow.hidden = true;
  root.appendChild(title);
  root.appendChild(lead);
  if (hasTrail) {
    root.appendChild(options);
    root.appendChild(anonHint);
    root.appendChild(actions);
    root.appendChild(busyRow);
    root.appendChild(status);
    root.appendChild(notice);
    root.appendChild(preview);
    root.appendChild(resultRow);
  }

  function showNotice(key, ...args) {
    S.notice = key ? [key, args] : null;
    notice.hidden = !key;
    if (key) setText(doc, notice, st(S.lang, key, ...args));
  }

  function build() {
    const L = S.lang;
    setText(doc, title, st(L, "shTitle"));
    setText(doc, lead, hasTrail ? st(L, "shLead") : st(L, "shNoTrail"));
    clear(scopeBar);
    scopeBar.setAttribute("aria-label", st(L, "shScope"));
    for (const sc of SCOPES) {
      const b = el(doc, "button", "seg-btn" + (S.scope === sc ? " active" : ""), st(L, SCOPE_KEYS[sc]));
      b.type = "button";
      b.setAttribute("aria-pressed", S.scope === sc ? "true" : "false");
      b.addEventListener("click", () => {
        S.scope = sc;
        build();
      });
      scopeBar.appendChild(b);
    }
    setText(doc, rangeText, st(L, "shRange"));
    clear(rangeSel);
    const opt = (value, label) => {
      const o = el(doc, "option", null, label);
      o.value = String(value);
      if (value === S.range) o.selected = true;
      rangeSel.appendChild(o);
    };
    opt(-1, st(L, "shRangeAll"));
    data.chapters.forEach((c, i) => opt(i, st(L, "shRangeChapter", c.n, safeText(c.name || "", 60))));
    rangeSel.value = String(S.range);
    setText(doc, anonText, st(L, "shAnon"));
    anonBox.checked = S.anon;
    setText(doc, anonHint, st(L, "shAnonHint"));
    anonHint.hidden = !S.anon;
    setText(doc, btnVideo, st(L, "shVideo"));
    setText(doc, btnGif, st(L, "shGif"));
    setText(doc, btnPng, st(L, "shPng"));
    setText(doc, cancelBtn, st(L, "shCancel"));
    setText(doc, shareBtn, st(L, "shShare"));
    setText(doc, dlBtn, st(L, "shDownload"));
    if (S.notice) showNotice(S.notice[0], ...S.notice[1]);
    for (const b of [btnVideo, btnGif, btnPng]) b.disabled = Boolean(S.busy);
  }

  rangeSel.addEventListener("change", () => {
    const v = Number(rangeSel.value);
    S.range = Number.isInteger(v) && v >= -1 && v < data.chapters.length ? v : -1;
  });
  anonBox.addEventListener("change", () => {
    S.anon = Boolean(anonBox.checked);
    anonHint.hidden = !S.anon;
  });

  function setBusy(ctrl) {
    S.busy = ctrl;
    busyRow.hidden = !ctrl;
    for (const b of [btnVideo, btnGif, btnPng]) b.disabled = Boolean(ctrl);
  }

  function progressTo(label, i, n) {
    progress.max = n;
    progress.value = i;
    if (i === 1 || i === n || i % 10 === 0) setText(doc, status, st(S.lang, "shRendering", label, i, n));
  }

  function clearResult() {
    if (S.url) win.URL.revokeObjectURL(S.url);
    S.url = null;
    S.result = null;
    clear(preview);
    resultRow.hidden = true;
  }

  function showResult(res) {
    clearResult();
    S.result = res;
    if (win.URL && typeof win.URL.createObjectURL === "function") {
      S.url = win.URL.createObjectURL(res.blob);
      let media;
      if (res.kind === "video") {
        media = doc.createElement("video");
        media.controls = true;
        media.muted = true;
        media.loop = true;
        media.playsInline = true;
      } else {
        media = doc.createElement("img");
        media.alt = st(S.lang, "shPreview");
      }
      media.className = "share-media";
      media.src = S.url;
      preview.appendChild(media);
    }
    const size = formatBytes(S.lang, res.blob.size);
    setText(doc, status, res.kind === "video"
      ? st(S.lang, "shDoneVideo", res.label, res.size, res.size, Math.round(res.duration * 10) / 10, size)
      : st(S.lang, "shDone", res.label, res.size, res.size, size));
    res.file = makeFile(win, res.blob, res.name);
    shareBtn.hidden = !canShareFile(win.navigator, res.file);
    resultRow.hidden = false;
  }

  shareBtn.addEventListener("click", async () => {
    if (!S.result || !S.result.file) return;
    const r = await shareFile(win.navigator, S.result.file, st(S.lang, "shJourney"));
    if (r === "failed") showNotice("shShareFailed");
  });
  dlBtn.addEventListener("click", () => {
    if (S.result) downloadBlob(doc, win, S.result.blob, S.result.name);
  });
  cancelBtn.addEventListener("click", () => {
    if (S.busy) S.busy.abort();
  });

  // Auftrag für Ausschnitt/Zeitraum/Schalter vorbereiten (Daten, Zeitplan, Bilder, Schriften)
  async function prepare(kind) {
    const ctx = opts.getContext ? opts.getContext() : {};
    const { data: d, anon } = shareData({ data, char: opts.char, lang: S.lang, anonymize: S.anon, prepareJourney: opts.prepareJourney });
    const ch = S.range >= 0 ? d.chapters[S.range] : null;
    const range = ch ? { p0: ch.a0, p1: Math.max(ch.a1, ch.a0) } : { p0: 0, p1: tl.length };
    const base = ch && ch.mapID ? ch.mapID : ctx.mapID || null;
    const cfg = kind === "gif" ? GIF : VIDEO;
    const plan = planTimeline(range.p0, range.p1, { ...cfg, axisLength: tl.length });
    const images = new Map();
    const lang = S.lang;
    const job0 = createFrameJob({ data: d, scope: S.scope, range, images, plan, info: { charName: opts.journal && opts.journal.name, lang }, anon, baseMapID: base });
    await Promise.all(job0.mapIDs().map(async (id) => {
      const m = displayMap(id);
      images.set(id, m && m.art && m.mapID === id ? await loadImage(win, opts.imageUrls(id, lang)) : null);
    }));
    await loadFonts(doc);
    const name = (ext) => fileName({ charName: opts.journal && opts.journal.name, scope: S.scope, epoch: job0.endEpoch, ext });
    return { job: job0, plan, name };
  }

  async function makeVideo(job, plan, name, signal) {
    const size = VIDEO.size;
    setText(doc, status, st(S.lang, "shProbe"));
    const probe = await probeH264(win, { size, fps: plan.fps, bitrate: videoBitrate(plan.duration) });
    const label = st(S.lang, "shVideo");
    if (probe.ok) {
      const canvas = makeCanvas(doc, win, size);
      const c2 = canvas.getContext("2d");
      const { blob } = await encodeMp4({
        canvas, frames: plan.frames, fps: plan.fps, codec: probe.codec, signal,
        render: (i) => renderFrame(c2, job, i, size),
        onProgress: (i, n) => progressTo(label, i, n),
        onRetry: () => setText(doc, status, st(S.lang, "shRetry", label)),
      });
      return { kind: "video", blob, label, size, duration: plan.duration, name: name("mp4") };
    }
    if (recorderMime(win)) {
      showNotice("shNoWebCodecs");
      const wl = st(S.lang, "shFormatWebm");
      const canvas = makeCanvas(doc, win, size, { element: true });
      const c2 = canvas.getContext("2d");
      const r = await recordWebm(win, { canvas, frames: plan.frames, fps: plan.fps, signal, render: (i) => renderFrame(c2, job, i, size), onProgress: (i, n) => progressTo(wl, i, n) });
      if (r) return { kind: "video", blob: r.blob, label: wl, size, duration: plan.duration, name: name("webm") };
    }
    showNotice("shNoVideo");
    return null;
  }

  async function makeGif(job, plan, name, signal) {
    const label = st(S.lang, "shGif");
    for (const size of GIF.sizes) {
      const canvas = makeCanvas(doc, win, size);
      const c2 = canvas.getContext("2d", { willReadFrequently: true });
      const blob = await encodeGifAt(win, {
        size, frames: plan.frames, fps: plan.fps, signal,
        renderPixels: (i) => {
          renderFrame(c2, job, i, size);
          return c2.getImageData(0, 0, size, size).data;
        },
        onProgress: (i, n) => progressTo(label, i, n),
      });
      if (blob) return { kind: "gif", blob, label, size, name: name("gif") };
      setText(doc, status, st(S.lang, "shRetry", size + " px"));
    }
    showNotice("shTooBig", formatBytes(S.lang, LIMIT_BYTES));
    return null;
  }

  async function makePng(job, name) {
    const canvas = makeCanvas(doc, win, PNG_SIZE);
    const blob = await encodePng(canvas, job, PNG_SIZE);
    return { kind: "png", blob, label: st(S.lang, "shPng"), size: PNG_SIZE, name: name("png") };
  }

  async function run(kind) {
    if (S.busy) return showNotice("shBusy");
    if (!hasTrail) return;
    const ctrl = typeof win.AbortController === "function" ? new win.AbortController() : { signal: null, abort() {} };
    clearResult();
    showNotice(null);
    setBusy(ctrl);
    setText(doc, status, st(S.lang, "shPrepare"));
    try {
      await nextFrame(win);
      const { job, plan, name } = await prepare(kind);
      let res = null;
      if (kind === "video") res = await makeVideo(job, plan, name, ctrl.signal);
      else if (kind === "gif") res = await makeGif(job, plan, name, ctrl.signal);
      else res = await makePng(job, name);
      if (res) showResult(res);
      else setText(doc, status, "");
    } catch (e) {
      if (e && e.name === "AbortError") setText(doc, status, st(S.lang, "shCancelled"));
      else if (e && e.code === "noWorker") showNotice("shNoWorker");
      else if (e && e.code === "tooBig") showNotice("shTooBig", formatBytes(S.lang, LIMIT_BYTES));
      else setText(doc, status, st(S.lang, "shFailed", safeText(String((e && e.message) || e), 120)));
    } finally {
      setBusy(null);
    }
  }

  btnVideo.addEventListener("click", () => run("video"));
  btnGif.addEventListener("click", () => run("gif"));
  btnPng.addEventListener("click", () => run("png"));

  // Zeitraum anfangs wie das Kapitel der Reise-Ansicht
  const ctx0 = opts.getContext ? opts.getContext() : {};
  if (Number.isInteger(ctx0.chapter) && ctx0.chapter >= 0 && ctx0.chapter < data.chapters.length) S.range = ctx0.chapter;
  build();

  return {
    element: root,
    state: S,
    run,
    setLang(l) {
      if (l === S.lang) return;
      S.lang = l;
      build();
    },
    // Kapitelwahl der Reise übernehmen, solange nichts erzeugt wird
    syncChapter(i) {
      if (S.busy) return;
      S.range = Number.isInteger(i) && i >= 0 && i < data.chapters.length ? i : -1;
      rangeSel.value = String(S.range);
    },
    destroy() {
      if (S.busy) S.busy.abort();
      clearResult();
    },
  };
}
