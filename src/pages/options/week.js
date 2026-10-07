// "Your week": the last seven days of time on YouTube, opens, and times you turned back.
// Quiet and literal: numbers and plain bars, no goals, streaks or praise.
const AP = globalThis.AtPeace;
const { h } = AP.ui;

const count = (n) => h('span', { class: 'mono' }, String(n));

function renderTable(week) {
  const { days, totals, maxActiveSec } = week;
  const barWidth = (sec) => (maxActiveSec > 0 ? `${Math.max(sec > 0 ? 2 : 0, Math.round((sec / maxActiveSec) * 100))}%` : '0%');
  return h(
    'table',
    { class: 'week-table' },
    h('caption', { class: 'visually-hidden' }, 'Time on YouTube, openings, and times you turned back, for the last seven days'),
    h(
      'thead',
      null,
      h(
        'tr',
        null,
        h('th', { scope: 'col', class: 'caps' }, 'Day'),
        h('th', { scope: 'col', class: 'caps' }, 'On YouTube'),
        h('th', { scope: 'col', class: 'caps num' }, 'Opened'),
        h('th', { scope: 'col', class: 'caps num' }, 'Turned back'),
      ),
    ),
    h(
      'tbody',
      null,
      days.map((d) =>
        h(
          'tr',
          { class: d.isToday ? 'is-today' : null },
          h('th', { scope: 'row' }, d.label),
          h(
            'td',
            null,
            h(
              'div',
              { class: 'bar-cell' },
              h('span', { class: 'bar', 'aria-hidden': 'true' }, h('span', { class: 'bar-fill', style: { '--w': barWidth(d.activeSec) } })),
              h('span', { class: 'mono bar-text' }, AP.ui.formatDuration(d.activeSec)),
            ),
          ),
          h('td', { class: 'num' }, count(d.opens)),
          h('td', { class: 'num' }, count(d.turnedBack)),
        ),
      ),
    ),
    h(
      'tfoot',
      null,
      h(
        'tr',
        null,
        h('th', { scope: 'row' }, 'Week'),
        h('td', null, h('div', { class: 'bar-cell is-total' }, h('span', { class: 'mono bar-text' }, AP.ui.formatDuration(totals.activeSec)))),
        h('td', { class: 'num' }, count(totals.opens)),
        h('td', { class: 'num' }, count(totals.turnedBack)),
      ),
    ),
  );
}

/** Asks, then has the background forget every stored day. While the settings lock holds it asks for the unlock too (clearing resets a daily limit). */
async function clearHistory() {
  const ok = await AP.ui.confirm('Removes your usage numbers. A daily limit starts again from zero.', {
    title: 'Clear usage history?',
    confirmLabel: 'Clear history',
    danger: true,
  });
  if (!ok) return;
  const send = () => AP.msg.send(AP.msg.TYPES.STATS_CLEAR).catch(() => ({ ok: false }));
  let res = await send();
  if (res?.error === 'locked') {
    if (!(await AP.ui.requestUnlock())) {
      AP.ui.toast('Locked.');
      return;
    }
    res = await send();
  }
  AP.ui.toast(res?.ok ? 'Usage history cleared' : 'Could not clear.');
}

/** @returns {{ el: HTMLElement, refresh: () => Promise<void> }} */
export function buildWeek() {
  const body = h('div', { class: 'week' });

  async function refresh() {
    let stats = {};
    try {
      stats = await AP.state.getStats();
    } catch (err) {
      AP.warn('could not read usage numbers', err);
    }
    const week = AP.ui.weekStats(stats);
    // (Node#replaceChildren turns a `false` argument into the text "false", unlike h(): build the list first.)
    body.replaceChildren(
      ...[
        week.hasData
          ? renderTable(week)
          : h('p', { class: 'empty' }, 'Nothing yet.'),
        Object.keys(stats).length > 0 &&
          h('p', { class: 'week-foot' }, h('button', { type: 'button', class: 'btn btn-quiet', onClick: () => clearHistory() }, 'Clear usage history…')),
      ].filter(Boolean),
    );
  }

  refresh();
  return { el: body, refresh };
}
