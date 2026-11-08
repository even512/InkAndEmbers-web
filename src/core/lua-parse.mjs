// Herkunft: EveN_ForeverChronicle/tools/journal-export/src/lua-parse.mjs (kopiert mit scripts/sync-core.mjs).
// NICHT HIER BEARBEITEN: Pflege im Addon-Repo, danach `npm run sync-core`. Commit siehe SOURCE.txt.
// Reader for SavedVariables files (Lua assignments 'Name = <value>' as World of Warcraft writes them).
// No eval: a small hand-written scanner for the Lua literal subset (tables, strings with all escapes, long strings,
// numbers incl. hex/exponent/inf/nan, true/false/nil, comments). Linear in the file size, fine for several MB.
// Lua tables become objects without prototype (Object.create(null)); every key is a string: numbers as their decimal
// text ("1", "2537"), positional entries count 1, 2, 3 ... (a positional nil leaves a hole, as in Lua).

export class LuaParseError extends Error {
  constructor(code, message, line) {
    super(message);
    this.name = "LuaParseError";
    this.code = code; // "empty" | "syntax" | "depth"
    this.line = line || 0;
  }
}

export const LUA_MAX_DEPTH = 100;

const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;
const utf8 = new TextDecoder("utf-8");

export function luaKey(k) {
  if (typeof k === "number") {
    if (Number.isInteger(k)) return String(k);
    return String(k);
  }
  if (typeof k === "boolean") return k ? "true" : "false";
  return String(k);
}

export function newTable() {
  return Object.create(null);
}

export function isTable(v) {
  return v !== null && typeof v === "object";
}

// array part of a table: values of keys 1..n in order (stops at the first hole only if nothing follows)
export function luaArray(t) {
  if (!isTable(t)) return [];
  const idx = [];
  for (const k of Object.keys(t)) {
    if (/^[1-9][0-9]*$/.test(k)) idx.push(Number(k));
  }
  idx.sort((a, b) => a - b);
  return idx.map((i) => t[String(i)]);
}

export function parseSavedVariables(input) {
  if (typeof input !== "string") throw new LuaParseError("empty", "Kein Text", 0);
  const src = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const p = new Parser(src);
  const out = newTable();
  p.skipSpace();
  if (p.pos >= src.length) throw new LuaParseError("empty", "Die Datei ist leer", 1);
  while (true) {
    p.skipSpace();
    if (p.pos >= src.length) break;
    if (src[p.pos] === ";") {
      p.pos++;
      continue;
    }
    const name = p.readName();
    if (name === "local") {
      p.skipSpace();
      continue;
    }
    let target = name;
    p.skipSpace();
    while (src[p.pos] === ".") {
      p.pos++;
      p.skipSpace();
      target += "." + p.readName();
      p.skipSpace();
    }
    p.expect("=");
    const value = p.readValue(0);
    out[target] = value === undefined ? null : value;
  }
  return out;
}

class Parser {
  constructor(src) {
    this.src = src;
    this.pos = 0;
  }

  line() {
    let n = 1;
    const end = Math.min(this.pos, this.src.length);
    for (let i = 0; i < end; i++) if (this.src.charCodeAt(i) === 10) n++;
    return n;
  }

  fail(msg) {
    throw new LuaParseError("syntax", msg, this.line());
  }

  skipSpace() {
    const s = this.src;
    const n = s.length;
    while (this.pos < n) {
      const c = s.charCodeAt(this.pos);
      if (c === 32 || c === 9 || c === 10 || c === 13 || c === 11 || c === 12) {
        this.pos++;
      } else if (c === 45 && s.charCodeAt(this.pos + 1) === 45) {
        // comment
        this.pos += 2;
        const lvl = this.longBracketLevel();
        if (lvl >= 0) {
          this.readLongString(lvl);
        } else {
          const nl = s.indexOf("\n", this.pos);
          this.pos = nl < 0 ? n : nl + 1;
        }
      } else {
        break;
      }
    }
  }

  expect(ch) {
    if (this.src[this.pos] !== ch) this.fail("'" + ch + "' erwartet");
    this.pos++;
  }

  readName() {
    const s = this.src;
    const start = this.pos;
    if (!IDENT_START.test(s[this.pos] || "")) this.fail("Name erwartet");
    this.pos++;
    while (this.pos < s.length && IDENT_PART.test(s[this.pos])) this.pos++;
    return s.slice(start, this.pos);
  }

  // at '[': returns the level of a long bracket ([[ = 0, [==[ = 2) and moves behind it, or -1 (position unchanged)
  longBracketLevel() {
    const s = this.src;
    if (s[this.pos] !== "[") return -1;
    let i = this.pos + 1;
    let lvl = 0;
    while (s[i] === "=") {
      lvl++;
      i++;
    }
    if (s[i] !== "[") return -1;
    this.pos = i + 1;
    return lvl;
  }

  atLongBracket() {
    const save = this.pos;
    const lvl = this.longBracketLevel();
    this.pos = save;
    return lvl >= 0;
  }

  readLongString(lvl) {
    const s = this.src;
    const close = "]" + "=".repeat(lvl) + "]";
    const end = s.indexOf(close, this.pos);
    if (end < 0) this.fail("Langer Text ohne Ende");
    let text = s.slice(this.pos, end);
    this.pos = end + close.length;
    if (text.startsWith("\r\n")) text = text.slice(2);
    else if (text.startsWith("\n")) text = text.slice(1);
    return text;
  }

  readValue(depth) {
    this.skipSpace();
    const s = this.src;
    const c = s[this.pos];
    if (c === undefined) this.fail("Wert erwartet, Datei endet");
    if (c === "{") return this.readTable(depth + 1);
    if (c === '"' || c === "'") return this.readString(c);
    if (c === "[") {
      const lvl = this.longBracketLevel();
      if (lvl < 0) this.fail("Unerwartetes '['");
      return this.readLongString(lvl);
    }
    if (c === "-" || c === "+" || c === "." || (c >= "0" && c <= "9")) return this.readNumber();
    if (IDENT_START.test(c)) {
      const name = this.readName();
      if (name === "true") return true;
      if (name === "false") return false;
      if (name === "nil") return undefined;
      if (name === "inf") return Infinity;
      if (name === "nan") return NaN;
      this.fail("Unbekannter Wert '" + name.slice(0, 20) + "'");
    }
    this.fail("Unerwartetes Zeichen '" + c + "'");
    return undefined;
  }

  readNumber() {
    const s = this.src;
    let sign = 1;
    while (s[this.pos] === "-" || s[this.pos] === "+") {
      if (s[this.pos] === "-") sign = -sign;
      this.pos++;
      this.skipSpace();
    }
    const start = this.pos;
    // WoW/MSVC spellings of infinity and NaN: 1.#INF, 1.#IND, -nan(ind)
    const m = /^(?:0[xX][0-9a-fA-F]*(?:\.[0-9a-fA-F]*)?(?:[pP][+-]?[0-9]+)?|[0-9]*\.?[0-9]*(?:[eE][+-]?[0-9]+)?)(#INF|#IND|#QNAN|#SNAN)?/.exec(
      s.slice(start, start + 64),
    );
    let text = m ? m[0] : "";
    if (text === "" || text === ".") {
      if (/^inf/.test(s.slice(start, start + 3))) {
        this.pos = start + 3;
        return sign * Infinity;
      }
      if (/^nan/.test(s.slice(start, start + 3))) {
        this.pos = start + 3;
        if (s[this.pos] === "(") {
          const close = s.indexOf(")", this.pos);
          if (close > 0 && close - this.pos < 16) this.pos = close + 1;
        }
        return NaN;
      }
      this.fail("Zahl erwartet");
    }
    this.pos = start + text.length;
    if (m[1]) return m[1] === "#INF" ? sign * Infinity : NaN;
    let v;
    if (/^0[xX]/.test(text)) {
      const hm = /^0[xX]([0-9a-fA-F]*)(?:\.([0-9a-fA-F]*))?(?:[pP]([+-]?[0-9]+))?$/.exec(text);
      if (!hm) this.fail("Ungültige Zahl");
      v = parseInt(hm[1] || "0", 16);
      if (hm[2]) for (let i = 0; i < hm[2].length; i++) v += parseInt(hm[2][i], 16) / Math.pow(16, i + 1);
      if (hm[3]) v *= Math.pow(2, Number(hm[3]));
    } else {
      v = Number(text);
    }
    if (Number.isNaN(v)) this.fail("Ungültige Zahl");
    return sign * v;
  }

  readString(q) {
    const s = this.src;
    const n = s.length;
    this.pos++;
    let out = "";
    let runStart = this.pos;
    let bytes = null; // pending raw bytes from \ddd / \xXX escapes (decoded as UTF-8 together)
    const flushBytes = () => {
      if (bytes && bytes.length) {
        out += utf8.decode(new Uint8Array(bytes));
        bytes = null;
      }
    };
    while (true) {
      if (this.pos >= n) this.fail("Text ohne Ende");
      const c = s[this.pos];
      if (c === q) {
        if (this.pos > runStart) {
          flushBytes();
          out += s.slice(runStart, this.pos);
        }
        flushBytes();
        this.pos++;
        return out;
      }
      if (c === "\n") this.fail("Zeilenumbruch in einem Text");
      if (c !== "\\") {
        this.pos++;
        continue;
      }
      if (this.pos > runStart) {
        flushBytes();
        out += s.slice(runStart, this.pos);
      }
      this.pos++;
      const e = s[this.pos];
      let simple = null;
      switch (e) {
        case "n": simple = "\n"; break;
        case "t": simple = "\t"; break;
        case "r": simple = "\r"; break;
        case "a": simple = "\x07"; break;
        case "b": simple = "\b"; break;
        case "f": simple = "\f"; break;
        case "v": simple = "\v"; break;
        case "\\": simple = "\\"; break;
        case '"': simple = '"'; break;
        case "'": simple = "'"; break;
        case "\n": simple = "\n"; break;
        case "\r":
          simple = "\n";
          if (s[this.pos + 1] === "\n") this.pos++;
          break;
        default: break;
      }
      if (simple !== null) {
        flushBytes();
        out += simple;
        this.pos++;
      } else if (e >= "0" && e <= "9") {
        let j = this.pos;
        let num = "";
        while (num.length < 3 && s[j] >= "0" && s[j] <= "9") num += s[j++];
        const b = Number(num);
        if (b > 255) this.fail("Ungültiges Zeichen-Escape");
        this.pos = j;
        if (b < 128) {
          flushBytes();
          out += String.fromCharCode(b);
        } else {
          (bytes || (bytes = [])).push(b);
        }
      } else if (e === "x") {
        const hex = s.slice(this.pos + 1, this.pos + 3);
        if (!/^[0-9a-fA-F]{2}$/.test(hex)) this.fail("Ungültiges \\x-Escape");
        const b = parseInt(hex, 16);
        this.pos += 3;
        if (b < 128) {
          flushBytes();
          out += String.fromCharCode(b);
        } else {
          (bytes || (bytes = [])).push(b);
        }
      } else if (e === "z") {
        this.pos++;
        while (this.pos < n && /\s/.test(s[this.pos])) this.pos++;
      } else if (e === "u" && s[this.pos + 1] === "{") {
        const close = s.indexOf("}", this.pos);
        const hex = close > 0 ? s.slice(this.pos + 2, close) : "";
        if (!/^[0-9a-fA-F]{1,6}$/.test(hex) || parseInt(hex, 16) > 0x10ffff) this.fail("Ungültiges \\u-Escape");
        flushBytes();
        out += String.fromCodePoint(parseInt(hex, 16));
        this.pos = close + 1;
      } else {
        this.fail("Ungültiges Escape");
      }
      runStart = this.pos;
    }
  }

  readTable(depth) {
    if (depth > LUA_MAX_DEPTH) throw new LuaParseError("depth", "Tabellen zu tief verschachtelt", this.line());
    const s = this.src;
    this.pos++; // {
    const t = newTable();
    let next = 1;
    while (true) {
      this.skipSpace();
      const c = s[this.pos];
      if (c === undefined) this.fail("Tabelle ohne '}'");
      if (c === "}") {
        this.pos++;
        return t;
      }
      if (c === "[" && !this.atLongBracket()) {
        // [key] = value  (a long string '[[' as a positional value falls through)
        this.pos++;
        const key = this.readValue(depth);
        this.skipSpace();
        this.expect("]");
        this.skipSpace();
        this.expect("=");
        const value = this.readValue(depth);
        if (key === undefined || (typeof key === "number" && Number.isNaN(key))) this.fail("Ungültiger Schlüssel");
        if (isTable(key)) this.fail("Tabelle als Schlüssel");
        if (value !== undefined) t[luaKey(key)] = value;
      } else if (IDENT_START.test(c || "")) {
        const save = this.pos;
        const name = this.readName();
        this.skipSpace();
        if (s[this.pos] === "=" && s[this.pos + 1] !== "=") {
          this.pos++;
          const value = this.readValue(depth);
          if (value !== undefined) t[name] = value;
        } else {
          this.pos = save;
          const value = this.readValue(depth);
          if (value !== undefined) t[String(next)] = value;
          next++;
        }
      } else {
        // positional value (a '[' here starts a long string)
        const value = this.readValue(depth);
        if (value !== undefined) t[String(next)] = value;
        next++;
      }
      this.skipSpace();
      const sep = s[this.pos];
      if (sep === "," || sep === ";") {
        this.pos++;
      } else if (sep !== "}") {
        this.fail("',' oder '}' erwartet");
      }
    }
  }
}
