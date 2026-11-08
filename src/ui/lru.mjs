// Kleiner LRU-Speicher (Map in Zugriffsreihenfolge): hält höchstens max Einträge, der am längsten nicht benutzte fällt
// zuerst heraus. Für Kartenbilder und Szenen der Reise, damit langes Durchklicken den Speicher nicht füllt.
export const LRU_MAX = 6;

export function createLru(max = LRU_MAX) {
  const map = new Map();
  const limit = Number.isInteger(max) && max > 0 ? max : LRU_MAX;
  return {
    get(key) {
      if (!map.has(key)) return undefined;
      const v = map.get(key);
      map.delete(key);
      map.set(key, v);
      return v;
    },
    peek(key) {
      return map.get(key);
    },
    has(key) {
      return map.has(key);
    },
    set(key, value) {
      if (map.has(key)) map.delete(key);
      map.set(key, value);
      while (map.size > limit) map.delete(map.keys().next().value);
      return value;
    },
    entries() {
      return map.entries();
    },
    [Symbol.iterator]() {
      return map.entries();
    },
    get size() {
      return map.size;
    },
  };
}
