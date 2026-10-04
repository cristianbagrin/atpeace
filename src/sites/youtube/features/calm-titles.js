// Calm titles (yt.general.calmTitles = sentence): SHOUTING words in video titles become normal text.
//
//   "I TRIED THE WORLD'S HOTTEST CHILI | NASA reacts" → "I tried the world's hottest chili | NASA reacts"
//
// Which words count as shouting (calmCase below, unit-tested):
//   - at least two letters, every letter uppercase, no digits ("4K", "PS5", "RTX4090" stay);
//   - not on the acronym allowlist (USA, NASA, AI, TV, UK, EU, NBA, DIY, PC, HD …);
//   - a SHORT word (2-3 letters: "ABC", "MIT", "BBC", "NEW", "WOW") is only lowered when it is a known shouty
//     English word, or when the title as a whole is mostly capitals, because short capitals are far
//     more often acronyms than shouting.
// The first word of the title (and of each sentence) keeps a capital letter. Everything else about a
// title is left alone: punctuation, emoji, spacing and the case of every ordinary word.
//
// The original text is kept in `data-at-peace-original` on the element (the title text lives in a
// `yt-formatted-string`/`span`, and cards also carry the full original in their `title` attribute), and
// is put back when the setting is turned off.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;

  const ID = 'yt.general.calmTitles';
  const ORIGINAL = 'data-at-peace-original';

  // ---- conversion (pure, unit-tested) -------------------------------------------------------------------------

  /** Acronyms, initialisms and names that are written in capitals on purpose. */
  const KEEP = new Set(
    (
      'AI AR VR XR TV PC UK US USA EU UN UAE NATO NASA ESA FBI CIA NSA NYC LA DC SF ' +
      'NBA NFL NHL MLB MLS UFC WWE FIFA UEFA NCAA IPL WNBA NASCAR WWF ' +
      'DIY FAQ ASMR AMA ELI5 TIL CEO CFO CTO PR HR IT QA ' +
      'CPU GPU RAM ROM SSD HDD USB LED LCD OLED QLED HD UHD FHD HDR FPS RPG MMO MMORPG DLC GTA NPC AMD ' +
      'BBC CNN NBC ABC CBS HBO MTV ESPN BMW IBM MIT UCLA NYU MIT ' +
      'OK DJ MC MP3 MP4 GIF PDF PNG JPEG HTML CSS SQL API SDK URL ' +
      'II III IV VI VII VIII IX XI XII XIII ' +
      'USB-C PS PSP NES SNES N64 PSVR'
    ).split(' '),
  );

  /** Short English words that are shouting, not acronyms, when written in capitals. */
  const SHOUTY_SHORT = new Set(
    'THE AND BUT FOR YOU YOUR ALL ARE NOT NOW NEW WOW OMG WHY HOW WHO WHAT HAS HAD HIS HER ITS OUT OFF CAN DID GOT GET HOT TOP BIG BAD SAD MAD ONE TWO TEN WAY DAY MAN BOY ANY SEE SAY OLD OWN TRY USE WAS LOL WTF'
      .split(' '),
  );

  const LETTER = /\p{L}/u;
  const UPPER = /\p{Lu}/u;
  const LOWER = /\p{Ll}/u;
  /** A "word": letters, digits and apostrophes/hyphens inside it ("DON'T", "ANTI-WAR"). */
  const WORD = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;

  function isMostlyCapitals(text) {
    let upper = 0;
    let lower = 0;
    for (const ch of text) {
      if (UPPER.test(ch)) upper++;
      else if (LOWER.test(ch)) lower++;
    }
    return upper + lower >= 4 && upper / (upper + lower) >= 0.7;
  }

  /** Sentence case for the SHOUTING words of a title; every other character is returned untouched. */
  function calmCase(text) {
    if (typeof text !== 'string' || text === '') return text;
    const shouty = isMostlyCapitals(text);
    let sentenceStart = true;
    let last = 0;
    let out = '';
    for (const m of text.matchAll(WORD)) {
      const word = m[0];
      const between = text.slice(last, m.index);
      // A sentence ends at ". ", "! ", "? " or a line break (not at ":" or "-" or "|": titles continue there).
      if (/[.!?…]\s*$/.test(between) || /\n/.test(between)) sentenceStart = true;
      out += between;
      last = m.index + word.length;

      let converted = word;
      if (shoutingWord(word, shouty)) {
        converted = word.toLowerCase();
        // "I'M" → "I'm", "I'LL" → "I'll": the pronoun keeps its capital.
        if (/^i['’]/i.test(word)) converted = `I${converted.slice(1)}`;
      }
      if (sentenceStart && LETTER.test(converted)) {
        converted = converted.replace(LETTER, (c) => c.toUpperCase());
        sentenceStart = false;
      } else if (LETTER.test(word)) {
        sentenceStart = false;
      }
      out += converted;
    }
    return out + text.slice(last);
  }

  /** Is this word one of the shouting ones? (See the rules in the header.) */
  function shoutingWord(word, shouty) {
    if (/\p{N}/u.test(word)) return false;
    const parts = word.split(/['’-]/).filter(Boolean);
    const letters = [...word].filter((c) => LETTER.test(c));
    if (letters.length < 2) return false;
    if (letters.some((c) => !UPPER.test(c) || LOWER.test(c))) return false; // not all capitals (also rejects caseless scripts)
    if (parts.length === 1 && KEEP.has(word)) return false;
    if (parts.length > 1 && parts.every((p) => KEEP.has(p))) return false;
    if (parts.length === 1 && letters.length <= 3) return shouty || SHOUTY_SHORT.has(word);
    return true;
  }

  // ---- applying it to the page ---------------------------------------------------------------------------------

  /** The elements whose text IS the title (text lives directly in them, not in a link around them). */
  const TITLE_SELECTOR = [
    'a#video-title yt-formatted-string', // search results, legacy cards
    'a#video-title-link yt-formatted-string', // legacy rich-grid cards
    'yt-formatted-string#video-title', // queue panel, legacy sidebar
    'a.ytLockupMetadataViewModelTitle .ytAttributedStringHost', // current cards (home, sidebar, playlist, channel)
    '.shortsLockupViewModelHostMetadataTitle .ytAttributedStringHost', // Shorts cards
    'ytd-watch-metadata h1 yt-formatted-string', // the video's own title
  ].join(',');

  /** What each converted element showed after our change (to tell our text from a later rewrite by YouTube). */
  const converted = new WeakMap();

  function textNodesOf(el) {
    const nodes = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
    return nodes;
  }

  /** Replaces the element's text with `next`, keeping the node structure (only equal-length rewrites are possible). */
  function setText(el, next) {
    const nodes = textNodesOf(el);
    const current = nodes.map((n) => n.nodeValue).join('');
    if (current.length !== next.length || nodes.length === 0) return false;
    let at = 0;
    for (const node of nodes) {
      node.nodeValue = next.slice(at, at + node.nodeValue.length);
      at += node.nodeValue.length;
    }
    return true;
  }

  const textOf = (el) => textNodesOf(el).map((n) => n.nodeValue).join('');

  function calm(el) {
    const text = textOf(el);
    if (text === '' || converted.get(el) === text) return; // empty, or already our version
    const next = calmCase(text);
    if (next === text) {
      el.removeAttribute(ORIGINAL);
      converted.delete(el);
      return;
    }
    if (setText(el, next)) {
      el.setAttribute(ORIGINAL, text);
      converted.set(el, next);
    }
  }

  function scan(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.matches?.(TITLE_SELECTOR)) calm(root);
    const inner = root.closest?.(TITLE_SELECTOR);
    if (inner && inner !== root) calm(inner);
    if (root.querySelectorAll) for (const el of root.querySelectorAll(TITLE_SELECTOR)) calm(el);
  }

  function restoreAll() {
    for (const el of document.querySelectorAll(`[${ORIGINAL}]`)) {
      const original = el.getAttribute(ORIGINAL);
      // Only put the old text back over OUR text; if YouTube rewrote the title meanwhile, leave it.
      if (converted.get(el) === textOf(el)) setText(el, original);
      el.removeAttribute(ORIGINAL);
      converted.delete(el);
    }
  }

  let current = null; // ctx
  const isOn = (ctx) => ctx.settings?.[ID] === 'sentence';
  let lateTimer = null;
  /** The text of a title often arrives a moment after its element: one more pass shortly after each batch. */
  function later() {
    if (lateTimer !== null) return;
    lateTimer = setTimeout(() => {
      lateTimer = null;
      if (current && isOn(current)) scan(document.documentElement);
    }, 600);
  }

  AP.yt.features.push({
    id: 'calm-titles',
    settings: [ID],
    observes: true,
    isActive: isOn,
    init(ctx) {
      current = ctx;
    },
    onNavigate(ctx) {
      current = ctx;
      scan(document.documentElement);
      later();
    },
    onMutations(ctx, roots) {
      current = ctx;
      for (const root of roots) scan(root);
      later();
    },
    destroy() {
      clearTimeout(lateTimer);
      lateTimer = null;
      restoreAll();
      current = null;
    },
  });

  AP.yt.calmTitles = { calmCase, shoutingWord };
})();
