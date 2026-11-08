// Video der Reise: MP4/H.264 über WebCodecs mit Mediabunny (Bild für Bild, unabhängig von Echtzeit). Vorher prüft
// probeH264 die Unterstützung (VideoEncoder.isConfigSupported) UND kodiert ein Probe-Bild, weil isConfigSupported allein
// in manchen Browsern (Firefox unter Windows) nicht verlässlich ist. Rückfall ohne H.264: MediaRecorder (WebM, Echtzeit).
// Alles lokal, keine Netzwerkanfragen; Mediabunny ist im Bundle (MPL-2.0, unverändert).
import { Output, Mp4OutputFormat, BufferTarget, CanvasSource, Quality } from "mediabunny";
import { LIMIT_BYTES, videoBitrate, retryBitrate } from "./limits.mjs";

// H.264-Profile in der Reihenfolge der Versuche (High, Main, Baseline; Level 4.0 reicht für 1080×1080 bei 30 Bildern/s)
export const AVC_CODECS = Object.freeze(["avc1.640028", "avc1.4d0028", "avc1.42e028"]);

export class AbortedError extends Error {
  constructor() {
    super("aborted");
    this.name = "AbortError";
  }
}

const throwIfAborted = (signal) => {
  if (signal && signal.aborted) throw new AbortedError();
};

function probeCanvas(win, size) {
  if (typeof win.OffscreenCanvas === "function") return new win.OffscreenCanvas(size, size);
  const c = win.document.createElement("canvas");
  c.width = size;
  c.height = size;
  return c;
}

// -> { ok: true, codec } | { ok: false, reason: "noWebCodecs" | "noH264" }
export async function probeH264(win, { size, fps, bitrate }) {
  const VE = win.VideoEncoder, VF = win.VideoFrame;
  if (typeof VE !== "function" || typeof VF !== "function" || typeof VE.isConfigSupported !== "function") return { ok: false, reason: "noWebCodecs" };
  for (const codec of AVC_CODECS) {
    const config = { codec, width: size, height: size, bitrate, framerate: fps, avc: { format: "avc" } };
    try {
      const sup = await VE.isConfigSupported(config);
      if (!sup || !sup.supported) continue;
      let chunks = 0, failed = null;
      const enc = new VE({ output: () => chunks++, error: (e) => (failed = e) });
      enc.configure(config);
      const canvas = probeCanvas(win, size);
      const c2 = canvas.getContext("2d");
      c2.fillStyle = "#f3e6c6";
      c2.fillRect(0, 0, size, size);
      const frame = new VF(canvas, { timestamp: 0 });
      enc.encode(frame, { keyFrame: true });
      frame.close();
      await enc.flush();
      if (enc.state !== "closed") enc.close();
      if (!failed && chunks > 0) return { ok: true, codec };
    } catch {
      /* nächstes Profil */
    }
  }
  return { ok: false, reason: "noH264" };
}

// ein Durchlauf mit fester Bitrate -> Blob (video/mp4)
async function encodeOnce({ canvas, frames, fps, render, codec, bitrate, signal, onProgress }) {
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
  const source = new CanvasSource(canvas, {
    codec: "avc",
    fullCodecString: codec,
    quality: new Quality({ bitrate, bitrateMode: "variable" }),
    keyFrameInterval: 2,
    latencyMode: "quality",
  });
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();
  try {
    for (let i = 0; i < frames; i++) {
      throwIfAborted(signal);
      render(i);
      await source.add(i / fps, 1 / fps);
      if (onProgress) onProgress(i + 1, frames);
    }
    throwIfAborted(signal);
    await output.finalize();
  } catch (e) {
    try {
      await output.cancel();
    } catch {
      /* schon zu */
    }
    throw e;
  }
  return new Blob([output.target.buffer], { type: "video/mp4" });
}

// MP4 erzeugen; ist das Ergebnis trotz Bitratenwahl zu groß, ein zweiter Durchlauf mit kleinerer Bitrate.
// -> { blob, bitrate, attempts }
export async function encodeMp4({ canvas, frames, fps, render, codec, limitBytes = LIMIT_BYTES, signal, onProgress, onRetry }) {
  let bitrate = videoBitrate(frames / fps, limitBytes);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const blob = await encodeOnce({ canvas, frames, fps, render, codec, bitrate, signal, onProgress });
    if (blob.size <= limitBytes) return { blob, bitrate, attempts: attempt };
    bitrate = retryBitrate(bitrate, blob.size, limitBytes);
    if (onRetry) onRetry(bitrate);
  }
  throw Object.assign(new Error("tooBig"), { code: "tooBig" });
}

// Rückfall: MediaRecorder auf einem Canvas-Element (Echtzeit). -> { blob, mime } oder null, wenn nicht möglich
export function recorderMime(win) {
  const MR = win.MediaRecorder;
  if (typeof MR !== "function" || typeof MR.isTypeSupported !== "function") return null;
  for (const m of ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]) if (MR.isTypeSupported(m)) return m;
  return null;
}

export async function recordWebm(win, { canvas, frames, fps, render, limitBytes = LIMIT_BYTES, signal, onProgress }) {
  const mime = recorderMime(win);
  if (!mime || typeof canvas.captureStream !== "function") return null;
  const stream = canvas.captureStream(fps);
  const rec = new win.MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: videoBitrate(frames / fps, limitBytes) });
  const parts = [];
  rec.addEventListener("dataavailable", (e) => {
    if (e.data && e.data.size) parts.push(e.data);
  });
  const stopped = new Promise((resolve) => rec.addEventListener("stop", resolve, { once: true }));
  render(0);
  rec.start(1000);
  const t0 = win.performance.now();
  try {
    for (let i = 0; i < frames; i++) {
      throwIfAborted(signal);
      render(i);
      if (onProgress) onProgress(i + 1, frames);
      const wait = t0 + ((i + 1) * 1000) / fps - win.performance.now();
      if (wait > 0) await new Promise((r) => win.setTimeout(r, wait));
    }
  } finally {
    if (rec.state !== "inactive") rec.stop();
    await stopped;
    for (const tr of stream.getTracks()) tr.stop();
  }
  throwIfAborted(signal);
  return { blob: new Blob(parts, { type: "video/webm" }), mime };
}
