// Shorts (PLAN §6.3, "Shorts"): what happens when you open a Short, and trimming its player.
// Hiding Shorts elsewhere (sidebar entry, home/search/subscriptions/channel rows) lives in those
// sections, tagged `shorts` so the presets that hide Shorts find them.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;

  AP.schema.section({
    id: 'yt.shorts',
    site: 'youtube',
    title: 'Shorts',
    order: 180,
  });

  // While a redirect (watch) or the "Shorts are off" page (block) takes over, the Shorts player
  // behind it stays hidden. `page: 'shorts'` also covers the moment a navigation to Shorts starts.
  const PLAYER_HIDDEN = { hide: ['ytd-shorts'] };

  AP.schema.define('yt.shorts', [
    {
      id: 'yt.shorts.mode',
      group: 'Opening Shorts',
      label: 'When I open a Short',
      type: 'select',
      default: 'allow',
      options: [
        { value: 'allow', label: 'Play Shorts as usual', short: 'As usual' },
        { value: 'watch', label: 'Open in the normal player', short: 'Normal player' },
        { value: 'block', label: 'Block Shorts', short: 'Block' },
      ],
      tags: ['shorts'],
      page: 'shorts',
      variants: { watch: PLAYER_HIDDEN, block: PLAYER_HIDDEN },
      feature: 'shorts',
      since: '0.1.0',
    },
    {
      id: 'yt.shorts.hideComments',
      group: 'On the Shorts player',
      label: 'Hide comments on Shorts',
      type: 'toggle',
      default: false,
      tags: ['comments'],
      page: 'shorts',
      hide: [
        'ytd-shorts ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-comments-section"]',
        'ytd-shorts reel-action-bar-view-model > button-view-model:nth-of-type(1)',
        'ytd-reel-player-overlay-renderer #comments-button',
      ],
      since: '0.1.0',
    },
    {
      id: 'yt.shorts.hideLikeCounts',
      group: 'On the Shorts player',
      label: 'Hide counts on Shorts',
      type: 'toggle',
      default: false,
      tags: ['metrics'],
      page: 'shorts',
      hide: [
        'ytd-shorts reel-action-bar-view-model like-button-view-model .ytSpecButtonShapeWithLabelLabel',
        'ytd-shorts reel-action-bar-view-model > button-view-model:nth-of-type(1) .ytSpecButtonShapeWithLabelLabel',
      ],
      since: '0.1.0',
    },
    {
      id: 'yt.shorts.hideRemix',
      group: 'On the Shorts player',
      label: 'Hide Remix',
      type: 'toggle',
      default: false,
      advanced: true,
      page: 'shorts',
      // Third plain button of the action bar (after comments and share); no attribute names it.
      hide: ['ytd-shorts reel-action-bar-view-model > button-view-model:nth-of-type(3)', 'ytd-reel-player-overlay-renderer #remix-button'],
      since: '0.1.0',
    },
    {
      id: 'yt.shorts.hideSubscribe',
      group: 'On the Shorts player',
      label: 'Hide Subscribe on Shorts',
      type: 'toggle',
      default: false,
      page: 'shorts',
      hide: ['ytd-shorts yt-reel-channel-bar-view-model .ytReelChannelBarViewModelReelSubscribeButton', 'ytd-reel-player-overlay-renderer #subscribe-button'],
      since: '0.1.0',
    },
  ]);
})();
