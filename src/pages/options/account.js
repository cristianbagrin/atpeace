// "Account": optional. Sign in with the same account as Chris's other apps and your settings and own
// presets follow you to every browser. The background does the talking (src/background/account.js).
const AP = globalThis.AtPeace;
const { h } = AP.ui;
const T = AP.msg.TYPES;

const MANAGE = 'https://account.cristianbagrin.com/';
/** Firefox asks before an add-on sends anything; At Peace sends your email and password only here. */
const COLLECTS = ['authenticationInfo', 'personallyIdentifyingInfo'];

function ago(at) {
  if (!at) return '';
  const min = Math.round((Date.now() - at) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hours = Math.round(min / 60);
  return hours < 24 ? `${hours} h ago` : new Date(at).toLocaleDateString();
}

/** Firefox's consent prompt for sending data. Must run straight from the click. */
async function mayCollect() {
  const perms = AP.api.permissions;
  if (!perms?.request) return true;
  try {
    if (await perms.contains({ data_collection: COLLECTS })) return true;
    return await perms.request({ data_collection: COLLECTS });
  } catch {
    return true; // a Firefox without data-collection permissions
  }
}

/** @returns {{ el: HTMLElement }} */
export function buildAccount() {
  const el = h('div', { class: 'account backup' });
  let mode = 'signin';

  const draw = async () => {
    const s = await AP.msg.send(T.ACCOUNT_STATUS).catch(() => null);
    if (s?.signedIn) return drawSignedIn(s);
    drawForm(s);
  };

  const row = (label, hint, control) =>
    h('div', { class: 'row' }, h('div', { class: 'row-text' }, h('p', { class: 'row-label' }, label), hint ? h('p', { class: 'row-hint' }, hint) : null), h('div', { class: 'row-control' }, control));

  function drawSignedIn(s) {
    const line = s.error
      ? s.error
      : s.held
        ? 'Changes from your other browsers wait until you unlock your settings.'
        : s.at
          ? `Synced ${ago(s.at)}.`
          : 'Syncing…';
    const syncBtn = h('button', { type: 'button', class: 'btn' }, 'Sync now');
    syncBtn.addEventListener('click', async () => {
      syncBtn.disabled = true;
      await AP.msg.send(T.ACCOUNT_SYNC).catch(() => {});
      await draw();
    });
    const out = h('button', { type: 'button', class: 'btn' }, 'Sign out');
    out.addEventListener('click', async () => {
      await AP.msg.send(T.ACCOUNT_SIGN_OUT).catch(() => {});
      AP.ui.toast('Signed out. Your settings stay in this browser.');
      await draw();
    });
    el.replaceChildren(
      row(s.email, line, [syncBtn, out]),
      row('Email, password, delete account', null, h('a', { class: 'btn', href: MANAGE, target: '_blank', rel: 'noopener' }, 'Manage…')),
    );
  }

  function drawForm(s) {
    const email = h('input', { type: 'email', id: 'acct-email', autocomplete: 'username', spellcheck: false, value: s?.email ?? '' });
    const password = h('input', { type: 'password', id: 'acct-password', autocomplete: mode === 'signup' ? 'new-password' : 'current-password' });
    const msg = h('p', { class: 'row-hint account-msg', role: 'status' }, s?.error ?? '');
    const go = h('button', { type: 'button', class: 'btn btn-primary' }, { signin: 'Sign in', signup: 'Create account', forgot: 'Email me a link' }[mode]);
    const switchTo = (m, label) =>
      h('button', { type: 'button', class: 'btn btn-link', onClick: () => ((mode = m), drawForm(null)) }, label);

    go.addEventListener('click', async () => {
      msg.textContent = '';
      if (mode === 'forgot') {
        go.disabled = true;
        const r = await AP.msg.send(T.ACCOUNT_FORGOT, { email: email.value }).catch(() => null);
        go.disabled = false;
        msg.textContent = r?.ok ? 'If that email has an account, a link is on its way.' : (r?.error ?? 'Could not send.');
        return;
      }
      if (!(await mayCollect())) {
        msg.textContent = 'Firefox needs your OK to send your email and password to your account.';
        return;
      }
      go.disabled = true;
      const r = await AP.msg.send(T.ACCOUNT_SIGN_IN, { email: email.value, password: password.value, create: mode === 'signup' }).catch(() => null);
      go.disabled = false;
      if (!r?.signedIn) {
        msg.textContent = r?.error || 'Could not sign in.';
        return;
      }
      AP.ui.toast(mode === 'signup' ? 'Account created' : 'Signed in');
      mode = 'signin';
      await draw();
    });

    const fields = h(
      'div',
      { class: 'lock-fields' },
      h('div', { class: 'lock-field' }, h('label', { for: 'acct-email' }, 'Email'), email),
      mode === 'forgot' ? null : h('div', { class: 'lock-field' }, h('label', { for: 'acct-password' }, 'Password'), password),
      msg,
      h('div', { class: 'lock-actions' }, go, mode === 'signin' ? [switchTo('signup', 'Create an account'), switchTo('forgot', 'Forgot password?')] : switchTo('signin', 'Back to sign in')),
    );
    const lead =
      mode === 'signup'
        ? 'Free. The same account works in Chinese Brain, Money in Order and Ten Dollar Words.'
        : 'Your settings and presets, in every browser you use. Optional; your stats stay here.';
    el.replaceChildren(h('div', { class: 'row is-wide' }, h('div', { class: 'row-text' }, h('p', { class: 'row-label' }, mode === 'signup' ? 'Create your account' : mode === 'forgot' ? 'Reset your password' : 'Sign in'), h('p', { class: 'row-hint' }, lead)), h('div', { class: 'row-control' }, fields)));
  }

  void draw();
  return { el };
}
