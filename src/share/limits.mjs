// Größengrenzen und Rechnungen fürs Teilen (reine Funktionen, ohne Browser testbar).

export const LIMIT_BYTES = 15 * 1000 * 1000; // Ziel: Datei kleiner als 15 MB (Reddit/Discord/X nehmen das sicher an)
export const BITRATE_HEADROOM = 0.8; // Puffer für Schwankungen des Encoders und den MP4-Rahmen
export const BITRATE_MIN = 500_000;
export const BITRATE_MAX = 8_000_000; // darüber gewinnt eine 1080er-Kartenanimation nichts mehr

// Videobitrate (bit/s), mit der eine Datei der Dauer durationSec unter limitBytes bleibt
export function videoBitrate(durationSec, limitBytes = LIMIT_BYTES, { headroom = BITRATE_HEADROOM, min = BITRATE_MIN, max = BITRATE_MAX } = {}) {
  if (!(durationSec > 0) || !(limitBytes > 0)) return min;
  const raw = Math.floor((limitBytes * 8 * headroom) / durationSec);
  return Math.max(min, Math.min(max, raw));
}

// neue Bitrate nach einem zu großen Ergebnis (size Bytes bei bitrate): proportional herunter, mit weiterem Puffer
export function retryBitrate(bitrate, size, limitBytes = LIMIT_BYTES, { min = BITRATE_MIN } = {}) {
  if (!(size > 0)) return bitrate;
  return Math.max(min, Math.floor(bitrate * (limitBytes / size) * 0.85));
}

// Hochrechnung während der Erzeugung: wird die Datei bei diesem Stand die Grenze reißen? (erst ab 15 % der Bilder)
export function projectedTooBig(bytesSoFar, done, total, limitBytes = LIMIT_BYTES) {
  if (!(done > 0) || !(total > 0) || done / total < 0.15) return false;
  return (bytesSoFar / done) * total > limitBytes;
}

// Größe lesbar: "840 KB", "4,2 MB" (de) bzw. "4.2 MB" (en)
export function formatBytes(lang, n) {
  if (!Number.isFinite(n) || n < 0) return "–";
  const loc = lang === "en" ? "en-GB" : "de-DE";
  if (n < 1000 * 1000) return new Intl.NumberFormat(loc, { maximumFractionDigits: 0 }).format(Math.max(1, Math.round(n / 1000))) + " KB";
  return new Intl.NumberFormat(loc, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n / 1e6) + " MB";
}
