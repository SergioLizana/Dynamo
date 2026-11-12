// concepts.js — draws the concepts page from `DynamoSite.concepts` (concepts.data.js): one section per concept with its
// title, its paragraphs and the sources it rests on, each with the day it was read. Every text is a key of the dictionary
// (`concepts.<id>.title`, `.p1`, `.p2`) that assets/i18n.js fills in. It runs before assets/toc.js, so the side index finds
// the headings. A classic script: it works from file://.
(function () {
  'use strict';

  const concepts = window.DynamoSite.concepts;
  const slot = document.querySelector('[data-slot="concepts"]');
  if (!slot) return;

  function element(tag, className, attributes) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    Object.keys(attributes || {}).forEach(function (name) {
      node.setAttribute(name, attributes[name]);
    });
    return node;
  }

  function source(entry) {
    const item = element('li', 'concept__source');
    const link = element('a', null, { href: entry.url, target: '_blank', rel: 'noopener', 'data-i18n': 'concepts.source.' + entry.id });
    const read = element('span', 'concept__read');
    const day = element('time', null, { datetime: entry.read });
    day.textContent = entry.read;
    read.append(element('span', null, { 'data-i18n': 'concepts.read' }), document.createTextNode(' '), day);
    item.append(link, document.createTextNode(' · '), read);
    return item;
  }

  concepts.forEach(function (concept) {
    const section = element('section', 'section', { 'aria-labelledby': 'concept-' + concept.id });
    const box = element('div', 'container');
    const sources = element('ul', 'concept__sources');
    concept.sources.forEach(function (entry) {
      sources.appendChild(source(entry));
    });
    box.append(
      element('h2', null, { id: 'concept-' + concept.id, 'data-i18n': 'concepts.' + concept.id + '.title' }),
      element('p', 'measure', { 'data-i18n': 'concepts.' + concept.id + '.p1' }),
      element('p', 'measure', { 'data-i18n': 'concepts.' + concept.id + '.p2' })
    );
    if (concept.files) {
      const files = element('p', 'concept__files');
      files.append(element('span', null, { 'data-i18n': 'concepts.files' }), document.createTextNode(' '));
      concept.files.forEach(function (name, index) {
        if (index) files.appendChild(document.createTextNode(', '));
        const code = element('code');
        code.textContent = name;
        files.appendChild(code);
      });
      box.appendChild(files);
    }
    if (concept.sources.length) box.appendChild(sources);
    section.appendChild(box);
    slot.appendChild(section);
  });
})();
