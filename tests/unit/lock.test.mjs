// The settings lock (src/shared/lock.js): the "is this loosening?" decision for every kind of
// setting, the guards, PBKDF2 hashing, the guarded wrappers around AP.settings, and a scan that
// keeps the pages from changing settings around the lock.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadAtPeace, installFakeBrowser, uninstallFakeBrowser, CORE_SCRIPTS, SCHEMA_SCRIPTS, ROOT } from './_load.mjs';

let AP;
let L;
let fake;

beforeEach(async () => {
  fake = installFakeBrowser();
  AP = await loadAtPeace([...CORE_SCRIPTS, ...SCHEMA_SCRIPTS, 'src/shared/lock.js']);
  L = AP.lock;
});
afterEach(() => uninstallFakeBrowser());

const def = (id) => {
  const d = AP.schema.get(id);
  assert.ok(d, `no such setting: ${id}`);
  return d;
};
const loosens = (id, a, b) => L.isLoosening(def(id), a, b);

describe('isLoosening: toggles', () => {
  test('on → off loosens, off → on does not, no change does not', () => {
    assert.equal(loosens('yt.general.hideAds', true, false), true);
    assert.equal(loosens('yt.general.hideAds', false, true), false);
    assert.equal(loosens('yt.general.hideAds', true, true), false);
    assert.equal(loosens('yt.general.hideAds', false, false), false);
  });

  test('the master switch, the pause and "no early exit" follow the same rule', () => {
    assert.equal(loosens('general.enabled', true, false), true);
    assert.equal(loosens('general.enabled', false, true), false);
    assert.equal(loosens('pause.enabled', true, false), true);
    assert.equal(loosens('pause.enabled', false, true), false);
    assert.equal(loosens('focus.strict', true, false), true);
    assert.equal(loosens('pause.expiryOverlay', true, false), true);
  });

  test('purely cosmetic toggles are always allowed', () => {
    assert.equal(loosens('advanced.debug', true, false), false);
    assert.equal(loosens('yt.watch.autoTheater', true, false), false);
  });
});

describe('isLoosening: selects', () => {
  test('thumbnails: option order is least → most hidden', () => {
    const id = 'yt.general.thumbnails';
    assert.equal(loosens(id, 'show', 'blur'), false);
    assert.equal(loosens(id, 'blur', 'hide'), false);
    assert.equal(loosens(id, 'blur', 'grayscale'), false);
    assert.equal(loosens(id, 'blur', 'show'), true);
    assert.equal(loosens(id, 'hide', 'blur'), true);
    assert.equal(loosens(id, 'grayscale', 'blur'), true);
    assert.equal(loosens(id, 'hide', 'show'), true);
  });

  test('home feed: every redirect hides the same feed, only "show" loosens', () => {
    const id = 'yt.home.feedMode';
    assert.equal(loosens(id, 'show', 'hide'), false);
    assert.equal(loosens(id, 'show', 'custom'), false);
    assert.equal(loosens(id, 'hide', 'subscriptions'), false);
    assert.equal(loosens(id, 'subscriptions', 'hide'), false);
    assert.equal(loosens(id, 'watchLater', 'playlists'), false);
    assert.equal(loosens(id, 'hide', 'show'), true);
    assert.equal(loosens(id, 'custom', 'show'), true);
  });

  test('Shorts: allow < watch < block', () => {
    assert.equal(loosens('yt.shorts.mode', 'allow', 'block'), false);
    assert.equal(loosens('yt.shorts.mode', 'watch', 'block'), false);
    assert.equal(loosens('yt.shorts.mode', 'block', 'watch'), true);
    assert.equal(loosens('yt.shorts.mode', 'watch', 'allow'), true);
  });

  test('a session that is shorter is the stricter one; more friction is stricter', () => {
    assert.equal(loosens('pause.sessionMinutes', '15', '5'), false);
    assert.equal(loosens('pause.sessionMinutes', '15', '10'), false);
    assert.equal(loosens('pause.sessionMinutes', '15', '30'), true);
    assert.equal(loosens('pause.sessionMinutes', '5', '60'), true);
    assert.equal(loosens('focus.unlockFriction', 'wait', 'phrase'), false);
    assert.equal(loosens('focus.unlockFriction', 'wait', 'none'), true);
    assert.equal(loosens('focus.unlockFriction', 'phrase', 'wait'), true);
  });

  test('titles: off → sentence is calmer; theme and playback speed are cosmetic', () => {
    assert.equal(loosens('yt.general.calmTitles', 'off', 'sentence'), false);
    assert.equal(loosens('yt.general.calmTitles', 'sentence', 'off'), true);
    assert.equal(loosens('general.theme', 'light', 'dark'), false);
    assert.equal(loosens('general.theme', 'dark', 'system'), false);
    assert.equal(loosens('yt.watch.defaultSpeed', 'default', '2'), false);
    assert.equal(loosens('yt.watch.defaultSpeed', '2', 'default'), false);
  });

  test('a value that is not an option is treated as loosening (never stored anyway)', () => {
    assert.equal(loosens('yt.general.thumbnails', 'blur', 'nope'), true);
  });
});

describe('isLoosening: numbers', () => {
  test('a shorter breath loosens, a longer one does not', () => {
    assert.equal(loosens('pause.breathSeconds', 6, 3), true);
    assert.equal(loosens('pause.breathSeconds', 6, 12), false);
    assert.equal(loosens('pause.escalateStep', 4, 2), true);
    assert.equal(loosens('pause.escalateStep', 2, 4), false);
  });

  test('daily limit: lowering it tightens; raising it or turning it off loosens; setting one from "off" tightens', () => {
    assert.equal(loosens('focus.dailyMinutes', 60, 30), false);
    assert.equal(loosens('focus.dailyMinutes', 30, 60), true);
    assert.equal(loosens('focus.dailyMinutes', 30, 0), true);
    assert.equal(loosens('focus.dailyMinutes', 0, 45), false);
    assert.equal(loosens('focus.dailyMinutes', 0, 0), false);
  });

  test('extra time after the limit: more is looser', () => {
    assert.equal(loosens('focus.limitGrace', 1, 3), true);
    assert.equal(loosens('focus.limitGrace', 3, 1), false);
  });

  test('a number without a direction loosens whenever it changes', () => {
    const odd = { id: 'x.odd', type: 'number', default: 1 };
    assert.equal(L.isLoosening(odd, 1, 2), true);
    assert.equal(L.isLoosening(odd, 2, 1), true);
    assert.equal(L.isLoosening(odd, 2, 2), false);
    assert.equal(L.isLoosening(odd, 2, 'x'), true);
  });
});

describe('isLoosening: text', () => {
  test('any change to a text setting loosens (a redirect target and custom CSS have no direction)', () => {
    assert.equal(loosens('yt.home.redirectUrl', '', '/playlist?list=WL'), true);
    assert.equal(loosens('yt.home.redirectUrl', '/a', ''), true);
    assert.equal(loosens('advanced.customCss', 'a{}', 'a{}'), false);
    assert.equal(loosens('advanced.customCss', 'a{}', 'b{}'), true);
  });
});

describe('isLoosening: lists', () => {
  test('word filters: adding a word tightens; removing or changing one loosens', () => {
    const id = 'yt.filters.keywords';
    assert.equal(loosens(id, ['spoiler'], ['spoiler', 'drama']), false);
    assert.equal(loosens(id, [], ['drama']), false);
    assert.equal(loosens(id, ['spoiler', 'drama'], ['spoiler']), true);
    assert.equal(loosens(id, ['spoiler'], ['spoilers']), true);
    assert.equal(loosens(id, ['spoiler'], []), true);
    assert.equal(loosens(id, ['a'], ['a']), false);
  });

  test('multi-select: removing an option loosens, adding one does not', () => {
    const id = 'yt.filters.applyTo';
    assert.equal(loosens(id, ['home', 'search'], ['home']), true);
    assert.equal(loosens(id, ['home'], ['home', 'search']), false);
  });

  test('hidden elements: removing or editing a rule loosens, adding one does not', () => {
    const id = 'advanced.customRules';
    const a = { id: 'r1', selector: '#a', page: null, note: '', createdAt: 1 };
    const b = { id: 'r2', selector: '#b', page: 'home', note: '', createdAt: 2 };
    assert.equal(loosens(id, [a], [a, b]), false);
    assert.equal(loosens(id, [a, b], [a]), true);
    assert.equal(loosens(id, [a], [{ ...a, selector: '#other' }]), true);
    assert.equal(loosens(id, [], [a]), false);
  });

  test('paused sites: removing, disabling or moving one loosens; enabling or adding does not', () => {
    const id = 'pause.sites';
    const yt = { siteKey: 'youtube', domain: 'youtube.com', enabled: true };
    const rd = { siteKey: 'reddit.com', domain: 'reddit.com', enabled: true };
    assert.equal(loosens(id, [yt, rd], [yt]), true);
    assert.equal(loosens(id, [yt, rd], [yt, { ...rd, enabled: false }]), true);
    assert.equal(loosens(id, [yt], [{ ...yt, domain: 'm.youtube.com' }]), true);
    assert.equal(loosens(id, [yt], [yt, rd]), false);
    assert.equal(loosens(id, [yt, { ...rd, enabled: false }], [yt, rd]), false);
    assert.equal(loosens(id, [yt, { ...rd, enabled: false }], [yt]), false, 'a site that was off was not holding anything');
  });

  test('schedules: removed, disabled, shortened or re-purposed loosen; more days, more sites, a new name or a new schedule do not', () => {
    const id = 'focus.schedules';
    const work = { id: 's1', name: 'Work', days: [1, 2, 3], start: '09:00', end: '17:00', action: 'block', siteKeys: ['youtube'], enabled: true };
    assert.equal(loosens(id, [work], []), true);
    assert.equal(loosens(id, [work], [{ ...work, enabled: false }]), true);
    assert.equal(loosens(id, [work], [{ ...work, end: '12:00' }]), true);
    assert.equal(loosens(id, [work], [{ ...work, start: '10:00' }]), true);
    assert.equal(loosens(id, [work], [{ ...work, days: [1, 2] }]), true);
    assert.equal(loosens(id, [work], [{ ...work, siteKeys: [] }]), true);
    assert.equal(loosens(id, [work], [{ ...work, action: 'preset:gentle' }]), true);
    assert.equal(loosens(id, [work], [{ ...work, days: [1, 2, 3, 4] }]), false);
    assert.equal(loosens(id, [work], [{ ...work, siteKeys: ['youtube', 'reddit.com'] }]), false);
    assert.equal(loosens(id, [work], [{ ...work, name: 'Office' }]), false);
    assert.equal(loosens(id, [work], [work, { ...work, id: 's2' }]), false);
    assert.equal(loosens(id, [{ ...work, enabled: false }], [{ ...work, end: '09:30' }]), false, 'a disabled schedule was not holding anything');
    assert.equal(loosens(id, [{ ...work, enabled: false }], []), false);
  });

  test('a list that is not a list is treated as loosening', () => {
    assert.equal(loosens('yt.filters.keywords', ['a'], 'a'), true);
  });
});

describe('isLoosening: the lock itself, unknown things, everything else', () => {
  test('setting the first lock is not a loosening; changing or removing one is', () => {
    const id = 'advanced.lock';
    assert.equal(loosens(id, { mode: 'none' }, { mode: 'friction', waitSeconds: 60 }), false);
    assert.equal(loosens(id, { mode: 'none' }, { mode: 'password', salt: 's', hash: 'h' }), false);
    assert.equal(loosens(id, { mode: 'friction', waitSeconds: 60 }, { mode: 'none' }), true);
    assert.equal(loosens(id, { mode: 'friction', waitSeconds: 60 }, { mode: 'friction', waitSeconds: 10 }), true);
    assert.equal(loosens(id, { mode: 'password', salt: 's', hash: 'h' }, { mode: 'friction' }), true);
    assert.equal(loosens(id, { mode: 'password', salt: 's', hash: 'h' }, { mode: 'password', salt: 's', hash: 'h' }), false);
  });

  test('anything without a def or of an unknown type defaults to loosening', () => {
    assert.equal(L.isLoosening(undefined, 1, 2), true);
    assert.equal(L.isLoosening(null, 1, 2), true);
    assert.equal(L.isLoosening({ id: 'x.y', type: 'mystery' }, 1, 2), true);
    assert.equal(L.isLoosening({ id: 'x.y', type: 'object' }, { a: 1 }, { a: 2 }), true);
    assert.equal(L.isLoosening({ id: 'x.y', type: 'mystery' }, 1, 1), false);
  });

  test('every shipped setting has an answer for every kind of change, and it never throws', () => {
    for (const d of AP.schema.all()) {
      for (const [a, b] of [[d.default, d.default], [d.default, null], [null, d.default], [d.default, 'x'], [d.default, 0], [d.default, []], [d.default, {}], [true, false], [false, true]]) {
        assert.equal(typeof L.isLoosening(d, a, b), 'boolean', `${d.id} ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
      }
      assert.equal(L.isLoosening(d, d.default, structuredClone(d.default)), false, `${d.id}: no change is never a loosening`);
    }
  });

  test('every shipped toggle is judged by the one rule (on → off loosens) unless it is on the cosmetic list', () => {
    for (const d of AP.schema.all().filter((x) => x.type === 'toggle')) {
      const cosmetic = L.NEUTRAL.has(d.id);
      assert.equal(L.isLoosening(d, true, false), !cosmetic, `${d.id} on → off`);
      assert.equal(L.isLoosening(d, false, true), false, `${d.id} off → on`);
    }
  });

  test('every shipped select whose default is its least strict value: default → anything else never loosens, anything else → default always does', () => {
    // pause.sessionMinutes (default in the middle of the range) and focus.unlockFriction (default "wait") have their own tests above.
    const exempt = new Set(['pause.sessionMinutes', 'focus.unlockFriction', ...L.NEUTRAL]);
    const selects = AP.schema.all().filter((x) => x.type === 'select' && !exempt.has(x.id));
    assert.ok(selects.length >= 4);
    for (const d of selects) {
      for (const o of d.options.filter((x) => x.value !== d.default)) {
        assert.equal(L.isLoosening(d, d.default, o.value), false, `${d.id}: ${d.default} → ${o.value}`);
        assert.equal(L.isLoosening(d, o.value, d.default), true, `${d.id}: ${o.value} → ${d.default}`);
      }
    }
  });
});

describe('guardPatch', () => {
  const locked = { mode: 'password', unlockedUntil: 0 };
  const NOW = 1_000_000;

  test('does nothing when there is no lock', () => {
    assert.deepEqual(L.guardPatch({ 'yt.general.hideAds': false }, { 'yt.general.hideAds': true }, { mode: 'none', unlockedUntil: 0 }, NOW), { allowed: true, blocked: [] });
    assert.deepEqual(L.guardPatch({ 'general.enabled': false }, {}, undefined, NOW), { allowed: true, blocked: [] });
  });

  test('refuses loosening patches while locked and names every refused id', () => {
    const current = { 'yt.general.hideAds': true, 'yt.comments.hideAll': true, 'yt.general.thumbnails': 'blur' };
    const verdict = L.guardPatch({ 'yt.general.hideAds': false, 'yt.comments.hideAll': false, 'yt.general.thumbnails': 'hide' }, current, locked, NOW);
    assert.deepEqual(verdict, { allowed: false, blocked: ['yt.general.hideAds', 'yt.comments.hideAll'] });
  });

  test('allows tightening patches while locked', () => {
    const patch = { 'yt.general.hideAds': true, 'yt.general.thumbnails': 'blur', 'yt.shorts.mode': 'block', 'pause.enabled': true, 'focus.dailyMinutes': 30 };
    assert.deepEqual(L.guardPatch(patch, {}, locked, NOW), { allowed: true, blocked: [] });
  });

  test('a missing current value counts as the default', () => {
    assert.deepEqual(L.guardPatch({ 'general.enabled': false }, {}, locked, NOW).blocked, ['general.enabled'], 'default is on, so off loosens');
    assert.deepEqual(L.guardPatch({ 'yt.general.hideAds': false }, {}, locked, NOW).allowed, true, 'default is off: nothing changes');
  });

  test('an unlock that is still running lets everything through; an expired one does not', () => {
    const patch = { 'general.enabled': false };
    assert.equal(L.guardPatch(patch, {}, { mode: 'friction', unlockedUntil: NOW + 1 }, NOW).allowed, true);
    assert.equal(L.guardPatch(patch, {}, { mode: 'friction', unlockedUntil: NOW }, NOW).allowed, false);
    assert.equal(L.guardPatch(patch, {}, { mode: 'friction', unlockedUntil: NOW - 5 }, NOW).allowed, false);
  });

  test('unknown ids and unusable values are left to save() (it drops or reports them)', () => {
    assert.deepEqual(L.guardPatch({ 'nope.nothing': 1, 'yt.general.hideAds': 'yes' }, { 'yt.general.hideAds': true }, locked, NOW), { allowed: true, blocked: [] });
    assert.deepEqual(L.guardPatch(null, {}, locked, NOW), { allowed: true, blocked: [] });
  });

  test('the value is judged after the schema normalizes it (numbers snap and clamp)', () => {
    assert.deepEqual(L.guardPatch({ 'pause.breathSeconds': '3' }, { 'pause.breathSeconds': 6 }, locked, NOW).blocked, ['pause.breathSeconds']);
    assert.deepEqual(L.guardPatch({ 'pause.breathSeconds': 1 }, { 'pause.breathSeconds': 3 }, locked, NOW).allowed, true, '1 clamps to 3: no change');
  });

  test('bulk "hide all" is always allowed, "show all" is always refused (for every tag)', () => {
    const on = {};
    for (const tag of AP.schema.KNOWN_TAGS) {
      const targets = AP.schema.bulkTargets(tag);
      Object.assign(on, targets);
      assert.deepEqual(L.guardPatch(targets, AP.schema.defaults(), locked, NOW), { allowed: true, blocked: [] }, `${tag} on`);
      if (Object.keys(targets).length === 0) continue;
      const off = {};
      for (const id of Object.keys(targets)) off[id] = AP.schema.get(id).type === 'toggle' ? false : AP.schema.get(id).default;
      const verdict = L.guardPatch(off, { ...AP.schema.defaults(), ...targets }, locked, NOW);
      const expected = Object.keys(targets).filter((id) => !L.NEUTRAL.has(id)); // theater mode is cosmetic: never refused
      assert.deepEqual(verdict.blocked.sort(), expected.sort(), `${tag} off`);
    }
  });

  test('presets: applying a built-in one on top of the defaults tightens only; going back loosens', () => {
    for (const preset of AP.presets.builtIn()) {
      const patch = L.presetPatch(AP.presets.valuesFor(preset.id));
      assert.deepEqual(L.guardPatch(patch, AP.schema.defaults(), locked, NOW), { allowed: true, blocked: [] }, preset.id);
    }
    const deep = { ...AP.schema.defaults(), ...L.presetPatch(AP.presets.valuesFor('deep-work')) };
    const back = L.guardPatch(L.presetPatch(AP.presets.valuesFor('untouched')), deep, locked, NOW);
    assert.equal(back.allowed, false);
    assert.ok(back.blocked.includes('yt.home.feedMode'));
    assert.ok(back.blocked.includes('pause.enabled'));
    const down = L.guardPatch(L.presetPatch(AP.presets.valuesFor('gentle')), { ...AP.schema.defaults(), ...L.presetPatch(AP.presets.valuesFor('focused')) }, locked, NOW);
    assert.equal(down.allowed, false, 'Focused → Gentle shows the home feed again');
  });

  test('presetPatch covers exactly the settings presets may touch (not theme, schedules, the lock…)', () => {
    const patch = L.presetPatch({ 'yt.general.hideAds': true });
    assert.equal(patch['yt.general.hideAds'], true);
    assert.equal(patch['yt.guide.hideFooter'], false);
    for (const id of ['general.theme', 'focus.schedules', 'advanced.lock', 'pause.breathSeconds', 'advanced.customRules']) assert.equal(id in patch, false, id);
  });
});

describe('status', () => {
  const NOW = 5_000;
  test('is locked only when a mode is set and no unlock is running', () => {
    assert.deepEqual(L.status({ mode: 'none' }, 0, NOW), { mode: 'none', locked: false, unlockedUntil: 0, waitSeconds: 60 });
    assert.deepEqual(L.status(undefined, 99_999, NOW), { mode: 'none', locked: false, unlockedUntil: 0, waitSeconds: 60 });
    assert.equal(L.status({ mode: 'friction' }, 0, NOW).locked, true);
    assert.equal(L.status({ mode: 'friction' }, NOW, NOW).locked, true, 'an unlock that ends now has ended');
    assert.deepEqual(L.status({ mode: 'friction', waitSeconds: 30 }, NOW + 10, NOW), { mode: 'friction', locked: false, unlockedUntil: NOW + 10, waitSeconds: 30 });
    assert.equal(L.status({ mode: 'friction', waitSeconds: 5 }, 0, NOW).waitSeconds, 10);
    assert.equal(L.status({ mode: 'friction', waitSeconds: 5000 }, 0, NOW).waitSeconds, 600);
  });

  test('a password lock that lost its hash counts as no lock (it could never be opened)', () => {
    assert.equal(L.status({ mode: 'password', hash: 'h' }, 0, NOW).mode, 'none');
    assert.equal(L.status({ mode: 'password', salt: 's', hash: 'h' }, 0, NOW).mode, 'password');
  });

  test('read() combines the stored lock and state.lockUnlockedUntil', async () => {
    assert.equal((await L.read()).mode, 'none');
    await fake.storage.local.set({ settings: { 'advanced.lock': { mode: 'friction', waitSeconds: 20 } } });
    assert.deepEqual(await L.read(NOW), { mode: 'friction', locked: true, unlockedUntil: 0, waitSeconds: 20 });
    await fake.storage.local.set({ state: { lockUnlockedUntil: NOW + 600 } });
    assert.deepEqual(await L.read(NOW), { mode: 'friction', locked: false, unlockedUntil: NOW + 600, waitSeconds: 20 });
  });
});

describe('PBKDF2 password lock', () => {
  test('creates a salted SHA-256 PBKDF2 hash with at least 200k iterations and never keeps the password', async () => {
    const lock = await L.createPasswordLock('correct horse');
    assert.equal(lock.mode, 'password');
    assert.ok(lock.iterations >= 200_000);
    assert.equal(Buffer.from(lock.salt, 'base64').length, 16);
    assert.equal(Buffer.from(lock.hash, 'base64').length, 32);
    assert.ok(!JSON.stringify(lock).includes('correct horse'));
    assert.deepEqual(Object.keys(lock).sort(), ['hash', 'iterations', 'mode', 'salt']);
  });

  test('matches a reference PBKDF2-HMAC-SHA256 computed by node:crypto', async () => {
    const { pbkdf2Sync } = await import('node:crypto');
    const lock = await L.createPasswordLock('open sesame');
    const expected = pbkdf2Sync('open sesame', Buffer.from(lock.salt, 'base64'), lock.iterations, 32, 'sha256').toString('base64');
    assert.equal(lock.hash, expected);
  });

  test('verifies the right password and refuses a wrong one', async () => {
    const lock = await L.createPasswordLock('correct horse');
    assert.equal(await L.verifyPassword('correct horse', lock), true);
    assert.equal(await L.verifyPassword('correct horsE', lock), false);
    assert.equal(await L.verifyPassword('', lock), false);
    assert.equal(await L.verifyPassword(undefined, lock), false);
    assert.equal(await L.verifyPassword('correct horse', { ...lock, hash: Buffer.alloc(32).toString('base64') }), false);
  });

  test('every lock gets its own salt, so equal passwords give different hashes', async () => {
    const a = await L.createPasswordLock('same password');
    const b = await L.createPasswordLock('same password');
    assert.notEqual(a.salt, b.salt);
    assert.notEqual(a.hash, b.hash);
    assert.equal(await L.verifyPassword('same password', b), true);
  });

  test('a malformed lock never matches and never throws', async () => {
    for (const lock of [null, undefined, {}, { salt: 5, hash: 'x' }, { salt: '!!!', hash: '???' }, { mode: 'password' }, 'text']) {
      assert.equal(await L.verifyPassword('x', lock), false, JSON.stringify(lock));
    }
  });

  test('the stored shape survives the schema (so settings.save keeps it), and passwords have sane limits', async () => {
    const lock = await L.createPasswordLock('correct horse');
    assert.deepEqual(AP.schema.validateValue(AP.schema.get('advanced.lock'), lock), lock);
    assert.equal(L.passwordProblem('abc') !== null, true);
    assert.equal(L.passwordProblem('abcd'), null);
    assert.equal(L.passwordProblem('x'.repeat(201)) !== null, true);
    await assert.rejects(L.createPasswordLock('abc'));
  });

  test('friction locks keep a wait between 10 and 600 seconds', () => {
    assert.deepEqual(L.createFrictionLock(), { mode: 'friction', waitSeconds: 60 });
    assert.equal(L.createFrictionLock(3).waitSeconds, 10);
    assert.equal(L.createFrictionLock(9000).waitSeconds, 600);
    assert.equal(L.createFrictionLock(45.4).waitSeconds, 45);
    assert.deepEqual(AP.schema.validateValue(AP.schema.get('advanced.lock'), { mode: 'friction', waitSeconds: 2 }), { mode: 'friction', waitSeconds: 10 });
  });

  test('friction sentences are calm, short and end with a full stop', () => {
    assert.ok(L.SENTENCES.length >= 3);
    for (const s of L.SENTENCES) assert.match(s, /^[A-Z][^!?]{10,60}\.$/);
    assert.ok(L.SENTENCES.includes(L.pickSentence()));
  });
});

describe('guarded wrappers around AP.settings', () => {
  const lockIn = async (value, until = 0) => {
    await fake.storage.local.set({ settings: { ...(await fake.storage.local.get('settings')).settings, 'advanced.lock': value }, state: { lockUnlockedUntil: until } });
  };
  const stored = async () => (await fake.storage.local.get('settings')).settings ?? {};

  test('save: tightening goes through while locked, loosening is refused and nothing is written', async () => {
    await fake.storage.local.set({ settings: { 'yt.general.hideAds': true } });
    await lockIn({ mode: 'friction', waitSeconds: 60 });
    const ok = await L.save({ 'yt.comments.hideAll': true });
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.report.changed, ['yt.comments.hideAll']);
    const refused = await L.save({ 'yt.general.hideAds': false, 'yt.guide.hideFooter': true });
    assert.deepEqual(refused, { ok: false, blocked: ['yt.general.hideAds'], report: null });
    const now = await stored();
    assert.equal(now['yt.general.hideAds'], true);
    assert.equal(now['yt.guide.hideFooter'], undefined, 'a patch is all or nothing');
  });

  test('save: allowed once unlocked, and again refused when the unlock has run out', async () => {
    await fake.storage.local.set({ settings: { 'yt.general.hideAds': true } });
    await lockIn({ mode: 'friction' }, Date.now() + 60_000);
    assert.equal((await L.save({ 'yt.general.hideAds': false })).ok, true);
    await L.save({ 'yt.general.hideAds': true });
    await lockIn({ mode: 'friction' }, Date.now() - 1);
    assert.equal((await L.save({ 'yt.general.hideAds': false })).ok, false);
  });

  test('applyPreset: refused when it would loosen, allowed from a quieter state; unknown presets say so', async () => {
    await AP.settings.applyPreset('deep-work');
    await lockIn({ mode: 'friction' });
    const refused = await L.applyPreset('untouched');
    assert.equal(refused.ok, false);
    assert.equal(refused.error, 'locked');
    assert.ok(refused.blocked.length > 5);
    assert.equal((await stored())['yt.home.feedMode'], 'subscriptions');
    assert.deepEqual(await L.applyPreset('nope'), { ok: false, changed: [], error: 'unknown-preset' });
    await fake.storage.local.set({ settings: { 'advanced.lock': { mode: 'friction' } } });
    const fine = await L.applyPreset('deep-work');
    assert.equal(fine.ok, true);
  });

  test('reset: a full reset needs an unlock; resetting ids is judged like a patch of defaults', async () => {
    await fake.storage.local.set({ settings: { 'yt.general.hideAds': true, 'general.theme': 'dark' } });
    await lockIn({ mode: 'friction' });
    assert.deepEqual(await L.reset(), { ok: false, changed: [], error: 'locked' });
    const some = await L.reset(['yt.general.hideAds']);
    assert.equal(some.ok, false);
    assert.deepEqual(some.blocked, ['yt.general.hideAds']);
    assert.equal((await L.reset(['general.theme'])).ok, true, 'the theme is cosmetic');
    await lockIn({ mode: 'friction' }, Date.now() + 60_000);
    const done = await L.reset();
    assert.equal(done.ok, true);
    assert.ok(done.changed.includes('yt.general.hideAds'));
    assert.deepEqual((await stored())['advanced.lock'], { mode: 'friction' }, 'the lock survives a reset');
  });

  test('importAll: refused while locked, runs once unlocked', async () => {
    const backup = JSON.stringify({ app: 'at-peace', schemaVersion: 1, settings: { 'yt.general.hideAds': true } });
    await lockIn({ mode: 'friction' });
    const refused = await L.importAll(backup);
    assert.equal(refused.ok, false);
    assert.equal(refused.error, 'locked');
    assert.equal((await stored())['yt.general.hideAds'], undefined);
    await lockIn({ mode: 'friction' }, Date.now() + 60_000);
    assert.equal((await L.importAll(backup)).ok, true);
    assert.equal((await stored())['yt.general.hideAds'], true);
  });

  test('with no lock everything simply passes through', async () => {
    assert.equal((await L.save({ 'yt.general.hideAds': true })).ok, true);
    assert.equal((await L.save({ 'yt.general.hideAds': false })).ok, true);
    assert.equal((await L.reset()).ok, true);
  });

  test('watch(): reports the status now, on changes, and when an unlock ends', async () => {
    const seen = [];
    const stop = L.watch((s) => seen.push({ mode: s.mode, locked: s.locked }));
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(seen.at(-1), { mode: 'none', locked: false });
    await lockIn({ mode: 'friction' });
    await new Promise((r) => setTimeout(r, 120));
    assert.deepEqual(seen.at(-1), { mode: 'friction', locked: true });
    await fake.storage.local.set({ state: { lockUnlockedUntil: Date.now() + 200 } });
    await new Promise((r) => setTimeout(r, 120));
    assert.deepEqual(seen.at(-1), { mode: 'friction', locked: false });
    await new Promise((r) => setTimeout(r, 400));
    assert.deepEqual(seen.at(-1), { mode: 'friction', locked: true }, 'the timer fires when the unlock ends');
    stop();
    const count = seen.length;
    await lockIn({ mode: 'none' });
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(seen.length, count, 'stopped watchers hear nothing more');
  });
});

describe('no page changes settings around the lock', () => {
  const walk = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });

  test('src/pages and the background commands call AP.lock.*, never AP.settings.save/applyPreset/reset/importAll', () => {
    const files = [...walk(join(ROOT, 'src/pages')).filter((f) => f.endsWith('.js')), join(ROOT, 'src/background/background.js')];
    const offenders = [];
    for (const file of files) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const code = line.replace(/\/\/.*$/, '');
          if (/^\s*(\*|\/\*)/.test(code)) return; // comments
          if (code.includes('applyPreset(AP.presets.DEFAULT_ID)')) return; // the first install starts from the Gentle preset; no lock can exist yet
          if (/AP\.settings\.(save|applyPreset|reset|importAll)\(/.test(code)) offenders.push(`${file.replace(ROOT, '')}:${i + 1}: ${line.trim()}`);
        });
    }
    assert.deepEqual(offenders, [], 'go through AP.lock.save / applyPreset / reset / importAll');
  });
});
