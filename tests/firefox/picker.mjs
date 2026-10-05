// Phase 4a in REAL Firefox (headless, Selenium + geckodriver): the element picker and the custom-rules
// editor. Firefox is the product (Zen), so this is the run that counts.
//
// YouTube is OFFLINE here, like in the Chromium spec (tests/e2e/picker.spec.mjs): pages are rebuilt from
// the Phase 1 research snapshots and served by a local http server (tests/e2e/_yt-fixture.mjs). Firefox
// resolves www.youtube.com to 127.0.0.1 (network.dns.localDomains), and the content scripts match
// `*://www.youtube.com/*` whatever the scheme and port, so they inject exactly as on the real site. No
// traffic to Google. Without the snapshots (fresh clone) the whole file is skipped.
//
// The panel lives in a closed shadow root that WebDriver cannot read, so the flow is driven the way a
// person drives it (real pointer and key events) and judged by what it leaves behind: the stored rule,
// what is hidden on the page, the picker's phase attribute. Prerequisite: bash tests/firefox/setup.sh.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { By, Key } from 'selenium-webdriver';
import { launchFirefox, extUrl, ROOT } from './_harness.mjs';
import { fixturesAvailable, startFixtureServer } from '../e2e/_yt-fixture.mjs';

const SHOTS = join(ROOT, 'tests', 'e2e', 'artifacts', 'picker');
const HAVE = fixturesAvailable();
const skip = HAVE ? false : 'research snapshots are absent (tests/e2e/artifacts/research is local only)';

let ff;
let driver;
let server;
let extHandle = null;

before(async () => {
  if (!HAVE) return;
  server = await startFixtureServer();
  ff = await launchFirefox({
    prefs: {
      'network.dns.localDomains': 'www.youtube.com',
      'network.proxy.no_proxies_on': 'localhost, 127.0.0.1, www.youtube.com',
      'network.stricttransportsecurity.preloadlist': false, // youtube.com is HSTS-preloaded: do not upgrade our local http page to https
    },
  });
  driver = ff.driver;
  await driver.manage().window().setRect({ width: 1280, height: 900 });
  await mkdir(SHOTS, { recursive: true });
});

after(async () => {
  await ff?.close();
  await server?.close();
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const url = (path) => `${server.origin}${path}`;
const WATCH = '/watch?v=abc';
const PLAYLIST = '/playlist?list=PL1';
const shot = async (name) => writeFile(join(SHOTS, `${name}.png`), await driver.takeScreenshot(), 'base64');

async function until(fn, what, timeout = 8000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(80);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Runs fn in a dedicated tab on an extension page (messages and storage work there), then returns to the tab we came from. */
async function inExt(fn) {
  const original = await driver.getWindowHandle();
  if (extHandle === null) {
    await driver.switchTo().newWindow('tab');
    extHandle = await driver.getWindowHandle();
    await driver.get(extUrl('src/pages/popup/popup.html'));
  } else {
    await driver.switchTo().window(extHandle);
  }
  try {
    return await fn();
  } finally {
    await driver.switchTo().window(original);
  }
}

const storedRules = async () => {
  const { settings } = await ff.getStorage('settings');
  return settings?.['advanced.customRules'] ?? [];
};

async function reset(settings = {}) {
  await inExt(() =>
    driver.executeAsyncScript(async (s, done) => {
      await browser.storage.local.clear();
      await browser.storage.local.set({ settings: s });
      done(true);
    }, settings),
  );
  await sleep(150);
}

async function open(path) {
  await driver.get(url(path));
  await until(
    () => driver.executeScript(() => document.documentElement.hasAttribute('data-fixture-ready') && document.documentElement.hasAttribute('data-at-peace-page') && document.documentElement.hasAttribute('data-at-peace')),
    `the engine on ${path}`,
    20_000,
  );
}

/** START_PICKER to the YouTube tab, the way the background does. */
async function startPicker() {
  const youtube = await driver.getWindowHandle();
  const reply = await inExt(() =>
    driver.executeAsyncScript((done) => {
      browser.tabs.query({ url: '*://www.youtube.com/*' }).then(
        (tabs) => browser.tabs.sendMessage(tabs[tabs.length - 1].id, { type: 'START_PICKER' }).then(done, (e) => done({ __error: String(e) })),
        (e) => done({ __error: String(e) }),
      );
    }),
  );
  await driver.switchTo().window(youtube);
  return reply;
}

const phase = () => driver.executeScript(() => document.querySelector('[data-at-peace-picker]')?.getAttribute('data-at-peace-picker') ?? null);
const waitPhase = (wanted, timeout = 8000) => until(async () => (await phase()) === wanted, `the picker to be in "${wanted}"`, timeout);

const displays = (selector) => driver.executeScript((s) => [...document.querySelectorAll(s)].map((e) => getComputedStyle(e).display), selector);
const allHidden = async (selector) => {
  const list = await displays(selector);
  return list.length > 0 && list.every((d) => d === 'none');
};
const noneHidden = async (selector) => {
  const list = await displays(selector);
  return list.length > 0 && list.every((d) => d !== 'none');
};

/** The middle of an element, scrolled into view. */
async function centerOf(css) {
  const element = await driver.findElement(By.css(css));
  await driver.executeScript((e) => e.scrollIntoView({ block: 'center' }), element);
  const r = await element.getRect();
  return { element, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
}

const hover = (x, y) => driver.actions({ async: true }).move({ x, y }).perform();
const click = (x, y) => driver.actions({ async: true }).move({ x, y }).click().perform();
const press = async (...keys) => {
  const actions = driver.actions({ async: true });
  for (const key of keys) actions.sendKeys(key);
  await actions.perform();
};

async function pickRelatedThumbnail() {
  assert.deepEqual(await startPicker(), { ok: true });
  await waitPhase('pick');
  const { x, y } = await centerOf('#related yt-lockup-view-model yt-thumbnail-view-model');
  await hover(x - 4, y - 4);
  await hover(x, y);
  await sleep(250);
  await click(x, y);
  await waitPhase('review');
}

// ---------------------------------------------------------------------------------------------

test('start, block the page, leave without a trace', { skip }, async () => {
  await reset();
  await open(WATCH);
  const before = await driver.executeScript(() => ({ attrs: [...document.documentElement.attributes].map((a) => `${a.name}=${a.value}`).sort(), kids: document.documentElement.children.length }));
  await driver.executeScript(() => {
    window.__seen = [];
    for (const type of ['click', 'mousedown', 'mouseover', 'keydown']) {
      document.addEventListener(type, (event) => {
        window.__seen.push(type);
        if (type === 'click') event.preventDefault(); // do not follow the video link once the page hears clicks again
      }, true);
    }
  });

  assert.deepEqual(await startPicker(), { ok: true });
  await waitPhase('pick');
  assert.equal(await driver.executeScript(() => document.querySelectorAll('style[data-at-peace-picker-style]').length), 1);
  assert.deepEqual(await startPicker().then((r) => r.already), true, 'a second start changes nothing');

  const { x, y } = await centerOf('#related yt-lockup-view-model yt-thumbnail-view-model');
  await hover(x - 6, y - 6);
  await hover(x, y);
  await press('k'); // YouTube's play/pause shortcut
  await click(x, y);
  await waitPhase('review');
  assert.deepEqual(await driver.executeScript(() => window.__seen), [], "YouTube's own handlers saw none of it");
  await shot('firefox-picker-review');

  await press(Key.ESCAPE);
  await until(async () => (await phase()) === null, 'the host to go');
  assert.equal(await driver.executeScript(() => document.querySelectorAll('style[data-at-peace-picker-style]').length), 0);
  const after = await driver.executeScript(() => ({ attrs: [...document.documentElement.attributes].map((a) => `${a.name}=${a.value}`).sort(), kids: document.documentElement.children.length }));
  assert.deepEqual(after, before, '<html> is exactly as it was');
  assert.deepEqual(await storedRules(), []);

  // The page hears the pointer again.
  await hover(20, 300);
  await hover(x, y);
  await click(x, y);
  const seen = await driver.executeScript(() => window.__seen);
  assert.ok(seen.includes('mouseover') && seen.includes('mousedown') && seen.includes('click'), `events are back: ${seen}`);
});

test('pick a card, Bigger/Smaller by keyboard, Hide: stored, hidden at once, still hidden after reload', { skip }, async () => {
  await reset();
  await open(WATCH);
  await pickRelatedThumbnail();
  // thumbnail image → its wrapper → the card; one down and one up again must land on the card too.
  await press(Key.ARROW_UP, Key.ARROW_UP);
  await sleep(150);
  await press(Key.ARROW_DOWN);
  await sleep(150);
  await press(Key.ARROW_UP);
  await sleep(250);
  await shot('firefox-picker-card');
  await press(Key.ENTER);
  await waitPhase('done');

  const [rule] = await until(async () => {
    const r = await storedRules();
    return r.length ? r : null;
  }, 'the rule in storage');
  assert.equal(rule.selector, 'yt-lockup-view-model');
  assert.equal(rule.page, 'watch');
  assert.equal(rule.note, 'Hid yt-lockup-view-model on watch pages');
  assert.match(rule.id, /^rule_[0-9a-f]{12}$/);
  await until(() => allHidden('yt-lockup-view-model'), 'the cards to disappear');
  assert.equal((await displays('yt-lockup-view-model')).length, 26);
  await shot('firefox-picker-done');

  await until(async () => (await phase()) === null, 'the panel to leave on its own', 10_000);
  assert.equal(await driver.executeScript(() => document.querySelectorAll('style[data-at-peace-picker-style]').length), 0);
  await driver.navigate().refresh();
  await open(WATCH);
  await until(() => allHidden('yt-lockup-view-model'), 'hidden after reload');

  // "This kind of page (watch)": other page types keep their lockups.
  await open(PLAYLIST);
  assert.ok((await displays('yt-lockup-view-model')).length > 10);
  assert.equal(await noneHidden('yt-lockup-view-model'), true);
});

test('Ctrl+Z is Undo while the confirmation is up', { skip }, async () => {
  await reset();
  await open(WATCH);
  await pickRelatedThumbnail();
  await press(Key.ARROW_UP, Key.ARROW_UP);
  await sleep(150);
  await press(Key.ENTER);
  await waitPhase('done');
  await until(() => allHidden('yt-lockup-view-model'), 'hidden');
  await driver.actions({ async: true }).keyDown(Key.CONTROL).sendKeys('z').keyUp(Key.CONTROL).perform();
  await until(async () => (await storedRules()).length === 0, 'the rule to be removed');
  await until(() => noneHidden('yt-lockup-view-model'), 'the cards to come back');
});

test('the page frame is refused: Enter changes nothing', { skip }, async () => {
  await reset();
  await open(WATCH);
  assert.deepEqual(await startPicker(), { ok: true });
  await waitPhase('pick');
  await click(5, 400);
  await waitPhase('review');
  await press(Key.ENTER);
  await sleep(400);
  assert.equal(await phase(), 'review');
  assert.deepEqual(await storedRules(), []);
  await press(Key.ESCAPE);
  await until(async () => (await phase()) === null, 'the host to go');
});

test('settings: the rules editor lists, edits, removes with Undo, and checks a hand-typed selector', { skip }, async () => {
  const rules = [
    { id: 'rule_aaaaaaaaaaaa', selector: 'ytd-merch-shelf-renderer', page: 'watch', note: 'Hid ytd-merch-shelf-renderer on watch pages', createdAt: 1_700_000_000_000 },
    { id: 'rule_bbbbbbbbbbbb', selector: '#related yt-lockup-view-model', page: null, note: 'Hid the related cards', createdAt: 1_700_000_100_000 },
  ];
  await reset({ 'advanced.customRules': rules });
  const errorsBefore = (await ff.ourScriptErrors()).length;
  await driver.get(extUrl('src/pages/options/options.html#advanced'));
  await driver.wait(async () => (await driver.findElements(By.css('.custom-rules .rule'))).length === 2, 10_000, 'two rules listed');
  const row = (n) => driver.findElements(By.css('.custom-rules .rule')).then((rows) => rows[n]);
  assert.equal(await (await row(0)).findElement(By.css('.rule-selector')).getText(), 'ytd-merch-shelf-renderer');
  await driver.executeScript(() => document.querySelector('.custom-rules').scrollIntoView({ block: 'center' }));
  await shot('firefox-options-rules');

  // note: edited, saved on change
  const note = await (await row(1)).findElement(By.css('input.rule-note'));
  await note.clear();
  await note.sendKeys('The cards I never click');
  await driver.executeScript((e) => e.dispatchEvent(new Event('change', { bubbles: true })), note);
  await until(async () => (await storedRules())[1].note === 'The cards I never click', 'the note to be saved');
  // scope
  await driver.executeScript(() => {
    const select = document.querySelectorAll('.custom-rules .rule')[1].querySelector('select');
    select.value = 'search';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await until(async () => (await storedRules())[1].page === 'search', 'the scope to be saved');
  // delete + undo
  await (await row(0)).findElement(By.css('button.rule-delete')).click();
  await until(async () => (await storedRules()).length === 1, 'the delete');
  await driver.findElement(By.css('.custom-rules .undo button')).click();
  await until(async () => (await storedRules()).length === 2, 'the undo');
  assert.deepEqual((await storedRules()).map((r) => r.id), ['rule_aaaaaaaaaaaa', 'rule_bbbbbbbbbbbb']);

  // by hand: refused ones say why; a good one is stored
  await driver.executeScript(() => (document.querySelector('.custom-rules details.adder').open = true));
  const input = await driver.findElement(By.css('.custom-rules .adder-selector'));
  const add = await driver.findElement(By.css('.custom-rules .adder-add'));
  for (const [typed, message] of [['body', /page itself/], ['ytd-a, ytd-b', /one selector/], ['div[', /not a valid selector/], ['div', /too much/]]) {
    await input.clear();
    await input.sendKeys(typed);
    await add.click();
    const text = await until(async () => {
      const el = await driver.findElement(By.css('.custom-rules .field-error'));
      return (await el.isDisplayed()) ? el.getText() : '';
    }, `a message for "${typed}"`);
    assert.match(text, message, typed);
  }
  assert.equal((await storedRules()).length, 2);
  await input.clear();
  await input.sendKeys('ytd-engagement-panel-section-list-renderer');
  await add.click();
  await until(async () => (await storedRules()).length === 3, 'the hand-made rule');
  const made = (await storedRules())[2];
  assert.equal(made.selector, 'ytd-engagement-panel-section-list-renderer');
  assert.equal(made.page, null);
  assert.equal(made.note, 'Added by hand');
  assert.deepEqual((await ff.ourScriptErrors()).slice(errorsBefore), []);
});
