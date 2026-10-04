// Shared fixtures for the schema/settings/presets/engine tests: a small stand-in for the YouTube
// catalog (Phase 2b defines the real one), using the setting ids PLAN §6.3 names.
import { loadAtPeace, installFakeBrowser, CORE_SCRIPTS, SCHEMA_SCRIPTS, YOUTUBE_SCRIPTS } from './_load.mjs';

const toggle = (id, extra = {}) => ({ id, label: id, type: 'toggle', default: false, ...extra });
const select = (id, values, extra = {}) => ({
  id,
  label: id,
  type: 'select',
  default: values[0],
  options: values.map((value) => ({ value, label: value })),
  ...extra,
});

/**
 * Registers the stand-in catalog. Deliberately incomplete: `yt.guide.hideSignInPromo` and
 * `yt.search.hideRelatedSearches` are missing and `yt.general.thumbnails` has no 'blur' option, so
 * tests can see how presets report ids they cannot resolve.
 * @param {any} AP
 */
export function defineFixtureCatalog(AP) {
  const S = AP.schema;
  S.section({ id: 'yt.fixture', site: 'youtube', title: 'Fixture', order: 200 });
  S.define('yt.fixture', [
    toggle('yt.general.hideAds', { tags: ['ads'], hide: ['.ad-slot'] }),
    toggle('yt.general.hidePremiumUpsells', { tags: ['ads'], hide: ['.premium'] }),
    select('yt.general.thumbnails', ['show', 'grayscale', 'hide'], {
      tags: ['recommendations'],
      variants: { hide: { hide: ['ytd-thumbnail'] }, grayscale: { rules: [':scope-on ytd-thumbnail { filter: grayscale(1) !important; }'] } },
    }),
    toggle('yt.general.grayscale', { rules: [':scope-on { filter: grayscale(1) !important; }'] }),
    toggle('yt.general.disableHoverPreview', { feature: 'thumbnails-hover' }),
    toggle('yt.masthead.hideAICompanion', { tags: ['ai'], hide: ['#ai'] }),
    toggle('yt.masthead.hideCreate', { hide: ['#create'] }),
    toggle('yt.masthead.hideVoiceSearch', { hide: ['#voice'] }),
    toggle('yt.masthead.hideCountryCode', { hide: ['#country'] }),
    toggle('yt.guide.hideShorts', { tags: ['shorts'], hide: ['a[title="Shorts"]'] }),
    toggle('yt.guide.hideMoreFromYouTube', { hide: ['#more'] }),
    toggle('yt.guide.hideExploreSection', { hide: ['#explore'] }),
    toggle('yt.guide.hideFooter', { hide: ['#footer'] }),
    select('yt.home.feedMode', ['show', 'hide', 'subscriptions', 'watchLater', 'playlists', 'custom'], {
      tags: ['recommendations'],
      feature: 'home-feed',
      page: 'home',
      variants: { hide: { hide: ['ytd-rich-grid-renderer'] } },
    }),
    toggle('yt.home.hideShortsShelf', { tags: ['shorts'], page: 'home', hide: ['ytd-rich-shelf-renderer[is-shorts]'] }),
    toggle('yt.watch.hideRelated', { tags: ['recommendations'], page: 'watch', hide: ['#related'] }),
    toggle('yt.watch.hideAsk', { tags: ['ai'], page: 'watch', hide: ['#ask'] }),
    toggle('yt.watch.hideViewCount', { tags: ['metrics'], page: 'watch', hide: ['#view-count'] }),
    toggle('yt.watch.disableAutoplay', { tags: ['behaviour', 'recommendations'], feature: 'autoplay' }),
    toggle('yt.player.hideEndscreenCards', { tags: ['recommendations'], hide: ['.ytp-ce-element'] }),
    toggle('yt.player.hideEndscreenWall', { tags: ['recommendations'], hide: ['.ytp-endscreen-content'] }),
    toggle('yt.comments.hideAll', { tags: ['comments'], hide: ['ytd-comments'] }),
    toggle('yt.comments.hideTeaser', { hide: ['#teaser'] }),
    toggle('yt.search.hideShorts', { tags: ['shorts'], page: 'search', hide: ['ytd-reel-shelf-renderer'] }),
    toggle('yt.search.hideShelves', { page: 'search', hide: ['ytd-shelf-renderer'] }),
    select('yt.shorts.mode', ['allow', 'watch', 'block'], { tags: ['shorts'], feature: 'shorts' }),
  ]);
}

/**
 * Fresh world: fake `browser` installed and the schema stack loaded, plus the engine and YouTube
 * page detection when `engine` is set.
 *
 * `catalog`:
 *   'fixture' (default)  cross-site settings + the stand-in catalog above. The shipped YouTube
 *                        schema files are NOT loaded, so these tests keep passing whatever
 *                        Phase 2b puts there.
 *   'shipped'            the stack exactly as the manifest loads it
 *   'none'               cross-site settings only
 * @param {{ catalog?: 'fixture'|'shipped'|'none', engine?: boolean, browser?: object }} [options]
 */
export async function freshWorld({ catalog = 'fixture', engine = false, browser } = {}) {
  const fake = installFakeBrowser(browser);
  const schema = catalog === 'shipped' ? SCHEMA_SCRIPTS : SCHEMA_SCRIPTS.filter((f) => !f.startsWith('src/sites/youtube/schema/'));
  const scripts = [...CORE_SCRIPTS, ...schema, ...(engine ? YOUTUBE_SCRIPTS.slice(0, 2) : [])];
  const AP = await loadAtPeace(scripts);
  if (catalog === 'fixture') defineFixtureCatalog(AP);
  return { AP, fake };
}
