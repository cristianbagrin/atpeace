// Focus blocks, schedules and the daily limit (PLAN §8.4). None of these belong to presets: a
// preset changes how YouTube looks, not the commitments the user made to themselves.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;

  const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
  const SITE_KEY_RE = /^[a-z0-9][a-z0-9.-]{0,98}$/;
  const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  const ACTION_RE = /^(block|preset:[A-Za-z0-9_-]{1,40})$/;

  /**
   * One weekly schedule: `{ id, name, days:[0-6], start:'HH:MM', end:'HH:MM', action, siteKeys, enabled }`.
   * `action` is 'block' or 'preset:<presetId>'; an end before the start means "past midnight".
   * Items that cannot work (no id, no days, bad time, start == end) are dropped, not repaired.
   * @param {unknown} raw
   * @returns {object|null}
   */
  function schedule(raw) {
    if (!AP.util.isPlainObject(raw)) return null;
    if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) return null;
    if (!Array.isArray(raw.days)) return null;
    const days = [...new Set(raw.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
    if (days.length === 0) return null;
    if (typeof raw.start !== 'string' || !TIME_RE.test(raw.start)) return null;
    if (typeof raw.end !== 'string' || !TIME_RE.test(raw.end) || raw.end === raw.start) return null;
    if (typeof raw.action !== 'string' || !ACTION_RE.test(raw.action)) return null;
    const keys = Array.isArray(raw.siteKeys)
      ? [...new Set(raw.siteKeys.filter((k) => typeof k === 'string' && SITE_KEY_RE.test(k)))]
      : [];
    return {
      id: raw.id,
      name: typeof raw.name === 'string' ? raw.name.trim().slice(0, 80) : '',
      days,
      start: raw.start,
      end: raw.end,
      action: raw.action,
      siteKeys: keys.length > 0 ? keys : ['youtube'],
      enabled: raw.enabled !== false,
    };
  }

  const uniqueById = (list) => {
    const seen = new Set();
    return list.filter((s) => !seen.has(s.id) && seen.add(s.id));
  };

  AP.schema.section({
    id: 'focus',
    site: null,
    title: 'Focus & limits',
    order: 910,
    description: 'Blocks, schedules and a daily limit.',
  });

  AP.schema.define('focus', [
    {
      id: 'focus.unlockFriction',
      label: 'Ending a block early',
      type: 'select',
      default: 'wait',
      options: [
        { value: 'none', label: 'Just let me' },
        { value: 'wait', label: 'Wait 30 seconds' },
        { value: 'phrase', label: 'Type a sentence' },
      ],
      preset: false,
      feature: 'focus',
    },
    {
      id: 'focus.strict',
      label: 'No early exit',
      type: 'toggle',
      default: false,
      preset: false,
      feature: 'focus',
    },
    {
      id: 'focus.dailyMinutes',
      label: 'Daily limit',
      description: '0 means no limit.',
      type: 'number',
      default: 0,
      min: 0,
      max: 600,
      step: 1,
      unit: 'minutes',
      preset: false,
      feature: 'focus',
    },
    {
      id: 'focus.limitGrace',
      label: 'Extra time after the limit',
      description: '“5 more minutes” requests per day.',
      type: 'number',
      default: 1,
      min: 0,
      max: 5,
      step: 1,
      requires: 'focus.dailyMinutes',
      preset: false,
      feature: 'focus',
    },
    {
      id: 'focus.schedules',
      label: 'Weekly schedules',
      type: 'list',
      default: [],
      item: schedule,
      normalize: uniqueById,
      maxItems: 30,
      preset: false,
      feature: 'focus',
    },
  ]);
})();
