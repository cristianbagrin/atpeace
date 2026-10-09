// Home (PLAN §6.3, "Home"): the feed you land on. Every CSS rule is page-scoped to `home`.
// The home grid is `ytd-rich-grid-renderer > #contents`: video cards are ytd-rich-item-renderer,
// shelves are ytd-rich-section-renderer. Cards and shelves are hidden as a whole so the grid
// closes up (no empty cells).
(() => {
  'use strict';
  const AP = globalThis.AtPeace;

  AP.schema.section({
    id: 'yt.home',
    site: 'youtube',
    title: 'Home',
    order: 130,
  });

  const HOME = 'ytd-browse[page-subtype="home"]';
  const GRID = `${HOME} ytd-rich-grid-renderer`;

  // The feed column. A calm placeholder (home-feed.js) is a sibling of it, so it is not hidden too.
  const FEED_HIDDEN = { hide: [`${HOME} #primary`] };

  /**
   * Home-page redirect target: '' (not set), a path on youtube.com ("/feed/subscriptions"), or a
   * full https://www.youtube.com/… address. Anything else (other hosts, javascript:, //host) is rejected.
   * @param {string} value
   * @returns {string|undefined}
   */
  function normalizeRedirect(value) {
    const text = value.trim();
    if (text === '') return '';
    if (text.startsWith('/')) return text.startsWith('//') || text.includes('\\') ? undefined : text;
    try {
      const url = new URL(text);
      return url.protocol === 'https:' && (url.hostname === 'www.youtube.com' || url.hostname === 'youtube.com') ? text : undefined;
    } catch {
      return undefined;
    }
  }

  AP.schema.define('yt.home', [
    // ---- Feed ----------------------------------------------------------------------------------
    {
      id: 'yt.home.feedMode',
      group: 'Feed',
      label: 'When I open YouTube',
      type: 'select',
      default: 'show',
      options: [
        { value: 'show', label: 'Show the home feed', short: 'Show feed' },
        { value: 'hide', label: 'Show a calm empty page', short: 'Calm page' },
        { value: 'subscriptions', label: 'Go to Subscriptions', short: 'Subscriptions' },
        { value: 'watchLater', label: 'Go to Watch later', short: 'Watch later' },
        { value: 'playlists', label: 'Go to my playlists', short: 'Playlists' },
        { value: 'custom', label: 'Go to my own page', short: 'My own page' },
      ],
      // Presets that hide recommendations empty the feed; they never pick a redirect you did not choose.
      bulkValue: 'hide',
      tags: ['recommendations'],
      page: 'home',
      // The feed is hidden for every non-"show" mode, so a redirect never flashes the feed first.
      // The placeholder (hide) and the redirects (others) are home-feed.js; full page loads are redirected by DNR.
      variants: {
        hide: FEED_HIDDEN,
        subscriptions: FEED_HIDDEN,
        watchLater: FEED_HIDDEN,
        playlists: FEED_HIDDEN,
        custom: FEED_HIDDEN,
      },
      feature: 'home-feed',
      since: '0.1.0',
    },
    {
      id: 'yt.home.redirectUrl',
      group: 'Feed',
      label: 'My own home page',
      description: 'A YouTube address or path.',
      type: 'text',
      default: '',
      maxLength: 500,
      normalize: normalizeRedirect,
      requires: 'yt.home.feedMode=custom',
      page: 'home',
      feature: 'home-feed',
      since: '0.1.0',
    },

    // ---- Rows on the page ----------------------------------------------------------------------
    {
      id: 'yt.home.hideChips',
      group: 'Rows on the page',
      label: 'Hide the category bar',
      type: 'toggle',
      default: false,
      page: 'home',
      hide: [
        `${GRID} > #header`,
        `${HOME} ytd-feed-filter-chip-bar-renderer`,
        `${HOME} chip-bar-view-model`,
        `${HOME} yt-chip-cloud-renderer`,
      ],
      // The translucent backdrop behind the top bar grows to cover a chip bar; shrink it back so a
      // frosted strip does not stay where the chips were.
      rules: [':scope-on #frosted-glass.with-chipbar { height: 56px !important; }'],
      since: '0.1.0',
    },
    {
      id: 'yt.home.hideShortsShelf',
      group: 'Rows on the page',
      label: 'Hide Shorts on the home feed',
      type: 'toggle',
      default: false,
      tags: ['shorts'],
      page: 'home',
      hide: [
        // Shelves: the section wrapper goes, so no empty gap stays.
        `${HOME} ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts])`,
        `${HOME} ytd-rich-shelf-renderer[is-shorts]`,
        `${HOME} ytd-rich-section-renderer:has(ytm-shorts-lockup-view-model)`,
        `${HOME} ytd-reel-shelf-renderer`,
        // Single Shorts as ordinary grid cards (current and legacy card renderers).
        `${HOME} ytd-rich-item-renderer:has(ytm-shorts-lockup-view-model)`,
        `${HOME} ytd-rich-item-renderer:has(a[href^="/shorts/"])`,
        `${HOME} ytd-rich-item-renderer:has(ytd-thumbnail-overlay-time-status-renderer[overlay-style="SHORTS"])`,
      ],
      since: '0.1.0',
    },
    {
      id: 'yt.home.hideNewsShelf',
      group: 'Rows on the page',
      label: 'Hide the news row',
      type: 'toggle',
      default: false,
      page: 'home',
      // Keyed on YouTube's News topic channel, the only language-free marker of that row.
      hide: [`${HOME} ytd-rich-section-renderer:has(a[href="/channel/UCYfdidRxbB8Qhf0Nx7ioOYw"])`],
      since: '0.1.0',
    },
    {
      id: 'yt.home.hidePostsShelf',
      group: 'Rows on the page',
      label: 'Hide community posts',
      type: 'toggle',
      default: false,
      page: 'home',
      hide: [
        `${HOME} ytd-rich-section-renderer:has(ytd-rich-item-renderer[is-post])`,
        `${HOME} ytd-rich-shelf-renderer:has(ytd-rich-item-renderer[is-post])`,
        `${HOME} ytd-rich-item-renderer[is-post]`,
        `${HOME} ytd-rich-section-renderer:has(ytd-post-renderer)`,
      ],
      since: '0.1.0',
    },
    {
      id: 'yt.home.hideOtherShelves',
      group: 'Rows on the page',
      label: 'Hide every extra row',
      description: 'Everything except the video grid.',
      type: 'toggle',
      default: false,
      tags: ['recommendations'],
      page: 'home',
      // Every non-card child of the grid is a ytd-rich-section-renderer.
      hide: [
        `${GRID} > #contents > ytd-rich-section-renderer`,
        `${HOME} ytd-statement-banner-renderer`,
        `${HOME} ytd-brand-video-shelf-renderer`,
      ],
      since: '0.1.0',
    },
    {
      id: 'yt.home.disableInfiniteScroll',
      group: 'Rows on the page',
      label: 'Stop infinite scroll',
      description: 'The home feed ends after the first screens.',
      type: 'toggle',
      default: false,
      tags: ['recommendations'],
      page: 'home',
      // YouTube loads the next batch when the continuation spinner at the end of the grid scrolls into
      // view. Hidden, it never intersects the viewport, so no more cards are fetched.
      hide: [`${GRID} > #contents > ytd-continuation-item-renderer`],
      since: '0.2.0',
    },
    {
      id: 'yt.home.hideFeedNudge',
      group: 'Rows on the page',
      label: 'Hide "Try searching to get started"',
      type: 'toggle',
      default: false,
      tags: ['clutter'],
      page: 'home',
      hide: [
        // The wrapper first, so no empty section margin stays behind.
        `${GRID} > #contents > ytd-rich-section-renderer:has(> #content > ytd-feed-nudge-renderer)`,
        `${HOME} ytd-rich-item-renderer:has(> #content > ytd-feed-nudge-renderer)`,
        `${HOME} ytd-feed-nudge-renderer`,
      ],
      since: '0.1.0',
    },
  ]);
})();
