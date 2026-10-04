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
    description: 'Hide videos by words in the title or by channel, wherever they show up.',
  });

  const LIST_NOTE = 'One per line. Matching ignores capitals and accents.';

  AP.schema.define('yt.filters', [
    {
      id: 'yt.filters.keywords',
      group: 'Hide videos',
      label: 'Words to hide',
      description: `Hides any video whose title or description contains one of these words or phrases. Wrap a pattern in slashes for a regular expression, like /spoiler|leak/i. ${LIST_NOTE}`,
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
      description: `Hides every video from these channels. Use the channel name or its @handle. ${LIST_NOTE}`,
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
      description: 'The places that keyword and channel filters hide videos in.',
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
      description: `Hides any comment that contains one of these words or phrases. ${LIST_NOTE}`,
      type: 'list',
      default: [],
      maxItems: 500,
      page: 'watch',
      feature: 'filters',
      since: '0.1.0',
    },
  ]);
})();
