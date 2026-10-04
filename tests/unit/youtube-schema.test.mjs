// The YouTube settings catalog (src/sites/youtube/schema/*, Phase 2b): structure, naming, selector
// hygiene and the contracts other phases rely on. Whether a selector really matches YouTube is
// proven against DOM snapshots by `npm run selectors`; this file only guards what can be judged in
// Node: that nothing was dropped, every rule is well formed, and no rule breaks PLAN §6.2.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadAtPeace, installFakeBrowser, uninstallFakeBrowser, CORE_SCRIPTS, SCHEMA_SCRIPTS, YOUTUBE_SCRIPTS } from './_load.mjs';

/** Every YouTube setting that must exist: section → ids without the "yt.<section>." prefix. Keep in sync on purpose. */
const EXPECTED = {
  general: ['grayscale', 'thumbnails', 'disableHoverPreview', 'calmTitles', 'hideViewCounts', 'hideUploadDates', 'hideDurations', 'hideChannelAvatars', 'hideBadges', 'hideWatchedProgress', 'hideWatched', 'hideAds', 'hidePremiumUpsells', 'hideMixes', 'hidePlayables'],
  masthead: ['hideSearchSuggestions', 'hideVoiceSearch', 'hideSearchBar', 'hideCreate', 'hideNotifications', 'hideGuideButton', 'hideAICompanion', 'hideCountryCode', 'hideDoodle', 'hideMastheadAd'],
  guide: ['hideAll', 'hideMini', 'hideHome', 'hideShorts', 'hideSubscriptionsEntry', 'hideYouEntry', 'hideHistory', 'hidePlaylists', 'hideYourVideos', 'hideWatchLater', 'hideLiked', 'hideDownloads', 'hideCourses', 'hideSubscriptionsSection', 'hideExploreSection', 'hideMoreFromYouTube', 'hideSettingsSection', 'hideFooter', 'hideSignInPromo'],
  home: ['feedMode', 'redirectUrl', 'hideChips', 'hideShortsShelf', 'hideNewsShelf', 'hidePostsShelf', 'hideOtherShelves', 'hideFeedNudge'],
  watch: ['hideRelated', 'hideRelatedShorts', 'hideRelatedChips', 'hideLiveChat', 'hidePlayerAds', 'hideShoppingShelf', 'hideMerch', 'hideTickets', 'hideFundraiser', 'hideHashtags', 'hideOwnerAvatar', 'hideSubscriberCount', 'hideJoinButton', 'hideLikeCounts', 'hideLikeButtons', 'hideShare', 'hideDownload', 'hideClip', 'hideThanks', 'hideSave', 'hideAsk', 'hideMoreActions', 'hideViewCount', 'hideUploadDate', 'hideDescription', 'hideAISummary', 'hideChapters', 'hideDescriptionExtras', 'hideInfoPanels', 'hideAmbientMode', 'disableAutoplay', 'noAutoStart', 'autoTheater', 'defaultSpeed', 'dismissStillWatching'],
  player: ['hideEndscreenCards', 'hideEndscreenWall', 'hideInfoCards', 'hidePauseOverlay', 'hideWatermark', 'hidePaidPromotion', 'hideAutoplayToggle', 'hideNextButton', 'hideMiniplayerButton', 'hideCastButton', 'hideSubtitlesButton', 'hideChapterTitle', 'hideProgressPreviews'],
  comments: ['hideAll', 'hideTeaser', 'hideCount', 'hideAvatars', 'hideLikeCounts', 'hideReplies', 'hideCreatorHearts'],
  search: ['hideShorts', 'hideShelves', 'hideRelatedSearches', 'hideAds', 'hideAISummary', 'hideChannelResults', 'hideSnippets', 'hideFilterChips'],
  shorts: ['mode', 'hideComments', 'hideLikeCounts', 'hideRemix', 'hideSubscribe'],
  subs: ['hideShorts', 'hidePosts', 'hideLive', 'hideUpcoming', 'hideWatched'],
  channel: ['openVideosTab', 'hideTrailer', 'hideHomeShelves', 'hideBanner', 'hideSubscriberCount', 'hideShortsTab', 'hideLiveTab', 'hidePodcastsTab', 'hidePlaylistsTab', 'hidePostsTab', 'hideStoreTab'],
  filters: ['keywords', 'channels', 'applyTo', 'commentKeywords'],
};
const EXPECTED_IDS = Object.entries(EXPECTED).flatMap(([section, names]) => names.map((n) => `yt.${section}.${n}`));

/** Popup quick toggles (PLAN §6.3 stars). */
const QUICK = ['yt.general.grayscale', 'yt.general.thumbnails', 'yt.general.hideAds', 'yt.home.feedMode', 'yt.watch.hideRelated', 'yt.watch.disableAutoplay', 'yt.player.hideEndscreenWall', 'yt.comments.hideAll', 'yt.shorts.mode'];

/** Settings that may carry CSS without a `page:` although they sit in a page-specific section. */
const UNSCOPED_IN_PAGE_SECTIONS = new Set(['yt.watch.hideAmbientMode']);
const PLAYER_REACHING = new Set(['yt.general.thumbnails', 'yt.general.hidePremiumUpsells']);

/** Contract C5 (docs/reviews/phase-0-1.md): values the page bridge may tag. */
const BRIDGE = {
  'data-at-peace-entry': ['home', 'shorts', 'subscriptions', 'you', 'history', 'playlists', 'your-videos', 'watch-later', 'liked', 'downloads', 'courses', 'your-clips'],
  'data-at-peace-tab': ['home', 'videos', 'shorts', 'streams', 'podcasts', 'playlists', 'posts', 'store', 'courses', 'releases'],
  'data-at-peace-action': ['like', 'share', 'download', 'clip', 'thanks', 'save', 'ask', 'more', 'join'],
};

let AP;
let S;
/** Every YouTube setting of the real catalog (the Phase 2a TEMP settings are not part of it). */
let catalog;

before(async () => {
  installFakeBrowser();
  AP = await loadAtPeace([...CORE_SCRIPTS, ...SCHEMA_SCRIPTS, YOUTUBE_SCRIPTS[1]]);
  S = AP.schema;
  catalog = S.all().filter((d) => S.siteOf(d.id) === 'youtube' && !d.id.startsWith('yt.general.temp'));
});
after(() => uninstallFakeBrowser());

/** Every selector a setting contributes: hide lists, variants, and the selector side of rules. */
function selectorsOf(def) {
  const out = [];
  const blocks = [def, ...Object.values(def.variants ?? {})];
  for (const block of blocks) {
    out.push(...(block.hide ?? []).map((selector) => ({ selector, kind: 'hide' })));
    for (const rule of block.rules ?? []) {
      for (const m of rule.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
        for (const part of S.splitSelectorList(m[1].trim().replace(/^@\w+[^{]*$/, ''))) out.push({ selector: part.replace(/^:scope-on\s*/, ''), kind: 'rule' });
      }
    }
  }
  return out.filter((x) => x.selector !== '');
}

describe('catalog shape', () => {
  test('validateRegistry() is clean', () => {
    assert.deepEqual(S.validateRegistry(), []);
  });

  test('every expected setting exists, and nothing unlisted was added (keep EXPECTED in sync)', () => {
    const have = new Set(catalog.map((d) => d.id));
    assert.deepEqual(EXPECTED_IDS.filter((id) => !have.has(id)), [], 'missing from the catalog');
    assert.deepEqual([...have].filter((id) => !EXPECTED_IDS.includes(id)), [], 'in the catalog but not in EXPECTED');
    assert.equal(new Set(EXPECTED_IDS).size, EXPECTED_IDS.length, 'duplicate ids in EXPECTED');
  });

  test('the Phase 1 decisions hold: two settings dropped, two added', () => {
    for (const id of ['yt.general.hideLiveBadgesAndPremieres', 'yt.home.limitRows']) assert.equal(S.get(id), undefined, id);
    for (const id of ['yt.search.hideAISummary', 'yt.watch.hideUploadDate']) assert.ok(S.get(id), id);
  });

  test('sections: one per file, ids "yt.<name>", ordered 100-899 in file order', () => {
    const sections = S.sections({ site: 'youtube' }).filter((s) => s.site === 'youtube');
    assert.deepEqual(sections.map((s) => s.id), Object.keys(EXPECTED).map((n) => `yt.${n}`));
    for (const sec of sections) {
      assert.ok(sec.order >= 100 && sec.order <= 899, `${sec.id} order`);
      assert.ok(sec.title.trim() !== '' && sec.description?.trim() !== '', `${sec.id} title/description`);
    }
    assert.equal(new Set(sections.map((s) => s.title)).size, sections.length, 'section titles must differ');
    assert.ok(!sections.some((s) => s.title === 'General'), 'the cross-site section is called General');
  });

  test('settings live in the section their id names, in the order EXPECTED lists them', () => {
    for (const [section, names] of Object.entries(EXPECTED)) {
      assert.deepEqual(S.bySection(`yt.${section}`).filter((d) => !d.id.includes('.temp')).map((d) => d.id), names.map((n) => `yt.${section}.${n}`), section);
    }
  });

  test('labels are unique within a section, plain and short; descriptions are one or two plain sentences', () => {
    for (const sec of Object.keys(EXPECTED)) {
      const labels = catalog.filter((d) => d.section === `yt.${sec}`).map((d) => d.label);
      assert.equal(new Set(labels).size, labels.length, `duplicate label in ${sec}: ${labels.filter((l, i) => labels.indexOf(l) !== i)}`);
    }
    for (const def of catalog) {
      assert.ok(def.label.length >= 3 && def.label.length <= 60, `${def.id} label length`);
      assert.ok(typeof def.description === 'string' && def.description.length >= 20 && def.description.length <= 330, `${def.id} description length`);
      assert.match(def.description, /[.)]$/, `${def.id} description should end with a full stop`);
      assert.match(def.description, /^[A-Z"]/, `${def.id} description should start with a capital`);
      assert.doesNotMatch(`${def.label} ${def.description}`, /\p{Extended_Pictographic}/u, `${def.id}: no emoji`);
      assert.ok(def.group && def.group.trim() !== '', `${def.id} needs a group`);
      assert.equal(def.since, '0.1.0', `${def.id} since`);
    }
  });

  test('toggles that carry CSS have a non-empty list; every select variant has CSS; JS-only settings name their feature', () => {
    for (const def of catalog) {
      const hasCss = def.hide !== undefined || def.rules !== undefined || def.variants !== undefined;
      if (def.hide !== undefined) assert.ok(def.hide.length > 0, `${def.id}: empty hide list`);
      if (def.rules !== undefined) assert.ok(def.rules.length > 0, `${def.id}: empty rules list`);
      if (def.variants !== undefined) {
        for (const [value, v] of Object.entries(def.variants)) assert.ok((v.hide?.length ?? 0) + (v.rules?.length ?? 0) > 0, `${def.id}=${value}: variant without CSS`);
      }
      if (!hasCss) assert.ok(typeof def.feature === 'string' && def.feature !== '', `${def.id}: no CSS and no feature`);
    }
  });

  test('defaults describe the Untouched baseline: toggles off, selects at their first (least hidden) option', () => {
    for (const def of catalog) {
      if (def.type === 'toggle') assert.equal(def.default, false, def.id);
      if (def.type === 'select') {
        assert.equal(def.default, def.options[0].value, `${def.id}: the default must be the first option`);
        assert.ok(['show', 'allow', 'default', 'off'].includes(def.default), `${def.id}: default "${def.default}"`);
      }
      if (def.type === 'list' && def.id !== 'yt.filters.applyTo') assert.deepEqual(def.default, [], def.id);
    }
    assert.deepEqual(S.get('yt.filters.applyTo').default, ['home', 'search', 'watch', 'subscriptions']);
  });

  test('popup quick toggles are exactly the starred settings', () => {
    assert.deepEqual(catalog.filter((d) => d.quick).map((d) => d.id).sort(), [...QUICK].sort());
  });

  test('bulk actions: tagged selects land on a sensible value, never on a redirect or a blank', () => {
    assert.equal(S.bulkValue(S.get('yt.home.feedMode')), 'hide');
    assert.equal(S.bulkValue(S.get('yt.general.thumbnails')), 'blur');
    assert.equal(S.bulkValue(S.get('yt.shorts.mode')), 'block');
    for (const tag of ['shorts', 'ads', 'ai', 'comments', 'metrics', 'recommendations', 'clutter']) {
      assert.ok(S.byTag(tag).length >= 3, `tag ${tag} has settings`);
    }
    // Shorts that are allowed are not hidden by "comments"/"shorts" bulk accidentally: only shorts.mode carries the select.
    assert.deepEqual(S.byTag('shorts').filter((d) => d.type === 'select').map((d) => d.id), ['yt.shorts.mode']);
    assert.ok(S.byTag('ads').length >= 5 && S.byTag('ai').length >= 4);
  });

  test('every preset id (Gentle, Focused, Deep work) resolves against this catalog', () => {
    for (const [name, report] of Object.entries(AP.presets.diagnose())) {
      assert.deepEqual(report, { missing: [], invalid: [] }, name);
    }
  });
});

describe('selector hygiene (PLAN §6.2)', () => {
  test('no selector keys on visible text, aria-labels or translated titles', () => {
    const textual = /\[\s*(aria-label|title|tab-title|alt|placeholder|data-title[\w-]*|data-tooltip-title)\b|:contains\(|:has-text\(|:-abp-|:xpath\(|text\(/i;
    for (const def of catalog) for (const { selector } of selectorsOf(def)) assert.doesNotMatch(selector, textual, `${def.id}: ${selector}`);
  });

  test('selectors are well formed: balanced, no stray combinators, no !important, no braces', () => {
    for (const def of catalog) {
      for (const { selector, kind } of selectorsOf(def)) {
        const where = `${def.id}: ${selector}`;
        assert.ok(S.isSafeSelector(selector), where);
        assert.doesNotMatch(selector, /!important|[{};]|\/\*|<|>\s*$|^\s*[>+~]|,\s*,|\(\s*\)/, where);
        assert.doesNotMatch(selector, /\s{2,}/, `${where} (collapse whitespace)`);
        if (kind === 'hide') assert.equal(S.splitSelectorList(selector).length, 1, `${where} (one selector per entry)`);
        let quotes = 0;
        for (const ch of selector) if (ch === '"') quotes++;
        assert.equal(quotes % 2, 0, `${where} (unbalanced quotes)`);
      }
    }
  });

  test(':has() is always anchored to a specific element and never nested', () => {
    for (const def of catalog) {
      for (const { selector } of selectorsOf(def)) {
        const where = `${def.id}: ${selector}`;
        assert.doesNotMatch(selector, /(^|[\s>+~,])(\*|:has\()/, `${where} (unanchored :has / universal)`);
        // A bare `> :has(` or `> :is(…):has(` is fine; what is rejected is the start of a compound being :has.
        // Nested :has() is invalid CSS in every browser.
        let nested = false;
        let i = 0;
        const stack = [];
        while (i < selector.length) {
          if (selector.startsWith(':has(', i)) {
            if (stack.includes('has')) nested = true;
            stack.push('has');
            i += 5;
            continue;
          }
          const ch = selector[i];
          if (ch === '(') stack.push('(');
          else if (ch === ')') stack.pop();
          i++;
        }
        assert.equal(nested, false, `${where} (nested :has)`);
      }
    }
  });

  test('positional selectors are limited to the documented ones', () => {
    // nth-* guesses can hide the wrong element when YouTube reorders; each use here is justified in its schema file.
    const allowed = new Set([
      'yt.general.hideViewCounts', 'yt.general.hideUploadDates', // views/date row of metadata
      'yt.watch.hideViewCount', 'yt.watch.hideUploadDate', // #info spans
      'yt.shorts.hideComments', 'yt.shorts.hideLikeCounts', 'yt.shorts.hideRemix', 'yt.comments.hideAll', // Shorts action bar
      'yt.channel.hideSubscriberCount', // header metadata row
    ]);
    for (const def of catalog) {
      for (const { selector } of selectorsOf(def)) {
        if (/:nth-|:first-child|:last-child|:last-of-type|:first-of-type|:only-child/.test(selector.replace(/:nth-child\(1 of \.\w+\)/g, ''))) {
          assert.ok(allowed.has(def.id) || /yt-tab-shape:first-child\[aria-selected/.test(selector), `${def.id}: positional selector not on the allow list: ${selector}`);
        }
      }
    }
  });

  test('page-specific sections page-scope their CSS; the player and comments are deliberately unscoped', () => {
    const pageOf = { watch: 'watch', search: 'search', home: 'home', subs: 'subscriptions', channel: 'channel', shorts: 'shorts' };
    for (const def of catalog) {
      const section = def.section.slice(3);
      const css = def.hide !== undefined || def.rules !== undefined || def.variants !== undefined;
      if (!css || !pageOf[section] || UNSCOPED_IN_PAGE_SECTIONS.has(def.id)) continue;
      assert.equal(def.page, pageOf[section], `${def.id} must be scoped to the ${pageOf[section]} page`);
    }
    // The whole player DOM exists (hidden) on every page, so player rules need no page; it is a conscious choice.
    for (const def of catalog.filter((d) => d.section === 'yt.player')) assert.equal(def.page, undefined, def.id);
  });

  test('every selector that targets the player or the watch page is either page-scoped or lives in the player section', () => {
    for (const def of catalog) {
      // Site-wide settings that reach into the player on purpose: thumbnails (end-of-video wall stills)
      // and the Premium-only quality-menu entries.
      if (def.page || def.section === 'yt.player' || UNSCOPED_IN_PAGE_SECTIONS.has(def.id) || PLAYER_REACHING.has(def.id)) continue;
      for (const { selector } of selectorsOf(def)) {
        assert.doesNotMatch(selector, /\.ytp-|#movie_player/, `${def.id}: player selector without a page scope: ${selector}`);
      }
    }
  });

  test('bridge-tag attributes use only the values of contract C5, and bridge-only settings say so', () => {
    for (const def of catalog) {
      const sels = selectorsOf(def).map((s) => s.selector);
      for (const sel of sels) {
        for (const m of sel.matchAll(/\[(data-at-peace-(?:entry|tab|action))="([^"]*)"\]/g)) {
          assert.ok(BRIDGE[m[1]].includes(m[2]), `${def.id}: unknown ${m[1]} value "${m[2]}"`);
        }
        assert.doesNotMatch(sel, /data-at-peace-(?!entry|tab|action)/, `${def.id}: unknown bridge attribute in ${sel}`);
      }
      const usesBridge = sels.some((s) => /data-at-peace-(entry|tab|action)/.test(s));
      const onlyBridge = usesBridge && sels.every((s) => /data-at-peace-(entry|tab|action)/.test(s) || /ytd-reel-shelf-renderer/.test(s));
      if (def.feature === 'bridgeTags') assert.ok(usesBridge, `${def.id} claims bridgeTags but uses no tag`);
      if (onlyBridge && !/yt\.channel\.hideShortsTab/.test(def.id)) assert.equal(def.feature, 'bridgeTags', `${def.id} depends on bridge tags only`);
    }
    // The three families all appear.
    const all = catalog.flatMap(selectorsOf).map((s) => s.selector).join('\n');
    for (const attr of Object.keys(BRIDGE)) assert.match(all, new RegExp(attr));
  });

  test('action-button tag selectors can never match a container of the whole row', () => {
    for (const def of catalog) {
      for (const { selector } of selectorsOf(def)) {
        if (selector.includes('data-at-peace-action')) assert.match(selector, /:not\(ytd-menu-renderer[^)]*#top-level-buttons-computed/, def.id);
      }
    }
  });

  test('nothing broad: no selector is a bare page-level container', () => {
    const forbidden = /^(html|body|ytd-app|ytd-page-manager|ytd-browse|ytd-two-column-browse-results-renderer|#content|#page-manager|ytd-watch-flexy|ytd-masthead|div|span|a|img)(\[[^\]]*\])?$/;
    for (const def of catalog) {
      for (const { selector, kind } of selectorsOf(def)) {
        if (kind === 'hide') assert.doesNotMatch(selector, forbidden, `${def.id}: ${selector}`);
      }
    }
  });
});

describe('compiled stylesheet', () => {
  test('every catalog selector appears in exactly one compiled rule, gated by its own token', () => {
    const css = S.compileCss('youtube');
    for (const def of catalog) {
      if (def.type === 'toggle') {
        for (const sel of def.hide ?? []) {
          const gate = S.gate(def.id, def.page ?? null);
          assert.ok(css.includes(`${gate} ${sel} { display: none !important; }`), `${def.id}: ${sel}`);
        }
      }
    }
  });

  test('selects compile one gate per option (page-gated where the setting is)', () => {
    const css = S.compileCss('youtube');
    for (const id of ['yt.general.thumbnails=blur', 'yt.general.thumbnails=grayscale', 'yt.general.thumbnails=hide']) assert.ok(css.includes(`[data-at-peace~="${id}"]`), id);
    for (const mode of ['hide', 'subscriptions', 'watchLater', 'playlists', 'custom']) assert.ok(css.includes(`[data-at-peace~="yt.home.feedMode=${mode}"]`), mode);
    assert.ok(!css.includes('yt.home.feedMode=show'));
    assert.ok(css.includes('[data-at-peace~="yt.shorts.mode=block"]:is([data-at-peace-page="shorts"],[data-at-peace-next="shorts"]) ytd-shorts'));
  });

  test('thumbnail blur reveals on hover of the card, and the reveal outweighs the blur', () => {
    const rules = S.compileRules('youtube').filter((r) => r.includes('yt.general.thumbnails=blur'));
    assert.equal(rules.length, 2);
    assert.match(rules[0], /filter: blur\(14px\) !important/);
    assert.match(rules[1], /:hover :is\(.*\) \{ filter: none !important; \}/);
    assert.ok(rules[1].includes('yt-lockup-view-model') && rules[1].includes('ytd-video-renderer'));
    assert.ok(rules[0].includes('.ytThumbnailViewModelImage > img'), 'the filter is on the picture, not on the card');
    const hide = S.compileRules('youtube').filter((r) => r.includes('yt.general.thumbnails=hide'));
    assert.equal(hide.length, 1);
    assert.match(hide[0], /visibility: hidden !important/, 'hidden thumbnails keep their space');
  });

  test('grayscale is applied to the root element, which does not break position:fixed', () => {
    const rule = S.compileRules('youtube').find((r) => r.includes('yt.general.grayscale'));
    assert.equal(rule, 'html[data-at-peace~="yt.general.grayscale"] { filter: grayscale(1) !important; }');
  });

  test('hiding the guide also closes the gap it leaves; hiding related videos collapses an empty sidebar column', () => {
    const rules = S.compileRules('youtube');
    assert.ok(rules.some((r) => r.includes('yt.guide.hideAll') && r.includes('[guide-persistent-and-visible]') && r.includes('margin-left: 0 !important')));
    assert.ok(rules.some((r) => r.includes('yt.guide.hideAll') && r.includes('[mini-guide-visible]') && r.includes('margin-left: 0 !important')));
    assert.ok(rules.some((r) => r.includes('yt.guide.hideMini') && r.includes('[mini-guide-visible]')));
    const related = rules.filter((r) => r.includes('yt.watch.hideRelated"]') && r.endsWith('#secondary { display: none !important; }'));
    assert.equal(related.length, 2, 'collapse rule, and the variant for live chat hidden too');
    assert.ok(related[0].includes(':not([live-chat-present-and-expanded])'), 'an open live chat keeps the column');
    assert.ok(related[0].includes(':not(:has(#playlist:not([hidden])))'), 'a playing playlist keeps the column');
    assert.ok(related[0].includes('ENGAGEMENT_PANEL_VISIBILITY_EXPANDED'), 'an open transcript/chapters panel keeps the column');
    assert.ok(related[1].includes('[data-at-peace~="yt.watch.hideLiveChat"]'));
  });

  test('hiding related videos never targets the playlist panel, chat or engagement panels', () => {
    const related = S.get('yt.watch.hideRelated');
    for (const sel of related.hide) assert.doesNotMatch(sel, /#playlist|#chat|#panels|engagement-panel/, sel);
  });

  test('the Shorts, Premium and masthead settings never hide the in-stream ad controls or the autoplay countdown', () => {
    const all = catalog.flatMap(selectorsOf).map((s) => s.selector).join('\n');
    for (const forbidden of ['.video-ads', '.ytp-ad-module', 'ytp-ad-skip', 'ytp-autonav-endscreen-countdown']) assert.ok(!all.includes(forbidden), forbidden);
  });
});

describe('typed settings', () => {
  test('home redirect target: a YouTube path or https youtube.com address, nothing else', () => {
    const def = S.get('yt.home.redirectUrl');
    const ok = (v) => S.coerce(def, v).ok;
    assert.equal(def.default, '');
    for (const good of ['', '/feed/subscriptions', '/playlist?list=WL', 'https://www.youtube.com/playlist?list=PL123', 'https://youtube.com/@someone', '  /feed/history  ']) assert.ok(ok(good), good);
    for (const bad of ['javascript:alert(1)', '//evil.example/x', '/\\evil.example', 'http://www.youtube.com/', 'https://evil.example/', 'https://www.youtube.com.evil.example/', 'feed/subscriptions', 'data:text/html,hi']) assert.ok(!ok(bad), bad);
    assert.equal(S.validateValue(def, '  /feed/history  '), '/feed/history');
    assert.equal(S.validateValue(def, 'x'.repeat(501)), '');
  });

  test('playback speed options are the values the player accepts', () => {
    const def = S.get('yt.watch.defaultSpeed');
    assert.deepEqual(def.options.map((o) => o.value), ['default', '0.75', '1', '1.25', '1.5', '1.75', '2']);
    assert.equal(S.validateValue(def, 1.5), '1.5');
    assert.equal(S.validateValue(def, '3'), 'default');
  });

  test('filter lists trim and de-duplicate; applyTo is a multi-select', () => {
    assert.deepEqual(S.validateValue(S.get('yt.filters.keywords'), ['  spoiler ', 'spoiler', '', '/leak|rumou?r/i']), ['spoiler', '/leak|rumou?r/i']);
    assert.deepEqual(S.validateValue(S.get('yt.filters.applyTo'), ['home', 'nonsense', 'home', 'search']), ['home', 'search']);
  });

  test('Shorts mode and feed mode offer the documented choices in least-hidden-first order', () => {
    assert.deepEqual(S.get('yt.shorts.mode').options.map((o) => o.value), ['allow', 'watch', 'block']);
    assert.deepEqual(S.get('yt.home.feedMode').options.map((o) => o.value), ['show', 'hide', 'subscriptions', 'watchLater', 'playlists', 'custom']);
    assert.deepEqual(S.get('yt.general.thumbnails').options.map((o) => o.value), ['show', 'blur', 'grayscale', 'hide']);
    assert.deepEqual(S.get('yt.general.calmTitles').options.map((o) => o.value), ['off', 'sentence']);
  });
});
