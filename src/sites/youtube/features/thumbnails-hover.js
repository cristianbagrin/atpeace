// Hover previews (yt.general.disableHoverPreview): pointing at a thumbnail no longer starts the muted
// preview clip. CSS (schema/general.js) hides YouTube's preview overlay (`#video-preview`, drawn over
// the card, so it is not part of it); this file keeps the preview from being requested at all, so no
// clip is fetched and no sound can start. The pointer-enter events YouTube listens to on thumbnails are
// stopped in the capture phase before they get there. Hover STYLES are untouched (they are CSS :hover,
// not events), and so are the buttons on a thumbnail (Watch later, Add to queue) and their tooltips.
//
// Verified live that the hidden overlay never shows; whether the preview request itself is prevented
// needs real playback, so it is on the user checklist.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;

  const ID = 'yt.general.disableHoverPreview';
  const THUMBNAILS = 'ytd-thumbnail, yt-thumbnail-view-model, ytd-playlist-thumbnail, a.ytLockupViewModelContentImage, a.shortsLockupViewModelHostEndpoint';
  /** Controls drawn on top of a thumbnail keep their hover behaviour (tooltips, toggles). */
  const CONTROLS = 'button, yt-icon-button, ytd-thumbnail-overlay-toggle-button-renderer, yt-thumbnail-overlay-badge-view-model, #hover-overlays, #mouseover-overlay';
  const EVENTS = ['mouseover', 'mouseenter', 'pointerover', 'pointerenter'];

  /** Does this pointer-enter target start a preview? (On a thumbnail, but not on a control over it.) */
  function startsPreview(el) {
    if (!el?.closest) return false;
    return Boolean(el.closest(THUMBNAILS)) && !el.closest(CONTROLS);
  }

  const onHover = (event) => {
    try {
      const target = event.target;
      const el = target?.nodeType === 1 ? target : target?.parentElement;
      if (startsPreview(el)) event.stopImmediatePropagation();
    } catch {
      /* ignore */
    }
  };

  AP.yt.features.push({
    id: 'thumbnails-hover',
    settings: [ID],
    init() {
      for (const type of EVENTS) window.addEventListener(type, onHover, true);
    },
    destroy() {
      for (const type of EVENTS) window.removeEventListener(type, onHover, true);
    },
  });

  AP.yt.thumbnailsHover = { startsPreview };
})();
