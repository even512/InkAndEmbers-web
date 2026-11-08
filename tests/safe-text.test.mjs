import { describe, it, expect } from "vitest";
import { safeText } from "../src/ui/safe-text.mjs";

describe("safeText", () => {
  it("entfernt Steuerzeichen, Bidi-Zeichen, Zero-Width und Zeilentrenner", () => {
    const evil = ["a", "\u0000", "b", "\u202a", "\u202b", "\u202c", "\u202d", "\u202e", "c", "\u2066", "\u2067", "\u2068", "\u2069", "d",
      "\u200b", "\u200c", "\u200d", "\u200e", "\u200f", "\u2028", "\u2029", String.fromCharCode(0x2060),"\ufeff", "\u007f", "\u0085", "e"].join("");
    expect(safeText(evil)).toBe("abcde");
  });

  it("lässt Umlaute, Emoji und Zeilenumbruch stehen", () => {
    expect(safeText("Mädchen 🔥 – Zürich")).toBe("Mädchen 🔥 – Zürich");
    expect(safeText("a\nb")).toBe("a\nb");
  });

  it("kürzt auf die Höchstlänge und verträgt Nicht-Text", () => {
    expect(safeText("x".repeat(300), 10)).toBe("xxxxxxxxx…");
    expect(safeText(null)).toBe("");
    expect(safeText(42)).toBe("");
  });
});
