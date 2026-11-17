// Message protocol between content scripts / pages and the background (PLAN §8.1).
//
// Wire format (always): { type: <AP.msg.TYPES value>, payload: <object | undefined> }.
// Every handler answers with an object that has `ok: boolean`; failures carry `error: <code>`.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;

  /** @readonly */
  const TYPES = Object.freeze({
    PAUSE_CONTINUE: 'PAUSE_CONTINUE', // { siteKey, minutes }
    PAUSE_TURN_BACK: 'PAUSE_TURN_BACK', // { siteKey }
    PAUSE_OPENED: 'PAUSE_OPENED', // { siteKey }
    FOCUS_START: 'FOCUS_START', // { minutes | untilEndOfDay, siteKeys }
    FOCUS_END: 'FOCUS_END',
    HEARTBEAT: 'HEARTBEAT', // { siteKey }
    CLOSE_TAB: 'CLOSE_TAB', // closes sender.tab.id
    GET_STATUS: 'GET_STATUS', // → { block, sessions, activeSchedules, today, limit, … } (see src/background/sessions.js)
    OPEN_OPTIONS: 'OPEN_OPTIONS', // { section? }
    START_PICKER: 'START_PICKER',
    LIMIT_GRACE: 'LIMIT_GRACE', // {} → "5 more minutes" after the daily limit (Phase 3c)
    BLOCKED_OPENED: 'BLOCKED_OPENED', // { siteKey, reason } the blocked page loaded → stats.blockedHits (Phase 3c)
    LOCK_UNLOCK: 'LOCK_UNLOCK', // { password? | frictionDone? } → verifies, then state.lockUnlockedUntil = now + 10 min (Phase 4b)
    LOCK_RELOCK: 'LOCK_RELOCK', // {} → state.lockUnlockedUntil = 0
    STATS_CLEAR: 'STATS_CLEAR', // {} → the background clears the usage history (needs an unlock while the settings lock is on)
    ONBOARDING_DONE: 'ONBOARDING_DONE', // {} → meta.onboarded = true (only the background writes meta)
    ACCOUNT_STATUS: 'ACCOUNT_STATUS', // {} → { email, signedIn, at, error, held, pending } (src/background/account.js)
    ACCOUNT_SIGN_IN: 'ACCOUNT_SIGN_IN', // { email, password, create } → status, or { ok: false, error }
    ACCOUNT_SIGN_OUT: 'ACCOUNT_SIGN_OUT', // {} → status
    ACCOUNT_FORGOT: 'ACCOUNT_FORGOT', // { email } → { ok } or { ok: false, error }
    ACCOUNT_SYNC: 'ACCOUNT_SYNC', // {} → status after a sync
  });

  // Chrome and Firefox both say "Could not establish connection. Receiving end does not exist."
  // when nothing listens (background asleep/not ready, page being torn down). "Extension context
  // invalidated" happens in content scripts that outlive an extension update or reload.
  const NO_RECEIVER = /receiving end does not exist/i;
  const CONTEXT_INVALIDATED = /extension context invalidated/i;

  /**
   * Sends a message to the background and resolves with its response.
   * "Nobody is listening" is not an error worth throwing for (callers are UI code that must keep
   * working), so it is logged and reported as `{ ok: false, error: 'no-receiver' }`.
   * Any other failure still rejects.
   * @param {string} type one of TYPES
   * @param {object} [payload]
   * @returns {Promise<any>}
   */
  async function send(type, payload) {
    try {
      return await AP.api.runtime.sendMessage({ type, payload });
    } catch (err) {
      const text = String(err?.message ?? err);
      if (NO_RECEIVER.test(text)) {
        AP.warn(`no receiver for "${type}" (background not running?)`);
        return { ok: false, error: 'no-receiver' };
      }
      if (CONTEXT_INVALIDATED.test(text)) {
        AP.warn(`extension was reloaded; "${type}" not delivered`);
        return { ok: false, error: 'context-invalidated' };
      }
      throw err;
    }
  }

  AP.msg = { TYPES, send };
})();
