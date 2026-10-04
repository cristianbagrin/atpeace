// Cross-site "General" settings (PLAN §6.3): the master switch and the look of At Peace's own pages.
// Neither is part of a preset: applying "Gentle" must not turn the extension off or flip the theme.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;

  AP.schema.section({
    id: 'general',
    site: null,
    title: 'General',
    order: 10,
    description: 'The master switch and how At Peace itself looks.',
  });

  AP.schema.define('general', [
    {
      id: 'general.enabled',
      label: 'Turn At Peace on',
      description: 'Switch it off and every site goes back to exactly how it was.',
      type: 'toggle',
      default: true,
      quick: true,
      preset: false,
      feature: 'engine',
    },
    {
      id: 'general.theme',
      label: 'Appearance',
      description: 'Light or dark for the popup and settings, or follow your system.',
      type: 'select',
      default: 'light',
      options: [
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
        { value: 'system', label: 'Match my system' },
      ],
      preset: false,
      feature: 'pages',
    },
  ]);
})();
