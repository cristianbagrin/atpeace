// Mindful Pause page (PLAN §8.3). A DNR rule sends a page load of a paused site here with the
// original URL in the hash (`pause.html#https://…`). The flow:
//
//   breathing  one slow breath (the mint disc in the dial grows and shrinks, a big line says in / out)
//   choosing   how many times today, an optional "what did you come for?", then
//              Close <site>  or  Continue for [N minutes]
//   session    a session for this site is running (maybe started in another tab): just continue
//   invalid    nothing sensible to open
//
// It never traps the person: Close always works (history back, else close the tab), Esc is Close,
// and if the background does not answer, Continue still navigates after the breath.
//
// The only thing this page trusts the URL for is "which of MY configured sites is this": a hash
// that names any other address shows the "nothing to open" state, so the page cannot be used to
// bounce someone to an arbitrary site.

const AP = globalThis.AtPeace;
const T = AP.msg.TYPES;
const { h } = AP.ui;

const $ = (id) => document.getElementById(id);
const els = {
  kicker: $('kicker'),
  dial: $('dial'),
  guidance: $('guidance'),
  countdown: $('countdown'),
  sun: $('sun'),
  choice: $('choice'),
  session: $('session'),
  invalid: $('invalid'),
  breath: $('breath'),
  countLine: $('count-line'),
  intentionWrap: $('intention-wrap'),
  intention: $('intention'),
  close: $('close'),
  split: $('split'),
  go: $('continue'),
  minutes: $('minutes'),
  minutesSeg: $('minutes-seg'),
  note: $('note'),
  target: $('target'),
  sessionLine: $('session-line'),
  sessionGo: $('session-go'),
  sessionClose: $('session-close'),
  invalidClose: $('invalid-close'),
};

const COUNTED_KEY = 'at-peace:pause-counted';
const RAW_TARGET = location.hash.slice(1);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let siteKey = null;
let siteLabel = '';
let target = '';
let state = 'loading';
let leaving = false;
let breathSeconds = 6;
/** "4th time today", shown instead of the plain kicker once the choice is on screen. */
let countKicker = '';

// ---------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------

/** A usable http(s) address, or null. */
function parseTarget(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

/** 1 → "first", 2 → "2nd", 4 → "4th", 11 → "11th", 22 → "22nd". */
function ordinal(n) {
  if (n === 1) return 'first';
  const mod100 = n % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th');
  return `${n}${suffix}`;
}

function labelFor(key, sites) {
  if (key === 'youtube') return 'YouTube';
  const site = sites.find((s) => s.siteKey === key);
  return (site?.domain ?? key).replace(/^www\./, '');
}

function setNote(text) {
  els.note.textContent = text ?? '';
}

/** The small uppercase line above the title. */
function setKicker() {
  els.kicker.hidden = state === 'invalid';
  if (state === 'session') els.kicker.textContent = 'Session running';
  else if (state === 'choosing' && countKicker) els.kicker.textContent = countKicker;
  else els.kicker.textContent = `Before ${siteLabel || 'YouTube'}`;
}

/** The minutes buttons follow the select (the select is what the page reads and what tests drive). */
function syncMinutes() {
  for (const button of els.minutesSeg.children) button.setAttribute('aria-pressed', String(button.dataset.value === els.minutes.value));
  if (els.go.textContent === 'Continue for') {
    const chosen = els.minutes.selectedOptions[0]?.textContent;
    if (chosen) els.go.setAttribute('aria-label', `Continue for ${chosen}`);
  } else {
    els.go.removeAttribute('aria-label');
  }
}

function setMinutesDisabled(disabled) {
  els.minutes.disabled = disabled;
  for (const button of els.minutesSeg.children) button.disabled = disabled;
}

/** One layer visible at a time; the others are inert so keyboard and screen readers skip them. */
function setState(next) {
  state = next;
  document.body.dataset.state = next;
  els.choice.inert = next !== 'choosing';
  els.session.inert = next !== 'session';
  els.invalid.inert = next !== 'invalid';
  const choosing = next === 'choosing';
  els.close.disabled = !choosing;
  els.go.disabled = !choosing;
  setMinutesDisabled(!choosing);
  els.split.classList.toggle('is-disabled', !choosing);
  setKicker();
  $('foot-hint').hidden = next === 'invalid'; // Esc does nothing there
}

// ---------------------------------------------------------------------------------------
// The breath
// ---------------------------------------------------------------------------------------

let breath = null; // { animation, timers, ticker }

/** In/out pairs of about 8 s each (4 in, 4 out), stretched evenly to fill `seconds`. */
function breathPlan(seconds) {
  const cycles = Math.max(1, Math.round(seconds / 8));
  return { cycles, half: (seconds * 1000) / (cycles * 2) };
}

function setGuidance(text) {
  els.guidance.classList.add('is-fading');
  breath?.timers.push(
    setTimeout(() => {
      els.guidance.textContent = text;
      els.guidance.classList.remove('is-fading');
    }, 200),
  );
}

function startBreath() {
  cancelBreath();
  const total = breathSeconds * 1000;
  const { cycles, half } = breathPlan(breathSeconds);
  breath = { animation: null, timers: [], ticker: null };
  els.guidance.textContent = 'Breathe in…';
  els.guidance.classList.remove('is-fading');

  // The mint disc grows on the in-breath and shrinks on the out-breath, 0.6 ↔ 1.0, easing like a lung.
  // Reduced motion: no scaling; the disc stays put and softly fades in and out, with a countdown.
  const frames = [];
  for (let i = 0; i <= cycles * 2; i++) {
    const high = i % 2 === 1;
    frames.push(
      reducedMotion.matches
        ? { opacity: high ? 1 : 0.55, transform: 'scale(0.8)', offset: i / (cycles * 2), easing: 'ease-in-out' }
        : { transform: `scale(${high ? 1 : 0.6})`, offset: i / (cycles * 2), easing: 'cubic-bezier(0.45, 0, 0.55, 1)' },
    );
  }
  breath.animation = els.sun.animate(frames, { duration: total, fill: 'forwards' });

  for (let i = 1; i < cycles * 2; i++) {
    breath.timers.push(setTimeout(() => setGuidance(i % 2 === 1 ? '…and out' : 'Breathe in…'), i * half));
  }
  breath.timers.push(setTimeout(finishBreath, total));

  if (reducedMotion.matches) {
    const endsAt = Date.now() + total;
    els.countdown.hidden = false;
    const tick = () => {
      els.countdown.textContent = AP.ui.formatClock((endsAt - Date.now()) / 1000);
    };
    tick();
    breath.ticker = setInterval(tick, 250);
  }
}

/** Stops the timers of the breath, leaving the disc's animation as it is. */
function stopTimers() {
  if (!breath) return;
  for (const t of breath.timers) clearTimeout(t);
  clearInterval(breath.ticker);
  els.countdown.hidden = true;
}

/** Stops everything the breath started and puts the disc back to rest. */
function cancelBreath() {
  if (!breath) return;
  stopTimers();
  breath.animation?.cancel();
  breath = null;
}

function finishBreath() {
  if (state !== 'breathing') return;
  // The animation holds its last frame (fill: forwards): the disc rests small in the dial.
  stopTimers();
  if (reducedMotion.matches) els.sun.animate([{ opacity: 0.55 }, { opacity: 1 }], { duration: 400, fill: 'forwards' });
  breath = null;
  setState('choosing');
  els.close.focus({ preventScroll: true });
}

/** Breathe only while the page is looked at: a background tab waits, and a tab left mid-breath starts over. */
function onVisibility() {
  if (state !== 'breathing') return;
  if (document.visibilityState === 'visible') startBreath();
  else cancelBreath();
}

// ---------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------

async function closeTab() {
  let res;
  try {
    res = await AP.msg.send(T.CLOSE_TAB);
  } catch {
    res = null;
  }
  if (!res?.ok) {
    try {
      window.close();
    } catch {
      /* not allowed for tabs we did not open */
    }
    leaving = false;
    setNote('You can close this tab now.');
  }
}

/** Close the site: record it, then go back where the person came from, or close the tab. */
async function turnBack() {
  if (leaving) return;
  leaving = true;
  for (const b of [els.close, els.go, els.sessionClose, els.sessionGo]) b.disabled = true;
  setMinutesDisabled(true);
  try {
    sessionStorage.removeItem(COUNTED_KEY);
  } catch {
    /* private mode */
  }
  if (siteKey) await Promise.race([AP.msg.send(T.PAUSE_TURN_BACK, { siteKey }).catch(() => {}), sleep(350)]);
  if (history.length > 1) {
    history.back();
    // If going back did not leave this page (nothing to go back to after all), close the tab instead.
    await sleep(1500);
    if (document.visibilityState === 'visible') await closeTab();
  } else {
    await closeTab();
  }
}

/** Navigates on to the page that was asked for. replace(): the pause page must not stay in the history. */
function goOn() {
  try {
    sessionStorage.removeItem(COUNTED_KEY);
  } catch {
    /* private mode */
  }
  location.replace(target);
}

/** Emergency exit for a dead background: remove the pause rules (ids 200–299) so the person is not bounced back. */
async function liftPauseRules() {
  try {
    const rules = await AP.api.declarativeNetRequest.getDynamicRules();
    const ids = rules.map((r) => r.id).filter((id) => id >= 200 && id < 300);
    if (ids.length > 0) await AP.api.declarativeNetRequest.updateDynamicRules({ removeRuleIds: ids });
  } catch {
    /* nothing more to try */
  }
}

async function continueToSite() {
  if (leaving || state !== 'choosing') return;
  leaving = true;
  els.go.disabled = true;
  setMinutesDisabled(true);
  els.close.disabled = true;
  els.go.textContent = 'Opening…';
  syncMinutes();
  setNote('');
  let res;
  try {
    res = await AP.msg.send(T.PAUSE_CONTINUE, { siteKey, minutes: Number(els.minutes.value), intention: els.intention.value });
  } catch {
    res = { ok: false, error: 'failed' };
  }
  // The background has removed the pause rule before it answered, so the load below is not paused
  // again. If it did not answer at all, go on anyway: the person must never be trapped here.
  // ("blocked": a focus block started meanwhile; loading the site lets the block rule show its page.)
  if (res?.ok || ['no-receiver', 'context-invalidated', 'blocked'].includes(res?.error)) {
    // With no answer the pause rule is still in place and would send the load straight back here;
    // this page can lift it itself (the next time the background runs it puts the right rules back).
    if (!res?.ok && res?.error !== 'blocked') await liftPauseRules();
    goOn();
    return;
  }
  leaving = false;
  els.go.textContent = 'Continue for';
  syncMinutes();
  setState('choosing');
  setNote('That did not work. Please try again.');
}

// ---------------------------------------------------------------------------------------
// A session that is already running
// ---------------------------------------------------------------------------------------

let sessionTimer = null;

function showSession(until) {
  cancelBreath();
  const left = Math.max(1, Math.ceil((until - Date.now()) / 60_000));
  els.sessionLine.textContent = `${siteLabel} is open for ${left === 1 ? 'one more minute' : `${left} more minutes`}.`;
  els.sessionGo.textContent = `Continue to ${siteLabel}`;
  els.sessionClose.textContent = `Close ${siteLabel}`;
  setState('session');
  clearInterval(sessionTimer);
  sessionTimer = setInterval(() => {
    if (Date.now() >= until) location.reload(); // the session ended: start over with a fresh breath
    else showSessionText(until);
  }, 15_000);
  els.sessionGo.focus({ preventScroll: true });
}

function showSessionText(until) {
  const left = Math.max(1, Math.ceil((until - Date.now()) / 60_000));
  els.sessionLine.textContent = `${siteLabel} is open for ${left === 1 ? 'one more minute' : `${left} more minutes`}.`;
}

/** A session may start in another tab while this one is breathing: switch to "continue" at once. */
function watchSessions() {
  AP.api.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local' || !changes.state || !siteKey) return;
    const { sessions } = await AP.state.getState();
    const until = sessions[siteKey];
    const running = typeof until === 'number' && until > Date.now();
    if (running && state !== 'session' && !leaving) showSession(until);
    else if (!running && state === 'session') location.reload();
  });
}

// ---------------------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------------------

/** "15 minutes" → "15 min", "1 hour" → "1 h": short enough for a row of five. */
const shortMinutes = (label) => label.replace(/ minutes?$/, ' min').replace(/ hours?$/, ' h');

function buildMinutes(settings) {
  const def = AP.schema.get('pause.sessionMinutes');
  els.minutes.replaceChildren(...def.options.map((o) => h('option', { value: o.value }, o.label)));
  els.minutes.value = String(settings['pause.sessionMinutes']);
  els.minutesSeg.replaceChildren(
    ...def.options.map((o) =>
      h(
        'button',
        {
          type: 'button',
          dataset: { value: o.value },
          'aria-pressed': 'false',
          'aria-label': o.label,
          onClick: () => {
            els.minutes.value = o.value;
            syncMinutes();
          },
        },
        shortMinutes(o.label),
      ),
    ),
  );
  els.minutes.addEventListener('change', syncMinutes);
  syncMinutes();
}

async function main() {
  els.dial.prepend(AP.ui.dial().svg);
  els.target.textContent = RAW_TARGET;
  let settings;
  try {
    settings = await AP.settings.effective();
  } catch {
    settings = AP.schema.defaults(); // storage hiccup: the defaults still make a working page
  }
  AP.ui.watchTheme(settings);

  const url = parseTarget(RAW_TARGET);
  siteKey = url ? AP.state.siteKeyForUrl(url, settings['pause.sites']) : null;
  els.invalidClose.addEventListener('click', turnBack);
  if (!url || !siteKey) {
    setState('invalid');
    return;
  }
  target = url.href;
  siteLabel = labelFor(siteKey, settings['pause.sites']);
  els.close.textContent = `Close ${siteLabel}`;
  document.getElementById('question').textContent = `Open ${siteLabel}?`;
  setKicker();
  buildMinutes(settings);
  els.intentionWrap.hidden = settings['pause.askIntention'] !== true;

  els.close.addEventListener('click', turnBack);
  els.go.addEventListener('click', continueToSite);
  els.sessionGo.addEventListener('click', goOn);
  els.sessionClose.addEventListener('click', turnBack);
  els.intention.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !els.go.disabled) continueToSite();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented || state === 'loading' || state === 'invalid') return;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target?.tagName)) return;
    turnBack();
  });
  document.addEventListener('visibilitychange', onVisibility);
  watchSessions();

  // Tell the background (counts the visit, answers how long to breathe). A reload of this very page
  // is not a new visit: sessionStorage remembers it for this tab only.
  let repeat = false;
  try {
    repeat = sessionStorage.getItem(COUNTED_KEY) === target;
  } catch {
    /* private mode: every load counts */
  }
  let info;
  try {
    info = await AP.msg.send(T.PAUSE_OPENED, { siteKey, repeat });
  } catch {
    info = { ok: false };
  }
  if (info?.ok) {
    try {
      sessionStorage.setItem(COUNTED_KEY, target);
    } catch {
      /* private mode */
    }
  }
  if (info?.sessionUntil > Date.now()) {
    showSession(info.sessionUntil);
    return;
  }
  breathSeconds = info?.ok && info.breathSeconds > 0 ? info.breathSeconds : settings['pause.breathSeconds'];
  if (settings['pause.showCount'] && info?.ok && info.opens > 0) {
    els.countLine.textContent = `This is your ${ordinal(info.opens)} time opening ${siteLabel} today.`;
    els.countLine.hidden = false;
    countKicker = `${ordinal(info.opens)} time today`;
  }

  document.body.dataset.breath = String(breathSeconds); // how long this breath lasts (also a handle for tests)
  setState('breathing');
  if (document.visibilityState === 'visible') startBreath();
}

main().catch((err) => {
  AP.warn('pause page failed to start', err);
  // Never a dead end: fall back to the plain choice.
  setState('invalid');
});
