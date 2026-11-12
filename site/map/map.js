// map.js — draws the map page from `DynamoSite.map` (map.data.js): one group of buttons per kind of node, and the detail of
// the one picked (what it does, when to use it, where it is, how it connects). It also shows the diagram that Archify drew,
// in the language of the page. Texts are keys of the dictionaries (assets/i18n.js fills them in); the names of the nodes are
// the same in every language and come from the data. A classic script: it works from file://.
(function () {
  'use strict';

  const site = window.DynamoSite;
  const map = site.map;
  const byId = {};
  map.nodes.forEach(function (node) {
    byId[node.id] = node;
  });

  const list = document.querySelector('[data-map-list]');
  const panel = document.querySelector('[data-map-detail]');

  function element(tag, className, attributes, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    Object.keys(attributes || {}).forEach(function (name) {
      node.setAttribute(name, attributes[name]);
    });
    if (text) node.textContent = text;
    return node;
  }

  // A button that picks a node. Those of the list are toggles (`pressed`); those of the detail only jump to the other node.
  function nodeButton(className, node, pressed) {
    const attributes = { type: 'button', 'data-node': node.id };
    if (pressed) attributes['aria-pressed'] = 'false';
    return element('button', className, attributes, node.name);
  }

  // One group per kind, in the order of `map.kinds`, each with its nodes in the order of the data.
  function drawList() {
    map.kinds.forEach(function (kind) {
      const group = element('section', 'map-group', { 'aria-labelledby': 'group-' + kind });
      const title = element('h3', 'map-group__title', { id: 'group-' + kind, 'data-i18n': 'map.kind.' + kind + '.title' });
      const intro = element('p', 'map-group__intro', { 'data-i18n': 'map.kind.' + kind + '.intro' });
      const items = element('ul', 'map-group__list');
      map.nodes
        .filter(function (node) {
          return node.kind === kind;
        })
        .forEach(function (node) {
          const item = element('li');
          item.appendChild(nodeButton('map-node', node, true));
          items.appendChild(item);
        });
      group.append(title, intro, items);
      list.appendChild(group);
    });
  }

  // The edges of a node, outgoing first: the phrase of the type (`.out` or `.in`) and the node on the other end.
  function connections(node) {
    const out = map.edges
      .filter(function (edge) {
        return edge.from === node.id;
      })
      .map(function (edge) {
        return { phrase: 'map.edge.' + edge.type + '.out', other: byId[edge.to] };
      });
    const incoming = map.edges
      .filter(function (edge) {
        return edge.to === node.id;
      })
      .map(function (edge) {
        return { phrase: 'map.edge.' + edge.type + '.in', other: byId[edge.from] };
      });
    return out.concat(incoming);
  }

  function field(key, content) {
    const wrapper = element('div', 'map-field');
    wrapper.append(element('dt', 'map-field__label', { 'data-i18n': key }), content);
    return wrapper;
  }

  function links(node) {
    const found = connections(node);
    if (!found.length) return element('dd', 'map-field__text', { 'data-i18n': 'map.detail.none' });
    const items = found.map(function (link) {
      const item = element('li', 'map-links__item');
      item.append(element('span', 'map-links__phrase', { 'data-i18n': link.phrase }), nodeButton('map-link', link.other, false));
      return item;
    });
    const wrapper = element('dd', 'map-field__text');
    wrapper.appendChild(element('ul', 'map-links')).append(...items);
    return wrapper;
  }

  // Who runs the node, as one phrase; an agent's phrase is followed by its level table (a cell holds spans, never text of its own,
  // because the language layer would replace what a text cell holds).
  function runner(node) {
    const wrapper = element('dd', 'map-field__text');
    wrapper.appendChild(element('p', 'map-runner', { 'data-i18n': 'map.runner.' + node.runner }));
    const levels = site.levels;
    if (node.runner !== 'builder' && node.runner !== 'reviewer') return wrapper;
    const head = element('tr');
    ['map.level.level', 'map.level.model', 'map.level.effort', 'map.level.why'].forEach(function (key) {
      head.appendChild(element('th', '', { scope: 'col', 'data-i18n': key }));
    });
    const rows = Object.keys(levels).map(function (level) {
      const setting = levels[level][node.runner];
      const row = element('tr');
      const name = element('th', '', { scope: 'row' });
      name.appendChild(element('span', '', { 'data-i18n': 'board.level.' + level }));
      const model = element('td');
      model.appendChild(element('code', '', {}, setting.model));
      const effort = element('td');
      effort.appendChild(element('span', '', { 'data-i18n': 'map.effort.' + (setting.effort === null ? 'none' : setting.effort) }));
      const why = element('td');
      why.appendChild(element('span', '', { 'data-i18n': 'map.level.' + level + '.' + node.runner + '.why' }));
      row.append(name, model, effort, why);
      return row;
    });
    const table = element('table', 'map-levels');
    const thead = element('thead');
    thead.appendChild(head);
    const tbody = element('tbody');
    tbody.append(...rows);
    table.append(element('caption', 'map-levels__caption', { 'data-i18n': 'map.level.caption' }), thead, tbody);
    wrapper.append(table, element('p', 'map-levels__default', { 'data-i18n': 'map.level.default' }));
    return wrapper;
  }

  function showDetail(node, focus) {
    const name = element('h3', 'map-detail__name', { tabindex: '-1' }, node.name);
    const kind = element('p', 'map-detail__kind', { 'data-i18n': 'map.kind.' + node.kind });
    const source = element('dd', 'map-field__text');
    source.appendChild(element('code', 'map-detail__source', {}, node.source));
    const text = function (part) {
      return element('dd', 'map-field__text', { 'data-i18n': 'map.node.' + node.id + '.' + part });
    };
    const example = element('dd', 'map-field__text');
    example.appendChild(element('p', 'map-example', { 'data-i18n': 'map.node.' + node.id + '.example' }));
    const fields = element('dl', 'map-fields');
    fields.append(
      field('map.detail.runner', runner(node)),
      field('map.detail.does', text('does')),
      field('map.detail.when', text('when')),
    );
    fields.append(
      field('map.detail.takes', text('takes')),
      field('map.detail.leaves', text('leaves')),
      field('map.detail.source', source),
      field('map.detail.example', example),
      field('map.detail.links', links(node)),
    );
    const close = element('button', 'button button--secondary map-detail__close', { type: 'button', 'data-map-close': '' });
    close.appendChild(element('span', '', { 'data-i18n': 'map.detail.close' }));
    panel.replaceChildren(close, name, kind, fields);
    site.i18n.apply();
    if (focus) name.focus();
  }

  function select(id, focus) {
    const node = byId[id];
    if (!node) return;
    document.querySelectorAll('[data-node]').forEach(function (button) {
      if (button.closest('[data-map-list]')) button.setAttribute('aria-pressed', button.getAttribute('data-node') === id ? 'true' : 'false');
    });
    showDetail(node, focus);
    try {
      window.history.replaceState(null, '', '#' + id);
    } catch (error) {
      // Some file:// pages refuse to rewrite the address: the node is still shown.
    }
  }

  // Closing puts the panel back to its empty text and the focus on the node that was open, so the keyboard does not lose its place.
  function close() {
    const open = list.querySelector('[aria-pressed="true"]');
    if (!open) return;
    document.querySelectorAll('[data-map-list] [data-node]').forEach(function (button) {
      button.setAttribute('aria-pressed', 'false');
    });
    panel.replaceChildren(element('p', 'map-detail__empty', { 'data-i18n': 'map.detail.empty' }));
    site.i18n.apply();
    open.focus();
    try {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch (error) {
      // Some file:// pages refuse to rewrite the address.
    }
  }

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && panel.querySelector('[data-map-close]')) close();
  });

  document.addEventListener('click', function (event) {
    if (event.target.closest('[data-map-close]')) return close();
    const button = event.target.closest('[data-node]');
    if (!button) return;
    select(button.getAttribute('data-node'), !button.closest('[data-map-list]'));
    if (button.closest('[data-map-list]')) panel.scrollIntoView({ block: 'nearest' });
  });

  drawList();
  // The diagram Archify drew exists once per language (map.diagram.<lang>.html): shown in the page by the shared helper.
  site.diagram.mount(document.querySelector('[data-diagram]'), 'map.diagram');
  const asked = window.location.hash.slice(1);
  if (byId[asked]) select(asked, false);
})();
