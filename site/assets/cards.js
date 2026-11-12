// cards.js — draws one card per entry of `DynamoSite.pages` (assets/pages.js) into every element marked
// `data-cards`. The card has no text of its own: it names the keys `page.<id>.title`, `page.<id>.text` and
// `page.<id>.preview`, and assets/i18n.js fills them in. Links are relative to the root of the site (`data-root` on
// <html>, empty on the home page, `../` on a subpage).
(function () {
  'use strict';

  const site = window.DynamoSite;
  const root = document.documentElement.dataset.root || '';

  function element(tag, className, attributes) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    Object.keys(attributes || {}).forEach(function (name) {
      node.setAttribute(name, attributes[name]);
    });
    return node;
  }

  function card(page) {
    const item = element('li', 'card');

    // The SVG is drawn from the constant list in pages.js; the wrapper describes it for people who cannot see it.
    const preview = element('div', 'card__preview', {
      role: 'img',
      'data-i18n-attr': 'aria-label:page.' + page.id + '.preview',
    });
    preview.innerHTML = page.preview;
    preview.querySelector('svg').setAttribute('aria-hidden', 'true');

    const body = element('div', 'card__body');
    const title = element('h3', 'card__title');
    const link = element('a', 'card__link', { href: root + page.href, 'data-i18n': 'page.' + page.id + '.title' });
    title.appendChild(link);
    const text = element('p', 'card__text', { 'data-i18n': 'page.' + page.id + '.text' });
    body.append(title, text);

    item.append(preview, body);
    return item;
  }

  document.querySelectorAll('[data-cards]').forEach(function (list) {
    site.pages.forEach(function (page) {
      list.appendChild(card(page));
    });
  });
})();
