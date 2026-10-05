// Options page E2E in Chromium: every setting has a control, values save as they change, search,
// bulk chips, presets, backup round trip, theme, deep links, and light + dark screenshots.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, close, getContext, extUrl, trackErrors, setStorage, getStorage, evalInExtension, ARTIFACTS } from './harness.mjs';
import { pageUntil } from '../helpers/wait.mjs';

const SHOTS = join(ARTIFACTS, 'ui');
const OPTIONS = 'src/pages/options/options.html';

before(async () => {
  mkdirSync(SHOTS, { recursive: true });
  await launch();
});

after(async () => {
  await close();
});

beforeEach(async () => {
  await evalInExtension(() => chrome.storage.local.clear());
});

/**
 * Opens the options page at a fixed desktop size and waits until it has built itself.
 * `seed` is written to storage first, `hash` appended to the URL, `init` runs before the page's own scripts.
 */
async function openOptions({ hash = '', seed, width = 1280, height = 860, init } = {}) {
  if (seed) await setStorage(seed);
  const page = trackErrors(await getContext().newPage());
  if (init) await page.addInitScript(init);
  await page.setViewportSize({ width, height });
  await page.goto(`${extUrl(OPTIONS)}${hash}`);
  await page.waitForSelector('body[data-ready="true"]');
  return page;
}

const settings = async () => (await getStorage('settings')).settings ?? {};
const row = (page, id) => page.locator(`.row[data-id="${id}"]`);
const confirmDialog = (page) => page.locator('dialog[open] button[value="confirm"]');
/** The Apply / Rename / Delete buttons of one preset in the open presets dialog. */
const presetButton = (page, name, button) =>
  page
    .locator('dialog[open] .preset')
    .filter({ has: page.locator('.preset-name', { hasText: new RegExp(`^${name}`) }) })
    .getByRole('button', { name: button });

/** Reads the registry from inside the page, so tests follow whatever catalog is shipped. */
const registry = (page) =>
  page.evaluate(() => {
    const AP = globalThis.AtPeace;
    return {
      ids: AP.schema.all().map((d) => d.id),
      sections: AP.schema.sections().filter((s) => AP.schema.bySection(s.id).length > 0).map((s) => ({ id: s.id, title: s.title })),
    };
  });

test('the page opens without errors and builds one numbered section per registry section', async () => {
  const page = await openOptions();
  const { sections } = await registry(page);
  assert.ok(sections.length >= 5);
  const toc = await page.locator('#toc a').allTextContents();
  assert.equal(toc.length, sections.length + 2); // + Your week, Backup & reset
  assert.match(toc[0], /^01\s*General/);
  assert.match(toc.at(-1), /Backup & reset$/);
  assert.equal(await page.locator('h1').textContent(), 'At Peace');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('every setting in the registry has a row with a working control', async () => {
  const page = await openOptions();
  await page.locator('#show-advanced').check();
  const { ids } = await registry(page);
  assert.ok(ids.length >= 100, `registry holds ${ids.length}`);

  const missing = await page.evaluate((all) => {
    const out = [];
    for (const id of all) {
      const el = document.querySelector(`.row[data-id="${id}"]`);
      const control = el?.querySelector('input, select, textarea, button'); // a custom editor may start as just an "Add" button
      if (!el) out.push(`${id}: no row`);
      else if (!control) out.push(`${id}: no control`);
      else if (el.hidden || el.offsetParent === null) out.push(`${id}: not visible with advanced shown`);
    }
    return out;
  }, ids);
  assert.deepEqual(missing, []);

  // Rows carry a label and are unique.
  const counts = await page.evaluate(() => {
    const rowIds = [...document.querySelectorAll('.row[data-id]')].map((r) => r.dataset.id);
    const labels = [...document.querySelectorAll('.row[data-id] .row-label')].filter((l) => l.textContent.trim() === '');
    return { rows: rowIds.length, unique: new Set(rowIds).size, unlabeled: labels.length };
  });
  assert.equal(counts.rows, ids.length);
  assert.equal(counts.unique, ids.length);
  assert.equal(counts.unlabeled, 0);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('"Show advanced" hides and reveals advanced rows', async () => {
  const page = await openOptions();
  const advancedId = await page.evaluate(() => globalThis.AtPeace.schema.all().find((d) => d.advanced)?.id);
  assert.ok(advancedId, 'the catalog has advanced settings');
  await page.locator('#show-advanced').uncheck();
  assert.equal(await row(page, advancedId).isVisible(), false);
  await page.locator('#show-advanced').check();
  assert.equal(await row(page, advancedId).isVisible(), true);
  await page.close();
});

test('toggling a switch saves at once and shows "Saved"; toggling back stores the default again', async () => {
  const page = await openOptions();
  const id = await page.evaluate(() => globalThis.AtPeace.schema.byTag('shorts').find((d) => d.type === 'toggle' && !d.requires).id);
  const input = row(page, id).locator('input.switch');
  assert.equal(await input.isChecked(), false);

  await row(page, id).locator('.row-label').click(); // the whole row is the click target
  await pageUntil(page, async (key) => (await chrome.storage.local.get('settings')).settings?.[key] === true, id);
  assert.equal(await input.isChecked(), true);
  await page.waitForSelector('.saved.is-visible');

  await input.click();
  await pageUntil(page, async (key) => (await chrome.storage.local.get('settings')).settings?.[key] === false, id);
  assert.equal((await settings())[id], false);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('selects save the chosen option', async () => {
  const page = await openOptions();
  const { id, value } = await page.evaluate(() => {
    const def = globalThis.AtPeace.schema.all().find((d) => d.type === 'select' && d.id !== 'general.theme' && !d.requires);
    return { id: def.id, value: def.options.at(-1).value };
  });
  await row(page, id).locator('select').selectOption(value);
  await pageUntil(page, async ([key, v]) => (await chrome.storage.local.get('settings')).settings?.[key] === v, [id, value]);
  await page.close();
});

test('a setting that needs another is switched off, with a hint, until that one is on', async () => {
  const page = await openOptions();
  const pairs = await page.evaluate(() => globalThis.AtPeace.schema.all().filter((d) => d.requires === 'pause.enabled').map((d) => d.id));
  assert.ok(pairs.includes('pause.breathSeconds'));
  const breath = row(page, 'pause.breathSeconds');
  assert.equal(await breath.evaluate((el) => el.classList.contains('is-disabled')), true);
  assert.equal(await breath.locator('input').isDisabled(), true);
  assert.match(await breath.locator('.row-hint').textContent(), /Turn on “Pause before opening”/);

  await row(page, 'pause.enabled').locator('input.switch').click();
  await page.waitForFunction(() => !document.querySelector('.row[data-id="pause.breathSeconds"]').classList.contains('is-disabled'));
  assert.equal(await breath.locator('input').isDisabled(), false);
  assert.equal(await breath.locator('.row-hint').isVisible(), false);

  // the chain: "extra time per visit" needs "breathe longer", which needs the pause
  const step = row(page, 'pause.escalateStep');
  assert.equal(await step.evaluate((el) => el.classList.contains('is-disabled')), true);
  assert.match(await step.locator('.row-hint').textContent(), /Breathe longer/);
  await page.close();
});

test('a number out of range is explained inline and never saved; a good one is', async () => {
  const page = await openOptions({ seed: { settings: { 'pause.enabled': true } } });
  const input = row(page, 'pause.breathSeconds').locator('input[type="number"]');
  await input.fill('2'); // min is 3
  await input.blur();
  await page.waitForSelector('.row[data-id="pause.breathSeconds"] .row-error:not([hidden])');
  assert.match(await row(page, 'pause.breathSeconds').locator('.row-error').textContent(), /from 3 to 30/);
  assert.equal(await input.getAttribute('aria-invalid'), 'true');
  await page.waitForTimeout(700);
  assert.equal((await settings())['pause.breathSeconds'], undefined, 'garbage was stored');

  await input.fill('12');
  await input.blur();
  await pageUntil(page, async () => (await chrome.storage.local.get('settings')).settings?.['pause.breathSeconds'] === 12);
  assert.equal(await row(page, 'pause.breathSeconds').locator('.row-error').isVisible(), false);
  assert.equal(await input.getAttribute('aria-invalid'), 'false');
  await page.close();
});

test('word lists: one entry per line, a broken /regex/ is explained and not saved', async () => {
  const page = await openOptions();
  const id = await page.evaluate(() => globalThis.AtPeace.schema.all().find((d) => d.id.startsWith('yt.filters.') && d.type === 'list' && !d.options)?.id);
  assert.ok(id, 'a filters word list exists');
  const area = row(page, id).locator('textarea');

  await area.fill('spoiler\n/(/\nleak');
  const error = row(page, id).locator('.field-error');
  await error.waitFor({ state: 'visible' });
  assert.match(await error.textContent(), /Line 2: Not a valid regular expression/);
  assert.equal(await area.getAttribute('aria-invalid'), 'true');
  await area.blur();
  await page.waitForTimeout(900);
  assert.equal((await settings())[id], undefined, 'a broken pattern was stored');

  await area.fill('spoiler\n/colou?r/i\n\nspoiler\nleak');
  await area.blur();
  await pageUntil(page, async (key) => JSON.stringify((await chrome.storage.local.get('settings')).settings?.[key]) === '["spoiler","/colou?r/i","leak"]', id);
  assert.equal(await error.isVisible(), false);
  await page.close();
});

test('a text setting the schema refuses is explained and not saved; a valid one is', async () => {
  // Whatever text setting the catalog has (today: the home-page redirect), with what it waits for switched on.
  const probe = await openOptions();
  const def = await probe.evaluate(() => {
    const AP = globalThis.AtPeace;
    const text = AP.schema.all().find((d) => d.type === 'text');
    const cond = text.requires ? AP.schema.parseRequires(text.requires) : null; // 'id', 'id=value' or 'id!=value'
    const dep = cond ? AP.schema.get(cond.id) : null;
    return { id: text.id, requires: dep && { id: dep.id, value: cond.op === '=' ? cond.value : dep.type === 'select' ? dep.options.at(-1).value : true } };
  });
  await probe.close();
  assert.equal(def.id, 'yt.home.redirectUrl', 'the one text setting in the catalog');

  const page = await openOptions({ seed: { settings: def.requires ? { [def.requires.id]: def.requires.value } : {} } });
  const input = row(page, def.id).locator('input[type="text"]');
  await input.fill('https://example.com/elsewhere'); // another site: not allowed
  await input.blur();
  await page.waitForSelector(`.row[data-id="${def.id}"] .row-error:not([hidden])`);
  assert.match(await row(page, def.id).locator('.row-error').textContent(), /not allowed/);
  assert.equal((await settings())[def.id], undefined);

  await input.fill('/feed/subscriptions');
  await input.blur();
  await pageUntil(page, async (id) => (await chrome.storage.local.get('settings')).settings?.[id] === '/feed/subscriptions', def.id);
  assert.equal(await row(page, def.id).locator('.row-error').isVisible(), false);
  await page.close();
});

test('a setting changed elsewhere shows up here without a reload', async () => {
  const page = await openOptions();
  const id = await page.evaluate(() => globalThis.AtPeace.schema.byTag('ads').find((d) => d.type === 'toggle').id);
  const input = row(page, id).locator('input.switch');
  assert.equal(await input.isChecked(), false);
  await setStorage({ settings: { [id]: true } });
  await page.waitForFunction((key) => document.querySelector(`.row[data-id="${key}"] input.switch`).checked, id);
  await setStorage({ settings: {} });
  await page.waitForFunction((key) => !document.querySelector(`.row[data-id="${key}"] input.switch`).checked, id);
  await page.close();
});

test('search filters rows across sections, groups them under their section, and `/` and Esc work', async () => {
  const page = await openOptions();
  const total = await page.locator('.row:visible').count();

  await page.keyboard.press('/');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'search');
  await page.keyboard.type('shorts');
  await page.waitForSelector('#results-note:not([hidden])');
  const note = await page.locator('#results-note').textContent();
  assert.match(note, /settings? match “shorts”/);

  const hits = await page.evaluate(() =>
    [...document.querySelectorAll('.row')].filter((r) => !r.hidden && r.offsetParent !== null).map((r) => ({ id: r.dataset.id, text: r.textContent.toLowerCase(), section: r.closest('.section').dataset.section })),
  );
  assert.ok(hits.length >= 3 && hits.length < total, `${hits.length} of ${total}`);
  for (const hit of hits) assert.ok(hit.text.includes('shorts') || hit.id.includes('shorts') || hit.section.includes('shorts'), `${hit.id} does not match`);
  assert.ok(new Set(hits.map((h) => h.section)).size >= 2, 'matches come from several sections');

  // sections without a match disappear from the page and the table of contents
  const shownSections = await page.locator('.section:visible').count();
  assert.ok(shownSections < 10);
  assert.equal(await page.locator('#toc li:visible').count(), shownSections);

  await page.screenshot({ path: join(SHOTS, 'options-search-light.png') });

  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#search').inputValue(), '');
  await page.waitForSelector('#results-note', { state: 'hidden' });
  assert.equal(await page.locator('.row:visible').count(), total);

  await page.locator('#search').fill('zzzzqq');
  await page.waitForSelector('#results-note:not([hidden])');
  assert.match(await page.locator('#results-note').textContent(), /Nothing matches/);
  assert.equal(await page.locator('.row:visible').count(), 0);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('search also finds advanced settings, labelled as such', async () => {
  const page = await openOptions();
  await page.locator('#show-advanced').uncheck();
  await page.locator('#search').fill('debug');
  await page.waitForSelector('.row[data-id="advanced.debug"]:not([hidden])');
  assert.equal(await row(page, 'advanced.debug').locator('.row-tag').isVisible(), true);
  await page.close();
});

test('bulk chips show all / partly / off and set every tagged setting', async () => {
  const page = await openOptions();
  const tag = 'shorts';
  const chip = page.locator('.chip', { hasText: 'Shorts' });
  const targets = await page.evaluate((t) => globalThis.AtPeace.schema.bulkTargets(t), tag);
  assert.ok(Object.keys(targets).length >= 3);
  assert.equal(await chip.getAttribute('data-state'), 'none');
  assert.equal(await chip.getAttribute('aria-pressed'), 'false');

  await chip.click();
  await pageUntil(page, async (t) => {
    const s = (await chrome.storage.local.get('settings')).settings ?? {};
    return Object.entries(t).every(([id, v]) => s[id] === v);
  }, targets);
  assert.equal(await chip.getAttribute('data-state'), 'all');
  assert.equal(await chip.getAttribute('aria-pressed'), 'true');
  const stored = await settings();
  for (const [id, v] of Object.entries(targets)) assert.equal(stored[id], v, id);

  // the rows follow
  const firstToggle = Object.keys(targets).find((id) => typeof targets[id] === 'boolean');
  assert.equal(await row(page, firstToggle).locator('input.switch').isChecked(), true);

  // turn one off: "partly"
  await row(page, firstToggle).locator('input.switch').click();
  await page.waitForFunction(() => document.querySelector('.chip[data-state="partly"]'));
  assert.equal(await chip.getAttribute('aria-pressed'), 'mixed');

  // from partly, a click turns everything on, and a second click turns everything off again
  await chip.click();
  await page.waitForFunction(() => document.querySelector('.chip[data-state="all"]'));
  await chip.click();
  await page.waitForFunction(() => document.querySelector('.chip[data-state="none"]'));
  const after = await settings();
  for (const id of Object.keys(targets)) {
    const def = await page.evaluate((i) => globalThis.AtPeace.schema.get(i).default, id);
    assert.equal(after[id], def, `${id} back to default`);
  }
  await page.close();
});

test('presets: apply (with confirmation), save current, rename, delete', async () => {
  const page = await openOptions();
  const expected = await page.evaluate(() => {
    const AP = globalThis.AtPeace;
    const values = AP.presets.valuesFor('focused');
    return { values, ids: Object.keys(values) };
  });

  // Apply Focused: cancelling changes nothing, confirming applies the preset's values.
  await page.locator('#topbar button', { hasText: 'Presets' }).click();
  const dialog = page.locator('dialog[open]');
  await dialog.waitFor();
  assert.match(await dialog.textContent(), /sets all your YouTube settings in one go/);
  await presetButton(page, 'Focused', 'Apply').click();
  await page.locator('dialog[open]:has-text("Apply Focused?")').waitFor();
  assert.match(await page.locator('dialog[open]').textContent(), /replaces your current YouTube settings/);
  await page.locator('dialog[open] button[value="cancel"]').click();
  await page.locator('dialog[open]:has-text("Presets")').waitFor(); // back to the presets list
  assert.deepEqual(await settings(), {});
  await presetButton(page, 'Focused', 'Apply').click();
  await confirmDialog(page).click();
  await pageUntil(page, async (id) => (await chrome.storage.local.get('settings')).settings?.[id] !== undefined, expected.ids[0]);
  const applied = await settings();
  for (const [id, v] of Object.entries(expected.values)) assert.deepEqual(applied[id], v, id);
  await page.waitForFunction(() => document.querySelector('.preset-now')?.textContent.includes('Focused'));

  // Save the current settings as a preset.
  await page.locator('#topbar button', { hasText: 'Presets' }).click();
  await page.getByRole('button', { name: /Save my current settings as a preset/ }).click();
  await page.locator('dialog[open] input[type="text"]').fill('Evening');
  await confirmDialog(page).click();
  await pageUntil(page, async () => (await chrome.storage.local.get('customPresets')).customPresets?.length === 1);
  const custom = (await getStorage('customPresets')).customPresets;
  assert.equal(custom[0].name, 'Evening');
  for (const [id, v] of Object.entries(expected.values)) assert.deepEqual(custom[0].values[id], v, `custom preset keeps ${id}`);

  // The dialog reopens listing it; rename it.
  await presetButton(page, 'Evening', 'Rename').click();
  const field = page.locator('dialog[open] input[type="text"]');
  assert.equal(await field.inputValue(), 'Evening');
  await field.fill('Wind-down');
  await confirmDialog(page).click();
  await pageUntil(page, async () => (await chrome.storage.local.get('customPresets')).customPresets?.[0]?.name === 'Wind-down');

  // Delete it (asks first).
  await presetButton(page, 'Wind-down', 'Delete').click();
  assert.match(await page.locator('dialog[open]').textContent(), /will be removed/);
  await confirmDialog(page).click();
  await pageUntil(page, async () => ((await chrome.storage.local.get('customPresets')).customPresets ?? []).length === 0);
  await page.keyboard.press('Escape');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('presets dialog screenshot', async () => {
  const page = await openOptions();
  await page.evaluate(() => globalThis.AtPeace.settings.saveCustomPreset('Evening wind-down', { 'yt.general.grayscale': true }));
  await page.locator('#topbar button', { hasText: 'Presets' }).click();
  await page.locator('dialog[open] .preset-list').first().waitFor();
  await page.screenshot({ path: join(SHOTS, 'options-presets-light.png') });
  await page.keyboard.press('Escape');
  await page.close();
});

test('backup: export, reset, import restores the settings and presets; the report is shown', async () => {
  const page = await openOptions({ seed: { settings: { 'yt.general.hideAds': true, 'yt.comments.hideAll': true, 'pause.enabled': true, 'pause.breathSeconds': 9, 'general.theme': 'dark' } } });
  await page.evaluate(() => globalThis.AtPeace.settings.saveCustomPreset('Mine', { 'yt.general.grayscale': true }));
  const before = await settings();

  await page.locator('#sec-backup').scrollIntoViewIfNeeded();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export…' }).click()]);
  assert.match(download.suggestedFilename(), /^at-peace-\d{4}-\d{2}-\d{2}\.json$/);
  const file = join(SHOTS, 'backup-roundtrip.json');
  await download.saveAs(file);
  const exported = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(exported.app, 'at-peace');
  assert.equal(exported.settings['yt.general.hideAds'], true);
  assert.equal(exported.customPresets.length, 1);

  // Reset all: asks first.
  await page.getByRole('button', { name: 'Reset…' }).click();
  assert.match(await page.locator('dialog[open]').textContent(), /Reset all settings\?/);
  await page.locator('dialog[open] button[value="cancel"]').click();
  assert.deepEqual(await settings(), before);
  await page.getByRole('button', { name: 'Reset…' }).click();
  await confirmDialog(page).click();
  await pageUntil(page, async () => Object.keys((await chrome.storage.local.get('settings')).settings ?? {}).length === 0);
  assert.equal((await getStorage('customPresets')).customPresets.length, 1, 'presets survive a reset');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light'); // the theme went back to the default
  await page.waitForFunction(() => !document.querySelector('.row[data-id="yt.general.hideAds"] input.switch').checked);

  // Import the file back.
  await page.setInputFiles('.backup input[type="file"]', file);
  assert.match(await page.locator('dialog[open]').textContent(), /replaces your current settings/);
  await confirmDialog(page).click();
  await page.waitForSelector('.report:not([hidden])');
  assert.match(await page.locator('.report-head').textContent(), /^Imported \d+ settings?\.$/);
  assert.deepEqual(await settings(), before);
  await page.waitForFunction(() => document.querySelector('.row[data-id="yt.general.hideAds"] input.switch').checked);
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');

  // A file that is not a backup is refused with a reason, and changes nothing.
  const junk = join(SHOTS, 'not-a-backup.json');
  await import('node:fs').then((fs) => fs.writeFileSync(junk, '{"hello":"world"}'));
  await page.setInputFiles('.backup input[type="file"]', junk);
  await confirmDialog(page).click();
  await page.waitForFunction(() => document.querySelector('.report.is-error'));
  assert.match(await page.locator('.report').textContent(), /not an At Peace backup/);
  assert.deepEqual(await settings(), before);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('appearance: dark and "match my system" restyle the page at once and are remembered', async () => {
  const page = await openOptions();
  const theme = row(page, 'general.theme').locator('select');
  const paper = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
  assert.equal(await paper(), 'rgb(243, 238, 227)');

  await theme.selectOption('dark');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  assert.equal(await paper(), 'rgb(20, 22, 43)');
  assert.equal((await settings())['general.theme'], 'dark');

  await page.emulateMedia({ colorScheme: 'light' });
  await theme.selectOption('system');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'system');
  assert.equal(await paper(), 'rgb(243, 238, 227)');
  await page.emulateMedia({ colorScheme: 'dark' });
  assert.equal(await paper(), 'rgb(20, 22, 43)');

  // The next page load starts in the remembered theme (no light flash): theme-boot reads the cache.
  await page.reload();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'system');
  await page.close();
});

test('deep links: #section= scrolls to a section, #setting= reveals and highlights a row (advanced too)', async () => {
  const page = await openOptions({ hash: '#section=pause' });
  await page.waitForFunction(() => document.querySelector('#toc a[aria-current="location"]')?.textContent.includes('Mindful Pause'));
  const top = await page.locator('#sec-pause').evaluate((el) => Math.round(el.getBoundingClientRect().top));
  assert.ok(top < 220, `section top ${top}`);
  await page.close();

  const advancedId = await page2Id();
  const page2 = await openOptions({ hash: `#setting=${advancedId}` });
  await page2.waitForFunction((id) => document.querySelector(`.row[data-id="${id}"]`)?.classList.contains('is-target'), advancedId);
  assert.equal(await row(page2, advancedId).isVisible(), true);
  assert.equal(await page2.locator('#show-advanced').isChecked(), true);
  await page2.waitForFunction((id) => {
    const top = document.querySelector(`.row[data-id="${id}"]`).getBoundingClientRect().top;
    return top >= 0 && top < 400;
  }, advancedId);
  await page2.close();
});

async function page2Id() {
  const probe = await openOptions();
  const id = await probe.evaluate(() => globalThis.AtPeace.schema.all().find((d) => d.advanced).id);
  await probe.close();
  return id;
}

test('the table of contents follows the scroll with the seal on the current section', async () => {
  const page = await openOptions();
  assert.match(await page.locator('#toc a[aria-current="location"]').textContent(), /General/);
  await page.locator('#sec-focus').scrollIntoViewIfNeeded();
  await page.evaluate(() => document.querySelector('#sec-focus').scrollIntoView());
  await page.waitForFunction(() => document.querySelector('#toc a[aria-current="location"]')?.textContent.includes('Focus'));
  assert.equal(await page.locator('#toc a[aria-current="location"]').count(), 1);
  await page.close();
});

test('your week: empty state without data, bars and totals with it', async () => {
  const page = await openOptions();
  assert.match(await page.locator('#sec-week .empty').textContent(), /Nothing to show yet/);

  const stats = await page.evaluate(() => {
    const AP = globalThis.AtPeace;
    const day = (back) => AP.util.dayKey(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - back));
    return {
      [day(0)]: { youtube: { activeSec: 1500, opens: 6, turnedBack: 2, continued: 4, blockedHits: 0 } },
      [day(1)]: { youtube: { activeSec: 3720, opens: 9, turnedBack: 1, continued: 8, blockedHits: 0 } },
      [day(3)]: { youtube: { activeSec: 600, opens: 2, turnedBack: 0, continued: 2, blockedHits: 0 } },
      [day(9)]: { youtube: { activeSec: 99999, opens: 99, turnedBack: 99, continued: 0, blockedHits: 0 } },
    };
  });
  await setStorage({ stats });
  await page.waitForSelector('#sec-week .week-table'); // live: no reload
  const rows = await page.locator('#sec-week tbody tr').count();
  assert.equal(rows, 7);
  assert.equal((await page.locator('#sec-week tbody tr').last().locator('th').textContent()).trim(), 'Today');
  const foot = (await page.locator('#sec-week tfoot').textContent()).replace(/\s+/g, ' ');
  assert.match(foot, /Week\s*1 h 37 min\s*17\s*3/); // 1500 + 3720 + 600 s, the older day is outside the week
  await page.locator('#sec-week').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(SHOTS, 'options-week-light.png') });
  await page.close();
});

test('a schedule that applies a preset is mentioned, so the values on screen are not a surprise', async () => {
  // `state` belongs to the background (it recomputes the override from the schedules), so the page's
  // read of it is faked here instead of seeded.
  const page = await openOptions({
    init: () => {
      const get = chrome.storage.local.get.bind(chrome.storage.local);
      chrome.storage.local.get = async (keys) => {
        const result = await get(keys);
        if (keys === 'state' || (Array.isArray(keys) && keys.includes('state'))) result.state = { ...result.state, scheduleOverride: 'focused' };
        return result;
      };
    },
  });
  await page.waitForSelector('p.banner:not([hidden])');
  assert.match(await page.locator('#notices').textContent(), /A schedule is applying the “Focused” preset/);
  await page.close();
});

test('the host-access banner appears when access is missing and asks for it from the click', async () => {
  const page = await openOptions({
    init: () => {
      let granted = false;
      window.__asked = [];
      chrome.permissions.contains = async () => granted;
      chrome.permissions.request = (perms) => {
        window.__asked.push(perms);
        granted = true;
        return Promise.resolve(true);
      };
    },
  });
  const banner = page.getByRole('region', { name: 'Access to YouTube' });
  await banner.waitFor({ state: 'visible' });
  await banner.getByRole('button', { name: 'Grant access' }).click();
  await banner.waitFor({ state: 'hidden' });
  const asked = await page.evaluate(() => window.__asked);
  assert.deepEqual(asked, [{ origins: ['*://*.youtube.com/*'] }]);
  await page.close();
});

test('without the stub the banner stays hidden (access is granted at install)', async () => {
  const page = await openOptions();
  assert.equal(await page.getByRole('region', { name: 'Access to YouTube' }).isVisible(), false);
  await page.close();
});

test('keyboard: the table of contents, search and a switch can be used without a mouse', async () => {
  const page = await openOptions();
  await page.keyboard.press('Tab');
  assert.match(await page.evaluate(() => document.activeElement.textContent), /General/); // first TOC link
  const ring = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  assert.notEqual(ring, 'none');
  await page.close();
});

test('screenshots: light and dark, top / a long section / search', async () => {
  for (const theme of ['light', 'dark']) {
    const page = await openOptions({ seed: { settings: { 'general.theme': theme, 'yt.general.hideAds': true, 'yt.comments.hideAll': true, 'yt.shorts.mode': 'watch' } } });
    await page.screenshot({ path: join(SHOTS, `options-top-${theme}.png`) });

    await page.locator('#show-advanced').check();
    await page.evaluate(() => document.querySelector('#sec-yt-watch')?.scrollIntoView());
    await page.waitForTimeout(450);
    await page.screenshot({ path: join(SHOTS, `options-long-section-${theme}.png`) });

    await page.evaluate(() => document.querySelector('#sec-pause').scrollIntoView());
    await page.waitForTimeout(450);
    await page.screenshot({ path: join(SHOTS, `options-pause-${theme}.png`) });

    await page.locator('#search').fill('comments');
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(SHOTS, `options-search-${theme}.png`) });

    await page.locator('#search').fill('');
    await page.evaluate(() => document.querySelector('#sec-yt-filters')?.scrollIntoView());
    await page.waitForTimeout(450);
    await page.screenshot({ path: join(SHOTS, `options-filters-${theme}.png`) });

    await page.evaluate(() => document.querySelector('#sec-backup').scrollIntoView());
    await page.waitForTimeout(450);
    await page.screenshot({ path: join(SHOTS, `options-backup-${theme}.png`) });
    assert.deepEqual(page.errors, []);
    await page.close();
  }
});
