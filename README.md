# Ink & Embers – Tagebuch im Browser

Eine statische Webseite zum Addon **Ink & Embers** (World of Warcraft Forever, rudimentär auch Retail): Die Datei
`InkAndEmbers.lua` (SavedVariables) wird in die Seite gezogen, und das Reisetagebuch erscheint, mit Karte, Route, Chronik und
Statistik, zum Drucken (PDF) und zum Teilen als Video, GIF oder Bild. **Alles läuft im Browser, nichts wird hochgeladen.**
Die Seite hat keine Werbung, keine Spendenlinks und kein Tracking.

Fanprojekt, nicht mit Blizzard Entertainment verbunden. World of Warcraft und Kartenkunst © Blizzard Entertainment.

> Stand: Etappe W7 (Druck, Feinschliff, Tests). Reise mit Karte und Wiedergabe, Chronik & Statistik, Teilen (Video/GIF/Bild),
> Drucken / PDF und die Seite „Lizenzen & Hinweise“ sind da; es fehlen Laufzeit-Gate und Veröffentlichung auf GitHub Pages.
> Der Plan steht in der Spec `inkandembers-web` der Projekt-Werkstatt.

## Bedienung

1. Die Seite öffnen (später: <https://even512.github.io/InkAndEmbers-web/>, lokal: siehe Entwicklung).
2. Die Datei `InkAndEmbers.lua` hineinziehen oder über „Datei auswählen“ laden. Sie liegt im Spielordner unter
   `WTF\Account\<Konto>\SavedVariables\` (bei Forever im Ordner `_forever_`, sonst `_retail_`). Am besten nach dem Ausloggen
   nehmen, dann ist alles gesichert.
3. Der zuletzt gespielte Charakter wird gezeigt; oben im Auswahlfeld lässt sich ein anderer wählen.
4. Oben rechts zwischen **DE** und **EN** umschalten (ohne Wahl gilt die Systemsprache des Browsers, sonst Englisch; die Wahl wird gemerkt).
5. **Drucken / PDF** (im Charakter-Kopf): baut ein Druckbuch (A4, jedes Kapitel auf einer neuen Seite, Karten als Standbild
   der Kapitelroute, keine Bedienelemente) und öffnet den Druckdialog; dort „Als PDF speichern“ wählen. Mit
   **Andere Spieler ausblenden** stehen statt fremder Namen „Gefährte 1, 2, …“ im Druck.
6. **Lizenzen & Hinweise** (Fußzeile): Datenschutz, Blizzard-Hinweis, Grafiken, Bibliotheken und Schriften mit Lizenztext.

Grenzen beim Laden: nur Dateien mit der Endung `.lua`, höchstens 50 MB, nur Text; Ordner und mehrere Dateien werden mit
einem verständlichen Hinweis abgewiesen bzw. nur die erste `.lua`-Datei wird gelesen.

## Entwicklung

Voraussetzung: Node.js ab 20.19.

```bash
npm install          # Abhängigkeiten (nur Vite und Vitest, beide nur zur Entwicklung)
npm run dev          # Entwicklungsserver mit Neuladen (lockere CSP, nur lokal)
npm run build        # gebaute Seite nach dist/ (strenge CSP)
npm run preview      # dist/ lokal ansehen, so wie es später auf GitHub Pages liegt
npm test             # Tests (Vitest): Laden, Limits, XSS-Fixture, Quelltext-Regeln
npm run sync-core    # src/core/ aus dem Addon-Repo erneuern
npm run check-core   # prüfen, ob src/core/ noch dem Addon-Repo entspricht (Exit 1 bei Abweichung)
npm run build-map-index   # src/geo/index.json aus scripts/data/wago-<build>/ neu bauen (--fetch lädt von wago.tools)
```

### Aufbau

```
index.html          Grundgerüst mit Meta-CSP (kein Inline-Skript, kein Inline-Stil)
src/main.js         Einstieg
src/core/           Kopie aus EveN_ForeverChronicle/tools/journal-export/src/ (nicht von Hand ändern!)
src/trail/          parse-trail.mjs: Positionsspur prüfen, in Strecken zerlegen, Wiedergabe-Zeitachse
src/geo/            map-geo.mjs (Zone <-> Kontinent, Anzeigekarte), index.json (generiert)
src/ui/             Seite: app.mjs, load-file.mjs (Limits), drop.mjs, texts.mjs (DE/EN), safe-text.mjs, CSS
public/fonts/       Spectral (SIL OFL), die einzige Schrift der Seite
public/img/         Addon-Grafiken (Lesezeichen, Medaillen, Marker, Embleme, Porträts), alle Rechte vorbehalten
scripts/            sync-core.mjs, build-map-index.mjs, extract-maps.mjs (Kartenkunst aus dem lokalen Client)
scripts/data/       wago.tools-Schnappschüsse der Kartentabellen je Build
tests/              Vitest + synthetische Fixtures (keine echten Spielerdaten)
.github/workflows/  pages.yml (Deploy auf GitHub Pages)
```

### Regeln, die der Code einhält

- Text aus der Datei geht **nur als Textknoten** in die Seite (`createTextNode`/`textContent`), nie als HTML. Ein Test
  verbietet `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval` und `new Function` in `src/`.
- Die Datei wird mit einem eigenen Lua-Datenparser gelesen (kein `eval`), mit Größen- und Tiefenlimit.
- Die Seite sendet nichts: Die CSP in `index.html` setzt `connect-src 'none'`; alle Bibliotheken und Schriften liegen lokal.
- In `src/core/` steht der geprüfte Code des Addon-Exports. Änderungen gehören ins Addon-Repo; danach `npm run sync-core`.
  `src/core/SOURCE.txt` nennt den Quell-Commit.
- Echte `InkAndEmbers.lua`-Dateien gehören nie ins Repo (`.gitignore`); Tests nutzen nur synthetische Dateien.

### Konfiguration

`.env.example` nach `.env` kopieren (steht in `.gitignore`). Alles ist optional:

- `CHRONICLE_REPO`: Pfad zum Addon-Repo für `sync-core` (Vorgabe: Nachbarordner `../EveN_ForeverChronicle`).
- `WOW_FOREVER_DIR`: Pfad zum Spielclient (WoW-Ordner mit `Data/`), nur für `npm run extract-maps` (W3).

## Deploy

Ein Push auf `main` startet `.github/workflows/pages.yml` (Tests, Build, Veröffentlichung auf GitHub Pages). Einmalig im Repo
unter Settings > Pages die Quelle „GitHub Actions“ wählen.

## Lizenz

Quelltext: MIT (`LICENSE`). Schrift: SIL OFL 1.1. Grafiken unter `public/img/` (aus dem Addon): alle Rechte vorbehalten, siehe
`public/img/LICENSE-NOTE.md`. Kartenbilder und Blizzard-Inhalte: nicht unter MIT, siehe `LICENSE` und `THIRD-PARTY.md`.
