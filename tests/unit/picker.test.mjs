// The element picker's selector core (src/content/picker.js, "Part 1"): which hooks it trusts, how it
// anchors a selector, what it refuses. The page UI (hover box, panel, saving) needs a real browser and
// is exercised in tests/e2e/picker.spec.mjs and tests/firefox/picker.mjs.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadAtPeace, installFakeBrowser, uninstallFakeBrowser, CORE_SCRIPTS, SCHEMA_SCRIPTS } from './_load.mjs';
import { MiniDocument, el } from './_mini-dom.mjs';

let AP;
let core;

beforeEach(async () => {
  installFakeBrowser();
  AP = await loadAtPeace([
    ...CORE_SCRIPTS,
    ...SCHEMA_SCRIPTS,
    'src/sites/youtube/page.js',
    'src/content/picker.js',
    'src/pages/options/renderers/registry.js',
    'src/pages/options/renderers/custom-rules.js',
  ]);
  core = AP.picker.selector;
});
afterEach(() => uninstallFakeBrowser());

const box = (left, top, width, height) => ({ left, top, width, height });

/**
 * A watch page in miniature: the frame (ytd-app > #content > ytd-page-manager > ytd-watch-flexy), the
 * player column with a merch shelf, like/share buttons and two owner buttons, and the related list.
 */
function watchPage() {
  const doc = new MiniDocument({ width: 1280, height: 800 });
  const card = (n, extra = {}) =>
    el(
      doc,
      'yt-lockup-view-model',
      extra,
      [
        el(doc, 'div', { class: 'ytLockupViewModelHost ytLockupViewModelHorizontal' }, [
          el(doc, 'a', { class: 'ytLockupViewModelContentImage', href: `/watch?v=vid${n}` }, [el(doc, 'img', {}, [], box(900, 100 + n * 100, 168, 94))]),
          el(doc, 'div', { class: 'ytLockupViewModelMetadata' }, [el(doc, 'span', { class: 'ytAttributedStringHost', 'aria-label': `Title ${n}` })]),
        ], box(900, 100 + n * 100, 360, 94)),
      ],
      box(900, 100 + n * 100, 360, 94),
    );
  const named = {
    merch: el(doc, 'ytd-merch-shelf-renderer', { 'aria-label': 'Merch' }, [], box(60, 700, 800, 80)),
    like: el(doc, 'yt-button-view-model', {}, [], box(60, 600, 90, 36)),
    share: el(doc, 'yt-button-view-model', {}, [], box(160, 600, 90, 36)),
    join: el(doc, 'ytd-button-renderer', {}, [], box(500, 560, 80, 36)),
    subscribe: el(doc, 'ytd-button-renderer', {}, [], box(600, 560, 100, 36)),
    signIn: el(doc, 'ytd-button-renderer', {}, [], box(1100, 10, 80, 36)),
    cards: [1, 2, 3, 4].map((n) => card(n)),
    generated: el(doc, 'div', { id: 'a1b2c3d4e5f6', class: 'ytCustomThing' }, [], box(60, 650, 300, 30)),
    onlyAria: el(doc, 'div', { 'aria-label': 'Share', class: 'style-scope ytd-foo' }, [], box(60, 690, 20, 20)),
    shortsLink: el(doc, 'a', { href: '/shorts/abcdefghijk' }, [], box(60, 20, 50, 50)),
  };
  named.columns = el(doc, 'div', { id: 'columns' }, [
    el(doc, 'div', { id: 'primary' }, [
      el(doc, 'div', { id: 'player' }, [], box(60, 20, 800, 450)),
      el(doc, 'div', { id: 'below' }, [
        named.merch,
        el(doc, 'ytd-watch-metadata', {}, [el(doc, 'div', { id: 'actions' }, [el(doc, 'div', { id: 'top-level-buttons-computed' }, [named.like, named.share])])]),
        el(doc, 'div', { id: 'sponsor-button' }, [named.join]),
        el(doc, 'div', { id: 'subscribe-button' }, [named.subscribe]),
        named.generated,
        named.onlyAria,
        named.shortsLink,
      ]),
    ], box(40, 0, 840, 780)),
    el(doc, 'div', { id: 'secondary' }, [
      el(doc, 'div', { id: 'related' }, [el(doc, 'ytd-item-section-renderer', {}, [el(doc, 'div', { id: 'contents' }, named.cards)])], box(880, 80, 400, 700)),
    ], box(880, 0, 400, 800)),
  ]);
  named.flexy = el(doc, 'ytd-watch-flexy', {}, [named.columns], box(0, 56, 1280, 744));
  named.manager = el(doc, 'ytd-page-manager', { id: 'page-manager' }, [named.flexy], box(0, 56, 1280, 744));
  named.masthead = el(doc, 'ytd-masthead', {}, [el(doc, 'div', { id: 'buttons' }, [named.signIn])], box(0, 0, 1280, 56));
  named.content = el(doc, 'div', { id: 'content' }, [named.masthead, named.manager], box(0, 0, 1280, 800));
  named.app = el(doc, 'ytd-app', {}, [named.content], box(0, 0, 1280, 800));
  doc.body.append(named.app);
  return { doc, ...named };
}

const ok = (res) => {
  assert.equal(res.ok, true, res.message);
  return res;
};

describe('ids that look generated are never used', () => {
  test('machine-made ids', () => {
    for (const id of [':r1:', ':R5ab:', 'ember1234', 'a1b2c3d4e5f6', '9lives', 'deadbeefcafe', 'x-3fa91c0b72de', 'item_5f0e8a1c', '1234', 'f47ac10b-58cc-4372-a567-0e02b2c3d479', 'Zk9xQ2pLm1', 'has space', 'bad.dot', '']) {
      assert.equal(core.looksGeneratedId(id), true, id);
    }
  });
  test('names a person or YouTube would write are fine', () => {
    for (const id of ['related', 'secondary', 'top-level-buttons-computed', 'movie_player', 'sponsor-button', 'guide-renderer', 'chips-wrapper', 'h1', 'player-container-inner']) {
      assert.equal(core.looksGeneratedId(id), false, id);
      assert.equal(core.isStableId(id), true, id);
    }
  });
});

describe('which classes count', () => {
  test('view-model and player classes are stable', () => {
    for (const c of ['ytLockupViewModelHost', 'ytGridShelfViewModelHost', 'shortsLockupViewModelHostEndpoint', 'ytAttributedStringHost', 'ytp-endscreen-content', 'ytp-ce-element']) {
      assert.equal(core.isStableClass(c), true, c);
    }
  });
  test('scope markers, utility classes, state and hashes are not', () => {
    for (const c of ['style-scope', 'ytd-watch-flexy', 'yt-simple-endpoint', 'yt-spec-button-shape-next', 'active', 'selected', 'ytp-autohide', 'ytp-big-mode', 'ytp-hide-info-bar', 'ytp-fullscreen', 'content-id-dQw4w9WgXcQ', 'css-1x2y3z', 'abc', 'ytpPlayer12345']) {
      assert.equal(core.isStableClass(c), false, c);
    }
  });
});

describe('component tags and link prefixes', () => {
  test('custom elements are components; plumbing and plain tags are not', () => {
    for (const t of ['ytd-merch-shelf-renderer', 'yt-lockup-view-model', 'ytm-shorts-lockup-view-model', 'ytw-pinned-comment-badge-renderer', 'tp-yt-paper-tab', 'grid-shelf-view-model', 'badge-shape']) {
      assert.equal(core.isComponentTag(t), true, t);
    }
    for (const t of ['div', 'a', 'span', 'dom-if', 'dom-repeat', 'ps-dom-if', 'iron-iconset-svg', 'custom-style', 'font-face', 'YTD']) {
      assert.equal(core.isComponentTag(t), false, t);
    }
  });
  test('hrefPrefix keeps the part that says what kind of link it is', () => {
    assert.equal(core.hrefPrefix('/shorts/abc123'), '/shorts/');
    assert.equal(core.hrefPrefix('https://www.youtube.com/shorts/abc123'), '/shorts/');
    assert.equal(core.hrefPrefix('/feed/subscriptions?x=1'), '/feed/subscriptions');
    assert.equal(core.hrefPrefix('/@mrbeast'), '/@');
    assert.equal(core.hrefPrefix('/watch?v=abc&list=PL1'), '/watch');
    assert.equal(core.hrefPrefix('https://example.com/shorts/abc'), null);
    assert.equal(core.hrefPrefix('/something-else'), null);
    assert.equal(core.hrefPrefix(null), null);
  });
});

describe('selectors the picker builds', () => {
  test('a singleton component is just its tag', () => {
    const { merch } = watchPage();
    const res = ok(core.generate(merch));
    assert.equal(res.selector, 'ytd-merch-shelf-renderer');
    assert.equal(res.count, 1);
    assert.equal(res.similar, false);
    assert.equal(res.label, 'ytd-merch-shelf-renderer');
  });

  test('a repeated item matches all of its kind: "similar items" are everything the selector matches', () => {
    const { cards } = watchPage();
    const res = ok(core.generate(cards[1]));
    assert.equal(res.selector, 'yt-lockup-view-model');
    assert.equal(res.count, 4);
    assert.equal(res.similar, true);
    assert.deepEqual(res.matches, cards);
  });

  test('a widget used all over the page gets the ancestor that says where it is', () => {
    const { join, subscribe, signIn } = watchPage();
    assert.equal(ok(core.generate(join)).selector, '#sponsor-button ytd-button-renderer');
    assert.equal(ok(core.generate(subscribe)).selector, '#subscribe-button ytd-button-renderer');
    assert.equal(ok(core.generate(signIn)).selector, 'ytd-masthead ytd-button-renderer');
  });

  test('siblings of one container count as alike, so the bare tag is enough', () => {
    const { like } = watchPage();
    const res = ok(core.generate(like));
    assert.equal(res.selector, 'yt-button-view-model');
    assert.equal(res.count, 2);
  });

  test('a unique, readable id is a fine hook; a generic one needs an ancestor', () => {
    const { doc } = watchPage();
    const related = doc.querySelectorAll('#related')[0];
    assert.equal(ok(core.generate(related)).selector, '#related');
    const contents = doc.querySelectorAll('#contents')[0];
    assert.equal(ok(core.generate(contents)).selector, 'ytd-item-section-renderer #contents');
  });

  test('generated ids are skipped for the next best hook; aria-labels and style-scope never count', () => {
    const { generated, onlyAria } = watchPage();
    const res = ok(core.generate(generated));
    assert.equal(res.selector, '.ytCustomThing');
    assert.ok(!/a1b2/.test(res.selector));
    const refused = core.generate(onlyAria);
    assert.equal(refused.ok, false);
    assert.equal(refused.reason, 'no-hook');
    assert.match(refused.message, /steady way/);
  });

  test('links are picked by where they lead, never by their text', () => {
    const { shortsLink } = watchPage();
    assert.equal(ok(core.generate(shortsLink)).selector, 'a[href^="/shorts/"]');
  });

  test('an attribute joins the compound only when it tells this element from lookalikes', () => {
    const doc = new MiniDocument();
    const slim = el(doc, 'ytd-rich-item-renderer', { 'is-slim-media': '', lockup: 'true' });
    const wide1 = el(doc, 'ytd-rich-item-renderer', { lockup: 'true' });
    const wide2 = el(doc, 'ytd-rich-item-renderer', { lockup: 'true' });
    doc.body.append(el(doc, 'div', { id: 'grid-contents' }, [slim, wide1, wide2]));
    assert.equal(ok(core.generate(slim)).selector, 'ytd-rich-item-renderer[is-slim-media]');
    assert.equal(ok(core.generate(wide1)).selector, 'ytd-rich-item-renderer', 'every card has lockup, so it adds nothing');
    // When every card has the attribute it adds nothing and is left out.
    const doc2 = new MiniDocument();
    const a = el(doc2, 'ytd-rich-item-renderer', { lockup: 'true' });
    doc2.body.append(el(doc2, 'div', {}, [a, el(doc2, 'ytd-rich-item-renderer', { lockup: 'true' })]));
    assert.equal(ok(core.generate(a)).selector, 'ytd-rich-item-renderer');
  });

  test('our own bridge tags are language-free hooks', () => {
    const doc = new MiniDocument();
    const share = el(doc, 'yt-button-view-model', { 'data-at-peace-action': 'share' });
    doc.body.append(el(doc, 'div', { id: 'top-level-buttons-computed' }, [el(doc, 'yt-button-view-model', { 'data-at-peace-action': 'like' }), share]));
    assert.equal(ok(core.generate(share)).selector, 'yt-button-view-model[data-at-peace-action="share"]');
  });

  test('selectors never contain text, aria, or nth-child unless asked for', () => {
    const page = watchPage();
    for (const target of [page.merch, page.like, page.join, page.cards[0], page.generated, page.shortsLink]) {
      const sel = ok(core.generate(target)).selector;
      assert.ok(!/aria|nth-child|text/i.test(sel), sel);
      assert.ok(AP.schema.isSafeSelector(sel), sel);
      assert.ok(page.doc.querySelectorAll(sel).includes(target), `${sel} matches the picked element`);
    }
  });
});

describe('"Only this one" (position-based, last resort)', () => {
  test('uses :nth-child only when nothing else tells the element apart', () => {
    const { like, share, doc } = watchPage();
    const res = ok(core.generate(share, { unique: true }));
    assert.equal(res.unique, true);
    assert.equal(res.count, 1);
    assert.deepEqual(doc.querySelectorAll(res.selector), [share]);
    assert.match(res.selector, /:nth-child\(2\)$/);
    assert.notEqual(res.selector, ok(core.generate(like, { unique: true })).selector);
  });

  test('prefers a plain selector when one is already unique', () => {
    const { merch } = watchPage();
    const res = ok(core.generate(merch, { unique: true }));
    assert.equal(res.selector, 'ytd-merch-shelf-renderer');
    assert.equal(res.unique, false);
  });
});

describe('what is refused', () => {
  test('the page frame, whatever the viewport says', () => {
    const { doc, app, content, manager } = watchPage();
    for (const target of [doc.documentElement, doc.body, app, content, manager]) {
      const res = core.generate(target);
      assert.equal(res.ok, false);
      assert.equal(res.reason, 'protected');
      assert.match(res.message, /page itself/);
    }
  });

  test('anything that would cover more than 60% of the viewport', () => {
    const { flexy, doc } = watchPage();
    const res = core.generate(flexy);
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'too-big');
    assert.match(res.message, /most of the page/);
    // The same element in a much bigger viewport is fine (1200x744 of 4000x3000 is 7%).
    assert.equal(core.generate(flexy, { viewport: { width: 4000, height: 3000 } }).ok, true);
    // And ONE huge match among small ones refuses the whole selector.
    const cards = doc.querySelectorAll('yt-lockup-view-model');
    cards[3].rect = box(0, 0, 1280, 800);
    assert.equal(core.generate(cards[0]).reason, 'too-big');
  });

  test('size is judged by what can show: a long column counts by its width, not by how far it scrolls', () => {
    assert.equal(core.viewportShare({ width: 400, height: 3000 }, { width: 1280, height: 800 }).toFixed(3), '0.313');
    assert.equal(core.viewportShare({ width: 850, height: 5000 }, { width: 1280, height: 800 }).toFixed(2), '0.66');
    assert.equal(core.viewportShare({ width: 2000, height: 2000 }, { width: 1280, height: 800 }), 1);
    assert.equal(core.viewportShare({ width: 10, height: 10 }, { width: 0, height: 0 }), 0, 'no viewport: nothing to compare with');
    const { related } = (() => {
      const page = watchPage();
      page.doc.querySelectorAll('#related')[0].rect = box(880, 80, 400, 5000); // far taller than the window
      return { related: page.doc.querySelectorAll('#related')[0] };
    })();
    assert.equal(ok(core.generate(related)).selector, '#related');
  });

  test('typed-in selectors get the same refusals, without the viewport', () => {
    for (const bad of ['html', 'body', 'ytd-app', 'ytd-page-manager', '#content', '#page-manager', ':root', '*', 'div', 'span:first-child', 'ytd-app > ytd-page-manager', 'body.dark', 'div > a', 'ytd-foo body']) {
      assert.ok(core.refuseSelectorText(bad), bad);
    }
    for (const good of ['ytd-merch-shelf-renderer', '#related', 'ytd-watch-flexy #secondary', 'a[href^="/shorts/"]', '.ytLockupViewModelHost', 'ytd-app ytd-masthead', 'ytd-rich-item-renderer:not([hidden])', 'div.thing']) {
      assert.equal(core.refuseSelectorText(good), null, good);
    }
  });
});

describe('Bigger / Smaller: the chain of choices', () => {
  test('from a title: its card, then the list, skipping anonymous wrappers; stops below the frame', () => {
    const { doc, cards } = watchPage();
    const title = cards[0].children[0].children[1].children[0];
    const { chain, stoppedAtFrame } = core.buildChain(title, doc);
    const labels = chain.map((d) => core.labelOf(d.el));
    assert.equal(stoppedAtFrame, true);
    // the span (class hook), then components/unique ids going up; the card's inner div is skipped as a plain wrapper
    assert.deepEqual(labels.slice(0, 3), ['.ytAttributedStringHost', 'yt-lockup-view-model', 'ytd-item-section-renderer']);
    assert.ok(labels.includes('#related'));
    assert.ok(labels.includes('ytd-watch-flexy'));
    assert.ok(!labels.includes('ytd-app') && !labels.includes('ytd-page-manager') && !labels.includes('#content'));
    assert.ok(!labels.includes('#contents'), 'generic ids are not waypoints');
  });

  test('a wrapper with exactly the same box as the step before it replaces it (hide the outer, leave no shell)', () => {
    const { doc, cards } = watchPage();
    const image = cards[0].children[0].children[0]; // a.ytLockupViewModelContentImage
    const { chain } = core.buildChain(image.children[0], doc); // from the <img>
    // img has no hook → the link (class) is the first step; the card is a component → next
    assert.equal(core.labelOf(chain[0].el), '.ytLockupViewModelContentImage');
    assert.equal(core.labelOf(chain[1].el), 'yt-lockup-view-model');
  });

  test('nothing to select on at all', () => {
    const doc = new MiniDocument();
    const lonely = el(doc, 'div', { 'aria-label': 'x' }, [el(doc, 'span')]);
    doc.body.append(lonely);
    const { chain, stoppedAtFrame } = core.buildChain(lonely.children[0], doc);
    assert.deepEqual(chain, []);
    assert.equal(stoppedAtFrame, true); // reached <body>
  });
});

describe('notes written for rules', () => {
  test('short, plain, scoped to the page kind', () => {
    assert.equal(core.noteFor('ytd-merch-shelf-renderer', 'watch'), 'Hid ytd-merch-shelf-renderer on watch pages');
    assert.equal(core.noteFor('#related', 'home'), 'Hid #related on the home page');
    assert.equal(core.noteFor('.x', null), 'Hid .x');
    assert.ok(core.noteFor('a'.repeat(400), 'watch').length <= 200);
  });
});

describe('wiring', () => {
  test('exports the public API and refuses to start without a document', () => {
    assert.equal(typeof AP.picker.start, 'function');
    assert.equal(typeof AP.picker.stop, 'function');
    assert.equal(AP.picker.isActive(), false);
    assert.deepEqual(AP.picker.start(), { ok: false, error: 'no-document' });
    assert.equal(AP.picker.inspect(), null);
  });

  test('answers START_PICKER through sendResponse (Chrome does not take a returned promise) and ignores other messages', async () => {
    const reply = await AP.api.runtime.sendMessage({ type: AP.msg.TYPES.START_PICKER });
    assert.deepEqual(reply, { ok: false, error: 'no-document' });
    assert.equal(await AP.api.runtime.sendMessage({ type: 'SOMETHING_ELSE' }), undefined, 'not ours: no answer');
  });
});

describe('the custom-rules editor (src/pages/options/renderers/custom-rules.js)', () => {
  const editor = () => AP.optionsRenderers['advanced.customRules'];

  test('is registered for the setting, with update() for live changes', () => {
    const def = AP.schema.get('advanced.customRules');
    assert.ok(def);
    assert.equal(AP.optionsRendererFor(def), editor());
    assert.equal(typeof editor().render, 'function');
    assert.equal(typeof editor().update, 'function');
  });

  test('offers exactly the YouTube page types the engine knows', () => {
    assert.deepEqual(editor().PAGES.map((p) => p.value), [...AP.yt.page.TYPES]);
    for (const p of editor().PAGES) assert.ok(p.label.length > 2, p.value);
  });

  test('refuses what the picker refuses, with the same words (the two copies must not drift apart)', () => {
    const samples = [
      'html', 'body', 'ytd-app', 'ytd-page-manager', '#content', '#page-manager', ':root', '*', 'div', 'span:first-child', 'ytd-app > ytd-page-manager',
      'body.dark', 'div > a', 'ytd-foo body', 'ytd-merch-shelf-renderer', '#related', 'ytd-watch-flexy #secondary', 'a[href^="/shorts/"]',
      '.ytLockupViewModelHost', 'ytd-app ytd-masthead', 'ytd-rich-item-renderer:not([hidden])', 'div.thing', 'ytd-foo >  ytd-bar', 'a[title="x > y"]',
    ];
    for (const selector of samples) {
      assert.equal(editor().refuseSelectorText(selector), core.refuseSelectorText(selector), selector);
    }
  });

  test('checkSelector: one valid, safe, specific selector; the browser is asked whether it parses', () => {
    const accepts = (s) => editor().checkSelector(s, () => {});
    assert.deepEqual(accepts('  ytd-merch-shelf-renderer  '), { ok: true, selector: 'ytd-merch-shelf-renderer' });
    assert.deepEqual(accepts('ytd-watch-flexy   #secondary'), { ok: true, selector: 'ytd-watch-flexy #secondary' }, 'whitespace is tidied');
    assert.deepEqual(accepts('ytd-foo[title="a, b"]'), { ok: true, selector: 'ytd-foo[title="a, b"]' }, 'a comma inside brackets is not a list');
    const refused = (s, probe) => editor().checkSelector(s, probe ?? (() => {}));
    assert.match(refused('').message, /Type a selector/);
    assert.match(refused('ytd-a, ytd-b').message, /one selector at a time/);
    assert.match(refused('div[', () => { throw new SyntaxError('bad'); }).message, /not a valid selector/);
    assert.match(refused('ytd-foo { display: none }', () => {}).message, /braces, semicolons/);
    assert.match(refused('ytd-foo /* hi */').message, /braces, semicolons|comments/);
    assert.match(refused('body').message, /page itself/);
    assert.match(refused('div').message, /too much/);
    // Whatever it accepts, the engine accepts too.
    assert.equal(AP.schema.isSafeSelector(accepts('ytd-foo[title="a, b"]').selector), true);
  });
});
