// Registry of custom editors for the options page (contract C1). A setting that needs more than
// the generic control (a list of objects, a schedule builder…) gets its own renderer, in its own
// classic script loaded by options.html after this file and before options.js:
//
//   AP.optionsRenderers['pause.sites'] = {
//     // def: the SettingDef · value: the stored value now · ctx: see below
//     // Returns the editor; the options page puts it under the setting's label (full width).
//     render(def, value, ctx) { return ctx.h('div', null, …); },
//     // Optional: the stored value changed elsewhere (popup, another tab). Return true when the
//     // editor updated itself; otherwise the page calls render() again and swaps the element.
//     update(el, value) { … return true; },
//   };
//
//   ctx = {
//     save(newValue): Promise<void>   validates and stores the value; rejects with a readable
//                                     Error when the schema refuses it (show error.message inline)
//     api: AP.api,  h: AP.ui.h,  toast(message),  ui: AP.ui,  def,
//     inputId, labelId, describedBy   ids to put on the main input / the row label / its description, so the row's
//                                     <label> and description are read with it
//   }
//
// A renderer may also be picked by shape instead of by id:
//
//   AP.optionsRendererMatchers.push({ test: (def) => boolean, renderer })
//
// While no renderer is registered for a setting, the page falls back to the generic control
// (AP.ui.settingControl), which for lists of objects is a JSON editor, so nothing is unreachable.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;

  /** @type {Record<string, { render: Function, update?: Function }>} */
  AP.optionsRenderers ??= {};
  /** @type {{ test: (def: object) => boolean, renderer: { render: Function, update?: Function } }[]} */
  AP.optionsRendererMatchers ??= [];

  /**
   * The custom renderer for a setting, or null. An exact id wins over a matcher.
   * @param {object} def
   */
  AP.optionsRendererFor = (def) => {
    const byId = AP.optionsRenderers[def.id];
    if (byId && typeof byId.render === 'function') return byId;
    return AP.optionsRendererMatchers.find((m) => m.test(def))?.renderer ?? null;
  };
})();
