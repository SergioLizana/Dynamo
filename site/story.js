// story.js — draws the home page's story from `DynamoSite.chain`, `DynamoSite.truth` and `DynamoSite.origins`
// (story.data.js) into the elements marked `data-slot="chain"`, `"truth"` and `"origin"`. It holds no text of its own:
// every text is a key that assets/i18n.js fills in.
(function () {
  'use strict';

  const site = window.DynamoSite;

  function element(tag, className, key, attributes) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (key) node.setAttribute('data-i18n', key);
    Object.keys(attributes || {}).forEach(function (name) {
      node.setAttribute(name, attributes[name]);
    });
    return node;
  }

  function chainStep(step) {
    const item = element('li', 'chain__step');
    if (step.command) {
      const command = element('p', 'chain__command');
      const code = document.createElement('code');
      code.textContent = step.command;
      command.appendChild(code);
      item.appendChild(command);
    }
    item.append(
      element('h3', 'chain__title', 'chain.step.' + step.id + '.title'),
      element('p', 'chain__gains', 'chain.step.' + step.id + '.gains'),
    );
    return item;
  }

  function truthItem(entry) {
    const item = element('li', 'truth__item');
    item.append(
      element('h3', 'truth__title', 'truth.item.' + entry.id + '.title'),
      element('p', 'truth__text', 'truth.item.' + entry.id + '.text'),
    );
    return item;
  }

  function idea(id) {
    const item = element('li', 'origin__idea');
    const adds = element('p', 'origin__adds');
    adds.append(
      element('strong', 'origin__adds-label', 'origin.adds.label'),
      document.createTextNode(' '),
      element('span', '', 'origin.' + id + '.adds'),
    );
    item.append(element('p', 'origin__taken', 'origin.' + id + '.idea'), adds);
    return item;
  }

  function origin(entry) {
    const item = element('li', 'origin');
    const who = element('h3', 'origin__who');
    who.textContent = entry.who;
    const link = element('a', 'origin__link', '', { href: entry.url, rel: 'noopener noreferrer' });
    link.textContent = entry.repo;
    const repo = element('p', 'origin__repo');
    repo.append(element('span', 'origin__repo-label', 'origin.repo.label'), document.createTextNode(' '), link);

    const ideas = element('ul', 'origin__ideas');
    entry.ideas.forEach(function (id) {
      ideas.appendChild(idea(id));
    });
    item.append(who, repo, ideas);
    return item;
  }

  function fill(name, tag, className, entries, draw) {
    document.querySelectorAll('[data-slot="' + name + '"]').forEach(function (slot) {
      const list = element(tag, className);
      entries.forEach(function (entry) {
        list.appendChild(draw(entry));
      });
      slot.appendChild(list);
    });
  }

  fill('chain', 'ol', 'chain', site.chain, chainStep);
  fill('truth', 'ul', 'truth', site.truth, truthItem);
  fill('origin', 'ul', 'origins', site.origins, origin);
})();
