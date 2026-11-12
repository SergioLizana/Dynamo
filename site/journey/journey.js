// journey.js — draws, under the board, one prose section per column of the board, from the columns in assets/board.data.js: what
// happens there, who acts, what runs there (the model and effort of the Builder and of the Reviewer come from assets/levels.js)
// and where the card goes next. Every text is a key of the dictionaries (journey.i18n.js, assets/shared.i18n.js) that
// assets/i18n.js fills in, so a language change needs nothing here. Classic script.
(function () {
  'use strict';

  const site = window.DynamoSite;
  const columns = site.boardData.columns;

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

  // An element whose text is a key of the dictionary
  function label(tag, className, key, attributes) {
    return element(tag, className, Object.assign({ 'data-i18n': key }, attributes || {}));
  }

  function plain(tag, className, text) {
    const node = element(tag, className);
    node.textContent = text;
    return node;
  }

  function effortKey(effort) {
    return 'journey.effort.' + (effort === null ? 'none' : effort);
  }

  // What an agent runs with at each level: its model and its effort, one row per level
  function levelTable(agent) {
    const head = element('tr', '', {}, [label('th', '', 'journey.level.level', { scope: 'col' }), label('th', '', 'journey.level.runs', { scope: 'col' })]);
    const rows = Object.keys(site.levels).map(function (level) {
      const setting = site.levels[level][agent];
      // The cell holds spans, never text of its own: the language layer would replace what a text cell holds
      const cell = element('td');
      cell.append(plain('span', '', setting.model + ', '), label('span', '', 'journey.effort'), plain('span', '', ' '), label('span', '', effortKey(setting.effort)));
      return element('tr', '', {}, [element('th', '', { scope: 'row' }, [label('span', '', 'board.level.' + level)]), cell]);
    });
    return element('table', 'level-table', {}, [label('caption', 'level-table__caption', 'journey.level.caption'), element('thead', '', {}, [head]), element('tbody', '', {}, rows)]);
  }

  // A paragraph with its small label above it
  function paragraph(termKey, textKey) {
    return element('p', 'column__text', {}, [label('span', 'column__term', termKey), label('span', '', textKey)]);
  }

  function section(column) {
    const key = 'journey.col.' + column.id;
    const runs = element('div', 'column__runs', {}, [label('span', 'column__term', 'journey.term.runs')]);
    if (site.levels[Object.keys(site.levels)[0]][column.runs]) {
      runs.appendChild(levelTable(column.runs));
    } else {
      runs.appendChild(label('p', 'column__text', 'journey.line.' + column.runs));
    }
    return element('section', 'column', { 'data-column': column.id, 'aria-labelledby': 'column-' + column.id }, [
      element('h3', 'column__title', { id: 'column-' + column.id }, [element('span', 'column__dot', { 'aria-hidden': 'true' }), label('span', '', 'board.col.' + column.id)]),
      paragraph('journey.term.what', key + '.what'),
      element('p', 'column__text', {}, [label('span', 'column__term', 'journey.term.who'), label('span', '', 'board.actor.' + column.actor), plain('span', '', '. '), label('span', '', key + '.who')]),
      runs,
      paragraph('journey.term.next', key + '.next'),
    ]);
  }

  const root = document.querySelector('[data-columns]');
  columns.forEach(function (column) {
    root.appendChild(section(column));
  });
  site.i18n.apply();
})();
