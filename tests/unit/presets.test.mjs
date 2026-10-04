// Built-in presets are recipes resolved against the registry (src/shared/presets.js).
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { uninstallFakeBrowser } from './_load.mjs';
import { freshWorld } from './_fixtures.mjs';

let AP;
afterEach(() => uninstallFakeBrowser());

describe('with the stand-in catalog', () => {
  beforeEach(async () => {
    ({ AP } = await freshWorld());
  });

  test('builtIn() lists Gentle, Focused, Deep work, Untouched in menu order', () => {
    const presets = AP.presets.builtIn();
    assert.deepEqual(presets.map((p) => p.id), ['gentle', 'focused', 'deep-work', 'untouched']);
    assert.deepEqual(presets.map((p) => p.name), ['Gentle', 'Focused', 'Deep work', 'Untouched']);
    for (const p of presets) {
      assert.equal(p.builtIn, true);
      assert.ok(p.description.length > 10);
    }
    assert.equal(AP.presets.DEFAULT_ID, 'gentle');
  });

  test('Gentle = ads + shorts + AI tags, plus its explicit ids; explicit values win over tag values', () => {
    const v = AP.presets.valuesFor('gentle');
    // tags
    for (const id of ['yt.general.hideAds', 'yt.general.hidePremiumUpsells', 'yt.guide.hideShorts', 'yt.home.hideShortsShelf', 'yt.search.hideShorts', 'yt.masthead.hideAICompanion', 'yt.watch.hideAsk']) {
      assert.equal(v[id], true, id);
    }
    // explicit ids
    for (const id of ['yt.masthead.hideCreate', 'yt.masthead.hideVoiceSearch', 'yt.masthead.hideCountryCode', 'yt.guide.hideMoreFromYouTube', 'yt.guide.hideExploreSection', 'yt.guide.hideFooter']) {
      assert.equal(v[id], true, id);
    }
    // the shorts tag would say "block" (last option); Gentle softens it
    assert.equal(AP.schema.bulkTargets('shorts')['yt.shorts.mode'], 'block');
    assert.equal(v['yt.shorts.mode'], 'watch');
    // feeds stay
    assert.equal(v['yt.home.feedMode'], undefined);
    assert.equal(v['yt.comments.hideAll'], undefined);
    assert.equal(v['yt.watch.hideRelated'], undefined);
  });

  test('Focused extends Gentle with the home feed, related videos, end screens, comments, autoplay and hover previews', () => {
    const gentle = AP.presets.valuesFor('gentle');
    const v = AP.presets.valuesFor('focused');
    for (const [id, value] of Object.entries(gentle)) assert.deepEqual(v[id], value, `inherits ${id}`);
    assert.equal(v['yt.home.feedMode'], 'hide');
    assert.equal(v['yt.watch.hideRelated'], true);
    assert.equal(v['yt.player.hideEndscreenCards'], true);
    assert.equal(v['yt.player.hideEndscreenWall'], true);
    assert.equal(v['yt.comments.hideAll'], true);
    assert.equal(v['yt.comments.hideTeaser'], true);
    assert.equal(v['yt.watch.disableAutoplay'], true);
    assert.equal(v['yt.general.disableHoverPreview'], true);
    assert.equal(v['pause.enabled'], undefined);
  });

  test('Deep work extends Focused: subscriptions home, shorts blocked, metrics, grayscale, pause on', () => {
    const v = AP.presets.valuesFor('deep-work');
    assert.equal(v['yt.home.feedMode'], 'subscriptions', 'overrides Focused');
    assert.equal(v['yt.shorts.mode'], 'block', 'overrides Gentle');
    assert.equal(v['yt.watch.hideViewCount'], true, 'metrics tag');
    assert.equal(v['yt.search.hideShelves'], true);
    assert.equal(v['yt.general.grayscale'], true);
    assert.equal(v['pause.enabled'], true);
    assert.equal(v['yt.comments.hideAll'], true, 'inherited from Focused');
  });

  test('Untouched hides nothing', () => {
    assert.deepEqual(AP.presets.valuesFor('untouched'), {});
  });

  test('ids the registry does not know are skipped, never an error, and diagnose() names them', () => {
    const v = AP.presets.valuesFor('gentle');
    assert.equal('yt.guide.hideSignInPromo' in v, false);
    const diag = AP.presets.diagnose();
    assert.deepEqual(diag.gentle.missing, ['yt.guide.hideSignInPromo']);
    assert.deepEqual(diag.focused.missing, []);
    assert.deepEqual(diag['deep-work'].missing, ['yt.search.hideRelatedSearches']);
    assert.deepEqual(diag.untouched, { missing: [], invalid: [] });
  });

  test('explicit values the definition rejects are skipped and reported as invalid', () => {
    // the stand-in catalog's thumbnails select has no "blur" option
    const diag = AP.presets.diagnose();
    assert.deepEqual(diag['deep-work'].invalid, ['yt.general.thumbnails']);
    assert.equal('yt.general.thumbnails' in AP.presets.valuesFor('deep-work'), false);
  });

  test('presets pick up settings that are registered LATER (recipes resolve at call time)', () => {
    assert.equal('yt.guide.hideSignInPromo' in AP.presets.valuesFor('gentle'), false);
    AP.schema.define('yt.fixture', [{ id: 'yt.guide.hideSignInPromo', label: 'x', type: 'toggle', default: false, hide: ['#signin'] }]);
    assert.equal(AP.presets.valuesFor('gentle')['yt.guide.hideSignInPromo'], true);
    assert.deepEqual(AP.presets.diagnose().gentle.missing, []);
  });

  test('every preset value is valid for its definition and in scope', () => {
    for (const p of AP.presets.builtIn()) {
      for (const [id, value] of Object.entries(p.values)) {
        const def = AP.schema.get(id);
        assert.ok(def, id);
        assert.notEqual(def.preset, false, `${p.id} touches out-of-scope ${id}`);
        assert.deepEqual(AP.schema.validateValue(def, value), value, `${p.id}.${id}`);
      }
    }
  });

  test('get() finds built-ins, then custom presets; unknown → undefined', () => {
    assert.equal(AP.presets.get('gentle').name, 'Gentle');
    const custom = [{ id: 'mine', name: 'Mine', values: { 'yt.general.hideAds': true, 'general.theme': 'dark', 'yt.nope': true, 'yt.shorts.mode': 'bad' }, createdAt: 9 }];
    const got = AP.presets.get('mine', custom);
    assert.deepEqual(got, { id: 'mine', name: 'Mine', builtIn: false, values: { 'yt.general.hideAds': true }, createdAt: 9 });
    assert.equal(AP.presets.get('ghost', custom), undefined);
    assert.equal(AP.presets.get('mine'), undefined);
  });

  test('valuesFor accepts an id (built-in or custom), a values map, or nothing sensible', () => {
    assert.equal(AP.presets.valuesFor('ghost'), null);
    assert.deepEqual(AP.presets.valuesFor({ 'yt.general.hideAds': true, 'general.theme': 'dark', nope: 1 }), { 'yt.general.hideAds': true });
    assert.deepEqual(AP.presets.valuesFor('mine', [{ id: 'mine', name: 'M', values: { 'yt.guide.hideFooter': true } }]), { 'yt.guide.hideFooter': true });
    assert.deepEqual(AP.presets.valuesFor(null), {});
  });

  test('sanitize reports unknown, out-of-scope and invalid ids', () => {
    const r = AP.presets.sanitize({ 'yt.general.hideAds': true, 'yt.nope': 1, 'general.enabled': false, 'yt.shorts.mode': 'sideways', 'yt.guide.hideFooter': 'yes' });
    assert.deepEqual(r.values, { 'yt.general.hideAds': true });
    assert.deepEqual(r.unknown, ['yt.nope']);
    assert.deepEqual(r.outOfScope, ['general.enabled']);
    assert.deepEqual(r.invalid, ['yt.shorts.mode', 'yt.guide.hideFooter']);
  });

  test('sanitizeCustom drops malformed, reserved-id and duplicate presets', () => {
    const list = AP.presets.sanitizeCustom([
      { id: 'a', name: ' A ', values: {}, createdAt: 1 },
      { id: 'a', name: 'dup', values: {} },
      { id: 'gentle', name: 'Reserved', values: {} },
      { id: 'bad id', name: 'x', values: {} },
      { id: 'noname', name: '  ', values: {} },
      { name: 'noid' },
      'junk',
      null,
    ]);
    assert.deepEqual(list.map((p) => [p.id, p.name]), [['a', 'A']]);
    assert.deepEqual(AP.presets.sanitizeCustom('x'), []);
    const many = Array.from({ length: 80 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, values: {} }));
    assert.equal(AP.presets.sanitizeCustom(many).length, 50);
  });

  test('capture() keeps in-scope values that differ from the default', () => {
    const captured = AP.presets.capture({
      'yt.general.hideAds': true,
      'yt.guide.hideFooter': false,
      'yt.shorts.mode': 'block',
      'general.theme': 'dark',
      'yt.nope': true,
      'yt.comments.hideAll': 'yes',
    });
    assert.deepEqual(captured, { 'yt.general.hideAds': true, 'yt.shorts.mode': 'block' });
    assert.deepEqual(AP.presets.capture(null), {});
  });
});

describe('with the shipped YouTube catalog (whatever Phase 2b has put there)', () => {
  test('presets resolve to whatever exists without throwing', async () => {
    ({ AP } = await freshWorld({ catalog: 'shipped' }));
    for (const p of AP.presets.builtIn()) assert.equal(typeof p.values, 'object');
    // Pause is a real, in-scope cross-site setting, so Deep work always carries it.
    assert.equal(AP.presets.valuesFor('deep-work')['pause.enabled'], true);
  });

  test('DIAGNOSTIC: preset ids that the shipped catalog does not define (reconcile after Phase 2b)', async (t) => {
    ({ AP } = await freshWorld({ catalog: 'shipped' }));
    const diag = AP.presets.diagnose();
    for (const [id, { missing, invalid }] of Object.entries(diag)) {
      t.diagnostic(`${id}: ${missing.length} missing, ${invalid.length} invalid${missing.length ? ` → ${missing.join(', ')}` : ''}${invalid.length ? ` | invalid: ${invalid.join(', ')}` : ''}`);
    }
    // Not an assertion on purpose: until the catalog lands everything is "missing". Once it has, the
    // lists above must be empty; that is what to check in review.
    assert.ok(diag.gentle && diag.focused && diag['deep-work'] && diag.untouched);
  });
});
