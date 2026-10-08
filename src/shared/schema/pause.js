// Mindful Pause settings (PLAN §8.3). Cross-site: the list of paused sites is user-editable.
// Only `pause.enabled` belongs to presets ("Deep work" turns the pause on); the details are
// personal preferences that a preset must not overwrite.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;

  const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
  const SITE_KEY_RE = /^[a-z0-9][a-z0-9.-]{0,98}$/;

  /**
   * One paused site: `{ siteKey, domain, enabled }`. `siteKey` is 'youtube' for the built-in site
   * and the registrable domain for user-added ones; `domain` is the bare host (no scheme, no path).
   * @param {unknown} raw
   * @returns {{siteKey: string, domain: string, enabled: boolean}|null}
   */
  function pauseSite(raw) {
    if (!AP.util.isPlainObject(raw)) return null;
    const domain = typeof raw.domain === 'string' ? raw.domain.trim().toLowerCase() : '';
    const siteKey = typeof raw.siteKey === 'string' ? raw.siteKey.trim().toLowerCase() : '';
    if (domain.length > 253 || !HOST_RE.test(domain) || !SITE_KEY_RE.test(siteKey)) return null;
    return { siteKey, domain, enabled: raw.enabled !== false };
  }

  /** One entry per siteKey (the first wins) so the pause rules and stats never double up. */
  function uniqueBySiteKey(list) {
    const seen = new Set();
    return list.filter((s) => !seen.has(s.siteKey) && seen.add(s.siteKey));
  }

  AP.schema.section({
    id: 'pause',
    site: null,
    title: 'Mindful Pause',
    order: 900,
    description: 'A breath before a site opens.',
  });

  AP.schema.define('pause', [
    {
      id: 'pause.enabled',
      label: 'Pause before opening',
      description: 'A breathing screen before the sites below.',
      type: 'toggle',
      default: false,
      feature: 'pause',
    },
    {
      id: 'pause.sites',
      label: 'Sites that get a pause',
      type: 'list',
      default: [{ siteKey: 'youtube', domain: 'youtube.com', enabled: true }],
      item: pauseSite,
      normalize: uniqueBySiteKey,
      maxItems: 50,
      requires: 'pause.enabled',
      preset: false,
      feature: 'pause',
    },
    {
      id: 'pause.breathSeconds',
      label: 'Length of the breath',
      type: 'number',
      default: 6,
      min: 3,
      max: 30,
      step: 1,
      unit: 'seconds',
      requires: 'pause.enabled',
      preset: false,
      feature: 'pause',
    },
    {
      id: 'pause.sessionMinutes',
      label: 'Default time when I continue',
      description: 'How long the site stays open.',
      type: 'select',
      default: '15',
      options: [
        { value: '5', label: '5 minutes' },
        { value: '10', label: '10 minutes' },
        { value: '15', label: '15 minutes' },
        { value: '30', label: '30 minutes' },
        { value: '60', label: '1 hour' },
      ],
      requires: 'pause.enabled',
      preset: false,
      feature: 'pause',
    },
  ]);
})();
