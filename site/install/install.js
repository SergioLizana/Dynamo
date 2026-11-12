// install.js — draws the install simulator from `DynamoSite.install` (install.data.js): a tab per step, the simulated terminal
// of the one shown, and Back / Next. Mouse and keyboard both work: the tabs answer to the arrow keys, Home and End, and the
// buttons to Enter and Space. Every text is a key of the dictionaries (assets/i18n.js fills them in); commands are data, the
// same in both languages. A classic script: it works from file://.
(function () {
  'use strict';

  const site = window.DynamoSite;
  const data = site.install;
  const steps = data.steps;

  const tabs = document.querySelector('[data-sim-tabs]');
  const panel = document.querySelector('[data-sim-panel]');
  const title = document.querySelector('[data-sim-title]');
  const text = document.querySelector('[data-sim-text]');
  const terminal = document.querySelector('[data-sim-terminal]');
  const back = document.querySelector('[data-sim-back]');
  const next = document.querySelector('[data-sim-next]');
  const count = document.querySelector('[data-sim-count]');

  let current = 0;

  function element(tag, className, attributes, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    Object.keys(attributes || {}).forEach(function (name) {
      node.setAttribute(name, attributes[name]);
    });
    if (content) node.textContent = content;
    return node;
  }

  function key(step, part) {
    return 'install.step.' + step.id + '.' + part;
  }

  function drawTabs() {
    panel.id = 'sim-panel';
    steps.forEach(function (step, index) {
      const tab = element('button', 'sim__tab', {
        type: 'button',
        role: 'tab',
        id: 'sim-tab-' + step.id,
        'aria-controls': 'sim-panel',
        'data-step': String(index),
      });
      tab.append(element('span', 'sim__tab-number', {}, String(index + 1)), element('span', '', { 'data-i18n': key(step, 'tab') }));
      tabs.appendChild(tab);
    });
  }

  // One line of the terminal: a typed command after its prompt, a printed line, or a question with its answers.
  function drawLine(step, line) {
    if (line.run) {
      const row = element('p', 'sim__line sim__line--run');
      const prompt = line.prompt === 'claude' ? '>' : data.directory + ' $';
      row.append(element('span', 'sim__prompt', {}, prompt), element('code', 'sim__command', {}, line.run));
      return row;
    }
    if (line.file) {
      const row = element('div', 'sim__line sim__file');
      row.appendChild(element('p', 'sim__file-path', {}, line.file));
      row.appendChild(element('pre', 'sim__file-code', {}, line.code.join('\n')));
      row.appendChild(element('p', 'sim__file-rules', { 'data-i18n': key(step, line.rules) }));
      return row;
    }
    if (line.ask) {
      const row = element('div', 'sim__line sim__line--ask');
      row.appendChild(element('p', 'sim__question', { 'data-i18n': key(step, line.ask) }));
      const choices = element('ul', 'sim__choices');
      line.choices.forEach(function (choice, index) {
        choices.appendChild(element('li', index === 0 ? 'sim__choice sim__choice--picked' : 'sim__choice', {}, choice));
      });
      row.appendChild(choices);
      return row;
    }
    return element('p', 'sim__line sim__line--say', { 'data-i18n': key(step, line.say) });
  }

  function show(index) {
    current = Math.max(0, Math.min(steps.length - 1, index));
    const step = steps[current];
    tabs.querySelectorAll('[data-step]').forEach(function (tab) {
      const selected = Number(tab.getAttribute('data-step')) === current;
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      tab.setAttribute('tabindex', selected ? '0' : '-1');
      if (selected) panel.setAttribute('aria-labelledby', tab.id);
    });
    title.setAttribute('data-i18n', key(step, 'title'));
    text.setAttribute('data-i18n', key(step, 'text'));
    terminal.replaceChildren.apply(
      terminal,
      step.lines.map(function (line) {
        return drawLine(step, line);
      }),
    );
    back.disabled = current === 0;
    next.disabled = current === steps.length - 1;
    count.textContent = current + 1 + ' / ' + steps.length;
    site.i18n.apply();
    try {
      window.history.replaceState(null, '', '#' + step.id);
    } catch (error) {
      // Some file:// pages refuse to rewrite the address: the step is still shown.
    }
  }

  tabs.addEventListener('click', function (event) {
    const tab = event.target.closest('[data-step]');
    if (tab) show(Number(tab.getAttribute('data-step')));
  });

  // Arrow keys move between the tabs (the focused one is the shown one), Home and End jump to the first and the last.
  tabs.addEventListener('keydown', function (event) {
    const moves = { ArrowRight: current + 1, ArrowDown: current + 1, ArrowLeft: current - 1, ArrowUp: current - 1, Home: 0, End: steps.length - 1 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    show(moves[event.key]);
    tabs.querySelector('[data-step="' + current + '"]').focus();
  });

  back.addEventListener('click', function () {
    show(current - 1);
  });
  next.addEventListener('click', function () {
    show(current + 1);
  });

  drawTabs();
  const asked = steps.findIndex(function (step) {
    return step.id === window.location.hash.slice(1);
  });
  show(asked === -1 ? 0 : asked);
})();
