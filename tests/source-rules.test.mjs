// Quelltext-Regeln der Spec: keine HTML-Strings/Code-Auswertung in src/, strenge CSP in index.html, Texte in zwei Sprachen,
// src/core ist eine unveränderte Kopie des Addon-Repos.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { WEB_TEXTS, t } from "../src/ui/texts.mjs";
import { TEXTS } from "../src/core/i18n.mjs";
import { CORE_FILES, withHeader, resolveSource } from "../scripts/sync-core.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe("Quelltext-Regeln (src/)", () => {
  const files = walk(join(ROOT, "src")).filter((f) => /\.(m?js|html)$/.test(f));

  it("benutzt nirgends innerHTML, outerHTML, insertAdjacentHTML, document.write, eval, new Function, createContextualFragment", () => {
    expect(files.length).toBeGreaterThan(5);
    const forbidden = /\b(innerHTML|outerHTML|insertAdjacentHTML|createContextualFragment|srcdoc)\b|document\s*\.\s*write(ln)?\s*\(|\beval\s*\(|new\s+Function\s*\(|\bFunction\s*\(\s*["'`]|setTimeout\s*\(\s*["'`]|setInterval\s*\(\s*["'`]/;
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      const m = forbidden.exec(text);
      expect(m, relative(ROOT, f) + (m ? ": " + m[0] : "")).toBeNull();
    }
  });

  it("macht keine Netzwerkanfragen (fetch, XMLHttpRequest, WebSocket, sendBeacon, EventSource, import() von außen)", () => {
    const forbidden = /\bfetch\s*\(|XMLHttpRequest|\bWebSocket\b|sendBeacon|\bEventSource\b|importScripts|\bimport\s*\(\s*["'`]https?:/;
    for (const f of files) {
      const m = forbidden.exec(readFileSync(f, "utf8"));
      expect(m, relative(ROOT, f) + (m ? ": " + m[0] : "")).toBeNull();
    }
  });

  it("schreibt keine Dateiinhalte in localStorage oder die Konsole", () => {
    for (const f of files.filter((p) => !p.includes("core"))) {
      const text = readFileSync(f, "utf8");
      expect(/console\./.test(text), relative(ROOT, f)).toBe(false);
      for (const m of text.matchAll(/setItem\(([^)]*)\)/g)) expect(m[1]).toMatch(/^LANG_KEY, lang$/);
    }
  });
});

describe("index.html", () => {
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  const csp = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html);

  it("hat die strenge Meta-CSP aus der Spec", () => {
    expect(csp).not.toBeNull();
    const dirs = new Map(csp[1].split(";").map((d) => d.trim()).filter(Boolean).map((d) => [d.split(/\s+/)[0], d.split(/\s+/).slice(1).join(" ")]));
    expect(dirs.get("default-src")).toBe("'none'");
    expect(dirs.get("script-src")).toBe("'self'");
    expect(dirs.get("style-src")).toBe("'self'");
    expect(dirs.get("connect-src")).toBe("'none'");
    expect(dirs.get("img-src")).toBe("'self' blob: data:");
    expect(dirs.get("font-src")).toBe("'self'");
    expect(dirs.get("media-src")).toBe("'self' blob:");
    expect(dirs.get("worker-src")).toBe("'self' blob:");
    expect(dirs.get("base-uri")).toBe("'none'");
    expect(dirs.get("form-action")).toBe("'none'");
    expect(dirs.get("object-src")).toBe("'none'");
    expect(csp[1]).not.toMatch(/unsafe-inline|unsafe-eval|https?:|\*/);
    expect(html).toContain('<meta name="referrer" content="no-referrer">');
  });

  it("enthält kein Inline-Skript, keinen Inline-Stil, kein Inline-Handler-Attribut und kein CDN", () => {
    const noComments = html.replace(/<!--[\s\S]*?-->/g, "");
    for (const m of noComments.matchAll(/<script\b([^>]*)>/gi)) expect(m[1]).toMatch(/\bsrc="\//);
    expect(/<style\b/i.test(noComments)).toBe(false);
    expect(/\sstyle\s*=/i.test(noComments)).toBe(false);
    expect(/\son[a-z]+\s*=/i.test(noComments)).toBe(false);
    expect(/https?:\/\//i.test(noComments)).toBe(false);
  });
});

describe("Texte", () => {
  const keys = (o) => Object.keys(o).sort();
  const slots = (s) => (s.match(/\{\d+\}/g) || []).sort().join(",");

  it("Deutsch und Englisch haben dieselben Schlüssel und Platzhalter", () => {
    expect(keys(WEB_TEXTS.de)).toEqual(keys(WEB_TEXTS.en));
    for (const k of keys(WEB_TEXTS.de)) expect(slots(WEB_TEXTS.de[k]), k).toBe(slots(WEB_TEXTS.en[k]));
  });

  it("alle von der Seite benutzten Schlüssel gibt es in beiden Sprachen (Seite oder Kern)", () => {
    const src = readFileSync(join(ROOT, "src", "ui", "app.mjs"), "utf8");
    const used = new Set([...src.matchAll(/\bt\(state\.lang, "([A-Za-z]+)"/g)].map((m) => m[1]));
    for (const m of src.matchAll(/\["(?:journey|chronicle)", "([A-Za-z]+)"\]/g)) used.add(m[1]);
    used.add("journalOf");
    expect(used.size).toBeGreaterThan(15);
    for (const k of used) {
      for (const lang of ["de", "en"]) {
        const inWeb = typeof WEB_TEXTS[lang][k] === "string";
        const inCore = typeof TEXTS[lang][k] === "string";
        expect(inWeb || inCore, k + "/" + lang).toBe(true);
        expect(t(lang, k, "a", "b")).not.toBe(k);
      }
    }
  });
});

describe("src/core ist die Kopie des Addon-Repos", () => {
  it("jede Datei trägt den Herkunftskopf und SOURCE.txt nennt den Commit", () => {
    for (const f of CORE_FILES) {
      const text = readFileSync(join(ROOT, "src", "core", f), "utf8");
      expect(text.slice(0, 200), f).toMatch(/Herkunft: EveN_ForeverChronicle\/tools\/journal-export\/src\//);
      expect(text.includes("\r"), f).toBe(false);
    }
    expect(readFileSync(join(ROOT, "src", "core", "SOURCE.txt"), "utf8")).toMatch(/Commit: [0-9a-f]{40}/);
  });

  const repo = resolveSource([], {});
  const srcDir = join(repo, "tools", "journal-export", "src");
  it.skipIf(!existsSync(srcDir))("entspricht dem Stand im Nachbar-Repo (sonst: npm run sync-core)", () => {
    for (const f of CORE_FILES) {
      const expected = withHeader(f, readFileSync(join(srcDir, f), "utf8"));
      expect(readFileSync(join(ROOT, "src", "core", f), "utf8"), f).toBe(expected);
    }
  });
});
