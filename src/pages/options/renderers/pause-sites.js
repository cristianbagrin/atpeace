// Custom editor for `pause.sites`: the sites that get a Mindful Pause (Contract C1). YouTube is
// built in. Another site is added by typing its address; the browser then asks for permission to
// see that site (permissions.request has to run SYNCHRONOUSLY inside the click, which is why the
// request is the first thing the handler does). Only after the person agrees is the site saved;
// the background then registers the guard script for it (src/background/guards.js reacts to the
// settings and permission changes). Removing a site also hands the permission back.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;
  AP.optionsRenderers ??= {};

  // Same shape the schema accepts (src/shared/schema/pause.js).
  const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
  const BUILT_IN_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
  const ROOT_CLASS = 'pause-sites';

  const patternFor = (domain) => `*://*.${domain}/*`;

  /**
   * Turns what the person typed ("https://www.reddit.com/r/x", "Reddit.com") into a site, or says
   * why not. `www.` is dropped (the site key covers the domain and every subdomain).
   * @param {string} text
   * @param {{ siteKey: string, domain: string }[]} existing
   * @returns {{ ok: true, domain: string } | { ok: false, message: string }}
   */
  function parseSiteInput(text, existing) {
    const raw = String(text ?? '').trim();
    if (raw === '') return { ok: false, message: 'Type the address of a site, like example.com.' };
    if (raw.includes('@') || /\s/.test(raw)) return { ok: false, message: 'That does not look like a site address.' };
    let host;
    try {
      host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`).hostname;
    } catch {
      return { ok: false, message: 'That does not look like a site address.' };
    }
    host = host.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
    if (BUILT_IN_HOSTS.has(host) || host === 'youtube.com') return { ok: false, message: 'YouTube is already in the list.' };
    if (!host.includes('.') || /^\d+(\.\d+){3}$/.test(host) || host.includes(':')) return { ok: false, message: 'Use a site name like example.com, not an address with numbers.' };
    if (host.length > 253 || !HOST_RE.test(host)) return { ok: false, message: 'That does not look like a site address.' };
    if (existing.some((s) => s.siteKey === host || s.domain === host)) return { ok: false, message: `${host} is already in the list.` };
    return { ok: true, domain: host };
  }

  const CSS = `
.${ROOT_CLASS} { max-width: 560px; }
.${ROOT_CLASS} .site-list { border-top: 1px solid var(--rule); }
.${ROOT_CLASS} .site { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 4px var(--u2); padding: 9px 0; border-bottom: 1px solid var(--rule); }
.${ROOT_CLASS} .site-name { font-weight: 500; overflow-wrap: anywhere; }
.${ROOT_CLASS} .site-meta { grid-column: 1; display: flex; flex-wrap: wrap; align-items: center; gap: 2px var(--u2); font-size: 12.5px; color: var(--ink-2); }
.${ROOT_CLASS} .site-switch { grid-column: 2; grid-row: 1 / span 2; }
.${ROOT_CLASS} .site-meta .btn-quiet { font-size: 12.5px; }
.${ROOT_CLASS} .adder { display: flex; flex-wrap: wrap; gap: var(--u1); margin-top: var(--u2); }
.${ROOT_CLASS} .adder input[type="text"] { flex: 1 1 200px; min-width: 0; width: auto; }
.${ROOT_CLASS} .field-error { margin-top: var(--u1); }
`;

  function ensureStyle() {
    if (document.getElementById('ap-style-pause-sites')) return;
    const style = document.createElement('style');
    style.id = 'ap-style-pause-sites';
    style.textContent = CSS;
    document.head.append(style);
  }

  const renderer = {
    parseSiteInput,

    render(def, value, ctx) {
      ensureStyle();
      const { h, api } = ctx;
      let sites = Array.isArray(value) ? value.map((s) => ({ ...s })) : [];
      /** domain → boolean | undefined (unknown yet) */
      const access = new Map();
      let busy = false;

      const error = h('p', { class: 'field-error', role: 'alert', hidden: true });
      const showError = (message) => {
        error.textContent = message ?? '';
        error.hidden = !message;
      };
      const list = h('ul', { class: 'site-list', 'aria-label': 'Sites with a pause' });
      const input = h('input', {
        type: 'text',
        id: ctx.inputId,
        placeholder: 'example.com',
        autocomplete: 'off',
        spellcheck: false,
        'aria-describedby': ctx.describedBy,
        'aria-label': 'Site to add',
      });
      const addButton = h('button', { type: 'button', class: 'btn' }, 'Add site');
      const help = h('p', { class: 'field-help' }, 'Your browser will ask you to allow At Peace on that site. Nothing is read from the page except the address.');
      const root = h('div', { class: ROOT_CLASS }, list, h('div', { class: 'adder' }, input, addButton), help, error);

      const save = async (next, successMessage) => {
        try {
          await ctx.save(next);
          sites = next;
          showError(null);
          if (successMessage) ctx.toast(successMessage);
          refreshAccess(); // access may have changed behind our back; the rows say what is true now
          return true;
        } catch (err) {
          showError(String(err?.message ?? '') || 'That could not be saved.');
          return false;
        } finally {
          draw();
        }
      };

      const refreshAccess = () => sites.filter((s) => s.siteKey !== 'youtube').forEach(checkAccess);

      const checkAccess = async (site) => {
        try {
          access.set(site.domain, await api.permissions.contains({ origins: [patternFor(site.domain)] }));
        } catch {
          access.set(site.domain, false);
        }
        draw();
      };

      /** Asks for access; must be called straight from a click handler (no await before it). */
      const grant = (site, button) => {
        const request = api.permissions.request({ origins: [patternFor(site.domain)] });
        button.disabled = true;
        request.then(
          (granted) => {
            access.set(site.domain, Boolean(granted));
            if (!granted) showError(`Access to ${site.domain} was not granted, so its pause cannot work yet.`);
            else showError(null);
            draw();
          },
          () => {
            showError('The browser did not let us ask for access.');
            draw();
          },
        );
      };

      const row = (site) => {
        const builtIn = site.siteKey === 'youtube';
        const label = builtIn ? 'YouTube' : site.domain;
        const toggle = h('input', {
          type: 'checkbox',
          class: 'switch site-switch',
          role: 'switch',
          checked: site.enabled !== false,
          'aria-label': `Pause before opening ${label}`,
        });
        toggle.addEventListener('change', () => {
          save(sites.map((s) => (s.siteKey === site.siteKey ? { ...s, enabled: toggle.checked } : s)));
        });
        const meta = h('span', { class: 'site-meta' });
        if (builtIn) {
          meta.append('Built in');
        } else {
          const has = access.get(site.domain);
          if (has === undefined) meta.append('Checking access…');
          else if (has) meta.append('Access granted');
          else {
            meta.append('Access needed');
            const button = h('button', { type: 'button', class: 'btn btn-quiet' }, 'Grant access');
            button.addEventListener('click', () => grant(site, button)); // request() is the first call in grant()
            meta.append(button);
          }
          const remove = h('button', { type: 'button', class: 'btn btn-quiet btn-danger', 'aria-label': `Remove ${label}` }, 'Remove');
          remove.addEventListener('click', async () => {
            const remaining = sites.filter((s) => s.siteKey !== site.siteKey);
            if (!(await save(remaining))) return;
            try {
              // Nothing else of ours uses this domain: hand the permission back.
              if (!remaining.some((s) => s.domain === site.domain)) await api.permissions.remove({ origins: [patternFor(site.domain)] });
              ctx.toast(`Removed ${site.domain} and gave its access back.`);
            } catch {
              ctx.toast(`Removed ${site.domain}.`);
            }
          });
          meta.append(remove);
        }
        return h('li', { class: 'site' }, h('span', { class: 'site-name' }, label), toggle, meta);
      };

      function draw() {
        list.replaceChildren(...sites.map(row));
        addButton.disabled = busy;
      }

      const onAdd = () => {
        const parsed = parseSiteInput(input.value, sites);
        if (!parsed.ok) {
          showError(parsed.message);
          return;
        }
        // The permission request comes FIRST and synchronously: browsers only allow it inside a user gesture.
        const request = api.permissions.request({ origins: [patternFor(parsed.domain)] });
        busy = true;
        showError(null);
        draw();
        request
          .then(async (granted) => {
            if (!granted) {
              showError(`Access to ${parsed.domain} was not granted, so it was not added.`);
              return;
            }
            access.set(parsed.domain, true);
            if (await save([...sites, { siteKey: parsed.domain, domain: parsed.domain, enabled: true }], `Added ${parsed.domain}.`)) input.value = '';
          })
          .catch(() => showError('The browser did not let us ask for access.'))
          .finally(() => {
            busy = false;
            draw();
          });
      };
      addButton.addEventListener('click', onAdd);
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') onAdd();
      });
      input.addEventListener('input', () => showError(null));

      // Access can change behind our back (about:addons, another tab).
      for (const eventName of ['onAdded', 'onRemoved']) api.permissions?.[eventName]?.addListener(refreshAccess);

      root.apply = (next) => {
        sites = Array.isArray(next) ? next.map((s) => ({ ...s })) : [];
        draw();
        refreshAccess();
      };
      draw();
      refreshAccess();
      return root;
    },

    update(el, value) {
      if (typeof el?.apply !== 'function') return false;
      el.apply(value);
      return true;
    },
  };

  AP.optionsRenderers['pause.sites'] = renderer;
})();
