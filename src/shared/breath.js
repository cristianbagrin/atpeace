// The breath, shared by the pause page (src/pages/pause/pause.js) and the "time is up" overlay that
// breathes in place on the page (src/content/overlay.js). One place for the timing and the look, so
// the two cannot drift apart. Pure helpers, no DOM, no storage.
//
//   AP.breath.plan(seconds)          → { cycles, half }   in/out pairs of about 8 s, stretched evenly
//                                                         to fill `seconds`; `half` = ms per half-breath
//   AP.breath.guidance(i)            → 'Breathe in…' (even half-breaths) | '…and out' (odd ones)
//   AP.breath.frames(cycles, reduced)→ keyframes for the mint disc (Web Animations API): it scales
//                                      between 0.6 and 1 like a lung; with reduced motion it does not
//                                      scale at all, it only fades softly
//   AP.breath.ticksPath()            → the dial's sixty ticks as one SVG path (viewBox 0 0 320 320);
//                                      the same drawing as AP.ui.dialTicksPath() on the pages, which
//                                      cannot be loaded into a content script
//   AP.breath.ordinal(n)             → 'first' | '2nd' | '3rd' | '4th' …
(() => {
  'use strict';
  const AP = globalThis.AtPeace;

  const EASE = 'cubic-bezier(0.45, 0, 0.55, 1)';
  const CENTER = 160;

  /** In/out pairs of about 8 s each (4 in, 4 out), stretched evenly to fill `seconds`. */
  function plan(seconds) {
    const cycles = Math.max(1, Math.round(seconds / 8));
    return { cycles, half: (seconds * 1000) / (cycles * 2) };
  }

  /** What the line says at half-breath `i` (0 = the first in-breath). */
  const guidance = (i) => (i % 2 === 1 ? '…and out' : 'Breathe in…');

  /**
   * Keyframes for the mint disc: grows on the in-breath and shrinks on the out-breath, 0.6 ↔ 1.0,
   * easing like a lung. Reduced motion: no scaling; the disc stays put and softly fades in and out.
   * @param {number} cycles
   * @param {boolean} reduced
   * @returns {Keyframe[]}
   */
  function frames(cycles, reduced) {
    const out = [];
    for (let i = 0; i <= cycles * 2; i++) {
      const high = i % 2 === 1;
      out.push(
        reduced
          ? { opacity: high ? 1 : 0.55, transform: 'scale(0.8)', offset: i / (cycles * 2), easing: 'ease-in-out' }
          : { transform: `scale(${high ? 1 : 0.6})`, offset: i / (cycles * 2), easing: EASE },
      );
    }
    return out;
  }

  /** One path of 60 ticks, one per minute; every fifth is longer. */
  function ticksPath() {
    let d = '';
    for (let i = 0; i < 60; i++) {
      const angle = ((i * 6 - 90) * Math.PI) / 180;
      const inner = i % 5 === 0 ? 140 : 147;
      const [x1, y1] = [CENTER + inner * Math.cos(angle), CENTER + inner * Math.sin(angle)];
      const [x2, y2] = [CENTER + 154 * Math.cos(angle), CENTER + 154 * Math.sin(angle)];
      d += `M${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}`;
    }
    return d;
  }

  /** 1 → "first", 2 → "2nd", 4 → "4th", 11 → "11th", 22 → "22nd". */
  function ordinal(n) {
    if (n === 1) return 'first';
    const mod100 = n % 100;
    const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th');
    return `${n}${suffix}`;
  }

  AP.breath = { EASE, plan, guidance, frames, ticksPath, ordinal };
})();
