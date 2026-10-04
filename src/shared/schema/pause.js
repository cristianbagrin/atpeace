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
    description: 'A breath before you open a site, so opening it is a choice.',
  });

  AP.schema.define('pause', [
    {
      id: 'pause.enabled',
      label: 'Pause before opening',
      description: 'Shows a breathing screen before the sites below open.',
      type: 'toggle',
      default: false,
      quick: true,
      feature: 'pause',
    },
    {
      id: 'pause.sites',
      label: 'Sites that get a pause',
      description: 'YouTube is built in; you can add other sites you want to open more slowly.',
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
      description: 'How long the breathing screen holds before you can continue.',
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
      id: 'pause.escalate',
      label: 'Breathe longer when I come back often',
      description: 'Each extra visit within the hour adds a little more time to the breath.',
      type: 'toggle',
      default: false,
      requires: 'pause.enabled',
      preset: false,
      feature: 'pause',
    },
    {
      id: 'pause.escalateStep',
      label: 'Extra time per visit',
      description: 'How many seconds each repeat visit adds, up to 30 in total.',
      type: 'number',
      default: 2,
      min: 1,
      max: 10,
      step: 1,
      unit: 'seconds',
      requires: 'pause.escalate',
      preset: false,
      feature: 'pause',
    },
    {
      id: 'pause.askIntention',
      label: 'Ask what I came for',
      description: 'Adds a short line to write why you are opening the site.',
      type: 'toggle',
      default: false,
      requires: 'pause.enabled',
      preset: false,
      feature: 'pause',
    },
    {
      id: 'pause.sessionMinutes',
      label: 'Default time when I continue',
      description: 'How long the site stays open before the pause comes back.',
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
    {
      id: 'pause.showCount',
      label: 'Show how many times I opened it today',
      description: 'A quiet count on the pause screen, no judgement.',
      type: 'toggle',
      default: true,
      requires: 'pause.enabled',
      preset: false,
      feature: 'pause',
    },
    {
      id: 'pause.expiryOverlay',
      label: 'Tell me when my time is up',
      description: 'Shows a gentle note on the page and pauses the video when your minutes run out.',
      type: 'toggle',
      default: true,
      requires: 'pause.enabled',
      preset: false,
      feature: 'session-guard',
    },
  ]);
})();
