// Thumbnail picture (yt.general.thumbnailFrame = start | middle | end): the picture of a video card becomes a
// frame of the video itself instead of the one the uploader chose. YouTube makes three frames of every
// processed video and serves them as https://i.ytimg.com/vi/<id>/mq1.jpg, mq2.jpg and mq3.jpg (320×180, 16:9;
// measured on a 58-minute video: roughly a quarter, the middle and three quarters of the way in; 1.jpg … 3.jpg
// are the 120×90 ones). No request leaves for any other host, and nothing is read from the video.
//
//   which images   the picture of a card in a feed, search, the watch sidebar, a channel, subscriptions, a playlist
//                  or its queue panel, and of a Shorts card. Not the player, a chapter, a playlist or a Mix (one
//                  card, many videos: there is no single frame), and not an avatar.
//   the video id   from the card's own link (`/watch?v=ID` or `/shorts/ID`), never from the title or the picture.
//   the original   kept in `data-at-peace-thumb-src` (and `-srcset`) and put back when the setting goes back to
//                  "Original" or the feature is switched off.
//   YouTube again  a picture arrives late (lazy loading) or YouTube sets `src` again (a card reused for another
//                  video, a refresh): a MutationObserver on `src`/`srcset` swaps it again, and a different original
//                  is remembered as the new original.
//   no frame       a frame that fails to load (a new video, a live stream, offline) puts the original back, once
//                  per video and frame, and is not tried again.
//   no flash       while the setting is on, a card picture that has not been looked at yet is transparent (a style
//                  this feature owns), so the original never shows for a frame before the swap. A 1.2 s fail-safe
//                  animation shows it anyway, whatever happens to this script.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;

  const ID = 'yt.general.thumbnailFrame';
  const FRAMES = Object.freeze({ start: 'mq1', middle: 'mq2', end: 'mq3' });
  const MARK = 'data-at-peace-thumb'; // the frame in place ("mq2"), or "skip" (not a single video) / "failed" (frame did not load)
  const MARK_ID = 'data-at-peace-thumb-id';
  const ORIG_SRC = 'data-at-peace-thumb-src';
  const ORIG_SRCSET = 'data-at-peace-thumb-srcset';
  const STYLE_ID = 'at-peace-thumb-style';
  const ROOT_ATTR = 'data-at-peace-thumb-frame'; // on <html> while the feature runs: the transparent-until-looked-at style hangs on it
  const FAILSAFE_MS = 1200;

  /** Every kind of card that shows one video's picture. */
  const CARDS = [
    'yt-lockup-view-model',
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-playlist-video-renderer',
    'ytd-playlist-panel-video-renderer',
    'ytm-shorts-lockup-view-model',
    'ytd-reel-item-renderer',
    '.ytGridShelfViewModelGridShelfItem',
  ];
  const IMAGES = 'yt-thumbnail-view-model img, ytd-thumbnail img';
  /** Where a picture is NOT one video's: the player, chapters, and the cards that stand for many videos. */
  const NOT_A_VIDEO = '#movie_player, ytd-player, ytd-miniplayer, ytd-video-preview, ytd-macro-markers-list-item-renderer, ytd-playlist-renderer, ytd-compact-playlist-renderer, ytd-grid-playlist-renderer, ytd-radio-renderer, ytd-compact-radio-renderer, ytd-playlist-thumbnail, yt-collection-thumbnail-view-model';
  const VIDEO_LINKS = 'a[href*="/watch?v="], a[href*="/shorts/"]';

  /** The video id a card link points at: `/watch?v=ID` or `/shorts/ID` (11 characters), else null. */
  function videoIdFromHref(href) {
    if (typeof href !== 'string' || href === '') return null;
    let u;
    try {
      u = new URL(href, 'https://www.youtube.com');
    } catch {
      return null;
    }
    if (!/(^|\.)youtube\.com$/.test(u.hostname)) return null;
    const v = u.pathname === '/watch' ? u.searchParams.get('v') : /^\/shorts\/([\w-]+)/.exec(u.pathname)?.[1];
    return v && /^[\w-]{11}$/.test(v) ? v : null;
  }

  /** YouTube's own picture for frame `mq1` | `mq2` | `mq3` of a video. */
  const frameUrl = (id, frame) => `https://i.ytimg.com/vi/${id}/${frame}.jpg`;

  const failed = new Set(); // "id/frame" pairs that did not load
  let mode = 'default';
  let observer = null;
  let timer = 0;
  const pending = new Set();

  const frameOf = () => FRAMES[mode] ?? null;

  /** The card link that names the video of this picture. */
  function linkOf(img) {
    const own = img.closest('a[href]');
    if (own && videoIdFromHref(own.getAttribute('href'))) return own;
    return img.closest(CARDS.join(','))?.querySelector(VIDEO_LINKS) ?? null;
  }

  /**
   * May this picture become a frame? `{ id }` for a single video, `{ skip: true }` for a picture that never will
   * (the player, a playlist, an avatar), or `{}` while the card has no link yet (it is looked at again later).
   */
  function eligibility(img) {
    if (img.closest(NOT_A_VIDEO)) return { skip: true };
    const card = img.closest(CARDS.join(','));
    if (!card || card.querySelector('yt-collection-thumbnail-view-model')) return { skip: true };
    const link = linkOf(img);
    if (!link) return card.querySelector('a[href]') ? { skip: true } : {}; // links, but none to a video: not one (a channel, a playlist)
    const id = videoIdFromHref(link.getAttribute('href'));
    return id ? { id } : { skip: true };
  }

  /** One of the pictures this feature sets (so it is never mistaken for an original). */
  const isFrameSrc = (src) => /^https:\/\/i\.ytimg\.com\/vi\/[\w-]{11}\/mq[123]\.jpg$/.test(src);

  /** Puts a picture back as YouTube had it. */
  function restore(img) {
    const src = img.getAttribute(ORIG_SRC);
    if (src) img.setAttribute('src', src);
    else if (img.hasAttribute(ORIG_SRC) && img.getAttribute('src')?.startsWith('https://i.ytimg.com/vi/')) img.removeAttribute('src');
    const set = img.getAttribute(ORIG_SRCSET);
    if (set) img.setAttribute('srcset', set);
    for (const a of [MARK, MARK_ID, ORIG_SRC, ORIG_SRCSET]) img.removeAttribute(a);
  }

  /** Gives one picture its frame (or leaves/puts back the original when there is none to give). */
  function process(img) {
    const frame = frameOf();
    if (!frame) return;
    const { id, skip } = eligibility(img);
    const state = img.getAttribute(MARK);
    if (!id) {
      if (!skip) return; // no link yet: stays as it is (transparent until the fail-safe) and is looked at again
      if (state && state !== 'skip') restore(img); // reused for something that has no single video
      img.setAttribute(MARK, 'skip');
      return;
    }
    const target = frameUrl(id, frame);
    const current = img.getAttribute('src') ?? '';
    if (failed.has(`${id}/${frame}`)) {
      if (state && state !== 'failed' && state !== 'skip') restore(img);
      img.setAttribute(MARK, 'failed');
      img.setAttribute(MARK_ID, id);
      return;
    }
    if (state === frame && current === target && img.getAttribute(MARK_ID) === id) return; // already done
    if (!isFrameSrc(current)) {
      // What YouTube set (first time, or again) is the original now.
      if (current !== '' || !img.hasAttribute(ORIG_SRC)) img.setAttribute(ORIG_SRC, current);
    }
    if (img.hasAttribute('srcset')) {
      if (!img.hasAttribute(ORIG_SRCSET)) img.setAttribute(ORIG_SRCSET, img.getAttribute('srcset'));
      img.removeAttribute('srcset');
    }
    img.setAttribute(MARK, frame);
    img.setAttribute(MARK_ID, id);
    img.setAttribute('src', target);
  }

  function sweep(root) {
    if (!frameOf()) return;
    if (root.nodeType === 1 && root.matches?.(IMAGES)) process(root);
    if (root.querySelectorAll) for (const img of root.querySelectorAll(IMAGES)) process(img);
  }

  /** A frame that did not load: the original goes back, and this video is not tried again with this frame. */
  function onError(event) {
    try {
      const img = event.target;
      if (img?.localName !== 'img') return;
      const frame = frameOf();
      const id = img.getAttribute(MARK_ID);
      if (!frame || !id || img.getAttribute(MARK) !== frame || img.getAttribute('src') !== frameUrl(id, frame)) return;
      failed.add(`${id}/${frame}`);
      restore(img);
      img.setAttribute(MARK, 'failed');
      img.setAttribute(MARK_ID, id);
    } catch {
      /* never break a page's image handling */
    }
  }

  function flush() {
    timer = 0;
    const list = [...pending];
    pending.clear();
    for (const img of list) {
      try {
        if (img.isConnected) process(img);
      } catch {
        /* one odd card must not stop the others */
      }
    }
  }

  function onAttributes(records) {
    for (const r of records) {
      const el = r.target;
      if (el?.localName !== 'img' || !el.matches?.(IMAGES)) continue;
      const frame = frameOf();
      const id = el.getAttribute(MARK_ID);
      // Our own write (the frame URL we just set) is not news.
      if (r.attributeName === 'src' && frame && id && el.getAttribute('src') === frameUrl(id, frame) && el.getAttribute(MARK) === frame) continue;
      pending.add(el);
    }
    if (pending.size > 0 && timer === 0) timer = globalThis.requestAnimationFrame ? globalThis.requestAnimationFrame(flush) : globalThis.setTimeout(flush, 16);
  }

  const css = () =>
    `html[${ROOT_ATTR}] :is(${CARDS.join(', ')}) :is(yt-thumbnail-view-model, ytd-thumbnail) img:not([${MARK}]) { opacity: 0; animation: at-peace-thumb-reveal 0.01s linear ${FAILSAFE_MS}ms forwards; }\n` +
    '@keyframes at-peace-thumb-reveal { to { opacity: 1; } }\n';

  function start() {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = css();
      (document.head ?? document.documentElement).append(style);
    }
    document.documentElement.setAttribute(ROOT_ATTR, '');
    document.addEventListener('error', onError, true);
    if (!observer && typeof MutationObserver === 'function') {
      observer = new MutationObserver(onAttributes);
      observer.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['src', 'srcset'] });
    }
  }

  function stop() {
    observer?.disconnect();
    observer = null;
    pending.clear();
    if (timer) (globalThis.cancelAnimationFrame ?? globalThis.clearTimeout)(timer);
    timer = 0;
    document.removeEventListener('error', onError, true);
    document.documentElement.removeAttribute(ROOT_ATTR);
    document.getElementById(STYLE_ID)?.remove();
    for (const img of document.querySelectorAll(`img[${MARK}]`)) restore(img);
  }

  AP.yt.features.push({
    id: 'thumbnail-frame',
    settings: [ID],
    observes: true,
    init(ctx) {
      mode = ctx.settings?.[ID] ?? 'default';
      start();
    },
    onNavigate() {
      sweep(document.documentElement);
    },
    onSettings(ctx) {
      mode = ctx.settings?.[ID] ?? 'default';
      // A different frame: every picture is looked at again (its original is kept, never re-read from our own frame).
      sweep(document.documentElement);
    },
    onMutations(ctx, roots) {
      for (const root of roots) sweep(root);
    },
    destroy() {
      mode = 'default';
      stop();
    },
  });

  AP.yt.thumbnailFrame = { videoIdFromHref, frameUrl, FRAMES };
})();
