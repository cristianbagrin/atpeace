// The popup's two settings tabs. "This page" and "All" are the same thing built from different
// section lists: collapsible groups (a section each) of compact rows, the first open. Rows are made
// when a group is first opened (or searched), so the popup appears at once.
import { buildInlineRow, buildEditRow } from './rows.js';

const AP = globalThis.AtPeace;
const { h } = AP.ui;

const hiddenText = (n) => `${n} hidden`;

/**
 * One section as a collapsible group.
 * @param {object} ctx popup context
 * @param {{ id: string, title: string, counted: boolean, defs: object[], extra?: { label: string, target: object }[] }} spec
 */
function buildGroup(ctx, { id, title, counted, defs, extra = [] }, { open, onToggle }) {
  const panelId = `grp-${id.replace(/[^A-Za-z0-9_-]/g, '-')}`;
  const count = h('span', { class: 'grp-count mono' });
  const head = h(
    'button',
    { type: 'button', class: 'grp-head', 'aria-expanded': 'false', 'aria-controls': panelId },
    h('span', { class: 'grp-title' }, title),
    count,
    h('span', { class: 'grp-chev', 'aria-hidden': 'true' }),
  );
  const panel = h('div', { class: 'grp-panel', id: panelId, hidden: true });
  const el = h('section', { class: 'grp', dataset: { section: id } }, head, panel);

  /** @type {{ def: object, el: HTMLElement }[]} */
  const rows = [];
  /** [{ head: HTMLElement|null, rows: HTMLElement[] }] for hiding a sub-heading whose rows are all hidden. */
  const clusters = [];
  let built = false;
  let isOpen = open;
  /** A search is on: every group with a match is shown open. */
  let forced = false;
  /** The settings the current search / "Show advanced" lets through. */
  let visible = new Set(defs);
  let showExtra = extra.length > 0;

  function build() {
    if (built) return;
    built = true;
    const children = [];
    for (const { name, defs: list } of AP.ui.clusterGroups(defs)) {
      // A sub-heading that only repeats the section's own name would say nothing.
      const titled = name !== '' && name.toLowerCase() !== title.toLowerCase();
      const heading = titled ? h('p', { class: 'grp-sub caps' }, name) : null;
      const made = list.map((def) => (AP.ui.isInlineSetting(def) ? buildInlineRow(ctx, def) : buildEditRow(ctx, { label: def.label, target: { setting: def.id }, def })));
      rows.push(...made.map((row) => ({ def: row.def, el: row.el })));
      clusters.push({ heading, rows: made.map((r) => r.el) });
      children.push(heading, ...made.map((r) => r.el));
    }
    for (const item of extra) {
      const row = buildEditRow(ctx, item);
      rows.push({ def: null, el: row.el });
      clusters.push({ heading: null, rows: [row.el] });
      children.push(row.el);
    }
    panel.replaceChildren(...children.filter(Boolean));
    showRows();
    ctx.refreshRequires();
  }

  function showRows() {
    for (const row of rows) row.el.hidden = row.def ? !visible.has(row.def) : !showExtra;
    for (const cluster of clusters) {
      if (cluster.heading) cluster.heading.hidden = cluster.rows.every((r) => r.hidden);
    }
  }

  function paint() {
    const show = isOpen || forced;
    if (show) build();
    panel.hidden = !show;
    head.setAttribute('aria-expanded', show ? 'true' : 'false');
    el.classList.toggle('is-open', show);
  }

  head.addEventListener('click', () => {
    if (forced) return; // a search shows every match; there is nothing to fold
    isOpen = !isOpen;
    paint();
    onToggle(id, isOpen);
  });

  return {
    id,
    el,
    get isOpen() {
      return isOpen;
    },
    /** Shows only `matches` (a Set of defs); the extra rows show unless a search is on. */
    filter(matches, { searching }) {
      forced = searching;
      visible = matches;
      showExtra = !searching && extra.length > 0;
      const any = matches.size > 0 || showExtra;
      el.hidden = !any;
      if (!any) return;
      paint();
      if (built) showRows();
    },
    /** "3 hidden" in the header. */
    setCount(on) {
      count.textContent = counted ? hiddenText(on) : '';
    },
    paint,
  };
}

/**
 * @param {object} ctx popup context
 * @param {object} spec
 * @param {string} spec.key        remembered open groups are stored under this
 * @param {{ id: string, title: string, counted?: boolean, defs: object[], extra?: object[] }[]} spec.groups
 * @param {boolean} [spec.search]  a search field on top
 * @param {boolean} [spec.advancedSwitch]  "Show advanced" at the bottom
 * @param {string|null} [spec.note] one line above everything
 * @returns {{ el: HTMLElement, refresh: () => void, applyFilter: () => void, focusSearch: () => void }}
 */
export function buildSettingsView(ctx, { key, groups: specs, search = false, advancedSwitch = false, note = null }) {
  const remembered = ctx.prefs.openGroups(key);
  const openNow = new Set(remembered ?? specs.slice(0, 1).map((g) => g.id));
  const groups = specs.map((spec) =>
    buildGroup(ctx, { ...spec, counted: spec.counted ?? false }, {
      open: openNow.has(spec.id),
      onToggle: (id, isOpen) => {
        if (isOpen) openNow.add(id);
        else openNow.delete(id);
        ctx.prefs.setOpenGroups(key, [...openNow]);
      },
    }),
  );

  let query = '';
  const empty = h('p', { class: 'note empty', hidden: true });
  const children = [];
  let input = null;

  if (note) children.push(h('p', { class: 'note view-note' }, note));
  if (search) {
    input = h('input', { type: 'search', class: 'search-field', placeholder: 'Search settings', 'aria-label': 'Search settings', autocomplete: 'off', spellcheck: false });
    input.addEventListener('input', () => {
      query = input.value;
      applyFilter();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && input.value !== '') {
        event.preventDefault();
        event.stopPropagation();
        input.value = '';
        query = '';
        applyFilter();
      }
    });
    children.push(h('div', { class: 'search' }, input));
  }
  children.push(h('div', { class: 'grp-list' }, groups.map((g) => g.el)), empty);
  if (advancedSwitch) {
    const id = 'show-advanced';
    const control = AP.ui.settingControl({ id: 'popup.showAdvanced', type: 'toggle', label: 'Show advanced' }, ctx.state.showAdvanced, (on) => ctx.setShowAdvanced(on), { id });
    ctx.onShowAdvanced((on) => control.set(on));
    children.push(h('div', { class: 'row is-toggle advanced-row' }, h('label', { class: 'row-label', for: id }, 'Show advanced'), control.el));
  }
  const el = h('div', { class: 'view settings-view', dataset: { view: key } }, children);

  function applyFilter() {
    const searching = AP.ui.queryTokens(query).length > 0;
    const hits = AP.ui.filterPopupGroups(
      specs.map((spec) => ({ section: { id: spec.id, title: spec.title }, defs: spec.defs })),
      query,
      { showAdvanced: ctx.state.showAdvanced },
    );
    const matches = new Map(hits.map((hit) => [hit.section.id, new Set(hit.defs)]));
    for (const group of groups) group.filter(matches.get(group.id) ?? new Set(), { searching });
    empty.hidden = !searching || matches.size > 0;
    if (!empty.hidden) empty.textContent = `Nothing matches “${query.trim()}”.`;
  }

  function refresh() {
    const counts = AP.ui.navCounts(ctx.state.values);
    for (const [i, group] of groups.entries()) group.setCount(counts[specs[i].id]?.on ?? 0);
  }

  applyFilter();
  refresh();

  return { el, refresh, applyFilter, focusSearch: () => input?.focus() };
}
