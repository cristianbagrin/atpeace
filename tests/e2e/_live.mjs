// Live youtube.com is an environment, not a fixture: Google answers a burst of automated page loads with a
// captcha ("/sorry/") that sticks to the IP, and sometimes serves the page without parts of it. A live test
// that fails because of that is not a result about At Peace, so it SKIPS, with the reason, instead of failing.
// A failure on a page that rendered normally is still a failure.
//
//   watchGate(page)                      call once per page: remembers HTTP 429s from YouTube/Google
//   await liveSkipReason(err, page)      → a sentence when the failure is Google's doing, else null
//
//   test(name, async (t) => {
//     try { … } catch (err) {
//       const why = await liveSkipReason(err, page);
//       if (why) return t.skip(why);
//       throw err;
//     }
//   });
//
// Code that detects the condition itself throws `gate(message)` (the home page without its guide entries,
// a results page without results); `liveSkipReason` recognises those by `err.code`.

export const GATE_CODES = new Set(['YT_SORRY', 'YT_NOT_RENDERED']);

/** An error that makes a live test skip. */
export const gate = (message, code = 'YT_NOT_RENDERED') => Object.assign(new Error(message), { code });

/** Records the first HTTP 429 YouTube or Google's /sorry/ page answered with (on `page.gate429`). */
export function watchGate(page) {
  page.on('response', (response) => {
    if (response.status() !== 429 || page.gate429) return;
    const url = response.url();
    if (/^https:\/\/(www\.)?(youtube|google)\.com\//.test(url)) page.gate429 = new URL(url).pathname.slice(0, 60);
  });
  return page;
}

/**
 * Why a failed live test should be a skip, or null when the failure is ours to answer for.
 * @param {unknown} err
 * @param {import('playwright').Page | null} [page]
 * @returns {Promise<string|null>}
 */
export async function liveSkipReason(err, page = null) {
  if (err && GATE_CODES.has(err.code)) return `${err.message}; try again later`;
  if (!page || page.isClosed()) return null;
  if (/\/sorry\//.test(page.url())) return 'Google served its captcha page (/sorry/); try again later';
  if (page.gate429) return `YouTube answered ${page.gate429} with HTTP 429 (rate limited); try again later`;
  return null;
}
