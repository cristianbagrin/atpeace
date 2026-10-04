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
    description: 'Overlays and buttons inside the video player.',
  });

  AP.schema.define('yt.player', [
    // ---- Suggestions in the player -------------------------------------------------------------
    {
      id: 'yt.player.hideEndscreenCards',
      group: 'Suggestions in the player',
      label: 'Hide end-screen cards',
      description: 'Removes the video, channel and subscribe boxes creators add over the last 20 seconds of a video.',
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
      description: 'Removes the grid of suggested videos that covers the player when a video ends, and the grid in fullscreen.',
      type: 'toggle',
      default: false,
      tags: ['recommendations', 'player'],
      hide: ['.html5-endscreen', '.ytp-endscreen-content', '.ytp-fullscreen-grid'],
      quick: true,
      since: '0.1.0',
    },
    {
      id: 'yt.player.hideInfoCards',
      group: 'Suggestions in the player',
      label: 'Hide info cards',
      description: 'Removes the small "i" button and the card previews that pop up in the corner of the video.',
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
      description: 'Removes the suggestions YouTube can draw over a paused video, mostly in embedded players.',
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
      description: 'Removes the small channel logo and YouTube logo in the corner of the video.',
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
      description: 'Removes the sponsorship label at the top left of the video. It is a disclosure the creator must show, so hiding it is your call.',
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
      description: 'Removes the autoplay on/off switch from the player controls. The "Turn off autoplay" setting still works.',
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
      description: 'Removes the "next" arrow from the player controls. In a playlist you can still pick the next video from the list.',
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
      description: 'Removes the miniplayer button from the controls. The "i" keyboard shortcut still opens it.',
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
      description: 'Removes the "Play on TV" button from the controls.',
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
      description: 'Removes the CC button from the controls. The "c" keyboard shortcut still toggles captions.',
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
      description: 'Removes the current chapter name next to the time in the controls.',
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
      description: 'Removes the small picture that follows your pointer along the progress bar. The time stays.',
      type: 'toggle',
      default: false,
      tags: ['player'],
      advanced: true,
      hide: ['.ytp-tooltip-image', '.ytp-storyboard-framepreview', '.ytp-tooltip-bg'],
      since: '0.1.0',
    },
  ]);
})();
