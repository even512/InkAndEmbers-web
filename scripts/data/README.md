# wago.tools-Schnappschüsse

Eingaben für `scripts/build-map-index.mjs` (→ `src/geo/index.json`), damit der Index ohne Netz reproduzierbar ist.

| Ordner | Build | Tabellen |
|---|---|---|
| `wago-1.60.1.70862` | WoW Forever (Produkt `wowf`, neuester Build am 08.11.2026) | `UiMap`, `UiMapAssignment`, `UiMapXMapArt`, `UiMapArt`, `UiMapArtTile`; für `extract-maps.mjs` zusätzlich `WorldMapOverlay`, `WorldMapOverlayTile` (Erkundungs-Overlays) |

Quelle: `https://wago.tools/db2/<Tabelle>/csv?build=<Build>` (öffentliche Auszüge der Client-Tabellen; Spielwelt-Inhalte
© Blizzard Entertainment). Gegenüber dem Beta-Snapshot 1.60.1.70170 sind die Karten gleich (60 uiMaps mit Kunst, gleiche
Zuordnungen und Kacheln); nur `UiMapArt` 2177 (Silithus) hat eine andere Highlight-Datei.

Neuer Build: `node scripts/build-map-index.mjs --build <build> --fetch`, danach `DEFAULT_BUILD` im Skript anpassen.
