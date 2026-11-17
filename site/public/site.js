// Two small things. Without this file the page still works: both store buttons show, and the tour opens on YouTube.

// 1. Show only the store for this browser. Phones, Safari and anything unknown keep both buttons.
(() => {
  const ua = navigator.userAgent;
  if (/Mobi|Android|iPhone|iPad/i.test(ua)) return;
  const brands = (navigator.userAgentData?.brands || []).map((b) => b.brand);
  const firefox = /Firefox\//.test(ua);
  const chromium = !firefox && (brands.includes('Chromium') || /Chrome\/|Edg\//.test(ua));
  const chromeOn = document.documentElement.dataset.chrome !== 'off';

  let keep = null;
  let label = null;
  if (firefox) keep = 'firefox';
  else if (chromium && chromeOn) {
    keep = 'chrome';
    if (navigator.brave) label = 'Add to Brave';
    else if (/Edg\//.test(ua)) label = 'Add to Edge';
    else if (/OPR\//.test(ua)) label = 'Add to Opera';
    else if (/Vivaldi\//.test(ua)) label = 'Add to Vivaldi';
  }
  if (!keep) return;

  for (const group of document.querySelectorAll('[data-get]')) {
    for (const button of group.querySelectorAll('[data-store]')) {
      if (button.dataset.store !== keep) button.remove();
      else if (label) button.textContent = label;
    }
  }
})();

// 2. The tour: nothing from YouTube loads until it is pressed, then the player comes from youtube-nocookie.com.
for (const link of document.querySelectorAll('[data-video]')) {
  link.addEventListener('click', (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    const frame = document.createElement('iframe');
    frame.src = `https://www.youtube-nocookie.com/embed/${link.dataset.video}?autoplay=1&rel=0&modestbranding=1`;
    frame.title = 'At Peace: a short tour';
    frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    frame.allowFullscreen = true;
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    const box = document.createElement('div');
    box.className = 'video is-playing';
    box.append(frame);
    link.replaceWith(box);
    frame.focus();
  });
}
