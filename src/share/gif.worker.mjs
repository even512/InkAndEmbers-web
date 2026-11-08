// GIF-Encoder im Hintergrund (Web Worker, gleiche Herkunft): gifenc (MIT) quantisiert einmal eine gemeinsame Palette aus
// Probebildern und kodiert dann Bild für Bild. Unveränderte Bildpunkte gegenüber dem Vorbild werden durchsichtig (Index
// 255, Entsorgung „stehen lassen“), so bleibt die Datei klein, weil sich je Bild nur die Route verlängert.
// Nachrichten: { type: "start", width, height, delay, sample } -> { type: "ready" };
//              { type: "frame", rgba } -> { type: "progress", bytes }; { type: "finish" } -> { type: "done", buffer }
import { GIFEncoder, quantize, applyPalette } from "gifenc";
import { encodeGifFrame, padPalette } from "./gif-core.mjs";

let st = null;

self.addEventListener("message", (e) => {
  const msg = e.data || {};
  try {
    if (msg.type === "start") {
      const palette = padPalette(quantize(new Uint8Array(msg.sample), 255));
      st = { enc: GIFEncoder(), palette, prev: null, width: msg.width, height: msg.height, delay: msg.delay, n: 0 };
      self.postMessage({ type: "ready" });
    } else if (msg.type === "frame" && st) {
      const rgba = new Uint8Array(msg.rgba);
      st.prev = encodeGifFrame(st.enc, applyPalette(rgba, st.palette.slice(0, 255)), st.prev, st);
      st.n++;
      self.postMessage({ type: "progress", bytes: st.enc.bytesView().length });
    } else if (msg.type === "finish" && st) {
      st.enc.finish();
      const bytes = st.enc.bytes();
      st = null;
      self.postMessage({ type: "done", buffer: bytes.buffer }, [bytes.buffer]);
    }
  } catch (err) {
    self.postMessage({ type: "error", message: String((err && err.message) || err) });
  }
});
