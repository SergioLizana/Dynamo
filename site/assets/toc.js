// toc.js — the side index of a subpage: one link per `<h1 id>` and `<h2 id>` of <main> (the title opens the index, so
// a page with one section still has two entries), drawn from the headings themselves, and the
// link of the section in view is marked with `aria-current="true"`. The home page (`data-page="home"`) has none.
// On a wide screen the index sits at the side and stays in view; on a phone it folds above the content, a <details>
// closed by default (the CSS lays it out; this script only opens it on a wide screen and shuts it on a narrow one).
// The text of a link is the heading's own key (`data-i18n`), so it follows the language. Classic script (file://).
(function () {
  'use strict';

  const site = (window.DynamoSite = window.DynamoSite || {});

  // The section in view: the last one whose top has passed `line`; the first when none has. Pure, so it is tested alone.
  function currentId(sections, line) {
    let found = sections.length ? sections[0].id : '';
    sections.forEach(function (section) {
      if (section.top <= line) found = section.id;
    });
    return found;
  }
  site.toc = { currentId: currentId };

  const main = document.querySelector('main');
  if (!main || document.documentElement.dataset.page === 'home') return;
  const headings = Array.prototype.slice.call(main.querySelectorAll('h1[id], h2[id]'));
  if (headings.length < 2) return;

  function element(tag, className, attributes) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    Object.keys(attributes || {}).forEach(function (name) {
      node.setAttribute(name, attributes[name]);
    });
    return node;
  }

  const list = element('ul', 'toc__list');
  const links = {};
  headings.forEach(function (heading) {
    const key = heading.getAttribute('data-i18n');
    const anchor = element('a', 'toc__link', { href: '#' + heading.id });
    if (key) anchor.setAttribute('data-i18n', key);
    else anchor.textContent = heading.textContent;
    const item = element('li', 'toc__item');
    item.appendChild(anchor);
    list.appendChild(item);
    links[heading.id] = anchor;
  });

  const title = element('summary', 'toc__title', { 'data-i18n': 'toc.title' });
  const panel = element('details', 'toc__panel');
  panel.appendChild(title);
  panel.appendChild(list);
  const toc = element('nav', 'toc', { 'data-i18n-attr': 'aria-label:toc.label' });
  toc.appendChild(panel);
  main.insertBefore(toc, main.firstChild);
  main.classList.add('has-toc');

  const wide = window.matchMedia('(min-width: 60rem)');
  function fold() {
    if (wide.matches) panel.setAttribute('open', '');
    else panel.removeAttribute('open');
  }
  fold();
  if (wide.addEventListener) wide.addEventListener('change', fold);

  let marked = '';
  function mark() {
    const line = window.innerHeight / 3;
    const id = currentId(
      headings.map(function (heading) {
        return { id: heading.id, top: heading.getBoundingClientRect().top };
      }),
      line,
    );
    if (id === marked) return;
    if (marked) links[marked].removeAttribute('aria-current');
    marked = id;
    links[id].setAttribute('aria-current', 'true');
  }
  mark();
  window.addEventListener('scroll', mark, { passive: true });
  window.addEventListener('resize', mark);
})();
