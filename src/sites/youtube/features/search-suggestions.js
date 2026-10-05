// Search suggestions (yt.masthead.hideSearchSuggestions): CSS hides the dropdown, but YouTube's search
// box still keeps the hidden list in step with the keyboard: ArrowDown/ArrowUp walk the invisible rows
// and write each one into the input. While the setting is on, those two keys never reach YouTube's
// handler (a capture-phase guard on the window runs before the input's own listeners); the caret still
// moves as in any text field, and every other key, Enter included, behaves as usual.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;

  const ID = 'yt.masthead.hideSearchSuggestions';
  const SEARCH_BOX = 'yt-searchbox, ytd-searchbox, form#search-form';

  /** Should this key press be kept from YouTube's suggestion handler? */
  function shouldSwallow({ key, inSearchBox, modifiers }) {
    return inSearchBox && !modifiers && (key === 'ArrowDown' || key === 'ArrowUp');
  }

  const onKeydown = (event) => {
    try {
      const target = event.composedPath?.()[0] ?? event.target;
      const el = target?.nodeType === 1 ? target : target?.parentElement;
      const inSearchBox = Boolean(el?.closest?.(SEARCH_BOX)) && (el.localName === 'input' || el.getAttribute?.('role') === 'combobox');
      if (shouldSwallow({ key: event.key, inSearchBox, modifiers: event.altKey || event.ctrlKey || event.metaKey || event.shiftKey })) {
        event.stopImmediatePropagation();
      }
    } catch {
      /* a key handler must never throw */
    }
  };

  AP.yt.features.push({
    id: 'search-suggestions',
    settings: [ID],
    init() {
      window.addEventListener('keydown', onKeydown, true);
    },
    destroy() {
      window.removeEventListener('keydown', onKeydown, true);
    },
  });

  AP.yt.searchSuggestions = { shouldSwallow };
})();
