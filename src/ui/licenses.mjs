// Seite „Lizenzen & Hinweise“: Datenschutz („nichts wird hochgeladen“), Blizzard-Hinweis, Grafiken (alle Rechte
// vorbehalten), ausgelieferte Bibliotheken und Schriften mit Lizenz und Lizenztext. Nur feste Texte, keine Dateidaten.
// Adressen stehen als Text da (keine Links): die Seite öffnet nichts von selbst.
import { el } from "../core/render.mjs";
import { t } from "./texts.mjs";

// Versionen wie in package.json (ein Test hält beides gleich)
export const LIB_VERSIONS = Object.freeze({ mediabunny: "1.65.2", gifenc: "1.0.3" });
// Lizenztexte, die mit der Seite ausgeliefert werden (public/)
export const LICENSE_FILES = Object.freeze({
  mediabunny: "licenses/MPL-2.0-mediabunny.txt",
  gifenc: "licenses/MIT-gifenc.txt",
  spectral: "fonts/OFL-Spectral.txt",
});
export const SOURCES = Object.freeze({
  mediabunny: "https://github.com/Vanilagy/mediabunny (v1.65.2)",
  page: "https://github.com/even512/InkAndEmbers-web",
});

function block(doc, title, ...paras) {
  return el(doc, "section", "lic-block", el(doc, "h2", "lic-h", title), ...paras.filter(Boolean).map((p) => (typeof p === "string" ? el(doc, "p", "lic-p", p) : p)));
}

function lib(doc, lang, text, file, source) {
  return el(doc, "li", "lic-lib",
    el(doc, "p", "lic-p", text),
    file ? el(doc, "p", "lic-file", t(lang, "licTextFile", file)) : null,
    source ? el(doc, "p", "lic-file", t(lang, "licSource", source)) : null,
  );
}

export function renderLicenses(doc, lang, onBack) {
  const back = el(doc, "button", "btn lic-back", t(lang, "licBack"));
  back.type = "button";
  if (typeof onBack === "function") back.addEventListener("click", onBack);
  const libs = el(doc, "ul", "lic-libs",
    lib(doc, lang, t(lang, "licMediabunny", LIB_VERSIONS.mediabunny), LICENSE_FILES.mediabunny, SOURCES.mediabunny),
    lib(doc, lang, t(lang, "licGifenc", LIB_VERSIONS.gifenc), LICENSE_FILES.gifenc, null),
    lib(doc, lang, t(lang, "licSpectral"), LICENSE_FILES.spectral, null),
  );
  const page = el(doc, "section", "licenses wrap",
    el(doc, "div", "lic-head", back),
    (() => {
      const h = el(doc, "h1", "lic-title", t(lang, "licTitle"));
      h.setAttribute("id", "lic-title");
      return h;
    })(),
    el(doc, "p", "lic-lead", t(lang, "licLead")),
    block(doc, t(lang, "licPrivacyTitle"), t(lang, "licPrivacy1"), t(lang, "licPrivacy2"), t(lang, "licPrivacy3")),
    block(doc, t(lang, "licBlizzardTitle"), t(lang, "licBlizzard1"), t(lang, "licBlizzard2")),
    block(doc, t(lang, "licArtTitle"), t(lang, "licArt1")),
    block(doc, t(lang, "licLibTitle"), t(lang, "licLibLead"), libs, t(lang, "licVite")),
    block(doc, t(lang, "licCodeTitle"), t(lang, "licCode1"), el(doc, "p", "lic-file", t(lang, "licSource", SOURCES.page))),
  );
  page.setAttribute("id", "licenses");
  page.setAttribute("aria-labelledby", "lic-title");
  return page;
}
