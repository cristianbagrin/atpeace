// Shared by the Chromium (Playwright) and Firefox (Selenium) specs of Phase 7b: builds, inside a YouTube
// fixture page, video cards in every metadata layout the "Hide view counts" / "Hide upload dates" rules must
// cope with. The base card is a real lockup from a snapshot (a channel Home shelf card: channel row with the
// verified tick + "play-arrow, views, delimiter, date" row); the variants only re-arrange its own parts, so the
// class names are YouTube's, not invented.
//
//   [channel ✓] / [▷ views • date]     two-rows        what the logged-out snapshots show
//   [channel ✓ • ▷ views • date]       one-row         the layout the signed-in home is reported to use
//   (the same two without the ▷ icon)  two-rows-plain / one-row-plain
//   [▷ views • date]                   no-channel      channel Videos tab
//   live: [channel ✓] / [watching]     live-two-rows,  [channel ✓ • watching]  live-one-row
//
// Every part carries data-part="channel|tick|play|views|date|sep-1|sep-2" so a spec asserts on roles, never on
// text. `partsVisible(card)` (below, also runs in the page) lists the roles that still take up room.

/** Runs in the page. Appends one card per variant to a container and returns the variant names. */
export function buildVariantsInPage() {
  const ROW = 'ytContentMetadataViewModelMetadataRow';
  const find = (root, cls) => root.querySelector(`.${cls}`);
  const base = [...document.querySelectorAll('yt-lockup-view-model')].find((l) => l.querySelector(`.ytContentMetadataViewModelLeadingIcon`) && l.querySelector(`.ytContentMetadataViewModelIcon`));
  if (!base) throw new Error('no lockup with a channel row in this snapshot');
  const host = document.createElement('div');
  host.id = 'at-peace-variants';
  host.style.cssText = 'position:relative;z-index:10;background:#fff;margin:60px 0 0 250px;display:grid;grid-template-columns:repeat(4,260px);gap:12px 16px;padding:16px;font:12px/16px sans-serif;';
  document.body.prepend(host);

  /** The six parts of the base card, detached from it. */
  const parts = (card) => {
    const meta = card.querySelector('yt-content-metadata-view-model');
    const rows = [...meta.querySelectorAll(`.${ROW}`)];
    const channelRow = rows[0];
    const statsRow = rows[1];
    const channel = find(channelRow, 'ytContentMetadataViewModelMetadataText');
    const tick = find(channelRow, 'ytContentMetadataViewModelIcon');
    const play = find(statsRow, 'ytContentMetadataViewModelLeadingIcon');
    const texts = [...statsRow.querySelectorAll('.ytContentMetadataViewModelMetadataText')];
    const sep = find(statsRow, 'ytContentMetadataViewModelDelimiter');
    channel.setAttribute('data-part', 'channel');
    tick.setAttribute('data-part', 'tick');
    play.setAttribute('data-part', 'play');
    texts[0].setAttribute('data-part', 'views');
    texts[1].setAttribute('data-part', 'date');
    sep.setAttribute('data-part', 'sep-1');
    return { meta, rows, channelRow, statsRow, channel, tick, play, views: texts[0], date: texts[1], sep };
  };
  const lastPart = (el, last) => el.classList.toggle('ytContentMetadataViewModelMetadataTextLastPart', last);
  const addLive = (card) => {
    const badge = document.createElement('badge-shape');
    badge.className = 'ytBadgeShapeHost ytBadgeShapeThumbnailLive';
    card.querySelector('yt-thumbnail-view-model')?.append(badge);
  };
  const clone = (name) => {
    const card = base.cloneNode(true);
    card.setAttribute('data-variant', name);
    const wrap = document.createElement('div');
    const caption = document.createElement('div');
    caption.textContent = name;
    caption.style.cssText = 'font:11px monospace;color:#888;';
    wrap.append(caption, card);
    host.append(wrap);
    return card;
  };
  const row = () => {
    const r = document.createElement('div');
    r.className = ROW;
    r.setAttribute('role', 'group');
    return r;
  };
  const delimiter = (role) => {
    const d = document.createElement('span');
    d.className = 'ytContentMetadataViewModelDelimiter';
    d.setAttribute('data-part', role);
    return d;
  };
  /** Rebuilds the metadata block with the given rows (each row = elements in order); a badge row stays last. */
  const layout = (p, rowsOfElements) => {
    for (const r of p.rows) r.remove();
    const made = rowsOfElements.map((els) => {
      const r = row();
      r.append(...els);
      return r;
    });
    p.meta.prepend(...made);
  };

  const names = [];
  const make = (name, build) => {
    const card = clone(name);
    const p = parts(card);
    build(p, card);
    names.push(name);
  };

  make('two-rows', () => {});
  make('two-rows-plain', (p) => p.play.remove());
  make('one-row', (p) => {
    const sep2 = delimiter('sep-2');
    layout(p, [[p.channel, p.tick, p.sep, p.play, p.views, sep2, p.date]]);
    lastPart(p.channel, false);
    lastPart(p.date, true);
  });
  make('one-row-plain', (p) => {
    const sep2 = delimiter('sep-2');
    p.play.remove();
    layout(p, [[p.channel, p.tick, p.sep, p.views, sep2, p.date]]);
    lastPart(p.channel, false);
    lastPart(p.date, true);
  });
  make('no-channel', (p) => {
    layout(p, [[p.play, p.views, p.sep, p.date]]);
  });
  make('live-two-rows', (p, card) => {
    addLive(card);
    p.views.setAttribute('data-part', 'views'); // "N watching"
    p.date.remove();
    p.sep.remove();
    p.play.remove();
    lastPart(p.views, true);
    layout(p, [[p.channel, p.tick], [p.views]]);
  });
  make('live-one-row', (p, card) => {
    addLive(card);
    p.date.remove();
    p.play.remove();
    p.views.setAttribute('data-part', 'views');
    lastPart(p.channel, false);
    lastPart(p.views, true);
    layout(p, [[p.channel, p.tick, p.sep, p.views]]);
  });
  // A playlist card keeps its rows whatever the settings say.
  make('playlist', (p, card) => {
    const stack = document.createElement('yt-collection-thumbnail-view-model');
    card.querySelector('yt-thumbnail-view-model')?.append(stack);
  });
  return names;
}

/** Runs in the page: the roles (data-part) of one card that are still laid out, in document order. */
export function partsVisibleInPage(variant) {
  const card = document.querySelector(`yt-lockup-view-model[data-variant="${variant}"]`);
  return [...card.querySelectorAll('[data-part]')]
    .filter((el) => el.getClientRects().length > 0)
    .map((el) => el.getAttribute('data-part'));
}
