// Wiedergabe der Reise (portiert aus addon/InkAndEmbers/journal/Playback.lua): Zustand auf der Wiedergabe-Achse
// (parse-trail buildTimeline: Leerlauf und Offline-Zeit gekürzt), Tempo = Spielsekunden je echter Sekunde.
// Reine Daten, kein DOM; die Oberfläche (ui/journey.mjs) und das Video (W6) treiben sie mit step().

export const SPEEDS = Object.freeze([20, 60, 180]);
export const DEFAULT_SPEED = 60;
export const SPEED_KEYS = Object.freeze({ 20: "speedSlow", 60: "speedMedium", 180: "speedFast" });

export function validSpeed(speed) {
  return SPEEDS.includes(speed) ? speed : DEFAULT_SPEED;
}

// p0..p1 Bereich auf der Achse (Kapitel oder ganze Reise), p aktuelle Stelle
export function createPlayback(speed) {
  return { p0: 0, p1: 0, p: 0, playing: false, speed: validSpeed(speed) };
}

// neuer Bereich: angehalten, Stelle am Ende (zeigt den ganzen Weg)
export function setRange(st, p0, p1) {
  const a = Number.isFinite(p0) ? p0 : 0;
  const b = Number.isFinite(p1) && p1 >= a ? p1 : a;
  st.p0 = a;
  st.p1 = b;
  st.p = b;
  st.playing = false;
  return st;
}

export function setSpeed(st, speed) {
  st.speed = validSpeed(speed);
  return st.speed;
}

// Abspielen/Anhalten; am Ende beginnt es von vorn
export function toggle(st) {
  if (st.playing) st.playing = false;
  else {
    if (st.p >= st.p1) st.p = st.p0;
    st.playing = st.p1 > st.p0;
  }
  return st.playing;
}

export function pause(st) {
  st.playing = false;
}

// dt echte Sekunden -> true, wenn sich die Stelle bewegt hat
export function step(st, dt) {
  if (!st.playing || !Number.isFinite(dt) || dt <= 0) return false;
  const before = st.p;
  st.p = Math.min(st.p1, st.p + dt * st.speed);
  if (st.p >= st.p1) st.playing = false;
  return st.p !== before;
}

// Sprung auf einen Anteil 0..1 des Bereichs
export function seek(st, frac) {
  const f = Math.max(0, Math.min(1, Number.isFinite(frac) ? frac : 0));
  st.p = st.p0 + (st.p1 - st.p0) * f;
  return st.p;
}

export function frac(st) {
  return st.p1 <= st.p0 ? 1 : (st.p - st.p0) / (st.p1 - st.p0);
}

// Stelle, bis zu der gezeichnet wird: angehalten am Ende = alles (Infinity), sonst die Achsensekunde
export function drawAxis(st) {
  return !st.playing && st.p >= st.p1 ? Infinity : st.p;
}

// echte Sekunden für den ganzen Bereich bei diesem Tempo
export function realDuration(st) {
  return (st.p1 - st.p0) / st.speed;
}
