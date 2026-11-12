// layout.js — draws the header and the footer of every page, so a page holds only `<header data-site-header>` and
// `<footer data-site-footer>`. The menu comes from `DynamoSite.pages` (assets/pages.js); the current page is named by
// `data-page` on <html> and the root of the site by `data-root` (empty on the home page, `../` on a subpage).
// Texts are keys of assets/shared.i18n.js, filled in by assets/i18n.js.
(function () {
  'use strict';

  const site = window.DynamoSite;
  const root = document.documentElement.dataset.root || '';
  const current = document.documentElement.dataset.page || '';

  function element(tag, className, attributes, children) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    Object.keys(attributes || {}).forEach(function (name) {
      node.setAttribute(name, attributes[name]);
    });
    (children || []).forEach(function (child) {
      node.appendChild(child);
    });
    return node;
  }

  function link(className, href, key, id) {
    const anchor = element('a', className, { href: href, 'data-i18n': key });
    if (id && id === current) anchor.setAttribute('aria-current', 'page');
    return anchor;
  }

  function navigation() {
    const entries = [{ id: 'home', href: 'index.html', key: 'nav.home' }].concat(
      site.pages.map(function (page) {
        return { id: page.id, href: page.href, key: 'page.' + page.id + '.title' };
      }),
    );
    const items = entries.map(function (entry) {
      return element('li', '', {}, [link('site-nav__link', root + entry.href, entry.key, entry.id)]);
    });
    return element('nav', 'site-nav', { 'data-i18n-attr': 'aria-label:nav.label' }, [
      element('ul', 'site-nav__list', {}, items),
    ]);
  }

  function languageToggles() {
    const buttons = ['en', 'es'].map(function (code) {
      return element('button', 'toggle', {
        type: 'button',
        lang: code,
        'data-lang-set': code,
        'data-i18n': 'lang.' + code,
        'aria-pressed': 'false',
      });
    });
    return element('div', 'toggle-group', { role: 'group', 'data-i18n-attr': 'aria-label:lang.label' }, buttons);
  }

  function themeToggle() {
    return element('button', 'toggle toggle--single', {
      type: 'button',
      'data-theme-toggle': '',
      'data-i18n': 'theme.toggle',
      'aria-pressed': 'false',
    });
  }

  // The brand: Dynamo's logo, in its dark and its light version; the CSS shows the one of the theme in force.
  function brand() {
    const versions = ['dark', 'light'].map(function (version) {
      return element('img', 'logo logo--' + version, {
        src: root + 'assets/dynamo-logo-' + version + '.svg',
        alt: '',
        'data-i18n-attr': 'alt:logo.alt',
      });
    });
    return element('a', 'brand', { href: root + 'index.html' }, versions);
  }

  document.querySelectorAll('[data-site-header]').forEach(function (header) {
    header.classList.add('site-header');
    const inner = element('div', 'container site-header__inner', {}, [
      brand(),
      navigation(),
      element('div', 'site-header__tools', {}, [languageToggles(), themeToggle()]),
    ]);
    header.append(link('skip-link', '#main', 'skip', ''), inner);
  });

  document.querySelectorAll('[data-site-footer]').forEach(function (footer) {
    footer.classList.add('site-footer');
    footer.appendChild(
      element('div', 'container', {}, [element('p', '', { 'data-i18n': 'footer.text' })]),
    );
  });

  site.theme.sync();
})();
