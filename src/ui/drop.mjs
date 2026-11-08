// Ablegen per Drag & Drop: aus dem DataTransfer genau eine Datei wählen (nie einen Ordner, nie Text).
// pickDroppedFile liefert { file, count } oder wirft LoadError("noFile" | "folder").
import { LoadError } from "./load-file.mjs";

export function hasFiles(dt) {
  if (!dt) return false;
  const types = dt.types ? Array.from(dt.types) : [];
  return types.includes("Files");
}

function isDirectoryItem(item) {
  try {
    const entry = item && typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null;
    return !!(entry && entry.isDirectory);
  } catch {
    return false;
  }
}

export function pickDroppedFile(dt) {
  if (!dt) throw new LoadError("noFile");
  const items = dt.items ? Array.from(dt.items).filter((i) => i && i.kind === "file") : [];
  if (items.length > 0 && items.every(isDirectoryItem)) throw new LoadError("folder");
  const files = dt.files ? Array.from(dt.files) : [];
  if (files.length === 0) throw new LoadError("noFile");
  const lua = files.find((f) => f && typeof f.name === "string" && /\.lua$/i.test(f.name));
  return { file: lua || files[0], count: files.length };
}
