// Kern der GIF-Kodierung ohne Worker-Bindung (testbar in Node): Palette auf 256 Einträge auffüllen (Index 255 bleibt der
// durchsichtigen Farbe vorbehalten) und ein Bild als Differenz zum Vorbild schreiben.
export const TRANSPARENT = 255;

export function padPalette(palette) {
  const out = palette.slice(0, 255).map((c) => [c[0], c[1], c[2]]);
  while (out.length < 256) out.push([255, 0, 255]);
  return out;
}

// index: Farbindizes des Bildes (0..254), prev: Indizes des Vorbilds oder null. -> index (wird das nächste prev)
export function encodeGifFrame(enc, index, prev, { width, height, delay, palette }) {
  if (!prev) {
    enc.writeFrame(index, width, height, { palette, delay, repeat: 0, dispose: 1 });
    return index;
  }
  const diff = new Uint8Array(index.length);
  for (let i = 0; i < index.length; i++) diff[i] = index[i] === prev[i] ? TRANSPARENT : index[i];
  enc.writeFrame(diff, width, height, { delay, transparent: true, transparentIndex: TRANSPARENT, dispose: 1 });
  return index;
}
