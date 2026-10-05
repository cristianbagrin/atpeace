// Default playback speed (yt.watch.defaultSpeed): every video starts at the chosen speed.
//
// The speed is set through the player API (bridge `setPlaybackRate`, which YouTube's own UI follows;
// DOM `video.playbackRate` is the fallback when the bridge is absent). It is applied when a video's
// metadata is loaded and again when it starts playing, because YouTube restores its own remembered
// speed at those moments. A speed the USER changes during the same video wins: a `ratechange` that
// we did not cause, shortly after a trusted keyboard shortcut (< >) or a click in the player's
// settings menu, switches the feature off for that video.
//
// Verified with the player API in the sandbox (setPlaybackRate/getPlaybackRate round trip, docs/youtube-dom.md §4.4);
// the effect on a PLAYING video and the "user changed it" detection need real playback (user checklist).
(() => {
  'use strict';
  const AP = globalThis.AtPeace;
  const { shared } = AP.yt;
  const bridge = () => AP.yt.bridge;

  const ID = 'yt.watch.defaultSpeed';
  /** A ratechange within this long of our own call is ours. */
  const OWN_MS = 800;
  /** A ratechange within this long of the user's shortcut/menu click is theirs. */
  const USER_MS = 2500;
  const MAX_REAPPLY = 3;

  // ---- pure helpers (unit-tested) -------------------------------------------------------------------------------

  /** The speed a setting value means, or null for "leave it" / garbage. */
  function parseSpeed(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0.25 && n <= 2 ? n : null;
  }

  /**
   * Who changed the speed? `ours` (we just set it), `user` (a shortcut / menu click just before) or
   * `player` (YouTube itself, e.g. restoring its remembered speed).
   * @param {{ now: number, ownSetAt: number, userInputAt: number }} s
   * @returns {'ours'|'user'|'player'}
   */
  function classifyRateChange({ now, ownSetAt, userInputAt }) {
    // The user's shortcut or menu click AFTER our own change is theirs, even right after it.
    if (userInputAt > ownSetAt && now - userInputAt < USER_MS) return 'user';
    if (now - ownSetAt < OWN_MS) return 'ours';
    if (userInputAt > 0 && now - userInputAt < USER_MS) return 'user';
    return 'player';
  }

  // ---- state -------------------------------------------------------------------------------------------------------

  let current = null; // ctx
  let videoId = null;
  let userChanged = false;
  let reapplied = 0;
  let ownSetAt = 0;
  let listening = false;

  const wanted = () => parseSpeed(current?.settings?.[ID]);
  const isMainVideo = (el) => el?.localName === 'video' && el === shared.mainVideo();

  async function apply(video) {
    const speed = wanted();
    if (speed === null || userChanged || current?.page !== 'watch' || !video) return;
    if (video.playbackRate === speed) return;
    ownSetAt = Date.now();
    const res = await bridge()?.call('setPlaybackRate', speed);
    ownSetAt = Date.now(); // the answer came back later than the call went out
    if (!res?.ok && video.playbackRate !== speed) video.playbackRate = speed;
  }

  function onVideoEvent(event) {
    try {
      if (!isMainVideo(event.target)) return;
      if (event.type === 'ratechange') {
        const who = classifyRateChange({ now: Date.now(), ownSetAt, userInputAt: shared.inputs.lastSpeedAt });
        if (who === 'user') userChanged = true;
        else if (who === 'player' && !userChanged && wanted() !== null && event.target.playbackRate !== wanted() && reapplied++ < MAX_REAPPLY) {
          setTimeout(() => apply(event.target), 150); // YouTube restored its own speed: put ours back (bounded)
        }
        return;
      }
      apply(event.target); // loadedmetadata, playing
    } catch (err) {
      AP.warn('speed handler failed', err);
    }
  }

  function newVideo() {
    userChanged = false;
    reapplied = 0;
  }

  let retryTimers = [];
  function applyAfterNavigation() {
    for (const t of retryTimers) clearTimeout(t);
    retryTimers = [0, 800, 2500].map((delay) => setTimeout(() => apply(shared.mainVideo()).catch((err) => AP.warn('speed apply failed', err)), delay));
  }

  const EVENTS = ['loadedmetadata', 'playing', 'ratechange'];

  AP.yt.features.push({
    id: 'speed',
    settings: [ID],
    init(ctx) {
      current = ctx;
      if (!listening) {
        listening = true;
        shared.inputs.acquire();
        for (const type of EVENTS) document.addEventListener(type, onVideoEvent, true);
      }
    },
    onNavigate(ctx) {
      current = ctx;
      const id = shared.videoIdOf(ctx.url);
      if (id !== videoId) {
        videoId = id;
        newVideo();
      }
      // The speed is also set before the video has loaded anything: the player keeps it (verified: the
      // API answers setPlaybackRate/getPlaybackRate on an unstarted player) and the loadedmetadata /
      // playing handlers put it back if YouTube restores its own. The player may not exist yet, hence a
      // few bounded retries (not a poll).
      applyAfterNavigation();
    },
    onSettings(ctx) {
      current = ctx;
      newVideo(); // a new choice in the options: apply it to the video that is open
      applyAfterNavigation();
    },
    destroy() {
      for (const t of retryTimers) clearTimeout(t);
      retryTimers = [];
      if (listening) {
        listening = false;
        shared.inputs.release();
        for (const type of EVENTS) document.removeEventListener(type, onVideoEvent, true);
      }
      current = null;
    },
  });

  AP.yt.speed = { parseSpeed, classifyRateChange };
})();
