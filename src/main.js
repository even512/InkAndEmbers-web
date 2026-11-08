// Einstieg der Seite: Schriften und Stile laden, die App an das Dokument hängen.
import "./ui/fonts.css";
import "./core/style.css";
import "./ui/app.css";
import "./ui/journey.css";
import { startApp } from "./ui/app.mjs";

startApp(document, window);
