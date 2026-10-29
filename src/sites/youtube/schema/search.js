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

  AP.schema.define('yt.search', [
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
