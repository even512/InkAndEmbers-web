// GIF der Reise: Bilder entstehen im Hauptthread (OffscreenCanvas, gleiche Zeichenroutine wie das Video), kodiert wird
// im Web Worker (gif.worker.mjs, gleiche Herkunft, worker-src 'self'). Wird die Datei absehbar größer als die Grenze,
// beginnt die Erzeugung mit kleinerer Kantenlänge neu (GIF.sizes).
import { LIMIT_BYTES, projectedTooBig } from "./limits.mjs";
import { AbortedError } from "./video-mp4.mjs";

export function createGifWorker(win) {
  if (typeof win.Worker !== "function") return null;
  // wörtlich "new Worker(new URL(...))", damit Vite den Worker als eigenes Modul bündelt (gleiche Herkunft)
  return new Worker(new URL("./gif.worker.mjs", import.meta.url), { type: "module" });
}

// Antwort des Workers abwarten (type), Fehler weiterreichen
function waitFor(worker, type, signal) {
  return new Promise((resolve, reject) => {
    const onMsg = (e) => {
      const d = e.data || {};
      if (d.type === type) done(resolve, d);
      else if (d.type === "error") done(reject, new Error(d.message || "gif"));
    };
    const onErr = (e) => done(reject, new Error((e && e.message) || "gif worker"));
    const onAbort = () => done(reject, new AbortedError());
    const done = (fn, v) => {
      worker.removeEventListener("message", onMsg);
      worker.removeEventListener("error", onErr);
      if (signal) signal.removeEventListener("abort", onAbort);
      fn(v);
    };
    worker.addEventListener("message", onMsg);
    worker.addEventListener("error", onErr);
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
  });
}

// Probebilder für die Palette: erstes, mittleres und letztes Bild nebeneinander (je volle Fläche)
function samplePixels(renderPixels, frames) {
  const idx = [...new Set([0, Math.floor(frames / 2), frames - 1])];
  const parts = idx.map((i) => renderPixels(i));
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// eine Kantenlänge versuchen. renderPixels(i) -> Uint8ClampedArray (RGBA, size×size). -> Blob oder null (zu groß)
export async function encodeGifAt(win, { size, frames, fps, renderPixels, limitBytes = LIMIT_BYTES, signal, onProgress }) {
  const worker = createGifWorker(win);
  if (!worker) throw Object.assign(new Error("noWorker"), { code: "noWorker" });
  try {
    const sample = samplePixels(renderPixels, frames);
    const ready = waitFor(worker, "ready", signal);
    worker.postMessage({ type: "start", width: size, height: size, delay: Math.round(1000 / fps), sample: sample.buffer }, [sample.buffer]);
    await ready;
    for (let i = 0; i < frames; i++) {
      if (signal && signal.aborted) throw new AbortedError();
      const px = renderPixels(i);
      const buf = px.buffer.byteLength === px.length ? px.buffer : px.slice().buffer;
      const prog = waitFor(worker, "progress", signal);
      worker.postMessage({ type: "frame", rgba: buf }, [buf]);
      const { bytes } = await prog;
      if (onProgress) onProgress(i + 1, frames);
      if (bytes > limitBytes || projectedTooBig(bytes, i + 1, frames, limitBytes)) return null;
    }
    const fin = waitFor(worker, "done", signal);
    worker.postMessage({ type: "finish" });
    const { buffer } = await fin;
    if (buffer.byteLength > limitBytes) return null;
    return new Blob([buffer], { type: "image/gif" });
  } finally {
    worker.terminate();
  }
}
