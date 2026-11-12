// diagram.js — what the pages need to show a diagram drawn with archify: its address with the site's active theme
// (archify reads `?theme=light|dark`, and `?embed=1` for its embedded mode, without its own toolbar and header) and Live
// motion (archify starts Still unless localStorage `archify-motion` is `live`). Classic script, loaded after theme.js.
(function () {
  'use strict';

  const site = (window.DynamoSite = window.DynamoSite || {});
  const media = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  function theme() {
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  }

  // The address of a diagram file with the active theme; `embed` asks for archify's embedded mode.
  function url(file, embed) {
    return file + '?theme=' + theme() + (embed ? '&embed=1' : '');
  }

  // Stores Live motion before a diagram loads or opens. Under reduced motion nothing is stored: archify keeps it still.
  function prepare() {
    if (media && media.matches) return;
    try {
      window.localStorage.setItem('archify-motion', 'live');
    } catch (error) {
      // Storage blocked: the diagram starts still, as archify does by default.
    }
  }

  // Calls `callback` whenever the reader changes the site's theme.
  function onTheme(callback) {
    new MutationObserver(callback).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  // Gives an iframe holding an archify diagram the diagram's own proportions, read from its drawing's `viewBox` (the
  // largest one, as icons inside may have their own), so the whole diagram shows at any width. Runs on every load.
  function fit(frame) {
    function apply() {
      let best = null;
      try {
        frame.contentDocument.querySelectorAll('svg[viewBox]').forEach(function (svg) {
          const box = svg.viewBox.baseVal;
          if (box && box.width > 0 && box.height > 0 && (!best || box.width * box.height > best.width * best.height)) best = box;
        });
      } catch (error) {
        return; // Not readable: the frame keeps its stylesheet ratio.
      }
      if (best) frame.style.aspectRatio = best.width + ' / ' + best.height;
    }
    frame.addEventListener('load', apply);
    apply();
  }

  // Shows a diagram in the page. `figure` holds an iframe `[data-diagram-frame]` and a button `[data-diagram-toggle]`; the
  // diagram is the file `<name>.<lang>.html` next to the page, in archify's embedded mode, drawn again when the language or
  // the theme changes. The button puts the figure over the whole screen (class `diagram--full`) and back; so does Escape.
  function mount(figure, name) {
    const frame = figure.querySelector('[data-diagram-frame]');
    const toggle = figure.querySelector('[data-diagram-toggle]');

    function draw() {
      prepare();
      const framed = url(name + '.' + site.i18n.lang() + '.html', true);
      if (frame.getAttribute('src') !== framed) frame.setAttribute('src', framed);
    }

    function full(on) {
      figure.classList.toggle('diagram--full', on);
      toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
    }

    toggle.addEventListener('click', function () {
      full(!figure.classList.contains('diagram--full'));
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') full(false);
    });
    new MutationObserver(draw).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    onTheme(draw);
    fit(frame);
    full(false);
    draw();
  }

  site.diagram = { url: url, prepare: prepare, onTheme: onTheme, fit: fit, mount: mount };
})();
