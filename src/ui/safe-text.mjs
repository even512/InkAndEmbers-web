// Text aus der Datei für die Anzeige: Steuerzeichen, Bidi-Marken/-Überschreibungen/-Isolate (U+061C, U+200E/F,
// U+202A–E, U+2066–9), Zero-Width- und unsichtbare Formatzeichen (U+180E, U+200B–F, U+2060–206F, U+FEFF, Tag-Zeichen
// U+E0000–E007F) und Zeilen-/Absatztrenner (U+2028/9) werden entfernt, die Länge begrenzt. Das Ergebnis geht immer nur
// als Textknoten oder ins Canvas hinaus, nie als HTML.

// Bereiche als Zahlen (keine Sonderzeichen im Quelltext)
export const STRIP_RANGES = Object.freeze([
  [0x0000, 0x0008], [0x000b, 0x001f], [0x007f, 0x009f], // Steuerzeichen (Tab und Zeilenumbruch bleiben)
  [0x061c, 0x061c], // Arabic Letter Mark
  [0x180e, 0x180e], // Mongolian Vowel Separator
  [0x200b, 0x200f], // Zero-Width, LRM, RLM
  [0x2028, 0x202e], // Zeilen-/Absatztrenner, Bidi-Einbettungen/-Überschreibungen
  [0x2060, 0x206f], // Word Joiner, unsichtbare Operatoren, Bidi-Isolate, veraltete Formatzeichen (U+206A–F)
  [0xfeff, 0xfeff], // BOM / Zero-Width No-Break Space
  [0xe0000, 0xe007f], // Tag-Zeichen (unsichtbar)
]);

const hex = (n) => "\\u{" + n.toString(16) + "}";
export const STRIP = new RegExp("[" + STRIP_RANGES.map(([a, b]) => (a === b ? hex(a) : hex(a) + "-" + hex(b))).join("") + "]", "gu");

export function safeText(s, max = 120) {
  if (typeof s !== "string") return "";
  const out = s.replace(STRIP, "");
  return out.length > max ? out.slice(0, max - 1) + "…" : out;
}
