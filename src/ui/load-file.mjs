// Datei-Eingang: prüft, was der Nutzer ablegt oder auswählt, bevor ein Byte gedeutet wird, und macht aus Fehlern
// verständliche Meldungen. Liest nur lokal (File API), nichts wird gesendet. Keine DOM-Abhängigkeit (testbar).
// Tiefenlimit: der Parser (core/lua-parse) bricht ab 100 Tabellenebenen ab; das kommt hier als "notLua" an.
import { openFile, ExportError } from "../core/journal-model.mjs";
import { safeText } from "./safe-text.mjs";

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const BINARY_SNIFF_BYTES = 8192;
// erlaubte MIME-Typen; Browser melden für .lua meist "" (unbekannt)
const OK_TYPES = new Set(["", "text/plain", "text/x-lua", "application/x-lua", "application/octet-stream"]);

export class LoadError extends Error {
  constructor(code, args = []) {
    super(code);
    this.name = "LoadError";
    this.code = code; // noFile | folder | notLuaFile | badType | empty | tooBig | binary | read | internal | Kern-Codes
    this.args = args;
  }
}

// Vorprüfung ohne Lesen: Name, Endung, Typ, Größe
export function checkFileMeta(file) {
  if (!file || typeof file.size !== "number" || typeof file.name !== "string") throw new LoadError("noFile");
  const name = safeText(file.name, 80);
  if (!/\.lua$/i.test(file.name)) throw new LoadError("notLuaFile", [name]);
  const type = String(file.type || "").toLowerCase();
  if (!OK_TYPES.has(type)) throw new LoadError("badType", [safeText(type, 40)]);
  if (file.size === 0) throw new LoadError("empty");
  if (file.size > MAX_FILE_BYTES) throw new LoadError("tooBig", [Math.floor(MAX_FILE_BYTES / (1024 * 1024))]);
}

// Datei -> { name, db, characters, language, schemaWarning }; wirft LoadError (nie etwas anderes)
export async function loadSvFile(file) {
  checkFileMeta(file);
  let text;
  try {
    text = await file.text();
  } catch {
    throw new LoadError("read");
  }
  if (text.slice(0, BINARY_SNIFF_BYTES).includes("\u0000")) throw new LoadError("binary");
  try {
    const opened = openFile(text);
    return { name: safeText(file.name, 80), ...opened };
  } catch (e) {
    throw toLoadError(e);
  }
}

export function toLoadError(e) {
  if (e instanceof LoadError) return e;
  if (e instanceof ExportError) {
    const line = e.detail && e.detail.line ? e.detail.line : "?";
    switch (e.code) {
      case "empty": return new LoadError("empty");
      case "tooBig": return new LoadError("tooBig", [Math.floor(MAX_FILE_BYTES / (1024 * 1024))]);
      case "notLua": return new LoadError("notLua", [line]);
      case "noData": return new LoadError("noData");
      case "noChars": return new LoadError("noChars");
      case "unknownChar": return new LoadError("unknownChar");
      default: return new LoadError("read");
    }
  }
  return new LoadError("internal", [safeText(String((e && e.message) || e), 120)]);
}

// Fehler -> { key, args } für t(lang, key, ...args)
export function errorMessage(e) {
  const le = toLoadError(e);
  const map = {
    noFile: "errNoFile",
    folder: "errFolder",
    notLuaFile: "errNotLuaFile",
    badType: "errBadType",
    empty: "errEmpty",
    tooBig: "errTooBigWeb",
    binary: "errBinary",
    notLua: "errNotLua",
    noData: "errNoData",
    noChars: "errNoChars",
    unknownChar: "errUnknownChar",
    read: "errRead",
    internal: "errInternal",
  };
  return { key: map[le.code] || "errRead", args: le.args };
}
