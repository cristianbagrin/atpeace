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
    body.replaceChildren(
      week.hasData
        ? renderTable(week)
        : h('p', { class: 'empty' }, 'Nothing to show yet. Once you have used YouTube with At Peace on, the last seven days appear here.'),
    );
  }

  refresh();
  return { el: body, refresh };
}
