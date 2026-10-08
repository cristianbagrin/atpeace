// Filters (PLAN §6.3, "Filters"): keyword and channel filters, run by features/filters.js. A card
// that matches gets the `data-at-peace-filtered` attribute and the engine's always-on CSS rule
// (schema-core compileRules) hides it, so these settings carry no CSS of their own.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;

  AP.schema.section({
    id: 'yt.filters',
    site: 'youtube',
    title: 'Filters',
    order: 210,
  });

  AP.schema.define('yt.filters', [
    {
      id: 'yt.filters.keywords',
      group: 'Hide videos',
      label: 'Words to hide',
      description: 'One per line. Use /regex/ for patterns.',
      type: 'list',
      default: [],
      maxItems: 500,
      feature: 'filters',
      since: '0.1.0',
    },
    {
      id: 'yt.filters.channels',
      group: 'Hide videos',
      label: 'Channels to hide',
      description: 'Name or @handle, one per line.',
      type: 'list',
      default: [],
      maxItems: 500,
      feature: 'filters',
      since: '0.1.0',
    },
    {
      id: 'yt.filters.applyTo',
      group: 'Hide videos',
      label: 'Where the filters apply',
      type: 'list',
      default: ['home', 'search', 'watch', 'subscriptions'],
      options: [
        { value: 'home', label: 'Home feed' },
        { value: 'search', label: 'Search results' },
        { value: 'watch', label: 'Videos next to the player' },
        { value: 'subscriptions', label: 'Subscriptions feed' },
      ],
      feature: 'filters',
      since: '0.1.0',
    },
    {
      id: 'yt.filters.commentKeywords',
      group: 'Hide comments',
      label: 'Words to hide in comments',
      description: 'One per line.',
      type: 'list',
      default: [],
      maxItems: 500,
      page: 'watch',
      feature: 'filters',
      since: '0.1.0',
    },
  ]);
})();
