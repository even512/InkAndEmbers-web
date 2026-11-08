// Seitenaufbau: Datei laden (Ablegen oder Auswahl), Charakter wählen, Sprache umschalten, Reiter Reise/Chronik.
// Läuft nur im Browser; nichts verlässt den Rechner (die CSP der Seite verbietet jede Anfrage).
// Sicherheit: Alles aus der Datei geht nur über Textknoten (createTextNode via el()) hinaus; kein HTML-String irgendwo.
import { buildJournal } from "../core/journal-model.mjs";
import { fmtNumber } from "../core/i18n.mjs";
import { el } from "../core/render.mjs";
import { t } from "./texts.mjs";
import { safeText } from "./safe-text.mjs";
import { loadSvFile, errorMessage } from "./load-file.mjs";
import { pickDroppedFile, hasFiles } from "./drop.mjs";

const LANG_KEY = "iae-lang";

function readStoredLang(win) {
  try {
    const v = win.localStorage && win.localStorage.getItem(LANG_KEY);
    return v === "de" || v === "en" ? v : null;
  } catch {
    return null; // localStorage gesperrt: kein Problem, die Sprache gilt dann nur für diese Sitzung
  }
}

function storeLang(win, lang) {
  try {
    if (win.localStorage) win.localStorage.setItem(LANG_KEY, lang); // nur "de"/"en", nie Inhalte der Datei
  } catch {
    /* ignorieren */
  }
}

export function startApp(doc, win) {
  const stored = readStoredLang(win);
  const state = {
    lang: stored || (win.navigator && /^de\b/i.test(win.navigator.language || "") ? "de" : "en"),
    langChosen: !!stored,
    file: null, // { name, db, characters, schemaWarning }
    guid: null,
    journal: null, // buildJournal-Ergebnis des gewählten Charakters
    view: "journey", // journey | chronicle
    error: null, // { key, args }
    notice: null, // { key, args }
    busy: false,
  };
  let loadToken = 0;

  const root = doc.getElementById("app");
  const picker = doc.createElement("input");
  picker.type = "file";
  picker.accept = ".lua,text/plain";
  picker.className = "visually-hidden";
  picker.tabIndex = -1;
  picker.setAttribute("aria-hidden", "true");
  doc.body.appendChild(picker);
  picker.addEventListener("change", () => {
    const f = picker.files && picker.files[0];
    if (f) loadFile(f);
    picker.value = "";
  });

  function selectCharacter(guid) {
    state.guid = guid || null;
    state.journal = null;
    if (!state.guid || !state.file) return;
    try {
      state.journal = buildJournal(state.file.db, state.guid);
    } catch (e) {
      const m = errorMessage(e);
      state.error = m;
      state.guid = null;
    }
  }

  async function loadFile(file, extra) {
    const token = ++loadToken;
    state.error = null;
    state.notice = extra && extra.count > 1 ? { key: "fileCount", args: [extra.count, safeText(file && file.name, 80)] } : null;
    state.busy = true;
    render();
    try {
      const opened = await loadSvFile(file);
      if (token !== loadToken) return; // eine neuere Auswahl hat übernommen
      state.file = { name: opened.name, db: opened.db, characters: opened.characters, schemaWarning: opened.schemaWarning };
      if (!state.langChosen && opened.language) state.lang = opened.language;
      // zuletzt gespielter Charakter zuerst (listCharacters sortiert nach lastSeen)
      selectCharacter(opened.characters.length > 0 ? opened.characters[0].guid : null);
    } catch (e) {
      if (token !== loadToken) return;
      state.error = errorMessage(e);
    } finally {
      if (token === loadToken) state.busy = false;
    }
    render();
  }

  function showDropError(e) {
    ++loadToken;
    state.busy = false;
    state.notice = null;
    state.error = errorMessage(e);
    render();
  }

  // Ablegen irgendwo auf der Seite
  let dragDepth = 0;
  win.addEventListener("dragenter", (e) => {
    e.preventDefault();
    if (!hasFiles(e.dataTransfer)) return;
    dragDepth++;
    doc.body.classList.add("dragging");
  });
  win.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) doc.body.classList.remove("dragging");
  });
  win.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  });
  win.addEventListener("drop", (e) => {
    e.preventDefault();
    dragDepth = 0;
    doc.body.classList.remove("dragging");
    let picked;
    try {
      picked = pickDroppedFile(e.dataTransfer);
    } catch (err) {
      showDropError(err);
      return;
    }
    loadFile(picked.file, picked);
  });

  function button(cls, label, onClick, extra) {
    const b = el(doc, "button", cls, label);
    b.type = "button";
    b.addEventListener("click", onClick);
    if (extra) extra(b);
    return b;
  }

  function langSwitch() {
    const wrap = el(doc, "div", "lang-switch");
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", t(state.lang, "language"));
    for (const l of ["de", "en"]) {
      wrap.appendChild(
        button("lang-btn" + (state.lang === l ? " active" : ""), l.toUpperCase(), () => {
          state.lang = l;
          state.langChosen = true;
          storeLang(win, l);
          render();
        }, (b) => b.setAttribute("aria-pressed", state.lang === l ? "true" : "false")),
      );
    }
    return wrap;
  }

  function charLabel(c) {
    let label = safeText(c.name, 40);
    if (c.realm) label += " – " + safeText(c.realm, 40);
    const parts = [label];
    if (c.level !== null) parts.push(t(state.lang, "charLevel", c.level));
    if (c.cls) parts.push(safeText(c.cls, 40));
    return parts.join(" · ");
  }

  function toolbar() {
    const bar = el(doc, "header", "toolbar no-print");
    bar.appendChild(el(doc, "div", "brand", el(doc, "span", "brand-mark", "❦"), el(doc, "span", "brand-name", t(state.lang, "siteTitle"))));
    const tools = el(doc, "div", "tools");
    if (state.file) {
      tools.appendChild(el(doc, "span", "file-name", t(state.lang, "loadedFile", state.file.name)));
      tools.appendChild(button("btn ghost", t(state.lang, "otherFile"), () => picker.click()));
      const sel = el(doc, "select", "char-select");
      sel.setAttribute("aria-label", t(state.lang, "chooseChar"));
      if (!state.guid) {
        const blank = el(doc, "option", null, "…");
        blank.value = "";
        blank.selected = true;
        sel.appendChild(blank);
      }
      for (const c of state.file.characters) {
        const o = el(doc, "option", null, charLabel(c));
        o.value = c.guid;
        if (c.guid === state.guid) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener("change", () => {
        state.error = null;
        selectCharacter(sel.value || null);
        render();
      });
      tools.appendChild(sel);
    }
    tools.appendChild(langSwitch());
    bar.appendChild(tools);
    return bar;
  }

  function dropZone() {
    return el(doc, "section", "intro no-print",
      el(doc, "h1", "intro-title", t(state.lang, "siteTitle")),
      el(doc, "p", "intro-lead", t(state.lang, "siteLead")),
      el(doc, "div", "dropzone",
        el(doc, "p", "drop-title", t(state.lang, "dropTitle")),
        el(doc, "p", "drop-or", t(state.lang, "dropOr")),
        button("btn primary", t(state.lang, "dropPick"), () => picker.click()),
      ),
      el(doc, "p", "drop-hint", t(state.lang, "dropHint")),
      el(doc, "p", "privacy", t(state.lang, "privacy")),
    );
  }

  function charChooser() {
    const list = el(doc, "div", "char-cards");
    for (const c of state.file.characters) {
      list.appendChild(button("char-card", [
        el(doc, "span", "char-name", safeText(c.name, 40)),
        el(doc, "span", "char-meta", [c.level !== null ? t(state.lang, "charLevel", c.level) : null, c.race ? safeText(c.race, 40) : null, c.cls ? safeText(c.cls, 40) : null].filter(Boolean).join(" · ")),
        el(doc, "span", "char-realm", [c.realm ? safeText(c.realm, 40) : null, t(state.lang, "charLines", fmtNumber(state.lang, c.lines))].filter(Boolean).join(" · ")),
      ], () => {
        state.error = null;
        selectCharacter(c.guid);
        render();
      }));
    }
    return el(doc, "section", "chooser no-print", el(doc, "h2", "chooser-title", t(state.lang, "chooseChar")), list);
  }

  function alertBox(kind, m) {
    const box = el(doc, "div", kind + " no-print", t(state.lang, m.key, ...m.args));
    box.setAttribute("role", kind === "alert" ? "alert" : "status");
    return box;
  }

  function currentCharacter() {
    return state.file ? state.file.characters.find((c) => c.guid === state.guid) || null : null;
  }

  function tabs() {
    const bar = el(doc, "div", "view-tabs no-print");
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", t(state.lang, "tabsLabel"));
    for (const [id, key] of [["journey", "tabJourney"], ["chronicle", "tabChronicle"]]) {
      bar.appendChild(button("tab-btn" + (state.view === id ? " active" : ""), t(state.lang, key), () => {
        state.view = id;
        render();
      }, (b) => b.setAttribute("aria-pressed", state.view === id ? "true" : "false")));
    }
    return bar;
  }

  // Platzhalter für Reise (W4) und Chronik/Statistik (W5)
  function journalShell() {
    const c = currentCharacter();
    const meta = c
      ? [c.level !== null ? t(state.lang, "charSummaryLevel", c.level) : null, c.race ? safeText(c.race, 40) : null, c.cls ? safeText(c.cls, 40) : null, c.realm ? safeText(c.realm, 40) : null].filter(Boolean).join(" · ")
      : "";
    const head = el(doc, "section", "journal-head",
      el(doc, "h1", "journal-name", c ? safeText(c.name, 40) : ""),
      meta ? el(doc, "p", "journal-meta", meta) : null,
      c ? el(doc, "p", "journal-meta", t(state.lang, "charSummaryLines", fmtNumber(state.lang, c.lines))) : null,
    );
    const isJourney = state.view === "journey";
    const panel = el(doc, "section", "view-panel placeholder",
      el(doc, "h2", "panel-title", t(state.lang, isJourney ? "journeyTitle" : "chronicleTitle")),
      el(doc, "p", "panel-soon", t(state.lang, isJourney ? "journeySoon" : "chronicleSoon")),
    );
    return el(doc, "div", "journal-shell", head, tabs(), panel);
  }

  function footer() {
    return el(doc, "footer", "site-footer no-print",
      el(doc, "p", "footer-main", t(state.lang, "footer")),
      el(doc, "p", "footer-privacy", t(state.lang, "footerPrivacy")),
    );
  }

  function render() {
    doc.documentElement.setAttribute("lang", state.lang);
    const c = state.journal ? currentCharacter() : null;
    doc.title = c ? t(state.lang, "journalOf") + " " + safeText(c.name, 40) : t(state.lang, "siteTitle");
    const main = el(doc, "main", "main");
    if (state.error) main.appendChild(alertBox("alert", state.error));
    if (state.notice) main.appendChild(alertBox("notice", state.notice));
    if (state.file && state.file.schemaWarning) main.appendChild(alertBox("notice", { key: "schemaWarn", args: [state.file.schemaWarning] }));
    if (state.busy) main.appendChild(alertBox("notice", { key: "reading", args: [] }));
    if (!state.file) main.appendChild(dropZone());
    else if (!state.journal) main.appendChild(charChooser());
    else main.appendChild(journalShell());
    const nodes = [toolbar(), main, footer()];
    while (root.firstChild) root.removeChild(root.firstChild);
    for (const n of nodes) root.appendChild(n);
  }

  render();
  return { state, render, loadFile };
}
