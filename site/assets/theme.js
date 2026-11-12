// theme.js — the light and dark theme. A classic script loaded in <head> (no defer) so the theme is set before the
// first paint. It starts from the choice remembered in localStorage (inside try/catch: it may be blocked, as on some
// file:// pages) and, with none, from `prefers-color-scheme`. The theme lives in `data-theme` on <html>, which
// tokens.css reads. Any element with `data-theme-toggle` switches it; the click is delegated, so the header can be
// drawn later by assets/layout.js.
(function () {
  'use strict';

  const site = (window.DynamoSite = window.DynamoSite || {});
  const KEY = 'dynamo-site-theme';
  const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function stored() {
    try {
      const value = window.localStorage.getItem(KEY);
      return value === 'light' || value === 'dark' ? value : null;
    } catch (error) {
      return null;
    }
  }

  function remember(theme) {
    try {
      window.localStorage.setItem(KEY, theme);
    } catch (error) {
      // Storage blocked: the choice lasts for this page only.
    }
  }

  function current() {
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  }

  // The toggle is a button with `aria-pressed`: pressed means dark.
  function sync() {
    const pressed = current() === 'dark' ? 'true' : 'false';
    document.querySelectorAll('[data-theme-toggle]').forEach(function (button) {
      button.setAttribute('aria-pressed', pressed);
    });
  }

  function apply(theme) {
    document.documentElement.dataset.theme = theme;
    sync();
  }

  apply(stored() || (media && media.matches ? 'dark' : 'light'));

  document.addEventListener('click', function (event) {
    if (event.target.closest('[data-theme-toggle]')) {
      const next = current() === 'dark' ? 'light' : 'dark';
      remember(next);
      apply(next);
    }
  });

  // While nobody has chosen, the page follows the system.
  if (media && media.addEventListener) {
    media.addEventListener('change', function (event) {
      if (!stored()) apply(event.matches ? 'dark' : 'light');
    });
  }

  document.addEventListener('DOMContentLoaded', sync);

  site.theme = { current: current, sync: sync };
})();
