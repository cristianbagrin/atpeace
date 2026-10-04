// YouTube page types (PLAN §6.1). `AP.yt.page.detect(url)` is pure: it only looks at the URL, so
// the engine can call it for the TARGET of a navigation before YouTube has rendered anything.
// Also declares the feature list that feature files (loaded after this one) push into.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;

  AP.yt ??= {};
  /** Feature objects (see src/content/engine.js). Feature files `AP.yt.features.push({...})`; main.js hands the list to the engine. */
  AP.yt.features ??= [];

  /** Values of `data-at-peace-page` and of a setting's `page:`. */
  const TYPES = Object.freeze([
    'home', 'watch', 'search', 'shorts', 'subscriptions', 'channel', 'playlist', 'history', 'you', 'hashtag', 'other',
  ]);

  const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
  const BASE = 'https://www.youtube.com';

  /**
   * Page type for a URL: absolute, a path such as '/results?search_query=x' (as found in YouTube's
   * navigation events), or a URL object. Anything unknown, malformed or on another host is 'other'.
   *
   *   /                       home           /feed/subscriptions     subscriptions
   *   /watch /live/ID /clip/ID watch          /feed/history           history
   *   /results                search         /feed/you, /feed/library you  (YouTube redirects library → you)
   *   /shorts, /shorts/ID     shorts         /hashtag/<tag>          hashtag
   *   /playlist               playlist       /@handle, /channel/…, /c/…, /user/… (+ sub-tabs)  channel
   *   everything else is 'other', including /feed/trending, /feed/explore and /gaming (YouTube now
   *   redirects those to '/', so the detector reports what the URL says and the redirect is
   *   picked up as the next navigation).
   *
   * @param {string|URL} url
   * @returns {string} one of TYPES
   */
  function detect(url) {
    // Strings (absolute or relative) and URL objects only; an empty string is not a URL.
    const text = typeof url === 'string' ? url : typeof url?.href === 'string' ? url.href : '';
    if (text === '') return 'other';
    let parsed;
    try {
      parsed = new URL(text, BASE);
    } catch {
      return 'other';
    }
    if (!HOSTS.has(parsed.hostname)) return 'other';
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length === 0) return 'home';

    const first = segments[0];
    const lower = first.toLowerCase();
    switch (lower) {
      case 'watch':
        return 'watch';
      case 'live':
      case 'clip':
        return segments.length > 1 ? 'watch' : 'other';
      case 'results':
        return 'search';
      case 'shorts':
        return 'shorts';
      case 'playlist':
        return 'playlist';
      case 'hashtag':
        return segments.length > 1 ? 'hashtag' : 'other';
      case 'channel':
      case 'c':
      case 'user':
        return segments.length > 1 ? 'channel' : 'other';
      case 'feed':
        return feedType(segments[1]?.toLowerCase());
      default:
        return first.startsWith('@') && first.length > 1 ? 'channel' : 'other';
    }
  }

  function feedType(name) {
    switch (name) {
      case undefined:
        return 'other';
      case 'subscriptions':
        return 'subscriptions';
      case 'history':
        return 'history';
      case 'you':
      case 'library':
        return 'you';
      default:
        return 'other'; // trending, explore, storefront, … no page of their own
    }
  }

  /**
   * Target URL of a `yt-navigate-start` event, as a path or absolute URL, or null when it cannot
   * be read. YouTube puts it in `detail.url` (and in the endpoint's webCommandMetadata). Content
   * scripts do not always see the page's `detail` object (Chromium returns null for it, Firefox
   * may wrap it), hence the fallbacks; the engine also listens to the Navigation API.
   * @param {Event} event
   * @returns {string|null}
   */
  function urlFromNavigateEvent(event) {
    const read = (detail) => {
      const url = detail?.url ?? detail?.endpoint?.commandMetadata?.webCommandMetadata?.url;
      return typeof url === 'string' && url !== '' ? url : null;
    };
    try {
      const direct = read(event?.detail);
      if (direct) return direct;
    } catch {
      /* opaque cross-realm object */
    }
    try {
      return read(event?.wrappedJSObject?.detail); // Firefox: the page's own view of the event
    } catch {
      return null;
    }
  }

  AP.yt.page = { TYPES, detect, urlFromNavigateEvent };
  AP.schema.registerPages('youtube', TYPES);
})();
