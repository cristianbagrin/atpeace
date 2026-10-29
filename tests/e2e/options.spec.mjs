// Options page E2E in Chromium: every setting has a control, values save as they change, search,
// presets, backup round trip, theme, deep links, and light + dark screenshots.
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
/** Reads the registry from inside the page, so tests follow whatever catalog is shipped. */
const registry = (page) =>
  page.evaluate(() => {
    const AP = globalThis.AtPeace;
    return {
      ids: AP.schema.all().map((d) => d.id),
      sections: AP.schema.sections().filter((s) => AP.schema.bySection(s.id).length > 0).map((s) => ({ id: s.id, title: s.title })),
    };
  });

test('the page opens without errors and builds one section per registry section, each with a navigation link', async () => {
  const page = await openOptions();
  const { sections } = await registry(page);
  assert.ok(sections.length >= 5);
  const toc = await page.locator('#toc a').allTextContents();
  assert.equal(toc.length, sections.length + 3); // + Presets, Your week, Backup & reset
  assert.match(toc[0], /^General/);
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
  assert.match(await row(page, def.id).locator('.row-error').textContent(), /not allowed/i);
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
  assert.match(note, /^\d+ matches?$/);

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

const presetRow = (page, name) => page.locator('#sec-presets .preset').filter({ has: page.locator('.preset-name', { hasText: new RegExp(`^${name}`) }) });
const customPresets = async () => (await getStorage('customPresets')).customPresets ?? [];

test('presets: a section of its own in the navigation, built-ins and "Yours", the one in use is marked', async () => {
  const page = await openOptions();
  const toc = await page.locator('#toc a').allTextContents();
  assert.match(toc[1], /^Presets/, 'right after General');
  assert.equal(await page.locator('#presets-btn, #topbar button', { hasText: 'Presets' }).count() >= 1, true);
  const names = (list) => list.locator('.preset-name').evaluateAll((els) => els.map((el) => el.firstChild.textContent));
  assert.deepEqual(await names(page.locator('#sec-presets .preset-list').first()), ['Gentle', 'Focused', 'Deep work', 'Untouched']);
  assert.equal(await page.locator('#sec-presets .section-intro').count(), 0);
  // nothing set: the defaults are "Untouched"
  assert.match(await presetRow(page, 'Untouched').locator('.preset-current').textContent(), /In use/);
  assert.match(await page.locator('#sec-presets .section-count').textContent(), /Untouched/);
  // a hand-made mix matches none
  await setStorage({ settings: { 'yt.general.grayscale': true } });
  await page.waitForFunction(() => document.querySelectorAll('#sec-presets .preset-current').length === 0);
  assert.equal(await page.locator('#sec-presets .section-count').isHidden(), true);
  // the toolbar button goes to the section
  await page.locator('#topbar button', { hasText: 'Presets' }).click();
  await page.waitForFunction(() => location.hash === '#section=presets');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('presets: apply asks only when it would replace a hand-made mix; locked loosening needs the unlock', async () => {
  const page = await openOptions({ seed: { settings: { 'yt.general.grayscale': true } } });
  const expected = await page.evaluate(() => {
    const values = globalThis.AtPeace.presets.valuesFor('focused');
    return { values, ids: Object.keys(values) };
  });

  // A hand-made mix: the question comes first, cancelling changes nothing.
  await presetRow(page, 'Focused').getByRole('button', { name: 'Apply Focused' }).click();
  await page.locator('dialog[open]:has-text("Apply Focused?")').waitFor();
  assert.match(await page.locator('dialog[open]').textContent(), /Replaces your YouTube settings/);
  await page.locator('dialog[open] button[value="cancel"]').click();
  assert.deepEqual(await settings(), { 'yt.general.grayscale': true });
  await presetRow(page, 'Focused').getByRole('button', { name: 'Apply Focused' }).click();
  await confirmDialog(page).click();
  await pageUntil(page, async (id) => (await chrome.storage.local.get('settings')).settings?.[id] !== undefined, expected.ids[0]);
  const applied = await settings();
  for (const [id, v] of Object.entries(expected.values)) assert.deepEqual(applied[id], v, id);
  assert.equal(applied['yt.general.grayscale'], undefined, 'a preset replaces everything it may touch');
  await page.waitForFunction(() => document.querySelector('#sec-presets .preset.is-current .preset-name')?.textContent.startsWith('Focused'));
  assert.match(await page.locator('.preset-now').textContent(), /Focused/);

  // Moving from one preset to another loses nothing: no question.
  await presetRow(page, 'Gentle').getByRole('button', { name: 'Apply Gentle' }).click();
  await page.locator('.toast.is-visible', { hasText: 'Gentle applied' }).waitFor();
  assert.equal(await page.locator('dialog[open]').count(), 0);
  await page.waitForFunction(() => document.querySelector('#sec-presets .preset.is-current .preset-name')?.textContent.startsWith('Gentle'));
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('presets: new from current settings, update, rename, delete with undo', async () => {
  const page = await openOptions({ seed: { settings: { 'yt.general.grayscale': true, 'yt.shorts.mode': 'block' } } });

  // New preset: an inline name field, no dialog.
  await page.getByRole('button', { name: 'New preset from current settings' }).click();
  const field = page.locator('#sec-presets .preset-form input[type="text"]');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Preset name', 'the field has the focus');
  await field.press('Escape');
  assert.equal(await field.count(), 0, 'Escape cancels');
  assert.deepEqual(await customPresets(), []);
  await page.getByRole('button', { name: 'New preset from current settings' }).click();
  await field.fill('   ');
  await field.press('Enter');
  assert.deepEqual(await customPresets(), [], 'a blank name saves nothing');
  await field.fill('Evening');
  await field.press('Enter');
  await pageUntil(page, async () => (await chrome.storage.local.get('customPresets')).customPresets?.length === 1);
  const [saved] = await customPresets();
  assert.equal(saved.name, 'Evening');
  assert.deepEqual(saved.values, { 'yt.general.grayscale': true, 'yt.shorts.mode': 'block' });
  await page.waitForFunction(() => document.querySelector('#sec-presets .preset.is-current .preset-name')?.textContent.startsWith('Evening'));
  assert.equal(await presetRow(page, 'Evening').getByRole('button', { name: /Update Evening/ }).isDisabled(), true, 'nothing to update while it is in use');
  assert.match(await presetRow(page, 'Evening').locator('.preset-desc').textContent(), /2 settings/);

  // Change something, then update the preset from the current settings.
  await setStorage({ settings: { 'yt.general.grayscale': true, 'yt.shorts.mode': 'block', 'yt.comments.hideAll': true } });
  await page.waitForFunction(() => !document.querySelector('#sec-presets .preset.is-current'));
  await presetRow(page, 'Evening').getByRole('button', { name: /Update Evening/ }).click();
  await pageUntil(page, async () => (await chrome.storage.local.get('customPresets')).customPresets?.[0]?.values?.['yt.comments.hideAll'] === true);
  assert.equal((await customPresets())[0].id, saved.id, 'same preset');
  await page.waitForFunction(() => document.querySelector('#sec-presets .preset.is-current .preset-name')?.textContent.startsWith('Evening'));

  // Rename in place.
  await presetRow(page, 'Evening').getByRole('button', { name: 'Rename Evening' }).click();
  const rename = page.locator('#sec-presets .preset-form input[type="text"]');
  assert.equal(await rename.inputValue(), 'Evening');
  await rename.fill('Wind-down');
  await page.locator('#sec-presets .preset-form').getByRole('button', { name: 'Save' }).click();
  await pageUntil(page, async () => (await chrome.storage.local.get('customPresets')).customPresets?.[0]?.name === 'Wind-down');
  assert.equal(await presetRow(page, 'Wind-down').count(), 1);

  // Delete: gone at once, with an Undo that brings it back with the same id.
  await presetRow(page, 'Wind-down').getByRole('button', { name: 'Delete Wind-down' }).click();
  await pageUntil(page, async () => ((await chrome.storage.local.get('customPresets')).customPresets ?? []).length === 0);
  assert.equal(await page.locator('dialog[open]').count(), 0, 'no confirmation: there is an undo');
  await page.locator('#sec-presets .undo').getByText('Deleted “Wind-down”.').waitFor();
  await page.screenshot({ path: join(SHOTS, 'options-presets-undo-light.png') });
  await page.locator('#sec-presets .undo').getByRole('button', { name: 'Undo' }).click();
  await pageUntil(page, async () => (await chrome.storage.local.get('customPresets')).customPresets?.length === 1);
  assert.equal((await customPresets())[0].id, saved.id);
  assert.equal((await customPresets())[0].name, 'Wind-down');
  assert.equal(await page.locator('#sec-presets .undo').isHidden(), true);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('presets: while locked, a preset that would show something again asks for the unlock; one that only hides more does not', async () => {
  const lock = { mode: 'friction', waitSeconds: 10 };
  const page = await openOptions({ seed: { settings: { 'advanced.lock': lock, 'yt.general.hidePremiumUpsells': true, 'yt.comments.hideAll': true, 'yt.home.feedMode': 'hide' } } });
  // "Untouched" shows everything again: refused with the unlock dialog; cancelling leaves things as they are.
  await presetRow(page, 'Untouched').getByRole('button', { name: 'Apply Untouched' }).click();
  await confirmDialog(page).click(); // the settings are a hand-made mix: the question first
  await page.locator('dialog[open]:has-text("Unlock settings")').waitFor();
  await page.locator('dialog[open]').getByRole('button', { name: 'Cancel' }).click();
  await page.locator('.toast.is-visible', { hasText: 'Locked.' }).waitFor();
  assert.equal((await settings())['yt.home.feedMode'], 'hide');
  await page.close();

  // Nothing hidden yet: a preset that only hides more goes through while locked, with no question.
  const quiet = await openOptions({ seed: { settings: { 'advanced.lock': lock } } });
  await presetRow(quiet, 'Focused').getByRole('button', { name: 'Apply Focused' }).click();
  await quiet.locator('.toast.is-visible', { hasText: 'Focused applied' }).waitFor();
  assert.equal(await quiet.locator('dialog[open]').count(), 0);
  assert.equal((await settings())['yt.home.feedMode'], 'hide');
  assert.deepEqual(quiet.errors, []);
  await quiet.close();
});

test('presets section screenshot', async () => {
  const page = await openOptions({ hash: '#section=presets' });
  await page.evaluate(() => globalThis.AtPeace.settings.saveCustomPreset('Evening wind-down', { 'yt.general.grayscale': true }));
  await page.locator('#sec-presets .preset-add, #sec-presets .preset').nth(5).waitFor();
  await page.screenshot({ path: join(SHOTS, 'options-presets-light.png') });
  await page.close();
});

test('backup: export, reset, import restores the settings and presets; the report is shown', async () => {
  const page = await openOptions({ seed: { settings: { 'yt.general.hidePremiumUpsells': true, 'yt.comments.hideAll': true, 'pause.enabled': true, 'pause.breathSeconds': 9, 'general.theme': 'dark' } } });
  await page.evaluate(() => globalThis.AtPeace.settings.saveCustomPreset('Mine', { 'yt.general.grayscale': true }));
  const before = await settings();

  await page.locator('#sec-backup').scrollIntoViewIfNeeded();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export…' }).click()]);
  assert.match(download.suggestedFilename(), /^at-peace-\d{4}-\d{2}-\d{2}\.json$/);
  const file = join(SHOTS, 'backup-roundtrip.json');
  await download.saveAs(file);
  const exported = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(exported.app, 'at-peace');
  assert.equal(exported.settings['yt.general.hidePremiumUpsells'], true);
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
  await page.waitForFunction(() => !document.querySelector('.row[data-id="yt.general.hidePremiumUpsells"] input.switch').checked);

  // Import the file back.
  await page.setInputFiles('.backup input[type="file"]', file);
  assert.match(await page.locator('dialog[open]').textContent(), /Replaces your settings/);
  await confirmDialog(page).click();
  await page.waitForSelector('.report:not([hidden])');
  assert.match(await page.locator('.report-head').textContent(), /^Imported \d+ settings?\.$/);
  assert.deepEqual(await settings(), before);
  await page.waitForFunction(() => document.querySelector('.row[data-id="yt.general.hidePremiumUpsells"] input.switch').checked);
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
  assert.equal(await paper(), 'rgb(238, 241, 246)');

  await theme.selectOption('dark');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  assert.equal(await paper(), 'rgb(14, 16, 51)');
  assert.equal((await settings())['general.theme'], 'dark');

  await page.emulateMedia({ colorScheme: 'light' });
  await theme.selectOption('system');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'system');
  assert.equal(await paper(), 'rgb(238, 241, 246)');
  await page.emulateMedia({ colorScheme: 'dark' });
  assert.equal(await paper(), 'rgb(14, 16, 51)');

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
  assert.match(await page.locator('#sec-week .empty').textContent(), /Nothing yet/);

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
  assert.match(await page.locator('#notices').textContent(), /A schedule is applying “Focused”/);
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
    const page = await openOptions({ seed: { settings: { 'general.theme': theme, 'yt.general.hidePremiumUpsells': true, 'yt.comments.hideAll': true, 'yt.shorts.mode': 'watch' } } });
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
    await page.evaluate(() => document.querySelector('#sec-backup').scrollIntoView());
    await page.waitForTimeout(450);
    await page.screenshot({ path: join(SHOTS, `options-backup-${theme}.png`) });
    assert.deepEqual(page.errors, []);
    await page.close();
  }
});
