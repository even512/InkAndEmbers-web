// Standbild der Reise als PNG: das letzte Bild des Auftrags (ganze Route, Einblendung, Wasserzeichen) in 1080×1080.
import { renderFrame } from "./frames.mjs";

export const PNG_SIZE = 1080;

export async function encodePng(canvas, job, size = PNG_SIZE) {
  const ctx = canvas.getContext("2d");
  renderFrame(ctx, job, job.plan.frames - 1, size);
  if (typeof canvas.convertToBlob === "function") return canvas.convertToBlob({ type: "image/png" });
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("png"))), "image/png"));
}
