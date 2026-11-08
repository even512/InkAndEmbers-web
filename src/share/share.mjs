// Ergebnis weitergeben: System-Teilen (Web Share API mit Datei, wo der Browser es kann) und immer „Herunterladen“.
// Zeichenflächen für die Erzeugung (OffscreenCanvas, sonst ein nicht eingehängtes Canvas-Element).

export function makeCanvas(doc, win, size, { element = false } = {}) {
  if (!element && typeof win.OffscreenCanvas === "function") return new win.OffscreenCanvas(size, size);
  const c = doc.createElement("canvas");
  c.width = size;
  c.height = size;
  return c;
}

export function makeFile(win, blob, name) {
  if (typeof win.File !== "function") return null;
  try {
    return new win.File([blob], name, { type: blob.type });
  } catch {
    return null;
  }
}

// Kann der Browser genau diese Datei teilen?
export function canShareFile(nav, file) {
  if (!nav || !file || typeof nav.share !== "function" || typeof nav.canShare !== "function") return false;
  try {
    return nav.canShare({ files: [file] });
  } catch {
    return false;
  }
}

// -> "shared" | "cancelled" | "failed"
export async function shareFile(nav, file, title) {
  try {
    await nav.share({ files: [file], title });
    return "shared";
  } catch (e) {
    return e && e.name === "AbortError" ? "cancelled" : "failed";
  }
}

// Download über einen Objekt-Link (nur lokal im Browser); der Link wird danach wieder freigegeben
export function downloadBlob(doc, win, blob, name) {
  const url = win.URL.createObjectURL(blob);
  const a = doc.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  a.hidden = true;
  doc.body.appendChild(a);
  a.click();
  a.remove();
  win.setTimeout(() => win.URL.revokeObjectURL(url), 60_000);
}
