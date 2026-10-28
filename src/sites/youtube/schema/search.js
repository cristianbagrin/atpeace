// Search results (PLAN §6.3, "Search"). Every rule is page-scoped to `search`. Results are
// ytd-video-renderer rows (legacy renderer, still used for search); Shorts shelves are
// grid-shelf-view-model, other shelves ytd-shelf-renderer. Shelves and rows are hidden as a whole.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;

  AP.schema.section({
    id: 'yt.search',
    site: 'youtube',
    title: 'Search results',
    order: 170,
  });

  // Grid layout: the result lists become grids of home-style cards (picture on top, text below).
  // Lists are the results column and the vertical list inside a "Latest from X" shelf; anything
  // that is not a video or a playlist card (channels, shelves, Shorts rows, ads) spans the whole row.
  const LISTS = 'ytd-search :is(ytd-item-section-renderer > #contents, ytd-vertical-list-renderer > #items)';
  const CARDS = 'ytd-video-renderer, yt-lockup-view-model, ytd-playlist-renderer, ytd-radio-renderer';
  const VIDEO = `${LISTS} > ytd-video-renderer`;
  const LOCKUP = `${LISTS} > yt-lockup-view-model`;
  const GRID_RULES = [
    // `dense` lets the next card fill a hole left before a full-width row, so no card stands alone.
    `:scope-on ${LISTS} { display: grid !important; grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); grid-auto-flow: row dense; gap: 24px 16px; align-items: start; }`,
    `:scope-on ${LISTS} > :not(${CARDS}) { grid-column: 1 / -1; min-width: 0; }`,
    `:scope-on ${LISTS} > :is(${CARDS}) { grid-column: auto; min-width: 0; margin-top: 0 !important; }`,
    `:scope-on ${VIDEO} #dismissible { flex-direction: column !important; }`,
    `:scope-on ${VIDEO} ytd-thumbnail.ytd-video-renderer { flex: none !important; width: 100% !important; min-width: 0 !important; max-width: none !important; margin: 0 0 12px !important; }`,
    `:scope-on ${VIDEO} .text-wrapper { max-width: none !important; }`,
    `:scope-on ${VIDEO} #video-title { font-size: 1.6rem !important; line-height: 2.2rem !important; max-height: 4.4rem !important; -webkit-line-clamp: 2 !important; }`,
    `:scope-on ${VIDEO} #channel-info { padding: 4px 0 0 !important; }`,
    // A card has no room for the description or the chapters row (home cards have neither).
    `:scope-on ${VIDEO} :is(.metadata-snippet-container, .metadata-snippet-container-one-line, #description-text, #expandable-metadata) { display: none !important; }`,
    `:scope-on ${LOCKUP} .ytLockupViewModelHorizontal { flex-direction: column !important; }`,
    `:scope-on ${LOCKUP} .ytLockupViewModelContentImage { width: 100% !important; max-width: none !important; margin: 0 0 12px !important; }`,
    `:scope-on ${LOCKUP} .ytLockupMetadataViewModelTitle { font-size: 1.6rem !important; line-height: 2.2rem !important; }`,
  ];

  AP.schema.define('yt.search', [
    {
      id: 'yt.search.gridLayout',
      group: 'Layout',
      label: 'Show results as a grid',
      description: 'Cards in rows, like the home page.',
      type: 'toggle',
      default: false,
      page: 'search',
      rules: GRID_RULES,
      since: '0.3.0',
    },
    {
      id: 'yt.search.hideShorts',
      group: 'Extras between results',
      label: 'Hide Shorts in results',
      type: 'toggle',
      default: false,
      tags: ['shorts'],
      page: 'search',
      // Two shapes: whole shelves (language-free via the Shorts card tag, not via the shelf title or
      // its "Show more" button) and single Shorts listed as ordinary rows.
      hide: [
        'ytd-search grid-shelf-view-model:has(ytm-shorts-lockup-view-model)',
        'ytd-search grid-shelf-view-model:has(a[href^="/shorts/"])',
        'ytd-search ytd-reel-shelf-renderer',
        'ytd-search ytd-video-renderer:has(ytd-thumbnail-overlay-time-status-renderer[overlay-style="SHORTS"])',
        'ytd-search ytd-video-renderer:has(a#thumbnail[href^="/shorts/"])',
      ],
      since: '0.1.0',
    },
    {
      id: 'yt.search.hideShelves',
      group: 'Extras between results',
      label: 'Hide extra rows',
      description: 'Rows between the results.',
      type: 'toggle',
      default: false,
      tags: ['recommendations'],
      page: 'search',
      // Shorts rows are a different component and have their own setting; so does the channel card.
      hide: ['ytd-search ytd-shelf-renderer'],
      since: '0.1.0',
    },
    {
      id: 'yt.search.hideRelatedSearches',
      group: 'Extras between results',
      label: 'Hide related searches',
      type: 'toggle',
      default: false,
      tags: ['recommendations'],
      page: 'search',
      hide: [
        'ytd-search ytd-search-refinement-card-renderer',
        'ytd-search ytd-horizontal-card-list-renderer:has(ytd-search-refinement-card-renderer)',
      ],
      since: '0.1.0',
    },
    {
      id: 'yt.search.hideAds',
      group: 'Extras between results',
      label: 'Hide sponsored results',
      type: 'toggle',
      default: false,
      tags: ['ads'],
      page: 'search',
      hide: [
        'ytd-search ytd-ad-slot-renderer',
        'ytd-search ytd-search-pyv-renderer',
        'ytd-search ytd-promoted-sparkles-web-renderer',
        'ytd-search ytd-promoted-video-renderer',
        'ytd-search ytd-in-feed-ad-layout-renderer',
      ],
      since: '0.1.0',
    },
    {
      id: 'yt.search.hideAISummary',
      group: 'Extras between results',
      label: 'Hide AI summaries',
      type: 'toggle',
      default: false,
      tags: ['ai'],
      page: 'search',
      // Same component as the "N chapters" row, so the AI body is what the selectors key on.
      hide: [
        'ytd-search ytd-expandable-metadata-renderer:has(video-summary-content-view-model)',
        'ytd-search ytd-video-renderer #expandable-metadata:has(video-summary-content-view-model)',
        'ytd-search video-summary-content-view-model',
      ],
      since: '0.1.0',
    },
    {
      id: 'yt.search.hideChannelResults',
      group: 'Extras between results',
      label: 'Hide channel results',
      type: 'toggle',
      default: false,
      advanced: true,
      page: 'search',
      hide: ['ytd-search ytd-channel-renderer'],
      since: '0.1.0',
    },
    {
      id: 'yt.search.hideSnippets',
      group: 'On each result',
      label: 'Hide descriptions',
      description: 'The text under each result.',
      type: 'toggle',
      default: false,
      page: 'search',
      hide: [
        'ytd-search ytd-video-renderer .metadata-snippet-container',
        'ytd-search ytd-video-renderer .metadata-snippet-container-one-line',
        'ytd-search ytd-video-renderer #description-text',
        'ytd-search ytd-channel-renderer #description',
      ],
      since: '0.1.0',
    },
    {
      id: 'yt.search.hideFilterChips',
      group: 'On each result',
      label: 'Hide the filter chips',
      type: 'toggle',
      default: false,
      page: 'search',
      // The row also hosts the Filters button, so the row keeps its height; only the chips go.
      hide: ['ytd-search ytd-search-header-renderer #chip-bar', 'ytd-search ytd-search-header-renderer yt-chip-cloud-renderer'],
      since: '0.1.0',
    },
  ]);
})();
