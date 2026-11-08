// Minimales DOM für Tests ohne Browser: Elemente und Textknoten. innerHTML & Co. werfen, damit jede Benutzung auffällt.

export function makeNode(tag, created) {
  const handlers = new Map();
  const node = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    className: "",
    attributes: {},
    childNodes: [],
    files: null,
    value: "",
    selected: false,
    appendChild(c) {
      this.childNodes.push(c);
      c.parentNode = this;
      return c;
    },
    removeChild(c) {
      const i = this.childNodes.indexOf(c);
      if (i >= 0) this.childNodes.splice(i, 1);
      return c;
    },
    get firstChild() {
      return this.childNodes[0] || null;
    },
    setAttribute(k, v) {
      this.attributes[k] = String(v);
    },
    addEventListener(type, fn) {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type).push(fn);
    },
    dispatch(type, event = {}) {
      for (const fn of handlers.get(type) || []) fn(event);
    },
    classList: {
      set: new Set(),
      add(c) { this.set.add(c); },
      remove(c) { this.set.delete(c); },
      contains(c) { return this.set.has(c); },
    },
    click() {
      this.dispatch("click", {});
    },
    get textContent() {
      return this.childNodes.map((c) => (c.nodeType === 3 ? c.data : c.textContent)).join("");
    },
  };
  for (const bad of ["innerHTML", "outerHTML"]) {
    Object.defineProperty(node, bad, { set() { throw new Error(bad + " benutzt"); }, get() { return undefined; } });
  }
  node.insertAdjacentHTML = () => { throw new Error("insertAdjacentHTML benutzt"); };
  if (created) created.push(node);
  return node;
}

export function findAll(node, pred, out = []) {
  if (node.nodeType === 1) {
    if (pred(node)) out.push(node);
    for (const c of node.childNodes) findAll(c, pred, out);
  }
  return out;
}

export function fakeEnv({ language = "en-US", stored = null } = {}) {
  const created = [];
  const appRoot = makeNode("div", created);
  const body = makeNode("body", created);
  const doc = {
    created,
    title: "",
    body,
    documentElement: makeNode("html", created),
    getElementById: (id) => (id === "app" ? appRoot : null),
    createElement: (tag) => makeNode(tag, created),
    createTextNode: (data) => ({ nodeType: 3, data: String(data) }),
  };
  const store = new Map(stored ? Object.entries(stored) : []);
  const win = makeNode("window");
  win.navigator = { language };
  win.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
  return { doc, win, appRoot, store };
}

// File-Ersatz: Name, Text, optional Typ/Größe (Größe getrennt vom Text, um Limits ohne große Daten zu prüfen)
export function makeFile(name, text, { type = "", size } = {}) {
  let reads = 0;
  return {
    name,
    type,
    size: size === undefined ? Buffer.byteLength(text, "utf8") : size,
    text: async () => {
      reads++;
      return text;
    },
    get reads() {
      return reads;
    },
  };
}

export const tick = () => new Promise((r) => setTimeout(r, 0));
