// "Are you still watching?" (yt.watch.dismissStillWatching): playback is never interrupted by the
// idle prompt ("Video paused. Continue watching?").
//
//   1. Prevention: while a watch page is open, `window._lact` (YouTube's "last user activity" time,
//      which its idle detector reads) is refreshed from the MAIN world every minute (bridge
//      `keepActive`). Verified: `_lact` exists and is a number (docs/youtube-dom.md §4.5).
//   2. Fallback: if the dialog shows up anyway, its confirm button is pressed. A dialog is only
//      dismissed when the user has been idle for a minute, because other confirm dialogs (delete a
//      playlist, unsubscribe…) are also `yt-confirm-dialog-renderer`s and always follow a click.
//
// Neither can be exercised without hours of playback (no video in the sandbox, and the dialog's exact
// markup is from public sources): the decision logic is unit-tested, and this is on the user checklist.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;
  const { shared } = AP.yt;
  const bridge = () => AP.yt.bridge;

  const ID = 'yt.watch.dismissStillWatching';
  const KEEP_ALIVE_MS = 60_000;
  /** The idle prompt appears after hours; a dialog within this long of the user's last input is theirs. */
  const IDLE_MS = 60_000;
  const DIALOG = 'yt-confirm-dialog-renderer';

  /**
   * May a confirm dialog be dismissed on the user's behalf?
   * @param {{ now: number, lastInputAt: number, pageStartedAt: number, onWatchPage: boolean }} s
   * @returns {boolean}
   */
  function mayDismiss({ now, lastInputAt, pageStartedAt, onWatchPage }) {
    if (!onWatchPage) return false;
    return now - Math.max(lastInputAt, pageStartedAt) >= IDLE_MS;
  }

  /** Should the keep-alive run now? On a watch page that is visible or has a video playing (background music). */
  function shouldKeepAlive({ onWatchPage, visible, playing }) {
    return onWatchPage && (visible || playing);
  }

  let current = null; // ctx
  let timer = null;
  let started = 0;

  function keepAlive() {
    try {
      const video = shared.mainVideo();
      const playing = Boolean(video && !video.paused && !video.ended);
      if (shouldKeepAlive({ onWatchPage: current?.page === 'watch', visible: document.visibilityState === 'visible', playing })) {
        bridge()?.call('keepActive');
      }
    } catch (err) {
      AP.warn('keep-alive failed', err);
    }
  }

  function dismissDialogs(roots) {
    if (current?.settings?.[ID] !== true) return;
    if (!mayDismiss({ now: Date.now(), lastInputAt: shared.inputs.lastAt, pageStartedAt: started, onWatchPage: current.page === 'watch' })) return;
    const seen = new Set();
    for (const root of roots) {
      // Dialogs are added to YouTube's popup container; a root anywhere else cannot be one.
      if (root.localName !== 'html' && !root.closest?.('ytd-popup-container')) continue;
      const dialogs = [];
      const own = root.closest?.(DIALOG);
      if (own) dialogs.push(own);
      if (root.querySelectorAll) dialogs.push(...root.querySelectorAll(DIALOG));
      for (const dialog of dialogs) {
        if (seen.has(dialog)) continue;
        seen.add(dialog);
        const button = dialog.querySelector('#confirm-button button, #confirm-button');
        if (button && (button.offsetParent !== null || button.getClientRects().length > 0)) {
          AP.log('[still-watching] confirming the idle dialog');
          button.click();
        }
      }
    }
  }

  AP.yt.features.push({
    id: 'still-watching',
    settings: [ID],
    observes: true,
    init(ctx) {
      current = ctx;
      started = Date.now();
      shared.inputs.acquire();
      timer = setInterval(keepAlive, KEEP_ALIVE_MS);
    },
    onNavigate(ctx) {
      current = ctx;
      keepAlive();
    },
    onSettings(ctx) {
      current = ctx;
    },
    onMutations(ctx, roots) {
      current = ctx;
      if (ctx.page !== 'watch') return;
      // Only the popup container matters: dialogs are added there. (The first delivery after
      // activation is the whole document, which also finds a dialog that is already open.)
      dismissDialogs(roots);
    },
    destroy() {
      clearInterval(timer);
      timer = null;
      shared.inputs.release();
      current = null;
    },
  });

  AP.yt.stillWatching = { mayDismiss, shouldKeepAlive };
})();
