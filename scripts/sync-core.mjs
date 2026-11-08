// Gleicht src/core/ mit dem Addon-Repo EveN_ForeverChronicle ab (tools/journal-export/src/).
// Die Dateien dort sind die Quelle der Wahrheit (Parser, Modell, Texte, Darstellung); hier liegen nur Kopien mit
// Herkunftskopf. Nie in src/core/ von Hand ändern, sondern im Addon-Repo und dann dieses Skript laufen lassen.
//
//   node scripts/sync-core.mjs            kopiert die Dateien, schreibt src/core/SOURCE.txt
//   node scripts/sync-core.mjs --check    prüft nur: Exit 1, wenn src/core/ vom Addon-Repo abweicht
//   node scripts/sync-core.mjs --source <pfad zum Addon-Repo>
//
// Quelle: --source, sonst Umgebungsvariable CHRONICLE_REPO (auch aus .env), sonst ../EveN_ForeverChronicle.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REL_SRC = ["tools", "journal-export", "src"];
export const CORE_FILES = ["lua-parse.mjs", "journal-model.mjs", "i18n.mjs", "render.mjs", "style.css"];
const CORE_DIR = join(ROOT, "src", "core");

export function headerFor(name) {
  const text =
    "Herkunft: EveN_ForeverChronicle/tools/journal-export/src/" + name + " (kopiert mit scripts/sync-core.mjs).\n" +
    "NICHT HIER BEARBEITEN: Pflege im Addon-Repo, danach `npm run sync-core`. Commit siehe SOURCE.txt.";
  if (name.endsWith(".css")) return "/* " + text.replace("\n", "\n   ") + " */\n";
  return text.split("\n").map((l) => "// " + l).join("\n") + "\n";
}

export function withHeader(name, content) {
  return headerFor(name) + content.replace(/\r\n/g, "\n");
}

function loadEnvFile() {
  const f = join(ROOT, ".env");
  if (existsSync(f) && typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile(f);
    } catch {
      /* unlesbare .env: dann gelten Vorgabe und Argumente */
    }
  }
}

export function resolveSource(argv, env) {
  const i = argv.indexOf("--source");
  if (i >= 0) {
    if (!argv[i + 1]) throw new Error("--source braucht einen Pfad.");
    return resolve(argv[i + 1]);
  }
  if (env.CHRONICLE_REPO) return resolve(env.CHRONICLE_REPO);
  return resolve(ROOT, "..", "EveN_ForeverChronicle");
}

function git(repo, ...args) {
  try {
    return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function main() {
  loadEnvFile();
  const check = process.argv.includes("--check");
  let repo;
  try {
    repo = resolveSource(process.argv.slice(2), process.env);
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  const srcDir = join(repo, ...REL_SRC);
  if (!existsSync(srcDir)) {
    console.error("Addon-Repo nicht gefunden: " + srcDir);
    console.error("Pfad per --source <ordner> oder CHRONICLE_REPO in .env angeben (siehe .env.example).");
    process.exit(2);
  }
  const missing = CORE_FILES.filter((f) => !existsSync(join(srcDir, f)));
  if (missing.length) {
    console.error("Im Addon-Repo fehlen: " + missing.join(", "));
    process.exit(2);
  }

  const wanted = new Map(CORE_FILES.map((f) => [f, withHeader(f, readFileSync(join(srcDir, f), "utf8"))]));

  if (check) {
    const stale = [];
    for (const [name, content] of wanted) {
      const target = join(CORE_DIR, name);
      const current = existsSync(target) ? readFileSync(target, "utf8").replace(/\r\n/g, "\n") : null;
      if (current !== content) stale.push(name);
    }
    if (stale.length) {
      console.error("src/core/ ist nicht aktuell (" + stale.join(", ") + "). Abgleich: npm run sync-core");
      process.exit(1);
    }
    console.log("src/core/ ist aktuell gegenüber " + repo);
    return;
  }

  mkdirSync(CORE_DIR, { recursive: true });
  for (const [name, content] of wanted) writeFileSync(join(CORE_DIR, name), content, "utf8");
  const commit = git(repo, "rev-parse", "HEAD") || "unbekannt";
  const dirty = git(repo, "status", "--porcelain", "--", REL_SRC.join("/"));
  const lines = [
    "Quelle: EveN_ForeverChronicle, Ordner " + REL_SRC.join("/"),
    "Commit: " + commit,
    "Ungesicherte Änderungen in der Quelle: " + (dirty ? "ja (Kopie entspricht dem Arbeitsstand, nicht dem Commit)" : "nein"),
    "Dateien: " + CORE_FILES.join(", "),
    "Stand: " + new Date().toISOString(),
    "",
  ];
  writeFileSync(join(CORE_DIR, "SOURCE.txt"), lines.join("\n"), "utf8");
  console.log("kopiert nach src/core/: " + CORE_FILES.join(", ") + " (Quell-Commit " + commit.slice(0, 7) + ")");
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) main();
