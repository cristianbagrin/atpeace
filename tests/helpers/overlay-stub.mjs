// The stand-in for www.youtube.com used by the overlay specs (tests/e2e/overlay.spec.mjs in Chromium,
// tests/firefox/overlay.mjs in real Firefox): a page with a REAL media element (a generated WAV of 20 s,
// muted) inside #movie_player, whose end a test triggers with `currentTime = duration`, and a
// window.__spa(url) that does what YouTube's single-page navigation does (yt-navigate-start, pushState,
// yt-navigate-finish). `window.__marker` changes on every load (proof that nothing was reloaded) and
// `window.__keys` counts the keydown events the page saw.
export const stubPage = (title) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head>
<body style="font:16px system-ui;padding:40px;background:#fff;color:#111">
<h1>${title}</h1>
<div id="movie_player" style="width:480px;height:270px;background:#000"><video class="html5-main-video" id="v" muted playsinline width="480" height="270"></video></div>
<p>Some text on the page behind the overlay.</p>
<script>
  function wav(seconds) {
    const rate = 8000, n = seconds * rate, b = new ArrayBuffer(44 + n), v = new DataView(b);
    const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
    w(36, 'data'); v.setUint32(40, n, true); for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
    return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
  }
  const video = document.getElementById('v');
  video.src = wav(20);
  window.__marker = 'loaded-' + Math.random();
  window.__keys = 0;
  addEventListener('keydown', () => window.__keys++);
  window.__spa = (url) => {
    window.dispatchEvent(new CustomEvent('yt-navigate-start', { detail: { url } }));
    history.pushState({}, '', url);
    window.dispatchEvent(new CustomEvent('yt-navigate-finish', { detail: {} }));
  };
</script></body></html>`;
