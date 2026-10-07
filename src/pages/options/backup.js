// "Backup & reset": export the settings as a JSON file, import one (with a plain report of what
// was applied, skipped or kept), and put everything back to its defaults.
const AP = globalThis.AtPeace;
const { h } = AP.ui;

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = h('a', { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** A ledger row whose right side is a button. */
function actionRow(label, button) {
  return h('div', { class: 'row' }, h('div', { class: 'row-text' }, h('p', { class: 'row-label' }, label)), h('div', { class: 'row-control' }, button));
}

/** @returns {{ el: HTMLElement }} */
export function buildBackup() {
  const report = h('div', { class: 'report', role: 'status', hidden: true });

  const showReport = ({ tone, headline, lines }) => {
    report.className = `report is-${tone}`;
    report.replaceChildren(h('p', { class: 'report-head' }, headline), ...lines.map((line) => h('p', { class: 'report-line' }, line)));
    report.hidden = false;
  };

  const file = h('input', { type: 'file', accept: 'application/json,.json', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' });
  file.addEventListener('change', async () => {
    const picked = file.files?.[0];
    file.value = '';
    if (!picked) return;
    const ok = await AP.ui.confirm(
      `Replaces your settings with the ones in “${picked.name}”.`,
      { title: 'Import this backup?', confirmLabel: 'Import' },
    );
    if (!ok) return;
    let text;
    try {
      text = await picked.text();
    } catch {
      showReport({ tone: 'error', headline: 'Nothing was imported.', lines: ['Could not read the file.'] });
      return;
    }
    // An import replaces settings wholesale, so while the lock holds it asks for the unlock first.
    let imported = await AP.lock.importAll(text);
    if (imported.error === 'locked') {
      if (!(await AP.ui.requestUnlock())) {
        AP.ui.toast('Locked.');
        return;
      }
      imported = await AP.lock.importAll(text);
    }
    const result = AP.ui.formatImportReport(imported);
    showReport(result);
    if (result.tone !== 'error') AP.ui.toast('Backup imported');
  });

  const exportBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn',
      onClick: async () => {
        download(`at-peace-${AP.util.dayKey()}.json`, JSON.stringify(await AP.settings.exportAll(), null, 2));
        AP.ui.toast('Backup saved');
      },
    },
    'Export…',
  );

  const importBtn = h('button', { type: 'button', class: 'btn', onClick: () => file.click() }, 'Import…');

  const resetBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn btn-danger',
      onClick: async () => {
        const ok = await AP.ui.confirm('Every setting goes back to its default. This cannot be undone.', {
          title: 'Reset all settings?',
          confirmLabel: 'Reset settings',
          danger: true,
        });
        if (!ok) return;
        let done = await AP.lock.reset();
        if (done.error === 'locked') {
          if (!(await AP.ui.requestUnlock())) {
            AP.ui.toast('Locked.');
            return;
          }
          done = await AP.lock.reset();
        }
        if (!done.ok) {
          AP.ui.toast('Could not reset.');
          return;
        }
        report.hidden = true;
        AP.ui.toast('Settings reset');
      },
    },
    'Reset…',
  );

  const el = h(
    'div',
    { class: 'backup' },
    actionRow('Export settings', exportBtn),
    actionRow('Import settings', [importBtn, file]),
    report,
    actionRow('Reset all settings', resetBtn),
  );
  return { el };
}
