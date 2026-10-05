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
function actionRow(label, description, button) {
  return h('div', { class: 'row' }, h('div', { class: 'row-text' }, h('p', { class: 'row-label' }, label), h('p', { class: 'row-desc' }, description)), h('div', { class: 'row-control' }, button));
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
      `This replaces your current settings with the ones in “${picked.name}”. Presets saved in the file are added to yours. Your lock is never changed by an import.`,
      { title: 'Import this backup?', confirmLabel: 'Import' },
    );
    if (!ok) return;
    let text;
    try {
      text = await picked.text();
    } catch {
      showReport({ tone: 'error', headline: 'Nothing was imported.', lines: ['The file could not be read.'] });
      return;
    }
    // An import replaces settings wholesale, so while the lock holds it asks for the unlock first.
    let imported = await AP.lock.importAll(text);
    if (imported.error === 'locked') {
      if (!(await AP.ui.requestUnlock())) {
        AP.ui.toast('Locked: nothing was imported.');
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
        AP.ui.toast('Backup saved to your downloads');
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
        const ok = await AP.ui.confirm('Every setting goes back to its default, which leaves YouTube untouched. Presets you saved stay. This cannot be undone, so export a backup first if you might want these settings again.', {
          title: 'Reset all settings?',
          confirmLabel: 'Reset settings',
          danger: true,
        });
        if (!ok) return;
        let done = await AP.lock.reset();
        if (done.error === 'locked') {
          if (!(await AP.ui.requestUnlock())) {
            AP.ui.toast('Locked: nothing was reset.');
            return;
          }
          done = await AP.lock.reset();
        }
        if (!done.ok) {
          AP.ui.toast('That could not be reset.');
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
    actionRow('Export settings', 'Saves your settings and presets as a file you can keep or move to another browser.', exportBtn),
    actionRow('Import settings', 'Loads a file made by Export. It replaces your current settings.', [importBtn, file]),
    report,
    actionRow('Reset all settings', 'Back to the defaults. Your saved presets stay.', resetBtn),
  );
  return { el };
}
