// Sets <html data-theme> before first paint so a dark page never flashes light. It has to be a
// tiny blocking script and cannot wait for storage, so it reads the last theme that
// AP.ui.applyTheme() cached in localStorage (shared by every extension page). Without it
// (private window, blocked storage) the page starts light and corrects itself a moment later.
(() => {
  'use strict';
  let theme = 'light';
  try {
    const cached = localStorage.getItem('at-peace-theme');
    if (cached === 'dark' || cached === 'system') theme = cached;
  } catch {
    /* storage unavailable: light */
  }
  document.documentElement.dataset.theme = theme;
})();
