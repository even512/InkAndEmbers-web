// Text aus der Datei für die Anzeige: Steuerzeichen, Bidi-Überschreibungen/-Isolate (U+202A–E, U+2066–9), Zero-Width-Zeichen
// (U+200B–F, U+2060, U+FEFF) und Zeilen-/Absatztrenner (U+2028/9) werden entfernt, die Länge begrenzt. Das Ergebnis geht
// immer nur als Textknoten (oder später ins Canvas) hinaus, nie als HTML.

// Bereiche als Zahlen (keine Sonderzeichen im Quelltext)
const STRIP_RANGES = [
  [0x0000, 0x0008], [0x000b, 0x001f], [0x007f, 0x009f], // Steuerzeichen (Tab und Zeilenumbruch bleiben)
  [0x200b, 0x200f], // Zero-Width, LRM, RLM
  [0x2028, 0x202e], // Zeilen-/Absatztrenner, Bidi-Einbettungen/-Überschreibungen
  [0x2060, 0x2069], // Word Joiner, unsichtbare Operatoren, Bidi-Isolate
  [0xfeff, 0xfeff], // BOM / Zero-Width No-Break Space
];

const hex = (n) => "\\u" + n.toString(16).padStart(4, "0");
const STRIP = new RegExp("[" + STRIP_RANGES.map(([a, b]) => (a === b ? hex(a) : hex(a) + "-" + hex(b))).join("") + "]", "g");

export function safeText(s, max = 120) {
  if (typeof s !== "string") return "";
  const out = s.replace(STRIP, "");
  return out.length > max ? out.slice(0, max - 1) + "…" : out;
}
