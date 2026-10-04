// YouTube "site-wide" settings: defined in Phase 2b (this file is replaced then).
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
})();
