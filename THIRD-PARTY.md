# Drittanbieter-Hinweise

Die Seite lädt zur Laufzeit nichts von außen: alles unten Genannte wird mit der Seite ausgeliefert.

## Ausgelieferte Bestandteile

| Bestandteil | Lizenz | Wo | Hinweis |
|---|---|---|---|
| Spectral (Production Type) | SIL OFL 1.1 | `public/fonts/Spectral-*.ttf`, Text: `public/fonts/OFL-Spectral.txt` | unverändert aus dem Addon Ink & Embers |
| Caveat (The Caveat Project Authors) | SIL OFL 1.1 | `public/fonts/Caveat-Bold.ttf`, Text: `public/fonts/OFL-Caveat.txt` | unverändert aus dem Addon Ink & Embers |
| Blizzard-Kartenkunst (WebP je uiMap und Sprache) | © Blizzard Entertainment, nicht-kommerzielle Fan-Nutzung, keine Lizenz an Dritte | `public/maps/forever/`, Hinweis: `public/maps/LICENSE-NOTE.md` | aus dem lokalen Spielclient (`scripts/extract-maps.mjs`) |
| Parser, Modell, Texte, Darstellung | MIT (eigener Code) | `src/core/` | Kopie aus `EveN_ForeverChronicle/tools/journal-export/src/`, siehe `src/core/SOURCE.txt` |

Vorgesehen für spätere Etappen (noch nicht eingebunden):

| Bestandteil | Lizenz | Etappe |
|---|---|---|
| Mediabunny (MP4 über WebCodecs) | MPL-2.0 (unverändert einbinden, Lizenztext ausliefern) | W6 |
| gifenc (GIF-Encoder) | MIT | W6 |
| Kartentabellen (UiMap, UiMapAssignment, UiMapXMapArt, UiMapArt, UiMapArtTile) von wago.tools, als `src/geo/index.json` | Auszüge der Client-Tabellen, Spielwelt-Inhalte © Blizzard Entertainment | W2 |

## Nur zur Entwicklung (nicht Teil der ausgelieferten Seite)

| Werkzeug | Lizenz |
|---|---|
| Vite | MIT |
| Vitest | MIT |
| @jamiephan/casclib (CASC-Zugriff, nur `scripts/extract-maps.mjs`) | MIT (CascLib: MIT) |
| wow-blp-web (BLP-Dekodierung, nur `scripts/extract-maps.mjs`) | MIT OR Apache-2.0 |
| sharp (WebP/PNG, nur `scripts/extract-maps.mjs`) | Apache-2.0 (libvips: LGPL-3.0, als vorgebaute Bibliothek) |

(Deren eigene Abhängigkeiten stehen in `package-lock.json`.)

## Hinweis zu Blizzard

World of Warcraft und die zugehörigen Namen und Kunstwerke sind © Blizzard Entertainment. Dies ist ein Fanprojekt, es ist
nicht mit Blizzard Entertainment verbunden und nicht von Blizzard unterstützt. Es gibt keine Werbung, keine Spenden- oder
Bezahllinks und kein Tracking.
