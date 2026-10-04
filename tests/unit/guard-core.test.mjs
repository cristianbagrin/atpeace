// The page-side guard (src/content/guard-core.js): decisions are pure, the controller and the
// heartbeat get a fake environment so no browser is needed.
import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { loadAtPeace, installFakeBrowser, uninstallFakeBrowser, CORE_SCRIPTS } from './_load.mjs';

let AP;
let G;

beforeEach(async () => {
  installFakeBrowser();
  AP = await loadAtPeace([...CORE_SCRIPTS, 'src/content/guard-core.js']);
  G = AP.guard;
  mock.method(console, 'warn', () => {});
});
afterEach(() => {
  mock.restoreAll();
  uninstallFakeBrowser();
});

const MIN = 60_000;
const T0 = 1_800_000_000_000;

describe('parseSnapshot', () => {
  test('garbage in, a safe empty snapshot out', () => {
    for (const junk of [undefined, null, 'x', { state: 'x', settings: [] }, {}]) {
      const s = G.parseSnapshot(junk);
      assert.deepEqual([s.sessions, s.blocks, s.sites, s.expiryOverlay, s.theme], [{}, [], [], true, 'light']);
    }
  });

  test('reads sessions, minutes, blocks (list or the single PLAN block), sites and the two settings it needs', () => {
    const s = G.parseSnapshot({
      state: {
        sessions: { youtube: 5, bad: 'x' },
        sessionMinutes: { youtube: 15, zero: 0 },
        blocks: [{ reason: 'focus', until: 9, siteKeys: ['youtube', 3] }, { until: 'x', siteKeys: [] }, 'x'],
      },
      settings: { 'pause.sites': [{ siteKey: 'a.com', domain: 'a.com' }, { siteKey: 1 }], 'pause.expiryOverlay': false, 'general.theme': 'dark' },
    });
    assert.deepEqual(s.sessions, { youtube: 5 });
    assert.deepEqual(s.sessionMinutes, { youtube: 15 });
    assert.deepEqual(s.blocks, [{ reason: 'focus', until: 9, siteKeys: ['youtube'] }]);
    assert.deepEqual(s.sites, [{ siteKey: 'a.com', domain: 'a.com' }]);
    assert.equal(s.expiryOverlay, false);
    assert.equal(s.theme, 'dark');
    const legacy = G.parseSnapshot({ state: { block: { until: 7, reason: 'limit', siteKeys: ['youtube'] } } });
    assert.deepEqual(legacy.blocks, [{ reason: 'limit', until: 7, siteKeys: ['youtube'] }]);
  });
});

describe('siteKeyForHost and blockFor', () => {
  const sites = [{ siteKey: 'reddit.com', domain: 'reddit.com' }, { siteKey: 'old.reddit.com', domain: 'old.reddit.com' }];

  test('domain and subdomains match; the longest domain wins; look-alikes do not', () => {
    assert.equal(G.siteKeyForHost('reddit.com', sites), 'reddit.com');
    assert.equal(G.siteKeyForHost('www.reddit.com', sites), 'reddit.com');
    assert.equal(G.siteKeyForHost('OLD.reddit.com.', sites), 'old.reddit.com');
    assert.equal(G.siteKeyForHost('notreddit.com', sites), null);
    assert.equal(G.siteKeyForHost('reddit.com.evil.example', sites), null);
  });

  test('blockFor ignores ended blocks and other sites', () => {
    const snap = { blocks: [{ reason: 'schedule', until: T0 + MIN, siteKeys: ['youtube'] }, { reason: 'focus', until: T0 + MIN, siteKeys: ['youtube'] }, { reason: 'focus', until: T0 - 1, siteKeys: ['x'] }] };
    assert.equal(G.blockFor(snap, 'youtube', T0).reason, 'focus');
    assert.equal(G.blockFor(snap, 'x', T0), null);
    assert.equal(G.blockFor(snap, 'youtube', T0 + MIN), null);
  });
});

describe('decide', () => {
  const snap = (state = {}) => G.parseSnapshot({ state, settings: {} });
  const memory = () => ({ knownUntil: null, knownMinutes: null });

  test('a block wins over everything', () => {
    const d = G.decide(snap({ sessions: { youtube: T0 + MIN }, blocks: [{ reason: 'focus', until: T0 + MIN, siteKeys: ['youtube'] }] }), 'youtube', T0, memory());
    assert.equal(d.type, 'block');
    assert.equal(d.block.reason, 'focus');
  });

  test('a running session, an ended one still in state, and no session at all', () => {
    assert.deepEqual(G.decide(snap({ sessions: { youtube: T0 + MIN } }), 'youtube', T0, memory()), { type: 'running', until: T0 + MIN });
    assert.deepEqual(G.decide(snap({ sessions: { youtube: T0 - 1 }, sessionMinutes: { youtube: 15 } }), 'youtube', T0, memory()), { type: 'expired', until: T0 - 1, minutes: 15 });
    assert.deepEqual(G.decide(snap(), 'youtube', T0, memory()), { type: 'idle' });
  });

  test('a session this page saw end and the background already removed: expired; removed early: cancelled', () => {
    const seen = { knownUntil: T0 - 100, knownMinutes: 5 };
    assert.deepEqual(G.decide(snap(), 'youtube', T0, seen), { type: 'expired', until: T0 - 100, minutes: 5 });
    const early = { knownUntil: T0 + 10 * MIN, knownMinutes: 5 };
    assert.deepEqual(G.decide(snap(), 'youtube', T0, early), { type: 'idle' });
    const justBefore = { knownUntil: T0 + 1000, knownMinutes: 5 };
    assert.equal(G.decide(snap(), 'youtube', T0, justBefore).type, 'expired', 'within the slack counts as ended');
  });

  test('titles', () => {
    assert.equal(G.expiryTitle(15), 'Your 15 minutes are up.');
    assert.equal(G.expiryTitle(1), 'Your 1 minute is up.');
    assert.equal(G.expiryTitle(null), 'Your time is up.');
  });
});

/** A guard wired to a fake world. */
function harness({ siteKey = 'youtube', state = {}, settings = {}, pauseMedia } = {}) {
  const log = { overlays: [], hidden: 0, navigations: [], closed: 0, paused: 0, keepPaused: [], reads: 0 };
  const timers = [];
  let now = T0;
  let stored = { state, settings };
  const listeners = { storage: [], wake: [] };
  const env = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const t = { fn, at: now + ms, live: true };
      timers.push(t);
      return t;
    },
    clearTimeout: (t) => {
      if (t) t.live = false;
    },
    read: async () => {
      log.reads++;
      return structuredClone(stored);
    },
    onStorageChange: (fn) => {
      listeners.storage.push(fn);
      return () => listeners.storage.splice(listeners.storage.indexOf(fn), 1);
    },
    onWake: (fn) => {
      listeners.wake.push(fn);
      return () => listeners.wake.splice(listeners.wake.indexOf(fn), 1);
    },
    urlFor: (p) => `ext://${p}`,
    pageUrl: () => 'https://www.youtube.com/watch?v=abc',
    navigate: (u) => log.navigations.push(u),
    closeTab: async () => {
      log.closed++;
      return { ok: true };
    },
    showOverlay: (spec) => log.overlays.push(spec),
    hideOverlay: () => log.hidden++,
    keepPaused: (on) => log.keepPaused.push(on),
  };
  const guard = G.create({ siteKey, siteName: 'YouTube', pauseMedia: pauseMedia ?? (() => log.paused++), env });
  return {
    guard,
    log,
    timers,
    setStored(next) {
      stored = next;
    },
    /** Advance the clock and run due timers (the way the page would). */
    async advance(ms) {
      now += ms;
      for (const t of timers.filter((x) => x.live && x.at <= now)) {
        t.live = false;
        t.fn();
      }
      await new Promise((r) => setImmediate(r));
    },
    async change(next) {
      stored = next;
      for (const fn of listeners.storage) fn();
      await new Promise((r) => setImmediate(r));
    },
    wake: async () => {
      for (const fn of listeners.wake) fn();
      await new Promise((r) => setImmediate(r));
    },
    now: () => now,
    listeners,
  };
}

describe('guard controller: session expiry', () => {
  test('waits for the end of the session, then pauses the media and shows the overlay with the right text', async () => {
    const h = harness({ state: { sessions: { youtube: T0 + 5 * MIN }, sessionMinutes: { youtube: 5 } } });
    await h.guard.start();
    assert.equal(h.log.overlays.length, 0);
    await h.advance(4 * MIN);
    assert.equal(h.log.overlays.length, 0);
    await h.advance(MIN + 100);
    assert.equal(h.log.overlays.length, 1);
    const [overlay] = h.log.overlays;
    assert.equal(overlay.title, 'Your 5 minutes are up.');
    assert.deepEqual(overlay.actions.map((a) => a.label), ['Leave YouTube', 'Take a breath']);
    assert.equal(overlay.actions[0].primary, true);
    assert.equal(h.log.paused, 1);
    assert.deepEqual(h.log.keepPaused, [true]);
  });

  test('Leave closes the tab; Take a breath goes to the pause page with this page in the hash', async () => {
    const h = harness({ state: { sessions: { youtube: T0 - 1 }, sessionMinutes: { youtube: 5 } } });
    await h.guard.start();
    const [leave, breath] = h.log.overlays[0].actions;
    await leave.onClick();
    assert.equal(h.log.closed, 1);
    assert.deepEqual(h.log.navigations, []);
    breath.onClick();
    assert.deepEqual(h.log.navigations, ['ext://src/pages/pause/pause.html#https://www.youtube.com/watch?v=abc']);
  });

  test('if the tab cannot be closed, Leave falls back to the pause page', async () => {
    const h = harness({ state: { sessions: { youtube: T0 - 1 } } });
    h.guard.start();
    await new Promise((r) => setImmediate(r));
    const env = h.log;
    void env;
    // rebuild with a failing closeTab
    const failing = G.create({
      siteKey: 'youtube',
      env: {
        now: () => T0,
        read: async () => ({ state: { sessions: { youtube: T0 - 1 } }, settings: {} }),
        onStorageChange: () => () => {},
        onWake: () => () => {},
        urlFor: (p) => `ext://${p}`,
        pageUrl: () => 'u',
        navigate: (u) => env.navigations.push(u),
        closeTab: async () => ({ ok: false, error: 'no-tab' }),
        showOverlay: (spec) => env.overlays.push(spec),
        hideOverlay: () => {},
        keepPaused: () => {},
      },
    });
    await failing.start();
    await env.overlays.at(-1).actions[0].onClick();
    assert.equal(env.navigations.at(-1), 'ext://src/pages/pause/pause.html#u');
  });

  test('when the background removes the ended session first, the page still shows the overlay', async () => {
    const h = harness({ state: { sessions: { youtube: T0 + 5 * MIN }, sessionMinutes: { youtube: 5 } } });
    await h.guard.start();
    await h.advance(5 * MIN + 100); // the end is reached…
    h.log.overlays.length = 0;
    await h.change({ state: {}, settings: {} }); // …and the background has removed the session
    assert.equal(h.log.overlays.length, 0, 'it was shown once already; no second overlay for the same session');
  });

  test('the background clearing the session at its end (before the page timer) shows the overlay', async () => {
    const h = harness({ state: { sessions: { youtube: T0 + 1000 }, sessionMinutes: { youtube: 5 } } });
    await h.guard.start();
    h.timers.forEach((t) => (t.live = false)); // the page timer has not fired yet…
    await h.advance(1000);
    await h.change({ state: {}, settings: {} }); // …when the background's alarm removes the session
    assert.equal(h.log.overlays.length, 1);
  });

  test('a session cancelled early (pause switched off) never shows an overlay', async () => {
    const h = harness({ state: { sessions: { youtube: T0 + 10 * MIN } } });
    await h.guard.start();
    await h.change({ state: {}, settings: {} });
    await h.advance(11 * MIN);
    assert.equal(h.log.overlays.length, 0);
  });

  test('the overlay is switched off by pause.expiryOverlay = false (the pause itself still comes back on the next load)', async () => {
    const h = harness({ state: { sessions: { youtube: T0 - 1 } }, settings: { 'pause.expiryOverlay': false } });
    await h.guard.start();
    assert.equal(h.log.overlays.length, 0);
    assert.equal(h.log.paused, 0);
  });

  test('a new session started elsewhere removes the overlay and re-arms the timer', async () => {
    const h = harness({ state: { sessions: { youtube: T0 - 1 }, sessionMinutes: { youtube: 5 } } });
    await h.guard.start();
    assert.equal(h.log.overlays.length, 1);
    await h.change({ state: { sessions: { youtube: T0 + 10 * MIN }, sessionMinutes: { youtube: 10 } }, settings: {} });
    assert.equal(h.log.hidden, 1);
    assert.deepEqual(h.log.keepPaused, [true, false]);
    await h.advance(10 * MIN + 100);
    assert.equal(h.log.overlays.length, 2);
    assert.equal(h.log.overlays[1].title, 'Your 10 minutes are up.');
  });

  test('a tab that was asleep (timers frozen) catches up when it wakes', async () => {
    const h = harness({ state: { sessions: { youtube: T0 + 5 * MIN } } });
    await h.guard.start();
    h.timers.forEach((t) => (t.live = false)); // the browser froze the page
    await h.advance(0);
    h.setStored({ state: { sessions: { youtube: T0 + 5 * MIN } }, settings: {} });
    await h.advance(30 * MIN);
    assert.equal(h.log.overlays.length, 0, 'frozen timers do not fire');
    await h.wake(); // visibilitychange / pageshow
    assert.equal(h.log.overlays.length, 1);
  });

  test('no entry and nothing known: idle, nothing shown', async () => {
    const h = harness();
    await h.guard.start();
    await h.advance(60 * MIN);
    assert.deepEqual(h.log.overlays, []);
    assert.deepEqual(h.log.navigations, []);
  });

  test('a media hook that throws does not stop the overlay', async () => {
    const h = harness({
      state: { sessions: { youtube: T0 - 1 } },
      pauseMedia: () => {
        throw new Error('player gone');
      },
    });
    await h.guard.start();
    assert.equal(h.log.overlays.length, 1);
  });

  test('stop() removes the overlay and the listeners', async () => {
    const h = harness({ state: { sessions: { youtube: T0 - 1 } } });
    await h.guard.start();
    h.guard.stop();
    assert.equal(h.log.hidden, 1);
    assert.deepEqual([h.listeners.storage.length, h.listeners.wake.length], [0, 0]);
  });
});

describe('guard controller: blocks', () => {
  const block = { reason: 'focus', until: T0 + 25 * MIN, siteKeys: ['youtube'] };

  test('a block that is already active sends the tab to the blocked page, with the reason and the page', async () => {
    const h = harness({ state: { blocks: [block] } });
    await h.guard.start();
    assert.deepEqual(h.log.navigations, ['ext://src/pages/blocked/blocked.html?reason=focus#https://www.youtube.com/watch?v=abc']);
    assert.equal(h.log.paused, 1, 'the video stops while the page leaves');
  });

  test('a block that starts while the page is open redirects at once (storage change)', async () => {
    const h = harness({ state: {} });
    await h.guard.start();
    assert.deepEqual(h.log.navigations, []);
    await h.change({ state: { blocks: [{ ...block, reason: 'schedule' }] }, settings: {} });
    assert.match(h.log.navigations[0], /\?reason=schedule#/);
    await h.change({ state: { blocks: [{ ...block, reason: 'schedule' }] }, settings: {} });
    assert.equal(h.log.navigations.length, 1, 'only once');
  });

  test('a block for another site, or one that has ended, does nothing', async () => {
    const h = harness({ state: { blocks: [{ ...block, siteKeys: ['reddit.com'] }, { ...block, until: T0 - 1 }] } });
    await h.guard.start();
    assert.deepEqual(h.log.navigations, []);
  });

  test('a block beats a running session', async () => {
    const h = harness({ state: { sessions: { youtube: T0 + MIN }, blocks: [block] } });
    await h.guard.start();
    assert.equal(h.log.navigations.length, 1);
    assert.equal(h.log.overlays.length, 0);
  });
});

describe('guard controller: sites resolved from storage (user-added sites)', () => {
  test('resolveSiteKey runs on the first read; a page of an unconfigured site does nothing', async () => {
    const sites = [{ siteKey: 'reddit.com', domain: 'reddit.com' }];
    const log = { overlays: [] };
    const make = (host) =>
      G.create({
        siteName: host,
        resolveSiteKey: (s) => G.siteKeyForHost(host, s.sites),
        env: {
          now: () => T0,
          read: async () => ({ state: { sessions: { 'reddit.com': T0 - 1 } }, settings: { 'pause.sites': sites } }),
          onStorageChange: () => () => {},
          onWake: () => () => {},
          urlFor: (p) => p,
          pageUrl: () => 'u',
          navigate: () => {},
          closeTab: async () => ({ ok: true }),
          showOverlay: (spec) => log.overlays.push(spec),
          hideOverlay: () => {},
          keepPaused: () => {},
        },
      });
    const mine = make('www.reddit.com');
    await mine.start();
    assert.equal(mine.siteKey(), 'reddit.com');
    assert.equal(log.overlays.length, 1);
    assert.equal(log.overlays[0].actions[0].label, 'Leave www.reddit.com');
    const other = make('example.org');
    await other.start();
    assert.equal(other.siteKey(), null);
    assert.equal(log.overlays.length, 1);
  });

  test('a storage read that fails (extension reloaded) is quiet', async () => {
    const guard = G.create({
      siteKey: 'youtube',
      env: { read: async () => Promise.reject(new Error('Extension context invalidated.')), onStorageChange: () => () => {}, onWake: () => () => {} },
    });
    await guard.start();
    assert.equal(guard.peek(), null);
  });
});

describe('heartbeat', () => {
  function beat({ visible = true, active = true } = {}) {
    const state = { visible, active, sent: 0, now: T0, interval: null, visListener: null };
    const hb = G.createHeartbeat({
      siteKey: 'youtube',
      env: {
        now: () => state.now,
        visible: () => state.visible,
        active: () => state.active,
        send: async () => {
          state.sent++;
        },
        every: (fn, ms) => {
          state.interval = { fn, ms };
          return state.interval;
        },
        stopEvery: (h) => {
          if (state.interval === h) state.interval = null;
        },
        onVisibility: (fn) => {
          state.visListener = fn;
          return () => (state.visListener = null);
        },
      },
    });
    return { hb, state };
  }

  test('ticks every 30 s while visible; sends only when the window has focus or media plays', () => {
    const { hb, state } = beat();
    hb.start();
    assert.equal(state.interval.ms, 30_000);
    state.interval.fn();
    assert.equal(state.sent, 1);
    state.now += 30_000;
    state.active = false; // neither focus nor playing
    state.interval.fn();
    assert.equal(state.sent, 1);
    state.active = true;
    state.interval.fn();
    assert.equal(state.sent, 2);
  });

  test('never more often than every 25 s, however often it is nudged', () => {
    const { hb, state } = beat();
    hb.start();
    for (const dt of [0, 5_000, 10_000, 24_999]) {
      state.now = T0 + dt;
      hb.tick();
    }
    assert.equal(state.sent, 1);
    state.now = T0 + 25_000;
    hb.tick();
    assert.equal(state.sent, 2);
  });

  test('stops with the tab: no timer while hidden, one again when it comes back; hidden ticks send nothing', () => {
    const { hb, state } = beat();
    hb.start();
    state.visible = false;
    state.visListener();
    assert.equal(state.interval, null);
    hb.tick();
    assert.equal(state.sent, 0);
    state.visible = true;
    state.visListener();
    assert.ok(state.interval);
    hb.stop();
    assert.equal(state.interval, null);
    assert.equal(state.visListener, null);
  });

  test('a tab that starts hidden does not start a timer', () => {
    const { hb, state } = beat({ visible: false });
    hb.start();
    assert.equal(state.interval, null);
  });
});
