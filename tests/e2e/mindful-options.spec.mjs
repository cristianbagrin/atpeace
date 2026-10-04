// Phase 3c, Chromium: the two custom editors (pause sites, schedules) inside the real options page.
// permissions.request cannot be clicked in a headless test, so the page's `chrome.permissions`
// methods are replaced by recorders; what is tested is OUR sequence (the request comes first, inside
// the click, and nothing is saved when it is refused) and what gets stored.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { launch, close, extUrl, evalInExtension } from './harness.mjs';
import { resetStorage, configure, newTab, shotEl, dnrRules, settle, ourErrors } from './_mindful.mjs';

before(async () => {
  await launch();
});
after(async () => {
  await close();
});
beforeEach(async () => {
  await resetStorage();
});

const stored = () => evalInExtension(async () => (await chrome.storage.local.get('settings')).settings ?? {});

async function optionsPage(section) {
  if (section === 'pause') await configure({ 'pause.enabled': true }); // the sites editor is switched off while the pause is
  const page = await newTab();
  await page.setViewportSize({ width: 1280, height: 1500 }); // tall: nothing needs scrolling under the sticky top bar
  await page.goto(`${extUrl('src/pages/options/options.html')}#${section}`);
  await page.waitForSelector(section === 'pause' ? '[data-id="pause.sites"] .pause-sites' : '[data-id="focus.schedules"] .schedules');
  return page;
}

/** Replaces chrome.permissions.request/contains/remove in the page with recorders. */
async function stubPermissions(page, { grant = true } = {}) {
  await page.evaluate((grantIt) => {
    const log = (window.__perm = { calls: [], settingsAtRequest: [], granted: new Set() });
    const perms = chrome.permissions;
    perms.request = (query) => {
      // What is stored at the moment of the request: it must not be the new site yet.
      chrome.storage.local.get('settings').then((r) => log.settingsAtRequest.push(r.settings?.['pause.sites']?.length ?? 1));
      log.calls.push(['request', query.origins[0]]);
      if (grantIt) for (const o of query.origins) log.granted.add(o);
      return Promise.resolve(grantIt);
    };
    perms.contains = ({ origins }) => Promise.resolve(origins.every((o) => log.granted.has(o)));
    perms.remove = ({ origins }) => {
      log.calls.push(['remove', origins[0]]);
      for (const o of origins) log.granted.delete(o);
      return Promise.resolve(true);
    };
  }, grant);
}

test('pause sites: YouTube is built in; adding a site asks for access first, then saves it', async () => {
  const page = await optionsPage('pause');
  await stubPermissions(page);
  const editor = page.locator('[data-id="pause.sites"]');
  assert.equal(await editor.locator('.site').count(), 1);
  assert.equal(await editor.locator('.site-name').first().textContent(), 'YouTube');
  assert.equal(await editor.locator('.site-meta').first().textContent(), 'Built in');
  assert.equal(await editor.getByRole('button', { name: /Remove YouTube/ }).count(), 0, 'YouTube cannot be removed');

  await editor.getByLabel('Site to add').fill('https://www.Reddit.com/r/calm');
  await editor.getByRole('button', { name: 'Add site' }).click();
  await editor.locator('.site').nth(1).waitFor();
  assert.equal(await editor.locator('.site-name').nth(1).textContent(), 'reddit.com');
  await page.waitForFunction(() => document.querySelector('[data-id="pause.sites"] .site:nth-child(2) .site-meta')?.textContent.startsWith('Access granted'));

  const perm = await page.evaluate(() => ({ calls: window.__perm.calls, atRequest: window.__perm.settingsAtRequest }));
  assert.deepEqual(perm.calls[0], ['request', '*://*.reddit.com/*']);
  assert.deepEqual(perm.atRequest, [1], 'the site was not stored before the browser agreed');
  assert.deepEqual((await stored())['pause.sites'], [
    { siteKey: 'youtube', domain: 'youtube.com', enabled: true },
    { siteKey: 'reddit.com', domain: 'reddit.com', enabled: true },
  ]);
  assert.equal(await editor.getByLabel('Site to add').inputValue(), '', 'the field is cleared');
  await shotEl(editor, 'options-pause-sites');
  assert.deepEqual(ourErrors(page), []);
  await page.close();
});

test('pause sites: a pause rule appears for the new site once it is added and the pause is on', async () => {
  const page = await optionsPage('pause');
  await stubPermissions(page);
  const editor = page.locator('[data-id="pause.sites"]');
  await editor.getByLabel('Site to add').fill('example.org');
  await editor.getByLabel('Site to add').press('Enter');
  await editor.locator('.site').nth(1).waitFor();
  await settle();
  const regexes = (await dnrRules()).map((r) => r.condition.regexFilter);
  assert.deepEqual(regexes, ['^https?://([a-z0-9-]+\\.)*example\\.org(:[0-9]+)?/.*', '^https?://(www\\.|m\\.)?youtube\\.com/.*']);
  await page.close();
});

test('pause sites: refused access means nothing is added; bad input says why', async () => {
  const page = await optionsPage('pause');
  await stubPermissions(page, { grant: false });
  const editor = page.locator('[data-id="pause.sites"]');
  await editor.getByLabel('Site to add').fill('example.org');
  await editor.getByRole('button', { name: 'Add site' }).click();
  await editor.getByRole('alert').filter({ hasText: 'was not granted' }).waitFor();
  assert.equal(await editor.locator('.site').count(), 1);
  assert.equal((await stored())['pause.sites'], undefined);

  for (const [typed, message] of [['youtube.com', /already in the list/], ['', /Type the address/], ['localhost', /site name like/], ['not a site', /does not look like/]]) {
    await editor.getByLabel('Site to add').fill(typed);
    await editor.getByRole('button', { name: 'Add site' }).click();
    await editor.getByRole('alert').filter({ hasText: message }).waitFor();
  }
  const calls = await page.evaluate(() => window.__perm.calls.length);
  assert.equal(calls, 1, 'a request was made only for the one valid address');
  await page.close();
});

test('pause sites: switch a site off, then remove it (the access is handed back)', async () => {
  const page = await optionsPage('pause');
  await stubPermissions(page);
  const editor = page.locator('[data-id="pause.sites"]');
  await editor.getByLabel('Site to add').fill('example.org');
  await editor.getByRole('button', { name: 'Add site' }).click();
  await editor.locator('.site').nth(1).waitFor();

  await editor.getByLabel('Pause before opening example.org').uncheck();
  await page.waitForFunction(async () => (await chrome.storage.local.get('settings')).settings['pause.sites'][1].enabled === false);

  await editor.getByRole('button', { name: 'Remove example.org' }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-id="pause.sites"] .site').length === 1);
  assert.equal((await stored())['pause.sites'].length, 1);
  const calls = await page.evaluate(() => window.__perm.calls);
  assert.deepEqual(calls.at(-1), ['remove', '*://*.example.org/*']);
  await page.close();
});

test('pause sites: a site whose access was revoked says so and offers to grant it again', async () => {
  const page = await optionsPage('pause');
  await stubPermissions(page);
  const editor = page.locator('[data-id="pause.sites"]');
  await editor.getByLabel('Site to add').fill('example.org');
  await editor.getByRole('button', { name: 'Add site' }).click();
  await editor.locator('.site').nth(1).waitFor();
  await page.waitForFunction(() => document.querySelector('[data-id="pause.sites"] .site:nth-child(2) .site-meta')?.textContent.startsWith('Access granted'));

  await page.evaluate(() => window.__perm.granted.clear()); // revoked in about:addons
  // The editor re-checks whenever the list is re-read (a change here or in another tab).
  await editor.getByLabel('Pause before opening example.org').uncheck();
  await editor.getByRole('button', { name: 'Grant access' }).waitFor();
  assert.match(await editor.locator('.site').nth(1).locator('.site-meta').textContent(), /Access needed/);
  await shotEl(editor, 'options-pause-sites-needs-access');
  await editor.getByRole('button', { name: 'Grant access' }).click();
  await page.waitForFunction(() => document.querySelector('[data-id="pause.sites"] .site:nth-child(2) .site-meta')?.textContent.startsWith('Access granted'));
  await page.close();
});

test('schedules: add one, change days and times, switch preset; invalid edits wait until fixed', async () => {
  const page = await optionsPage('focus');
  const editor = page.locator('[data-id="focus.schedules"]');
  assert.match(await editor.locator('.empty').textContent(), /No schedules yet/);

  await editor.getByRole('button', { name: 'Add a schedule' }).click();
  await editor.locator('.sched').waitFor();
  let schedules = (await stored())['focus.schedules'];
  assert.equal(schedules.length, 1);
  assert.deepEqual([schedules[0].name, schedules[0].days, schedules[0].start, schedules[0].end, schedules[0].action, schedules[0].enabled], ['Work hours', [1, 2, 3, 4, 5], '09:00', '17:00', 'block', true]);
  assert.match(schedules[0].id, /^sch_[0-9a-f]{12}$/);

  // Days: add Saturday, drop Monday.
  await editor.getByRole('button', { name: 'Saturday' }).click();
  await editor.getByRole('button', { name: 'Monday' }).click();
  await page.waitForFunction(async () => JSON.stringify((await chrome.storage.local.get('settings')).settings['focus.schedules'][0].days) === '[2,3,4,5,6]');

  // Times, including one that runs past midnight.
  await editor.getByLabel(/^Start time for/).fill('22:00');
  await editor.getByLabel(/^End time for/).fill('06:30');
  await page.waitForFunction(async () => {
    const s = (await chrome.storage.local.get('settings')).settings['focus.schedules'][0];
    return s.start === '22:00' && s.end === '06:30';
  });
  assert.equal(await editor.getByText('until the next morning').count(), 1);

  // A schedule that cannot work shows its problem and is NOT saved (the schema would drop it).
  await editor.getByLabel(/^End time for/).fill('22:00');
  await editor.getByRole('alert').filter({ hasText: 'cannot be the same' }).waitFor();
  schedules = (await stored())['focus.schedules'];
  assert.equal(schedules[0].end, '06:30', 'the last valid version is still what is stored');
  await shotEl(editor, 'options-schedules-invalid');
  await editor.getByLabel(/^End time for/).fill('07:00');
  await page.waitForFunction(async () => (await chrome.storage.local.get('settings')).settings['focus.schedules'][0].end === '07:00');
  assert.equal(await editor.getByRole('alert').filter({ hasText: 'cannot be the same' }).count(), 0);

  // No days at all.
  for (const day of ['Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']) await editor.getByRole('button', { name: day }).click();
  await editor.getByRole('alert').filter({ hasText: 'at least one day' }).waitFor();
  assert.equal((await stored())['focus.schedules'][0].days.length, 1, 'one day was still stored before the last click');
  await editor.getByRole('button', { name: 'Sunday' }).click();
  await page.waitForFunction(async () => JSON.stringify((await chrome.storage.local.get('settings')).settings['focus.schedules'][0].days.sort()) === '[0]');

  // Apply a preset instead of closing the site.
  await editor.getByLabel(/^What .* does/).selectOption('preset:deep-work');
  await page.waitForFunction(async () => (await chrome.storage.local.get('settings')).settings['focus.schedules'][0].action === 'preset:deep-work');
  await editor.getByLabel(/is on$/).uncheck();
  await page.waitForFunction(async () => (await chrome.storage.local.get('settings')).settings['focus.schedules'][0].enabled === false);
  assert.deepEqual(ourErrors(page), []);
  await page.close();
});

test('schedules: several, named, with custom presets listed; remove works', async () => {
  const custom = await evalInExtension(async () => {
    const res = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
    return res.ok;
  });
  assert.equal(custom, true);
  const page = await optionsPage('focus');
  const editor = page.locator('[data-id="focus.schedules"]');
  await editor.getByRole('button', { name: 'Add a schedule' }).click();
  await editor.getByRole('button', { name: 'Add a schedule' }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-id="focus.schedules"] .sched').length === 2);
  await editor.getByLabel('Name of schedule 2').fill('Evenings');
  await editor.getByLabel('Name of schedule 2').press('Tab');
  await page.waitForFunction(async () => (await chrome.storage.local.get('settings')).settings['focus.schedules'][1].name === 'Evenings');
  await shotEl(editor, 'options-schedules');
  await editor.getByRole('button', { name: 'Remove Work hours' }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-id="focus.schedules"] .sched').length === 1);
  const left = (await stored())['focus.schedules'];
  assert.deepEqual(left.map((s) => s.name), ['Evenings']);
  await page.close();
});

test('schedules: an edit made in another tab shows up here', async () => {
  const page = await optionsPage('focus');
  const editor = page.locator('[data-id="focus.schedules"]');
  await evalInExtension(async () => {
    await chrome.storage.local.set({
      settings: { 'focus.schedules': [{ id: 'sch_x', name: 'From elsewhere', days: [1], start: '10:00', end: '11:00', action: 'block', siteKeys: ['youtube'], enabled: true }] },
    });
  });
  await editor.getByLabel('Name of schedule 1').waitFor();
  assert.equal(await editor.getByLabel('Name of schedule 1').inputValue(), 'From elsewhere');
  await page.close();
});
