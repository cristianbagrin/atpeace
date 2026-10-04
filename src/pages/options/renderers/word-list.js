// Editor for lists of words or names, one entry per line (the keyword and channel filters).
// A line wrapped in slashes is a regular expression (/colou?r/i): it is compiled while you type,
// and a pattern that does not compile is explained next to the field and never saved.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;

  const wordList = {
    render(def, value, ctx) {
      const { h } = ctx;
      const problem = h('p', { class: 'field-error', role: 'alert', hidden: true });
      const control = AP.ui.settingControl(def, value, (items) => ctx.save(items), {
        id: ctx.inputId,
        describedBy: ctx.describedBy,
        regexLines: true,
        onError: (message) => {
          problem.textContent = message ?? '';
          problem.hidden = !message;
        },
      });
      const help = h('p', { class: 'field-help' }, 'One per line, not case-sensitive. Wrap a line in slashes to use a regular expression, like /colou?r/i.');
      const el = h('div', { class: 'word-list' }, control.el, help, problem);
      el.control = control;
      return el;
    },

    update(el, value) {
      el.control?.set(value);
      return Boolean(el.control);
    },
  };

  AP.optionsRendererMatchers.push({
    test: (def) => def.type === 'list' && AP.ui.isStringList(def) && def.id.startsWith('yt.filters.'),
    renderer: wordList,
  });
})();
