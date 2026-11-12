// hero-logo.js — draws Dynamo's logo (the same drawing as assets/dynamo-logo.svg) inline into the element marked
// `data-hero-logo`, so that its cells can be filled one after the other by the CSS (assets/components.css) and its colours
// follow the theme in force from the tokens. The header uses the SVG files themselves (assets/layout.js). The drawing has
// its text alternative under the key `logo.alt` of assets/shared.i18n.js.
(function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const CELLS = [
    { className: 'cell', points: '67,127 93,142 93,172 67,187 41,172 41,142' },
    { className: 'work', points: '100,70 126,85 126,115 100,130 74,115 74,85' },
    { className: 'done', points: '133,13 159,28 159,58 133,73 107,58 107,28' },
  ];
  const CHECK = 'M120 43 L129 52 L146 34';
  const STROKE_LETTERS =
    'M220.5,74.5 H250.5 L264.5,88.5 V111.5 L250.5,125.5 H220.5 Z M360.5,140 V60 M360.5,66 L404.5,134 M404.5,60 V140 M429.5,140 V88.5 L443.5,74.5 H459.5 L473.5,88.5 V140 M429.5,106 H473.5 M498.5,140 V74.5 L524.5,102 L550.5,74.5 V140';
  const ACCENT_LETTERS =
    'M285.5,66.5 L312.5,100 L339.5,66.5 M312.5,100 V140 M589.5,74.5 H605.5 L619.5,88.5 V111.5 L605.5,125.5 H589.5 L575.5,111.5 V88.5 Z';

  function shape(name, attributes) {
    const node = document.createElementNS(NS, name);
    Object.keys(attributes).forEach(function (key) {
      node.setAttribute(key, attributes[key]);
    });
    return node;
  }

  function logo() {
    const svg = shape('svg', { viewBox: '0 0 656 200', role: 'img', 'data-i18n-attr': 'aria-label:logo.alt', class: 'hero-logo' });
    const cells = shape('g', { 'stroke-width': 8, 'stroke-linejoin': 'round' });
    CELLS.forEach(function (cell, index) {
      cells.appendChild(shape('polygon', { class: 'hero-logo__' + cell.className, points: cell.points }));
    });
    svg.appendChild(cells);
    svg.appendChild(shape('path', { class: 'hero-logo__check', d: CHECK, 'stroke-width': 7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    const clip = shape('clipPath', { id: 'hero-logo-band' });
    clip.appendChild(shape('rect', { x: 0, y: 68, width: 2000, height: 64 }));
    svg.appendChild(clip);
    ['hero-logo__ink', 'hero-logo__accent'].forEach(function (className, index) {
      svg.appendChild(shape('path', { class: className, d: index === 0 ? STROKE_LETTERS : ACCENT_LETTERS, 'clip-path': 'url(#hero-logo-band)', 'stroke-width': 13, 'stroke-linejoin': 'miter', 'stroke-miterlimit': 10 }));
    });
    return svg;
  }

  document.querySelectorAll('[data-hero-logo]').forEach(function (holder) {
    holder.appendChild(logo());
  });
})();
