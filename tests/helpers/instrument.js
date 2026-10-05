// TEST-ONLY content script (never shipped; the Chromium harness adds it to its temporary manifest copy
// when `launch({ instrument: true })` is used, tests/e2e/perf.spec.mjs). It runs in the extension's
// isolated world at document_start, BEFORE any At Peace script, and counts what that world leaves
// behind: event listeners, observers and intervals that were added and never removed.
//
// The page's own scripts live in another world, so none of this can see (or count) YouTube's listeners.
//
// Reading the numbers: from the page's main world, dispatch `document.dispatchEvent(new CustomEvent(
// 'ap-instr-sample'))` and read `document.documentElement.getAttribute('data-ap-instr')` (JSON).
(() => {
  'use strict';
  const listeners = new Map(); // key object → { targetRef, type, capture }
  const observers = new Set(); // observers that have observed something and not been disconnected
  const intervals = new Set();
  let added = 0;
  let removed = 0;

  const captureOf = (options) => (typeof options === 'boolean' ? options : Boolean(options?.capture));
  const targetKeys = new WeakMap(); // target → Map(`${type}|${capture}` → Map(fn → key))

  const nativeAdd = EventTarget.prototype.addEventListener;
  const nativeRemove = EventTarget.prototype.removeEventListener;

  function remember(target, type, fn, capture, once) {
    if (once || (typeof fn !== 'function' && typeof fn?.handleEvent !== 'function')) return;
    let byType = targetKeys.get(target);
    if (!byType) targetKeys.set(target, (byType = new Map()));
    const slot = `${type}|${capture}`;
    let byFn = byType.get(slot);
    if (!byFn) byType.set(slot, (byFn = new Map()));
    if (byFn.has(fn)) return; // the same registration twice is one listener
    const key = {};
    byFn.set(fn, key);
    listeners.set(key, { targetRef: new WeakRef(target), type, capture });
    added += 1;
  }

  function forget(target, type, fn, capture) {
    const byFn = targetKeys.get(target)?.get(`${type}|${capture}`);
    const key = byFn?.get(fn);
    if (!key) return;
    byFn.delete(fn);
    listeners.delete(key);
    removed += 1;
  }

  EventTarget.prototype.addEventListener = function addEventListener(type, fn, options) {
    remember(this, String(type), fn, captureOf(options), Boolean(options?.once));
    if (options?.signal) options.signal.addEventListener('abort', () => forget(this, String(type), fn, captureOf(options)), { once: true });
    return nativeAdd.call(this, type, fn, options);
  };
  EventTarget.prototype.removeEventListener = function removeEventListener(type, fn, options) {
    forget(this, String(type), fn, captureOf(options));
    return nativeRemove.call(this, type, fn, options);
  };

  for (const name of ['MutationObserver', 'ResizeObserver', 'IntersectionObserver']) {
    const Native = globalThis[name];
    if (!Native) continue;
    const observe = Native.prototype.observe;
    const disconnect = Native.prototype.disconnect;
    Native.prototype.observe = function patchedObserve(...args) {
      observers.add({ kind: name, ref: new WeakRef(this) });
      return observe.apply(this, args);
    };
    Native.prototype.disconnect = function patchedDisconnect() {
      for (const rec of observers) if (rec.ref.deref() === this) observers.delete(rec);
      return disconnect.call(this);
    };
  }

  const nativeSetInterval = globalThis.setInterval;
  const nativeClearInterval = globalThis.clearInterval;
  globalThis.setInterval = function patchedSetInterval(...args) {
    const id = nativeSetInterval.apply(this, args);
    intervals.add(id);
    return id;
  };
  globalThis.clearInterval = function patchedClearInterval(id) {
    intervals.delete(id);
    return nativeClearInterval.call(this, id);
  };

  /** Listeners on things that outlive a page swap (window, document, the root, body, navigation…) vs elements still in the page. */
  function sample() {
    const byTarget = {};
    const byType = {};
    let total = 0;
    for (const [key, rec] of listeners) {
      const target = rec.targetRef.deref();
      if (!target) {
        listeners.delete(key); // collected: not a leak
        continue;
      }
      if (target instanceof Node && !target.isConnected) continue; // an element that left the page takes its listeners with it
      const label = target === window ? 'window' : target === document ? 'document' : target instanceof Node ? `<${target.localName}>` : (target.constructor?.name ?? 'other');
      byTarget[label] = (byTarget[label] ?? 0) + 1;
      byType[rec.type] = (byType[rec.type] ?? 0) + 1;
      total += 1;
    }
    const liveObservers = {};
    for (const rec of observers) {
      if (!rec.ref.deref()) {
        observers.delete(rec);
        continue;
      }
      liveObservers[rec.kind] = (liveObservers[rec.kind] ?? 0) + 1;
    }
    return { listeners: total, byTarget, byType, observers: liveObservers, intervals: intervals.size, added, removed };
  }

  document.addEventListener('ap-instr-sample', () => {
    document.documentElement.setAttribute('data-ap-instr', JSON.stringify(sample()));
  });
})();
