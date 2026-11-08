// Modell der Ansicht "Chronik & Statistik" für einen Charakter: Steckbrief, Medaillen, Stufenfluss, Erfahrungsquellen, Dungeons, Tode.
// Reine Berechnung auf den Daten der Datei (kein DOM, keine Texte); das Tagebuchmodell (buildJournal) liefert Kapitel, Höhepunkte,
// Notizen und die Bilanz-Zahlen und wird von der Ansicht unverändert weiterbenutzt.
import { makeCtx, num } from "./log.mjs";
import { buildProfile, buildFlow, buildSources, buildDeaths } from "./stats.mjs";
import { buildMedals, maxLevelFor } from "./medals.mjs";
import { buildDungeons } from "./dungeons.mjs";

export function buildChronik(db, guid, journal) {
  const ctx = makeCtx(db, guid);
  const profile = buildProfile(ctx, journal);
  const lines = ctx.list("L");
  const iface = lines.length ? num(lines[lines.length - 1], "interface") : null;
  const maxLevel = maxLevelFor(journal.flavor, iface);
  const dungeons = buildDungeons(ctx);
  return {
    ctx,
    profile,
    maxLevel,
    medals: buildMedals(ctx, { flavor: journal.flavor, maxLevel, level: profile.level }),
    flow: buildFlow(ctx, profile.level, profile.played),
    sources: buildSources(ctx),
    dungeons,
    deaths: buildDeaths(ctx, dungeons.instanceAt),
  };
}
