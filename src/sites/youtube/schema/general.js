// YouTube "everywhere" settings (PLAN §6.3, "General"): look of the whole site, what video cards
// show, promotions. Selectors come from docs/youtube-dom.md §3; each tag-name selector lists
// the legacy renderer AND the current view-model variant (PLAN §6.2 rule 3).
(() => {
  'use strict';
  const AP = globalThis.AtPeace;

  // TEMP (Phase 2a test) — replaced in 2b. A section plus two throw-away settings so the engine
  // can be exercised end to end (compiled CSS, tokens, live toggling) before the real catalog
  // exists. Nothing else may depend on these ids.
  AP.schema.section({ id: 'yt.general', site: 'youtube', title: 'Site-wide', order: 100, description: 'TEMP (Phase 2a test)' });
  AP.schema.define('yt.general', [
    {
      id: 'yt.general.tempHideLogo',
      label: 'TEMP: hide the logo',
      type: 'toggle',
      default: false,
      hide: ['ytd-masthead #logo'],
    },
    {
      id: 'yt.general.tempMastheadLook',
      label: 'TEMP: masthead look',
      type: 'select',
      default: 'normal',
      options: [
        { value: 'normal', label: 'Normal' },
        { value: 'faded', label: 'Faded' },
      ],
      variants: { faded: { rules: [':scope-on ytd-masthead { opacity: 0.4 !important; }'] } },
    },
  ]);

  // The real section. While the TEMP block above exists it has already registered 'yt.general';
  // once it is deleted this registers the section with its final title.
  if (!AP.schema.sections().some((s) => s.id === 'yt.general')) {
    AP.schema.section({
      id: 'yt.general',
      site: 'youtube',
      title: 'All of YouTube',
      order: 100,
      description: 'How the whole site looks, what video cards show, and promotions.',
    });
  }

  // --- Thumbnails -------------------------------------------------------------------------------
  // Every image that is a video/playlist thumbnail. Never avatars (yt-avatar-shape) and never the
  // player itself. The filter goes on the <img> (not the card) so duration badges stay crisp.
  const THUMBNAIL_IMAGES = [
    'yt-thumbnail-view-model .ytThumbnailViewModelImage > img', // current: home, channel, playlist, sidebar, Shorts cards
    'ytd-thumbnail img', // legacy: search results, shelves, playlist panel
    'ytd-playlist-thumbnail img', // legacy playlist cards
    'yt-collection-thumbnail-view-model img', // stacked playlist / mix thumbnails
    '.ytp-modern-videowall-still-image', // end-of-video wall (a background-image div)
    '.ytp-videowall-still-image', // legacy end-of-video wall
    '.ytp-ce-covering-image', // creator end-screen cards
  ];
  // Whatever holds a thumbnail; pointing at it reveals the picture again.
  const THUMBNAIL_CARDS = [
    'yt-lockup-view-model',
    'ytm-shorts-lockup-view-model',
    'ytd-video-renderer',
    'ytd-rich-grid-media',
    'ytd-compact-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-playlist-video-renderer',
    'ytd-playlist-panel-video-renderer',
    'ytd-playlist-renderer',
    'ytd-compact-playlist-renderer',
    'ytd-radio-renderer',
    'ytd-compact-radio-renderer',
    'ytd-reel-item-renderer',
    'ytd-macro-markers-list-item-renderer',
    '.ytp-modern-videowall-still',
    '.ytp-videowall-still',
    '.ytp-ce-element',
  ];
  const images = `:is(${THUMBNAIL_IMAGES.join(', ')})`;
  const cards = `:is(${THUMBNAIL_CARDS.join(', ')})`;
  /** Blur / grey the picture, and undo it while the pointer is over its card. */
  const filtered = (filter) => [
    `:scope-on ${images} { filter: ${filter} !important; transition: filter 0.15s ease; }`,
    `:scope-on ${cards}:hover ${images} { filter: none !important; }`,
  ];

  // --- Metrics inside video cards -------------------------------------------------------------
  // New lockups: the "views • date" row is the metadata row that has a delimiter span.
  const LOCKUP_STATS_ROW = 'yt-lockup-view-model .ytContentMetadataViewModelMetadataRow:has(> .ytContentMetadataViewModelDelimiter)';

  // --- Progress (resume) markers --------------------------------------------------------------
  // Three generations of the same marker: new view model, `ytw-` renderer, old `ytd-` renderer.
  const WATCHED_MARKS = 'yt-thumbnail-overlay-progress-bar-view-model, ytw-thumbnail-overlay-resume-playback-renderer, ytd-thumbnail-overlay-resume-playback-renderer';

  AP.schema.define('yt.general', [
    // ---- Look ----------------------------------------------------------------------------------
    {
      id: 'yt.general.grayscale',
      group: 'Look',
      label: 'Show YouTube in grayscale',
      description: 'Turns every page, thumbnail and video black and white so nothing pulls at your eye.',
      type: 'toggle',
      default: false,
      tags: ['behaviour'],
      // On <html>, not <body>: a filter on an ordinary element becomes the containing block of
      // position:fixed children (masthead, miniplayer) and breaks them; the root element is exempt.
      rules: [':scope-on { filter: grayscale(1) !important; }'],
      quick: true,
      since: '0.1.0',
    },
    {
      id: 'yt.general.thumbnails',
      group: 'Look',
      label: 'Thumbnails',
      description: 'Blur or grey out video thumbnails (they come back when you point at one), or leave the space empty.',
      type: 'select',
      default: 'show',
      options: [
        { value: 'show', label: 'Show' },
        { value: 'blur', label: 'Blur until hovered' },
        { value: 'grayscale', label: 'Grayscale until hovered' },
        { value: 'hide', label: 'Hide' },
      ],
      // The bulk "Recommendations" action blurs; it does not blank every picture.
      bulkValue: 'blur',
      tags: ['recommendations'],
      variants: {
        blur: { rules: filtered('blur(14px)') },
        grayscale: { rules: filtered('grayscale(1)') },
        // visibility (not display) keeps the grid cell the same size, so cards do not jump.
        hide: { rules: [`:scope-on ${images} { visibility: hidden !important; }`] },
      },
      quick: true,
      since: '0.1.0',
    },
    {
      id: 'yt.general.disableHoverPreview',
      group: 'Look',
      label: 'Turn off hover previews',
      description: 'Stops thumbnails from playing a short muted clip when you point at them.',
      type: 'toggle',
      default: false,
      tags: ['behaviour'],
      // CSS only hides the clip; thumbnails-hover.js also swallows the hover trigger so it never loads.
      hide: ['ytd-app #video-preview', 'ytd-video-preview', 'ytd-thumbnail-overlay-loading-preview-renderer'],
      feature: 'thumbnails-hover',
      since: '0.1.0',
    },
    {
      id: 'yt.general.calmTitles',
      group: 'Look',
      label: 'Calm shouting titles',
      description: 'Rewrites TITLES THAT SHOUT into normal sentence case in feeds, search and the video page.',
      type: 'select',
      default: 'off',
      options: [
        { value: 'off', label: 'Leave titles as they are' },
        { value: 'sentence', label: 'Sentence case' },
      ],
      tags: ['behaviour'],
      feature: 'calm-titles',
      since: '0.1.0',
    },

    // ---- On video cards ------------------------------------------------------------------------
    {
      id: 'yt.general.hideViewCounts',
      group: 'On video cards',
      label: 'Hide view counts',
      description: 'Removes "1.2M views" and "N watching" from cards in feeds, search, Shorts shelves and the sidebar.',
      type: 'toggle',
      default: false,
      tags: ['metrics'],
      hide: [
        // New lockups: the first text of the "views • date" row, its bullet and the play icon.
        `${LOCKUP_STATS_ROW} > :nth-child(1 of .ytContentMetadataViewModelMetadataText)`,
        `${LOCKUP_STATS_ROW} > .ytContentMetadataViewModelDelimiter`,
        'yt-lockup-view-model .ytContentMetadataViewModelLeadingIcon',
        // Shorts cards: the sub-heading is only the view count.
        '.shortsLockupViewModelHostOutsideMetadataSubhead',
        // Legacy renderers (search results, hashtag pages, old grids): first span = views.
        'ytd-video-meta-block #metadata-line > span.inline-metadata-item:nth-of-type(1)',
        'ytd-rich-grid-media #metadata-line > span.inline-metadata-item:nth-of-type(1)',
        'ytd-grid-video-renderer #metadata-line > span.inline-metadata-item:nth-of-type(1)',
        'ytd-compact-video-renderer #metadata-line > span.inline-metadata-item:nth-of-type(1)',
        'ytd-playlist-video-renderer #video-info > span:nth-of-type(1)',
      ],
      // The legacy separator bullet is a ::before on the date span; without the views it would lead the line.
      rules: [':scope-on ytd-video-meta-block #metadata-line > span.inline-metadata-item:nth-of-type(2)::before { display: none !important; }'],
      since: '0.1.0',
    },
    {
      id: 'yt.general.hideUploadDates',
      group: 'On video cards',
      label: 'Hide upload dates',
      description: 'Removes "3 days ago" and "Streamed 1 year ago" from cards in feeds, search and the sidebar.',
      type: 'toggle',
      default: false,
      tags: ['metrics'],
      hide: [
        `${LOCKUP_STATS_ROW} > .ytContentMetadataViewModelMetadataText.ytContentMetadataViewModelMetadataTextLastPart`,
        `${LOCKUP_STATS_ROW} > .ytContentMetadataViewModelDelimiter`,
        'ytd-video-meta-block #metadata-line > span.inline-metadata-item:nth-of-type(2)',
        'ytd-rich-grid-media #metadata-line > span.inline-metadata-item:nth-of-type(2)',
        'ytd-grid-video-renderer #metadata-line > span.inline-metadata-item:nth-of-type(2)',
        'ytd-compact-video-renderer #metadata-line > span.inline-metadata-item:nth-of-type(2)',
      ],
      since: '0.1.0',
    },
    {
      id: 'yt.general.hideDurations',
      group: 'On video cards',
      label: 'Hide video lengths',
      description: 'Removes the length badge ("12:34") from thumbnails; live streams lose their LIVE badge too.',
      type: 'toggle',
      default: false,
      // Only the badge child: the bottom overlay also hosts the watched-progress bar.
      hide: ['yt-thumbnail-bottom-overlay-view-model yt-thumbnail-badge-view-model', 'ytd-thumbnail-overlay-time-status-renderer'],
      since: '0.1.0',
    },
    {
      id: 'yt.general.hideChannelAvatars',
      group: 'On video cards',
      label: 'Hide channel pictures',
      description: 'Removes the round channel picture next to video titles in feeds, search and the sidebar.',
      type: 'toggle',
      default: false,
      hide: [
        'yt-lockup-view-model .ytLockupMetadataViewModelAvatar',
        'ytd-video-renderer #channel-info > a#channel-thumbnail',
        'ytd-video-renderer #channel-info > #avatar',
        'ytd-rich-grid-media #avatar-container',
      ],
      since: '0.1.0',
    },
    {
      id: 'yt.general.hideBadges',
      group: 'On video cards',
      label: 'Hide badges and verified ticks',
      description: 'Removes the New, 4K, CC and Live chips and the verified tick from video cards.',
      type: 'toggle',
      default: false,
      // Not the duration pill (yt-thumbnail-badge-view-model is a different element).
      hide: [
        'yt-lockup-view-model .ytContentMetadataViewModelBadge',
        'yt-lockup-view-model .ytContentMetadataViewModelIcon',
        'yt-lockup-view-model yt-badge-view-model',
        'ytd-video-renderer ytd-badge-supported-renderer',
        'ytd-video-renderer yt-badge-supported-renderer',
        'ytd-video-renderer #badges',
      ],
      since: '0.1.0',
    },
    {
      id: 'yt.general.hideWatchedProgress',
      group: 'On video cards',
      label: 'Hide the red "watched" bar',
      description: 'Removes the red resume bar at the bottom of thumbnails of videos you have started.',
      type: 'toggle',
      default: false,
      hide: ['yt-thumbnail-overlay-progress-bar-view-model', 'ytw-thumbnail-overlay-resume-playback-renderer', 'ytd-thumbnail-overlay-resume-playback-renderer'],
      since: '0.1.0',
    },
    {
      id: 'yt.general.hideWatched',
      group: 'On video cards',
      label: 'Hide videos you have already watched',
      description: 'Removes whole cards that show a red progress bar from the home feed, subscriptions, channel pages, search and the sidebar.',
      type: 'toggle',
      default: false,
      // The card wrapper is hidden (not the inner lockup) so the grid closes up. History and
      // playlists are left alone on purpose: there, watched videos are the content.
      hide: [
        `ytd-browse:is([page-subtype="home"], [page-subtype="subscriptions"], [page-subtype="channels"]) ytd-rich-item-renderer:has(${WATCHED_MARKS})`,
        `ytd-browse[page-subtype="subscriptions"] ytd-grid-video-renderer:has(${WATCHED_MARKS})`,
        `ytd-search ytd-video-renderer:has(${WATCHED_MARKS})`,
        `ytd-watch-flexy #related yt-lockup-view-model:has(${WATCHED_MARKS})`,
        `ytd-watch-flexy #related ytd-compact-video-renderer:has(${WATCHED_MARKS})`,
      ],
      since: '0.1.0',
    },

    // ---- Promotions ----------------------------------------------------------------------------
    {
      id: 'yt.general.hideAds',
      group: 'Promotions',
      label: 'Hide ad slots and sponsored cards',
      description: 'Removes sponsored cards in feeds and search, the home banner ad and the ad slot next to videos. Ads inside the player are not touched, so Skip stays reachable.',
      type: 'toggle',
      default: false,
      tags: ['ads'],
      hide: [
        'ytd-ad-slot-renderer',
        // The grid cell that wraps an ad slot, otherwise an empty card stays behind.
        'ytd-rich-item-renderer:has(> #content > ytd-ad-slot-renderer)',
        'ytd-rich-section-renderer:has(> #content > ytd-ad-slot-renderer)',
        'ytd-in-feed-ad-layout-renderer',
        'ytd-promoted-sparkles-web-renderer',
        'ytd-promoted-video-renderer',
        'ytd-display-ad-renderer',
        'ytd-carousel-ad-renderer',
        'ytd-action-companion-ad-renderer',
        'ytd-search-pyv-renderer',
        'ytd-compact-promoted-item-renderer',
        '#masthead-ad',
        '#player-ads',
        'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]',
        '#shorts-inner-container > .ytd-shorts:has(> .ytd-reel-video-renderer > ytd-ad-slot-renderer)',
      ],
      quick: true,
      since: '0.1.0',
    },
    {
      id: 'yt.general.hidePremiumUpsells',
      group: 'Promotions',
      label: 'Hide Premium and Music promotions',
      description: 'Removes the "Try Premium" banners and pop-up bars, the Premium entry in the sidebar and the Premium-only quality entries.',
      type: 'toggle',
      default: false,
      tags: ['ads'],
      hide: [
        'ytd-mealbar-promo-renderer',
        'yt-mealbar-promo-renderer',
        'ytd-banner-promo-renderer',
        'ytd-guide-entry-renderer:has(> a#endpoint[href="/premium"])',
        'ytd-mini-guide-entry-renderer:has(a#endpoint[href="/premium"])',
        '.ytp-quality-menu .ytp-menuitem:has(.ytp-premium-label)',
      ],
      since: '0.1.0',
    },

    // ---- Extras --------------------------------------------------------------------------------
    {
      id: 'yt.general.hideMixes',
      group: 'Extras',
      label: 'Hide Mixes',
      description: 'Removes auto-generated "Mix" playlists from the home feed, search and the sidebar.',
      type: 'toggle',
      default: false,
      tags: ['recommendations'],
      // A Mix is a stacked-collection card whose link has list=RD…; ordinary sidebar videos carry
      // list=RD… too (autoplay radio), so the collection thumbnail is what tells them apart.
      // :has() cannot be nested, hence two flat :has() on the same element.
      hide: [
        'ytd-rich-item-renderer:has(yt-collection-thumbnail-view-model):has(a[href*="list=RD"])',
        'yt-lockup-view-model:has(yt-collection-thumbnail-view-model):has(a[href*="list=RD"])',
        'ytd-compact-radio-renderer',
        'ytd-radio-renderer',
      ],
      since: '0.1.0',
    },
    {
      id: 'yt.general.hidePlayables',
      group: 'Extras',
      label: 'Hide Playables (games)',
      description: 'Removes the row of browser games from the home feed.',
      type: 'toggle',
      default: false,
      tags: ['clutter'],
      page: 'home',
      hide: [
        'ytd-browse[page-subtype="home"] ytd-rich-section-renderer:has(ytd-mini-game-card-view-model)',
        'ytd-browse[page-subtype="home"] ytd-rich-section-renderer:has(ytd-rich-shelf-renderer a[href="/playables"])',
        'ytd-browse[page-subtype="home"] ytd-rich-shelf-renderer[has-rounded-box-art-thumbnail-style]',
        'ytd-browse[page-subtype="home"] ytd-mini-game-card-view-model',
      ],
      since: '0.1.0',
    },
  ]);
})();
