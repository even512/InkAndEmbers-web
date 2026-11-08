// Seitenaufbau: Datei laden (Ablegen oder Auswahl), Charakter wählen, Sprache umschalten, Reiter Reise/Chronik.
// Läuft nur im Browser; nichts verlässt den Rechner (die CSP der Seite verbietet jede Anfrage).
// Sicherheit: Alles aus der Datei geht nur über Textknoten (createTextNode via el()) hinaus; kein HTML-String irgendwo.
// Bilder kommen nur aus public/img/ mit festen Namen (identity.mjs), nie aus Dateidaten.
import { buildJournal } from "../core/journal-model.mjs";
import { fmtNumber } from "../core/i18n.mjs";
import { el } from "../core/render.mjs";
import { t } from "./texts.mjs";
import { safeText } from "./safe-text.mjs";
import { loadSvFile, errorMessage } from "./load-file.mjs";
import { pickDroppedFile, hasFiles } from "./drop.mjs";
import { createJourneyView } from "./journey.mjs";
import { renderChroniclePanel } from "../chronik/index.mjs";
import { icon, portraitImg, classSpan } from "./identity.mjs";
import { buildPrintBook } from "./print.mjs";
import { renderLicenses } from "./licenses.mjs";

const LANG_KEY = "iae-lang";
const VIEWS = [["journey", "tabJourney", "tab-reise"], ["chronicle", "tabChronicle", "tab-chronik"]];

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
    page: "main", // main | licenses
    printAnon: false, // „Andere Spieler ausblenden“ für den Druck (Standard aus)
    printing: false,
    printMsg: null, // printPreparing | printReady | printFailed
  };
  let printToken = 0;
  let printRoot = null; // Druckbuch (eigener Knoten neben #app, nur im Druck sichtbar)
  let printUrls = [];
  let loadToken = 0;
  let journey = null; // { guid, db, view } Reise-Ansicht des gewählten Charakters (bleibt über render() erhalten)
  let focusTab = false; // nach Pfeiltaste: Fokus auf den neuen Reiter setzen

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

  function clearPrintBook() {
    ++printToken;
    if (printRoot && printRoot.parentNode) printRoot.parentNode.removeChild(printRoot);
    printRoot = null;
    if (win.URL && typeof win.URL.revokeObjectURL === "function") for (const u of printUrls) win.URL.revokeObjectURL(u);
    printUrls = [];
    if (doc.body.classList) doc.body.classList.remove("has-print-book");
  }
  win.addEventListener("afterprint", () => {
    if (!state.printing) clearPrintBook();
  });

  // Druckbuch bauen, neben #app hängen, Bilder dekodieren lassen, dann den Druckdialog öffnen
  async function startPrint() {
    if (state.printing || !state.journal || !state.file) return;
    clearPrintBook();
    const token = printToken;
    state.printing = true;
    state.printMsg = "printPreparing";
    render();
    try {
      const c = currentCharacter();
      const res = await buildPrintBook(doc, win, {
        db: state.file.db, guid: state.guid, journal: state.journal, char: state.file.db.chars[state.guid],
        lang: state.lang, anonymize: state.printAnon, info: c ? charInfo(c) : {},
      });
      if (token !== printToken) {
        if (win.URL && typeof win.URL.revokeObjectURL === "function") for (const u of res.urls) win.URL.revokeObjectURL(u);
        return;
      }
      printUrls = res.urls;
      printRoot = el(doc, "div", "print-root", res.element);
      printRoot.setAttribute("id", "print-root");
      doc.body.appendChild(printRoot);
      if (doc.body.classList) doc.body.classList.add("has-print-book");
      const imgs = [];
      const collect = (n) => {
        if (n && n.tagName === "IMG" && typeof n.decode === "function") imgs.push(n.decode().catch(() => {}));
        if (n && n.childNodes) for (const k of n.childNodes) collect(k);
      };
      collect(printRoot);
      await Promise.all(imgs);
      state.printMsg = "printReady";
      state.printing = false;
      render();
      if (typeof win.print === "function") win.print();
    } catch {
      state.printMsg = "printFailed"; // keine Dateiinhalte, kein Stacktrace
    } finally {
      state.printing = false;
    }
    render();
  }

  function selectCharacter(guid) {
    clearPrintBook();
    state.printMsg = null;
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
    state.page = "main";
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

  function charInfo(c) {
    const ch = state.file && state.file.db && state.file.db.chars ? state.file.db.chars[c.guid] : null;
    const info = ch && ch.info && typeof ch.info === "object" ? ch.info : {};
    return { raceFile: typeof info.raceFile === "string" ? info.raceFile : null, race: c.race, faction: c.faction };
  }

  function langSwitch() {
    const wrap = el(doc, "div", "seg lang-switch");
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

  // Auswahlfeld mit kurzer, vollständiger Beschriftung (Name – Realm, Stufe); keine Abschneidung
  function charLabel(c) {
    // Stufe vor dem Realm: das geschlossene Auswahlfeld kürzt hinten, und der Realm ist der längste Teil
    let label = safeText(c.name, 40);
    if (c.level !== null) label += " – " + t(state.lang, "charLevel", c.level);
    if (c.realm) label += (c.level !== null ? " · " : " – ") + safeText(c.realm, 40);
    return label;
  }

  function toolbar() {
    const bar = el(doc, "header", "topbar no-print");
    const brand = el(doc, "div", "brand",
      icon(doc, "book-icon", "brand-icon", [32, 32]),
      el(doc, "span", "brand-name", t(state.lang, "brandName")),
      el(doc, "span", "brand-sub", t(state.lang, "brandSub")),
    );
    const inner = el(doc, "div", "wrap topbar-inner", brand);
    if (state.file) {
      inner.appendChild(el(doc, "p", "file-name", t(state.lang, "loadedFile", state.file.name)));
      inner.appendChild(button("btn other-file", t(state.lang, "otherFile"), () => picker.click()));
    }
    inner.appendChild(langSwitch());
    bar.appendChild(inner);
    return bar;
  }

  function dropZone() {
    return el(doc, "section", "intro wrap no-print",
      el(doc, "h1", "intro-title", t(state.lang, "introTitle")),
      el(doc, "p", "intro-lead", t(state.lang, "siteLead")),
      el(doc, "div", "dropzone",
        icon(doc, "book-icon", "drop-icon", [48, 48]),
        el(doc, "p", "drop-title", t(state.lang, "dropTitle")),
        el(doc, "p", "drop-or", t(state.lang, "dropOr")),
        button("btn primary", t(state.lang, "dropPick"), () => picker.click()),
      ),
      el(doc, "p", "drop-hint", t(state.lang, "dropHint")),
      el(doc, "p", "privacy", t(state.lang, "privacy")),
    );
  }

  function metaLine(c) {
    const parts = [];
    if (c.level !== null) parts.push(t(state.lang, "charSummaryLevel", c.level));
    if (c.race) parts.push(safeText(c.race, 40));
    if (c.cls) parts.push(classSpan(doc, c.classFile, safeText(c.cls, 40)));
    if (c.realm) parts.push(safeText(c.realm, 40));
    const out = [];
    parts.forEach((p, i) => {
      if (i) out.push(" · ");
      out.push(p);
    });
    return out;
  }

  function charChooser() {
    const list = el(doc, "div", "char-cards");
    for (const c of state.file.characters) {
      list.appendChild(button("char-card", [
        portraitImg(doc, charInfo(c), "char-portrait", 56),
        el(doc, "span", "char-text",
          el(doc, "span", "char-name", safeText(c.name, 40)),
          el(doc, "span", "char-meta", metaLine(c)),
          el(doc, "span", "char-realm", t(state.lang, "charLines", fmtNumber(state.lang, c.lines))),
        ),
      ], () => {
        state.error = null;
        selectCharacter(c.guid);
        render();
      }));
    }
    return el(doc, "section", "chooser wrap no-print", el(doc, "h2", "chooser-title", t(state.lang, "chooseChar")), list);
  }

  function alertBox(kind, m) {
    const box = el(doc, "div", kind + " no-print", el(doc, "p", "alert-text", t(state.lang, m.key, ...m.args)));
    box.setAttribute("role", kind === "alert" ? "alert" : "status");
    if (kind === "alert") box.appendChild(button("btn", t(state.lang, "pickOther"), () => picker.click()));
    return box;
  }

  function currentCharacter() {
    return state.file ? state.file.characters.find((c) => c.guid === state.guid) || null : null;
  }

  function charSelect() {
    const sel = el(doc, "select", "char-select");
    sel.setAttribute("id", "char-select");
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
    const label = el(doc, "label", "field-label", t(state.lang, "charField"));
    label.setAttribute("for", "char-select");
    return el(doc, "div", "field hero-field", label, sel);
  }

  // Drucken / PDF mit eigenem Schalter „Andere Spieler ausblenden“
  function printTools() {
    const box = doc.createElement("input");
    box.type = "checkbox";
    box.className = "print-anon";
    box.checked = state.printAnon;
    box.addEventListener("change", () => {
      state.printAnon = Boolean(box.checked);
      clearPrintBook();
    });
    const btn = button("btn print-btn", t(state.lang, "printBtn"), () => startPrint());
    btn.disabled = state.printing;
    const status = el(doc, "p", "print-status", state.printMsg ? t(state.lang, state.printMsg) : "");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    return el(doc, "div", "print-tools no-print",
      el(doc, "label", "print-anon-label", box, el(doc, "span", null, t(state.lang, "printAnon"))),
      btn,
      status,
    );
  }

  function hero() {
    const c = currentCharacter();
    if (!c) return null;
    return el(doc, "section", "hero",
      portraitImg(doc, charInfo(c), "portrait", 80),
      el(doc, "div", "hero-who",
        el(doc, "h1", "journal-name", safeText(c.name, 40)),
        el(doc, "p", "hero-meta", metaLine(c)),
      ),
      charSelect(),
      printTools(),
    );
  }

  function selectView(id) {
    if (state.view === id) return;
    state.view = id;
    if (journey && id !== "journey") journey.view.pause();
    render();
    if (journey && id === "journey") journey.view.shown();
  }

  function tabs() {
    const bar = el(doc, "div", "tabs no-print");
    bar.setAttribute("role", "tablist");
    bar.setAttribute("aria-label", t(state.lang, "tabsLabel"));
    const ids = VIEWS.map(([id]) => id);
    for (const [id, key, art] of VIEWS) {
      const on = state.view === id;
      bar.appendChild(button("tab-btn" + (on ? " active" : ""), [icon(doc, art, "tab-cap", [37, 34]), el(doc, "span", "tab-text", t(state.lang, key))], () => selectView(id), (b) => {
        b.setAttribute("role", "tab");
        b.setAttribute("id", "tab-" + id);
        b.setAttribute("aria-selected", on ? "true" : "false");
        b.setAttribute("aria-controls", "view-panel");
        b.setAttribute("tabindex", on ? "0" : "-1");
        b.addEventListener("keydown", (e) => {
          const i = ids.indexOf(id);
          let next = null;
          if (e.key === "ArrowRight") next = ids[(i + 1) % ids.length];
          else if (e.key === "ArrowLeft") next = ids[(i - 1 + ids.length) % ids.length];
          else if (e.key === "Home") next = ids[0];
          else if (e.key === "End") next = ids[ids.length - 1];
          if (next === null) return;
          if (e.preventDefault) e.preventDefault();
          focusTab = true;
          selectView(next);
        });
      }));
    }
    return bar;
  }

  // Reise-Ansicht (W4): je Charakter einmal aufgebaut, bei jedem render() wieder eingehängt
  function journeyPanel() {
    const db = state.file.db;
    if (!journey || journey.guid !== state.guid || journey.db !== db) {
      if (journey) journey.view.destroy();
      journey = { guid: state.guid, db, view: createJourneyView(doc, win, { journal: state.journal, char: db.chars[state.guid], lang: state.lang }) };
    }
    journey.view.setLang(state.lang);
    return journey.view.element;
  }

  function journalShell() {
    const inner = state.view === "journey"
      ? journeyPanel()
      : renderChroniclePanel(doc, { db: state.file.db, guid: state.guid, journal: state.journal, lang: state.lang });
    const panel = el(doc, "div", "view-panel", inner);
    panel.setAttribute("id", "view-panel");
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", "tab-" + state.view);
    return el(doc, "div", "journal-shell wrap", hero(), tabs(), panel);
  }

  function showPage(page) {
    if (state.page === page) return;
    if (journey && page !== "main") journey.view.pause();
    state.page = page;
    render();
    if (page === "main" && journey && state.view === "journey") journey.view.shown();
    const target = doc.getElementById ? doc.getElementById(page === "licenses" ? "lic-title" : "app") : null;
    if (target && typeof target.focus === "function") {
      if (page === "licenses" && typeof target.setAttribute === "function") target.setAttribute("tabindex", "-1");
      target.focus();
    }
    if (typeof win.scrollTo === "function") win.scrollTo(0, 0);
  }

  function footer() {
    return el(doc, "footer", "site-footer no-print",
      el(doc, "div", "wrap",
        el(doc, "p", "footer-main", t(state.lang, "footer")),
        el(doc, "p", "footer-privacy", t(state.lang, "footerPrivacy")),
        el(doc, "p", "footer-links", button("link-btn licenses-link", t(state.lang, "licensesLink"), () => showPage("licenses"))),
      ),
    );
  }

  function render() {
    doc.documentElement.setAttribute("lang", state.lang);
    const c = state.journal ? currentCharacter() : null;
    doc.title = c ? t(state.lang, "journalOf") + " " + safeText(c.name, 40) : t(state.lang, "siteTitle");
    const main = el(doc, "main", "main");
    const msgs = el(doc, "div", "wrap messages");
    if (state.error) msgs.appendChild(alertBox("alert", state.error));
    if (state.notice) msgs.appendChild(alertBox("notice", state.notice));
    if (state.file && state.file.schemaWarning) msgs.appendChild(alertBox("notice", { key: "schemaWarn", args: [state.file.schemaWarning] }));
    if (state.busy) msgs.appendChild(alertBox("notice", { key: "reading", args: [] }));
    if (msgs.childNodes.length) main.appendChild(msgs);
    if (state.page === "licenses") main.appendChild(renderLicenses(doc, state.lang, () => showPage("main")));
    else if (!state.file) main.appendChild(dropZone());
    else if (!state.journal) main.appendChild(charChooser());
    else main.appendChild(journalShell());
    const nodes = [toolbar(), main, footer()];
    while (root.firstChild) root.removeChild(root.firstChild);
    for (const n of nodes) root.appendChild(n);
    if (focusTab) {
      focusTab = false;
      const tab = doc.getElementById ? doc.getElementById("tab-" + state.view) : null;
      if (tab && typeof tab.focus === "function") tab.focus();
    }
  }

  render();
  return { state, render, loadFile, startPrint, showPage };
}
