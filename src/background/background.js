// Background entry (Phase 0 stub). Firefox runs this as a non-persistent event page, Chrome (tests
// only) as a service worker via sw-chrome.js. Either way: NO in-memory state that matters — read
// from storage on each event (PLAN §8). Listeners must be registered synchronously at top level
// so the browser can wake us for them.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;
  const api = AP.api;
  const T = AP.msg.TYPES;

  /**
   * Message router table: type → `(payload, sender) => response | Promise<response>`.
   * Later phases add their handlers here (or via AP.background.handlers).
   * @type {Record<string, (payload: any, sender: any) => any>}
   */
  const handlers = {
    [T.GET_STATUS]: () => ({ ok: true, version: api.runtime.getManifest().version }),

    [T.CLOSE_TAB]: async (_payload, sender) => {
      const tabId = sender?.tab?.id;
      if (tabId === undefined) return { ok: false, error: 'no-tab' };
      await api.tabs.remove(tabId);
      return { ok: true };
    },
  };

  /**
   * Resolves the response for one message. Never throws: handler failures become `{ ok:false }`.
   * @param {unknown} message
   * @param {any} sender
   * @returns {Promise<{ ok: boolean, [k: string]: any }>}
   */
  async function handleMessage(message, sender) {
    const type = AP.util.isPlainObject(message) ? message.type : undefined;
    // hasOwn: a message type like "toString" must not reach Object.prototype members.
    if (typeof type !== 'string' || !Object.hasOwn(handlers, type)) {
      return { ok: false, error: 'unknown' };
    }
    try {
      return await handlers[type](message.payload, sender);
    } catch (err) {
      AP.warn(`handler for ${type} failed`, err);
      return { ok: false, error: 'handler-failed' };
    }
  }

  // Chrome MV3 does not accept a returned Promise from onMessage listeners, so answer through
  // sendResponse and return true (keep the channel open). Works identically in Firefox.
  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender).then(sendResponse);
    return true;
  });

  api.runtime.onInstalled.addListener((details) => {
    AP.log('onInstalled', details.reason, api.runtime.getManifest().version);
  });

  api.runtime.onStartup.addListener(() => {
    AP.log('onStartup');
  });

  AP.background = { handlers, handleMessage };
})();
