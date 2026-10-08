// Player (PLAN §6.3, "Player"): overlays and controls inside the video player. The player's DOM
// (`.ytp-*`) exists, hidden, on every page, so these rules are harmless where no player is visible
// and need no `page`: the same player also appears in channel trailers and the miniplayer.
//
// Deliberately NOT hidden anywhere: the in-stream ad layer (`.video-ads`, `.ytp-ad-module`; hiding
// it would hide the Skip button of an ad that keeps playing) and the "Up next in N" countdown
// (`.ytp-autonav-endscreen-countdown-overlay`; hiding it would make autoplay a surprise).
(() => {
  'use strict';
  const AP = globalThis.AtPeace;

  AP.schema.section({
    id: 'yt.player',
    site: 'youtube',
    title: 'Player',
    order: 150,
  });

  AP.schema.define('yt.player', [
    // ---- Suggestions in the player -------------------------------------------------------------
    {
      id: 'yt.player.hideEndscreenCards',
      group: 'Suggestions in the player',
      label: 'Hide end-screen cards',
      type: 'toggle',
      default: false,
      tags: ['recommendations', 'player'],
      hide: ['.ytp-ce-element'],
      since: '0.1.0',
    },
    {
      id: 'yt.player.hideEndscreenWall',
      group: 'Suggestions in the player',
      label: 'Hide the suggestions grid at the end',
      type: 'toggle',
      default: false,
      tags: ['recommendations', 'player'],
      hide: ['.html5-endscreen', '.ytp-endscreen-content', '.ytp-fullscreen-grid'],
      since: '0.1.0',
    },
    {
      id: 'yt.player.hideInfoCards',
      group: 'Suggestions in the player',
      label: 'Hide info cards',
      type: 'toggle',
      default: false,
      tags: ['player'],
      hide: ['.ytp-cards-button', '.ytp-cards-teaser'],
      since: '0.1.0',
    },
    {
      id: 'yt.player.hidePauseOverlay',
      group: 'Suggestions in the player',
      label: 'Hide "More videos" when paused',
      type: 'toggle',
      default: false,
      tags: ['recommendations', 'player'],
      advanced: true,
      hide: ['.ytp-pause-overlay', '.ytp-pause-overlay-container'],
      since: '0.1.0',
    },

    // ---- Labels over the picture ---------------------------------------------------------------
    {
      id: 'yt.player.hideWatermark',
      group: 'Labels over the picture',
      label: 'Hide channel watermarks',
      type: 'toggle',
      default: false,
      tags: ['player'],
      hide: ['.iv-branding', '.ytp-watermark'],
      since: '0.1.0',
    },
    {
      id: 'yt.player.hidePaidPromotion',
      group: 'Labels over the picture',
      label: 'Hide "Includes paid promotion"',
      type: 'toggle',
      default: false,
      tags: ['player'],
      hide: ['.ytp-paid-content-overlay', '.YtmPaidContentOverlayHost'],
      since: '0.1.0',
    },

    // ---- Controls ------------------------------------------------------------------------------
    {
      id: 'yt.player.hideAutoplayToggle',
      group: 'Controls',
      label: 'Hide the autoplay switch',
      type: 'toggle',
      default: false,
      tags: ['player'],
      // display:none keeps the element in the DOM, so autoplay.js can still read and click it.
      hide: ['.ytp-autonav-toggle', 'button.ytp-button[data-tooltip-target-id="ytp-autonav-toggle-button"]'],
      since: '0.1.0',
    },
    {
      id: 'yt.player.hideNextButton',
      group: 'Controls',
      label: 'Hide the next-video button',
      type: 'toggle',
      default: false,
      tags: ['player'],
      hide: ['.ytp-next-button'],
      since: '0.1.0',
    },
    {
      id: 'yt.player.hideMiniplayerButton',
      group: 'Controls',
      label: 'Hide the miniplayer button',
      type: 'toggle',
      default: false,
      tags: ['player'],
      advanced: true,
      hide: ['.ytp-miniplayer-button'],
      since: '0.1.0',
    },
    {
      id: 'yt.player.hideCastButton',
      group: 'Controls',
      label: 'Hide the cast button',
      type: 'toggle',
      default: false,
      tags: ['player'],
      hide: ['.ytp-remote-button'],
      since: '0.1.0',
    },
    {
      id: 'yt.player.hideSubtitlesButton',
      group: 'Controls',
      label: 'Hide the captions button',
      type: 'toggle',
      default: false,
      tags: ['player'],
      advanced: true,
      hide: ['.ytp-subtitles-button'],
      since: '0.1.0',
    },
    {
      id: 'yt.player.hideChapterTitle',
      group: 'Controls',
      label: 'Hide chapter names',
      type: 'toggle',
      default: false,
      tags: ['player'],
      hide: ['.ytp-chapter-container'],
      since: '0.1.0',
    },
    {
      id: 'yt.player.hideProgressPreviews',
      group: 'Controls',
      label: 'Hide previews on the progress bar',
      type: 'toggle',
      default: false,
      tags: ['player'],
      advanced: true,
      hide: ['.ytp-tooltip-image', '.ytp-storyboard-framepreview', '.ytp-tooltip-bg'],
      since: '0.1.0',
    },
  ]);
})();
