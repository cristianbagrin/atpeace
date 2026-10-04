// A tiny fake DOM for the engine tests: just enough of document / window / MutationObserver /
// requestAnimationFrame for src/content/engine.js. Not a general DOM; extend it when the engine
// needs more. Everything the engine touches is injected through `config.env`, so nothing here
// leaks into globalThis.

export class FakeElement extends EventTarget {
  constructor(tagName, doc) {
    super();
    this.tagName = tagName.toUpperCase();
    this.nodeType = 1;
    this.ownerDocument = doc;
    this.parentNode = null;
    this.children = [];
    this.id = '';
    this._attrs = new Map();
    this._text = '';
  }

  get isConnected() {
    let node = this;
    while (node.parentNode) node = node.parentNode;
    return node === this.ownerDocument;
  }

  get textContent() {
    return this._text;
  }

  set textContent(value) {
    this._text = String(value);
  }

  setAttribute(name, value) {
    this._attrs.set(name, String(value));
  }

  getAttribute(name) {
    return this._attrs.has(name) ? this._attrs.get(name) : null;
  }

  removeAttribute(name) {
    this._attrs.delete(name);
  }

  appendChild(child) {
    child.remove();
    child.parentNode = this;
    this.children.push(child);
    this.ownerDocument._record(this, [child], []);
    return child;
  }

  remove() {
    const parent = this.parentNode;
    if (!parent) return;
    parent.children.splice(parent.children.indexOf(this), 1);
    this.parentNode = null;
    this.ownerDocument._record(parent, [], [this]);
  }
}

export class FakeMutationObserver {
  /** All observers ever created in this test file; tests inspect `.active` / `.observing`. */
  static instances = [];

  constructor(callback) {
    this.callback = callback;
    this.targets = [];
    this.active = false;
    this.queue = [];
    this.scheduled = false;
    FakeMutationObserver.instances.push(this);
  }

  observe(target, options) {
    this.targets.push({ target, options });
    this.active = true;
  }

  disconnect() {
    this.active = false;
    this.targets = [];
    this.queue = [];
  }

  /** Does this observer see a childList change under `parent`? */
  _sees(parent) {
    return this.active && this.targets.some(({ target, options }) => {
      if (!options.childList) return false;
      if (target === parent) return true;
      if (!options.subtree) return false;
      for (let p = parent; p; p = p.parentNode) if (p === target) return true;
      return false;
    });
  }

  _deliver(record) {
    this.queue.push(record);
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      const records = this.queue.splice(0);
      if (this.active && records.length > 0) this.callback(records, this);
    });
  }
}

export class FakeDocument extends EventTarget {
  constructor() {
    super();
    this.nodeType = 9;
    this.parentNode = null;
    this.documentElement = new FakeElement('html', this);
    this.documentElement.parentNode = this; // so ancestor walks and isConnected reach the document
    this.readyState = 'loading';
  }

  createElement(tag) {
    return new FakeElement(tag, this);
  }

  createTextNode(text) {
    const node = new FakeElement('#text', this);
    node.nodeType = 3;
    node.textContent = text;
    return node;
  }

  getElementById(id) {
    const walk = (el) => {
      if (el.id === id) return el;
      for (const child of el.children) {
        const found = walk(child);
        if (found) return found;
      }
      return null;
    };
    return walk(this.documentElement);
  }

  /** Notifies observers about a childList change. */
  _record(parent, added, removed) {
    for (const observer of FakeMutationObserver.instances) {
      if (observer._sees(parent)) {
        observer._deliver({ type: 'childList', target: parent, addedNodes: added, removedNodes: removed });
      }
    }
  }
}

export class FakeWindow extends EventTarget {
  constructor(href = 'https://www.youtube.com/') {
    super();
    this.location = new URL(href);
    this.navigation = new EventTarget();
    this._frames = [];
    this._nextFrame = 1;
  }

  /** Moves location like history.pushState does (no events). */
  pushState(href) {
    this.location = new URL(href, this.location);
  }

  requestAnimationFrame(cb) {
    const handle = this._nextFrame++;
    this._frames.push([handle, cb]);
    return handle;
  }

  cancelAnimationFrame(handle) {
    this._frames = this._frames.filter(([h]) => h !== handle);
  }

  /** Runs the queued animation-frame callbacks (like the browser would before painting). */
  runFrames() {
    const frames = this._frames.splice(0);
    for (const [, cb] of frames) cb(0);
  }
}

/** Lets pending microtasks (MutationObserver deliveries, resolved promises) run. */
export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Builds the `env` the engine takes plus handles for the test.
 * @param {string} [href]
 */
export function createEnv(href) {
  FakeMutationObserver.instances = [];
  const doc = new FakeDocument();
  const win = new FakeWindow(href);
  return {
    doc,
    win,
    env: {
      doc,
      win,
      MutationObserver: FakeMutationObserver,
      raf: (cb) => win.requestAnimationFrame(cb),
      cancelRaf: (h) => win.cancelAnimationFrame(h),
    },
  };
}

/** A yt-navigate-start / finish style event. */
export function navEvent(type, detail) {
  return new CustomEvent(type, { detail });
}

/** Adds `count` nested element roots to a parent and returns them. */
export function addElements(doc, parent, tags) {
  return tags.map((tag) => parent.appendChild(doc.createElement(tag)));
}
