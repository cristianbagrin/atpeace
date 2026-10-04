// Top bar (PLAN §6.3, "Top bar"): everything in YouTube's header. All selectors are scoped to
// ytd-masthead so the same ids inside the sidebar (e.g. the burger in the drawer) are untouched.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;

  AP.schema.section({
    id: 'yt.masthead',
    site: 'youtube',
    title: 'Top bar',
    order: 110,
    description: 'The bar across the top: search, buttons and the logo.',
  });

  AP.schema.define('yt.masthead', [
    // ---- Search --------------------------------------------------------------------------------
    {
      id: 'yt.masthead.hideSearchSuggestions',
      group: 'Search',
      label: 'Hide search suggestions',
      description: 'Stops the list of suggested searches from dropping down while you type. Arrow keys can still move through suggestions you cannot see.',
      type: 'toggle',
      default: false,
      tags: ['recommendations'],
      hide: [
        'yt-searchbox .ytSearchboxComponentSuggestionsContainer',
        // Pre-2024 autocomplete, kept for A/B buckets that still use it.
        'div.sbdd_a',
      ],
      since: '0.1.0',
    },
    {
      id: 'yt.masthead.hideVoiceSearch',
      group: 'Search',
      label: 'Hide the microphone',
      description: 'Removes the voice search button next to the search box.',
      type: 'toggle',
      default: false,
      hide: ['ytd-masthead #voice-search-button'],
      since: '0.1.0',
    },
    {
      id: 'yt.masthead.hideSearchBar',
      group: 'Search',
      label: 'Hide the whole search bar',
      description: 'Removes the search box, microphone and AI button from the top bar. The "/" key then focuses a box you cannot see; open a search by its address instead.',
      type: 'toggle',
      default: false,
      advanced: true,
      hide: ['ytd-masthead #center', 'ytd-masthead yt-searchbox', 'ytd-masthead #search-button-narrow'],
      since: '0.1.0',
    },

    // ---- Buttons -------------------------------------------------------------------------------
    {
      id: 'yt.masthead.hideCreate',
      group: 'Buttons',
      label: 'Hide the Create button',
      description: 'Removes the "Create" (camera) button from the top bar when you are signed in.',
      type: 'toggle',
      default: false,
      // Signed-in only and not verifiable logged out. Whatever sits directly before the
      // notifications bell is the Create button, in both the old icon and the newer pill form.
      hide: ['ytd-masthead #buttons > :is(ytd-button-renderer, ytd-topbar-menu-button-renderer):has(+ ytd-notification-topbar-button-renderer)'],
      since: '0.1.0',
    },
    {
      id: 'yt.masthead.hideNotifications',
      group: 'Buttons',
      label: 'Hide the notifications bell',
      description: 'Removes the bell and its unread count from the top bar when you are signed in.',
      type: 'toggle',
      default: false,
      hide: ['ytd-masthead ytd-notification-topbar-button-renderer'],
      since: '0.1.0',
    },
    {
      id: 'yt.masthead.hideGuideButton',
      group: 'Buttons',
      label: 'Hide the menu (burger) button',
      description: 'Removes the three-line button that opens and closes the sidebar.',
      type: 'toggle',
      default: false,
      hide: ['ytd-masthead #guide-button'],
      since: '0.1.0',
    },
    {
      id: 'yt.masthead.hideAICompanion',
      group: 'Buttons',
      label: 'Hide the AI assistant button',
      description: 'Removes the AI companion button from the top bar where YouTube offers it.',
      type: 'toggle',
      default: false,
      tags: ['ai'],
      hide: ['ytd-masthead #ai-companion-button'],
      since: '0.1.0',
    },

    // ---- Logo ----------------------------------------------------------------------------------
    {
      id: 'yt.masthead.hideCountryCode',
      group: 'Logo',
      label: 'Hide the country code',
      description: 'Removes the small country code (such as "GB") shown beside the YouTube logo outside the US.',
      type: 'toggle',
      default: false,
      tags: ['clutter'],
      hide: ['ytd-topbar-logo-renderer #country-code'],
      since: '0.1.0',
    },
    {
      id: 'yt.masthead.hideDoodle',
      group: 'Logo',
      label: 'Hide seasonal logos',
      description: 'Shows the normal YouTube logo instead of animated holiday logos, and removes the big doodle slot on the home page.',
      type: 'toggle',
      default: false,
      tags: ['clutter'],
      hide: ['ytd-masthead ytd-yoodle-renderer', '#big-yoodle'],
      // While a doodle runs YouTube hides the normal logo; bring it back so the bar is never logo-less.
      rules: [
        ':scope-on ytd-topbar-logo-renderer a#logo > div[hidden] { display: block !important; }',
        ':scope-on ytd-topbar-logo-renderer a#logo > div > ytd-logo[hidden] { display: block !important; }',
      ],
      since: '0.1.0',
    },

    // ---- Ads -----------------------------------------------------------------------------------
    {
      id: 'yt.masthead.hideMastheadAd',
      group: 'Ads',
      label: 'Hide the banner ad',
      description: 'Removes the large promotional banner and brand takeover at the top of the home page.',
      type: 'toggle',
      default: false,
      tags: ['ads'],
      hide: [
        '#masthead-ad',
        'ytd-statement-banner-renderer',
        'ytd-brand-video-singleton-renderer',
        'ytd-brand-video-shelf-renderer',
        'ytd-primetime-promo-renderer',
      ],
      since: '0.1.0',
    },
  ]);
})();
