// i18n.js — the language layer. Every visible text is a key in a dictionary with `en` and `es` under the same keys;
// the HTML only names the key: `data-i18n="key"` sets the text, `data-i18n-attr="attr:key;attr:key"` sets attributes.
// A page registers its dictionary with `DynamoSite.i18n.register({ en: {...}, es: {...} })` before the page loads
// (deferred scripts run in order, and the text is applied on DOMContentLoaded, after all of them).
// The language is, in this order: `?lang=` in the address, the choice remembered in localStorage (inside try/catch),
// English. Any element with `data-lang-set="es"` selects a language. Relative links carry `?lang=` so the choice
// travels to the other pages. Classic script: it works from file://.
(function () {
  'use strict';

  const site = (window.DynamoSite = window.DynamoSite || {});
  const LANGS = ['en', 'es'];
  const DEFAULT = 'en';
  const KEY = 'dynamo-site-lang';
  const dictionary = { en: {}, es: {} };

  function valid(value) {
    return LANGS.indexOf(value) !== -1;
  }

  function stored() {
    try {
      return window.localStorage.getItem(KEY);
    } catch (error) {
      return null;
    }
  }

  function remember(value) {
    try {
      window.localStorage.setItem(KEY, value);
    } catch (error) {
      // Storage blocked: the choice still travels in the links.
    }
  }

  function fromAddress() {
    try {
      return new URLSearchParams(window.location.search).get('lang');
    } catch (error) {
      return null;
    }
  }

  function resolve() {
    const asked = fromAddress();
    if (valid(asked)) return asked;
    const kept = stored();
    return valid(kept) ? kept : DEFAULT;
  }

  let lang = resolve();

  // Adds the dictionaries of a page. A key that exists in one language and not in the other is reported in the console.
  function register(entries) {
    LANGS.forEach(function (code) {
      Object.assign(dictionary[code], entries[code] || {});
    });
    LANGS.forEach(function (code) {
      Object.keys(dictionary[code]).forEach(function (key) {
        LANGS.forEach(function (other) {
          if (!(key in dictionary[other])) console.warn('i18n: key "' + key + '" is missing in "' + other + '"');
        });
      });
    });
  }

  function t(key) {
    if (key in dictionary[lang]) return dictionary[lang][key];
    return key in dictionary[DEFAULT] ? dictionary[DEFAULT][key] : key;
  }

  // Puts `?lang=` on a relative link, keeping its path, other parameters and hash.
  function withLang(href, code) {
    if (/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) return href;
    const hashAt = href.indexOf('#');
    const hash = hashAt === -1 ? '' : href.slice(hashAt);
    const rest = hashAt === -1 ? href : href.slice(0, hashAt);
    const queryAt = rest.indexOf('?');
    const path = queryAt === -1 ? rest : rest.slice(0, queryAt);
    const params = new URLSearchParams(queryAt === -1 ? '' : rest.slice(queryAt + 1));
    params.set('lang', code);
    return path + '?' + params.toString() + hash;
  }

  function apply() {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach(function (node) {
      node.textContent = t(node.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-attr]').forEach(function (node) {
      node.getAttribute('data-i18n-attr').split(';').forEach(function (pair) {
        const at = pair.indexOf(':');
        if (at > 0) node.setAttribute(pair.slice(0, at).trim(), t(pair.slice(at + 1).trim()));
      });
    });
    document.querySelectorAll('[data-lang-set]').forEach(function (node) {
      node.setAttribute('aria-pressed', node.getAttribute('data-lang-set') === lang ? 'true' : 'false');
    });
    document.querySelectorAll('a[href]').forEach(function (link) {
      link.setAttribute('href', withLang(link.getAttribute('href'), lang));
    });
  }

  function select(code) {
    if (!valid(code)) return;
    lang = code;
    remember(code);
    try {
      const address = new URL(window.location.href);
      address.searchParams.set('lang', code);
      window.history.replaceState(null, '', address);
    } catch (error) {
      // Some file:// pages refuse to rewrite the address: the language is still applied.
    }
    apply();
  }

  document.addEventListener('click', function (event) {
    const button = event.target.closest('[data-lang-set]');
    if (button) select(button.getAttribute('data-lang-set'));
  });

  if (document.readyState === 'complete') apply();
  else document.addEventListener('DOMContentLoaded', apply);

  site.i18n = { register: register, t: t, apply: apply, lang: function () { return lang; } };
})();
