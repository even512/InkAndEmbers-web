// Einstieg der Seite: Schrift, Design-Tokens und Stile laden, die App an das Dokument hängen.
// Den Buch-Stil des Exports (core/style.css) lädt die Seite nicht: sie hat ein eigenes Design (ui/tokens.css, ui/base.css).
import "./ui/fonts.css";
import "./ui/tokens.css";
import "./ui/base.css";
import "./ui/app.css";
import "./ui/journey.css";
import "./chronik/chronik.css";
import { startApp } from "./ui/app.mjs";

startApp(document, window);
