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
  });

  AP.schema.define('yt.masthead', [
    // ---- Search --------------------------------------------------------------------------------
    {
      id: 'yt.masthead.hideSearchSuggestions',
      group: 'Search',
      label: 'Hide search suggestions',
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
      id: 'yt.masthead.hideSearchHistory',
      group: 'Search',
      label: 'Hide previous searches',
      type: 'toggle',
      default: false,
      // A row of the search box dropdown that comes from your history has a "Remove" link on its right (a
      // class of its own: ytSuggestionComponentRemoveLink, … Dark, … ClearButton). Live suggestions never
      // do, so only history goes. Observed in public style sheets and extensions; a signed-in check is on
      // the verification list (docs/VERIFY.md): logged out YouTube shows no history.
      hide: ['yt-searchbox .ytSuggestionComponentSuggestion:has([class*="ytSuggestionComponentRemoveLink"])'],
      since: '0.2.0',
    },
    {
      id: 'yt.masthead.hideVoiceSearch',
      group: 'Search',
      label: 'Hide the microphone',
      type: 'toggle',
      default: false,
      hide: ['ytd-masthead #voice-search-button'],
      since: '0.1.0',
    },
    {
      id: 'yt.masthead.hideSearchBar',
      group: 'Search',
      label: 'Hide the whole search bar',
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
      type: 'toggle',
      default: false,
      hide: ['ytd-masthead ytd-notification-topbar-button-renderer'],
      since: '0.1.0',
    },
    {
      id: 'yt.masthead.hideGuideButton',
      group: 'Buttons',
      label: 'Hide the menu (burger) button',
      type: 'toggle',
      default: false,
      hide: ['ytd-masthead #guide-button'],
      since: '0.1.0',
    },
    {
      id: 'yt.masthead.hideAICompanion',
      group: 'Buttons',
      label: 'Hide the AI assistant button',
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
  ]);
})();
