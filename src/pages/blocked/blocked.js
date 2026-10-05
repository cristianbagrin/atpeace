// Blocked page (PLAN §8.4, §9). A DNR block rule — or the page guard on an already open tab —
// sends a page load here as `blocked.html?reason=<focus|schedule|limit|shorts>#<original url>`.
//
//   focus      a block the person started. Quiet way out per `focus.strict` / `focus.unlockFriction`:
//              nothing (strict) · "End focus" · a 30 second wait · typing a sentence.
//   schedule   a weekly schedule is closing the site. No way out here; settings are one click away.
//   limit      today's daily limit. "5 more minutes" while the day's allowance lasts.
//   shorts     Shorts are switched off (no timer): a calm line and a link to the normal watch page.
//
// The remaining time is read from the background (GET_STATUS) and counts down live. When it ends
// the page says "You're free to go" and offers the original address. What the page shows always
// follows the background's truth, not the `reason` in the URL: a block that has ended, or been
// ended in another tab, turns this page into the "free" state.

const AP = globalThis.AtPeace;
const T = AP.msg.TYPES;
const { h } = AP.ui;

const $ = (id) => document.getElementById(id);
const els = {
  title: $('title'),
  sub: $('sub'),
  time: $('time'),
  clock: $('clock'),
  until: $('until'),
  cta: $('cta'),
  unlock: $('unlock'),
  note: $('note'),
  target: $('target'),
};

const REASONS = ['focus', 'schedule', 'limit', 'shorts'];
const WAIT_SECONDS = 30;
const RAW_TARGET = location.hash.slice(1);
const asked = new URLSearchParams(location.search).get('reason');
const askedReason = REASONS.includes(asked) ? asked : null;

let settings = AP.schema.defaults();
let lock = { mode: 'none', locked: false, unlockedUntil: 0, waitSeconds: 60 }; // the settings lock (AP.lock.read())
let target = null; // URL | null
let siteKey = null;
let siteLabel = 'This site';
let status = null; // the last GET_STATUS-like answer
let block = null; // the block shown (or null)
let ticker = null;
let unlockCleanup = null;
let ending = false;

// ---------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------

function parseTarget(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

const isYouTube = (url) => ['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname.toLowerCase());

/** The configured site a URL belongs to. YouTube counts even when it is not in the pause list. */
function siteKeyOf(url, sites) {
  if (isYouTube(url)) return 'youtube';
  return AP.state.siteKeyForUrl(url, sites);
}

function labelFor(key, sites) {
  if (key === 'youtube') return 'YouTube';
  const site = sites.find((s) => s.siteKey === key);
  return (site?.domain ?? key).replace(/^www\./, '');
}

/** "Back at 14:30", "Back tomorrow", "Back Friday at 09:00". */
function describeEnd(until, now = Date.now()) {
  const end = new Date(until);
  const today = new Date(now);
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(end) - startOfDay(today)) / 86_400_000);
  const clock = AP.ui.formatTimeOfDay(until);
  if (days <= 0) return `Back at ${clock}`;
  if (days === 1 && end.getHours() === 0 && end.getMinutes() === 0) return 'Back tomorrow';
  if (days === 1) return `Back tomorrow at ${clock}`;
  return `Back ${end.toLocaleDateString([], { weekday: 'long' })} at ${clock}`;
}

function setNote(text) {
  els.note.textContent = text ?? '';
}

/** A link that looks like the primary button. Real <a>: middle-click and "copy link" work. */
function linkButton(label, href) {
  return h('a', { class: 'btn btn-primary big', href }, label);
}

const quietButton = (label, onClick, attrs = {}) => h('button', { type: 'button', class: 'btn btn-quiet', onClick, ...attrs }, label);

function clearUnlock() {
  unlockCleanup?.();
  unlockCleanup = null;
  els.unlock.replaceChildren();
}

// ---------------------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------------------

/** GET_STATUS, or what storage says when the background does not answer. */
async function fetchStatus() {
  try {
    const res = await AP.msg.send(T.GET_STATUS);
    if (res?.ok) return res;
  } catch {
    /* fall through to storage */
  }
  const state = await AP.state.getState();
  const now = Date.now();
  return {
    ok: true,
    now,
    block: state.block,
    blocks: state.block ? [state.block] : [],
    limit: null,
    activeSchedules: [],
  };
}

/** The block that applies to this site: the one the URL asked about if it is running, else the longest. */
function pickBlock(blocks, now) {
  const mine = blocks.filter((b) => b.until > now && b.siteKeys.includes(siteKey));
  mine.sort((a, b) => b.until - a.until);
  return mine.find((b) => b.reason === askedReason) ?? mine[0] ?? null;
}

async function refresh() {
  try {
    settings = await AP.settings.effective();
  } catch {
    /* keep the last settings */
  }
  status = await fetchStatus();
  lock = await AP.lock.read().catch(() => lock);
  // The background's clock decides what is still running: judging by this page's own clock a few ms
  // later could call a block over while the background has not yet removed its rule.
  block = pickBlock(status.blocks ?? [], status.now ?? Date.now());
  render();
}

// ---------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------

function setState(state) {
  document.body.dataset.state = state;
  document.body.dataset.reason = block?.reason ?? askedReason ?? '';
}

function stopTicker() {
  clearInterval(ticker);
  ticker = null;
}

function render() {
  stopTicker();
  clearUnlock();
  setNote('');
  els.cta.replaceChildren();

  if (block) return renderBlocked();
  if (askedReason === 'shorts') return renderShorts();
  return renderFree();
}

function renderBlocked() {
  const reason = block.reason;
  setState('blocked');
  els.time.hidden = false;
  if (reason === 'focus') {
    els.title.textContent = `${siteLabel} is closed for now.`;
    els.sub.textContent = 'You asked for a quiet stretch.';
  } else if (reason === 'schedule') {
    els.title.textContent = 'Closed by your schedule.';
    els.sub.textContent = block.name ? `“${block.name}” keeps ${siteLabel} closed until then.` : `Your schedule keeps ${siteLabel} closed until then.`;
  } else {
    const minutes = status.limit?.dailyMinutes;
    els.title.textContent = 'That’s your time for today.';
    els.sub.textContent = minutes ? `You reached today’s limit of ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.` : 'You reached today’s limit.';
  }
  els.until.textContent = describeEnd(block.until);
  tick();
  ticker = setInterval(tick, 250);
  renderUnlock();
}

function tick() {
  if (!block) return;
  const left = block.until - Date.now();
  if (left <= 0) {
    ended();
    return;
  }
  const text = AP.ui.formatClock(left / 1000);
  if (els.clock.textContent !== text) els.clock.textContent = text;
}

/** The block ran out: ask the background (which clears the rule), then show the free state. */
async function ended() {
  stopTicker();
  await refresh();
}

function renderFree() {
  setState('free');
  els.time.hidden = true;
  els.title.textContent = 'You’re free to go.';
  els.sub.textContent = `Nothing is holding ${siteLabel} closed now.`;
  if (target) els.cta.append(linkButton(`Open ${siteLabel}`, target.href));
}

function renderShorts() {
  setState('shorts');
  els.time.hidden = true;
  els.title.textContent = 'Shorts are off.';
  els.sub.textContent = 'You chose not to see them, and that is fine.';
  const watch = watchUrlFor(target);
  if (watch) els.cta.append(linkButton('Watch this video normally', watch));
}

/** /shorts/<id> → the same video in the normal player. */
function watchUrlFor(url) {
  if (!url || !isYouTube(url)) return null;
  const match = /^\/shorts\/([\w-]{5,20})\/?$/.exec(url.pathname);
  return match ? `https://www.youtube.com/watch?v=${match[1]}` : null;
}

// ---------------------------------------------------------------------------------------
// The quiet way out
// ---------------------------------------------------------------------------------------

function renderUnlock() {
  clearUnlock();
  if (!block) return;
  if (block.reason === 'focus') {
    if (settings['focus.strict'] === true) {
      els.unlock.append(h('p', null, 'This block cannot be ended early. You chose it that way.'));
      return;
    }
    if (lock.locked) {
      // Ending a block early shows the site again, which the settings lock holds back until it is opened.
      els.unlock.append(
        h(
          'p',
          null,
          'Your settings are locked, so this cannot be ended early yet. ',
          quietButton('Unlock…', async () => {
            if (await AP.ui.requestUnlock(lock)) await refresh();
          }),
        ),
      );
      return;
    }
    const friction = settings['focus.unlockFriction'];
    if (friction === 'phrase') els.unlock.append(quietButton('End focus early…', showPhrase));
    else if (friction === 'wait') els.unlock.append(quietButton('End focus early…', showWait));
    else els.unlock.append(quietButton('End focus', () => endFocus(false)));
    return;
  }
  if (block.reason === 'limit' && (status.limit?.graceLeft ?? 0) > 0) {
    const left = status.limit.graceLeft;
    els.unlock.append(
      h(
        'div',
        { class: 'row' },
        h('button', { type: 'button', class: 'btn', id: 'grace', onClick: askGrace }, '5 more minutes'),
        h('span', { class: 'hint' }, left === 1 ? 'One left today.' : `${left} left today.`),
      ),
    );
    return;
  }
  els.unlock.append(
    h('p', null, block.reason === 'schedule' ? 'To change this, edit your schedules in ' : 'To change this, open ', quietButton('settings', () => AP.msg.send(T.OPEN_OPTIONS, { section: 'focus' })), '.'),
  );
}

/** "wait" friction: a countdown of 30 seconds, then the button. */
function showWait() {
  clearUnlock();
  let left = WAIT_SECONDS;
  const hint = h('span', { class: 'hint' }, `${left} s`);
  const confirmButton = h('button', { type: 'button', class: 'btn', disabled: true, onClick: () => endFocus(true) }, 'End focus now');
  const cancel = quietButton('Keep going', renderUnlock);
  els.unlock.append(h('p', null, 'Take a moment. You can end this in ', hint, '.'), h('div', { class: 'row' }, confirmButton, cancel));
  const timer = setInterval(() => {
    left -= 1;
    hint.textContent = `${left} s`;
    if (left <= 0) {
      clearInterval(timer);
      hint.textContent = 'now';
      confirmButton.disabled = false;
      confirmButton.focus();
    }
  }, 1000);
  unlockCleanup = () => clearInterval(timer);
}

/** "phrase" friction: type the sentence. */
function showPhrase() {
  clearUnlock();
  const phrase = AP.ui.FOCUS_PHRASE;
  const input = h('input', { type: 'text', id: 'phrase', autocomplete: 'off', spellcheck: false, 'aria-describedby': 'phrase-text', placeholder: 'Type it here' });
  const confirmButton = h('button', { type: 'button', class: 'btn', disabled: true, onClick: () => endFocus(true) }, 'End focus');
  input.addEventListener('input', () => {
    confirmButton.disabled = !AP.ui.phraseMatches(input.value, phrase);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !confirmButton.disabled) endFocus(true);
  });
  els.unlock.append(
    h('label', { for: 'phrase' }, 'To end this early, type:'),
    h('p', { class: 'phrase', id: 'phrase-text' }, phrase),
    input,
    h('div', { class: 'row' }, confirmButton, quietButton('Keep going', renderUnlock)),
  );
  input.focus();
}

async function endFocus(frictionDone) {
  if (ending) return;
  ending = true;
  setNote('');
  try {
    const res = await AP.msg.send(T.FOCUS_END, frictionDone ? { frictionDone: true } : {});
    if (res?.ok) {
      await refresh(); // maybe another block still holds the site: the page shows what is true
      return;
    }
    if (res?.error === 'strict') setNote('This block cannot be ended early.');
    else if (res?.error === 'locked') setNote('Your settings are locked again. Unlock them to end this early.');
    else if (res?.error === 'friction-required') setNote('Your settings changed: please follow the steps again.');
    else setNote('That did not work. Please try again.');
    await refresh();
  } finally {
    ending = false;
  }
}

async function askGrace() {
  const button = $('grace');
  if (button) button.disabled = true;
  const res = await AP.msg.send(T.LIMIT_GRACE).catch(() => ({ ok: false }));
  if (res?.ok) {
    // The background has already removed the block rule: carry on to where the person was going.
    if (target) location.replace(target.href);
    else await refresh();
    return;
  }
  setNote(res?.error === 'no-grace' ? 'There is no extra time left today.' : 'That did not work. Please try again.');
  await refresh();
}

// ---------------------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------------------

async function main() {
  els.target.textContent = RAW_TARGET;
  try {
    settings = await AP.settings.effective();
  } catch {
    /* defaults */
  }
  AP.ui.watchTheme(settings);

  target = parseTarget(RAW_TARGET);
  const sites = settings['pause.sites'];
  siteKey = target ? siteKeyOf(target, sites) : 'youtube';
  siteLabel = labelFor(siteKey ?? 'youtube', sites);

  // One hit per load, for the stats. Failures here must never get in the way.
  if (siteKey) AP.msg.send(T.BLOCKED_OPENED, { siteKey, reason: askedReason ?? 'focus' }).catch(() => {});

  await refresh();

  // Follow changes made elsewhere: a block ended from the popup, extended, or a limit raised.
  const onStateChange = AP.util.debounce(() => {
    if (!ending) refresh();
  }, 150);
  AP.api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.state || changes.settings)) onStateChange();
  });
  // A tab that slept through the end of the block must not keep showing a stale clock.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && block) tick();
  });
}

main().catch((err) => {
  AP.warn('blocked page failed to start', err);
  block = null;
  render();
});
