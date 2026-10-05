// A tiny DOM for the picker's selector tests: elements with tag, attributes, children and a box,
// and a `querySelectorAll` that understands exactly the selector grammar the picker generates:
//
//   complex   := compound (' ' compound)*              descendant combinators only
//   compound  := (tag | '*')? ('#id' | '.class' | '[attr]' | '[attr="v"]' | '[attr^="v"]' | ':nth-child(n)')*
//
// Anything else throws, so a test fails loudly if the generator ever emits something this does not model.
// Real-DOM behaviour (layout, hover, the panel) is covered by tests/e2e/picker.spec.mjs.

class MiniElement {
  constructor(doc, tag, attrs, rect) {
    this.ownerDocument = doc;
    this.nodeType = 1;
    this.localName = tag.toLowerCase();
    this.attrs = new Map(Object.entries(attrs ?? {}).map(([k, v]) => [k, String(v)]));
    this.parentElement = null;
    this.children = [];
    this.rect = rect ?? { left: 0, top: 0, width: 100, height: 40 };
    this.hiddenBox = false;
  }

  getAttribute(name) {
    return this.attrs.has(name) ? this.attrs.get(name) : null;
  }

  setAttribute(name, value) {
    this.attrs.set(name, String(value));
  }

  getBoundingClientRect() {
    const r = this.rect;
    return { ...r, right: r.left + r.width, bottom: r.top + r.height };
  }

  getClientRects() {
    return this.hiddenBox ? [] : [this.getBoundingClientRect()];
  }

  get isConnected() {
    let n = this;
    while (n.parentElement) n = n.parentElement;
    return n === this.ownerDocument.documentElement;
  }

  append(...kids) {
    for (const kid of kids) {
      kid.parentElement = this;
      this.children.push(kid);
    }
    return this;
  }
}

const COMPOUND_PART = /^(?:(\*|[a-z][a-z0-9-]*)|#([A-Za-z0-9_-]+)|\.([A-Za-z0-9_-]+)|\[([a-zA-Z0-9_:-]+)(?:(\^?=)"([^"]*)")?\]|:nth-child\((\d+)\))/;

function parseCompound(text) {
  const out = { tag: null, id: null, classes: [], attrs: [], nth: null };
  let rest = text;
  while (rest !== '') {
    const m = COMPOUND_PART.exec(rest);
    if (!m) throw new Error(`mini-dom cannot parse "${text}" at "${rest}"`);
    if (m[1]) out.tag = m[1];
    else if (m[2]) out.id = m[2];
    else if (m[3]) out.classes.push(m[3]);
    else if (m[4]) out.attrs.push({ name: m[4], op: m[5] ?? null, value: m[6] ?? null });
    else out.nth = Number(m[7]);
    rest = rest.slice(m[0].length);
  }
  return out;
}

function matchesCompound(el, c) {
  if (c.tag && c.tag !== '*' && el.localName !== c.tag) return false;
  if (c.id !== null && el.getAttribute('id') !== c.id) return false;
  const classes = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
  if (!c.classes.every((k) => classes.includes(k))) return false;
  for (const a of c.attrs) {
    const v = el.getAttribute(a.name);
    if (v === null) return false;
    if (a.op === '=' && v !== a.value) return false;
    if (a.op === '^=' && !v.startsWith(a.value)) return false;
  }
  if (c.nth !== null) {
    const parent = el.parentElement;
    if (!parent || parent.children.indexOf(el) + 1 !== c.nth) return false;
  }
  return true;
}

export class MiniDocument {
  constructor({ width = 1280, height = 800 } = {}) {
    this.nodeType = 9;
    this.defaultView = { innerWidth: width, innerHeight: height };
    this.documentElement = new MiniElement(this, 'html', {}, { left: 0, top: 0, width, height });
    this.body = new MiniElement(this, 'body', {}, { left: 0, top: 0, width, height });
    this.documentElement.append(this.body);
  }

  querySelectorAll(selector) {
    if (/[,>+~]/.test(selector.replace(/"[^"]*"/g, ''))) throw new Error(`mini-dom: unsupported selector ${selector}`);
    const compounds = selector.trim().split(/\s+/).map(parseCompound);
    const out = [];
    const walk = (el) => {
      if (matchesComplex(el, compounds)) out.push(el);
      el.children.forEach(walk);
    };
    walk(this.documentElement);
    return out;
  }
}

function matchesComplex(el, compounds) {
  if (!matchesCompound(el, compounds[compounds.length - 1])) return false;
  let at = el.parentElement;
  for (let i = compounds.length - 2; i >= 0; i--) {
    while (at && !matchesCompound(at, compounds[i])) at = at.parentElement;
    if (!at) return false;
    at = at.parentElement;
  }
  return true;
}

/**
 * Builds an element: `el(doc, 'ytd-foo', { id: 'x', class: 'a b' }, [children], rect?)`.
 * @param {MiniDocument} doc
 */
export function el(doc, tag, attrs = {}, children = [], rect) {
  const node = new MiniElement(doc, tag, attrs, rect);
  node.append(...children);
  return node;
}
