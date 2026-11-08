// Einstieg der Ansicht "Chronik & Statistik" für die App: renderChroniclePanel(doc, { db, guid, journal, lang }) -> Knoten.
// Das Modell wird je Tagebuch einmal berechnet (WeakMap); bei einem Fehler zeigt die Ansicht einen Hinweis statt eines Absturzes.
import { el } from "../core/render.mjs";
import { buildChronik } from "./model.mjs";
import { renderChronicle } from "./view.mjs";
import { ct } from "./texts.mjs";

const cache = new WeakMap();

export function chronikModel(db, guid, journal) {
  let m = cache.get(journal);
  if (!m) {
    m = buildChronik(db, guid, journal);
    cache.set(journal, m);
  }
  return m;
}

export function renderChroniclePanel(doc, { db, guid, journal, lang }) {
  try {
    return renderChronicle(doc, { model: chronikModel(db, guid, journal), journal, lang });
  } catch {
    // kein Stacktrace, keine Dateiinhalte: nur der verständliche Hinweis
    const box = el(doc, "div", "alert chron-failed", ct(lang, "buildFailed"));
    box.setAttribute("role", "alert");
    return box;
  }
}
