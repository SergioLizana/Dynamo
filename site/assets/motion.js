// motion.js — the motion of the shared layer: the sections of every page come in softly when they scroll into view.
// It does nothing under `prefers-reduced-motion: reduce`, nor where IntersectionObserver is missing: the sections then
// stay as they are, visible. The look of the motion (the offset, the duration) is in assets/components.css and the tokens.
(function () {
  'use strict';

  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !('IntersectionObserver' in window)) return;

  const observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.1 },
  );

  document.querySelectorAll('.section').forEach(function (section) {
    section.classList.add('reveal');
    observer.observe(section);
  });
})();
