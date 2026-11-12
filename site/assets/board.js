// board.js — the board, one component for the whole site: the eight columns of a GitHub-Projects-style board and three example
// tickets moving across them at once, one beat every 4 seconds. Below 640 px wide the board is not in the page: a «See the board»
// button opens it in a full-screen modal (turned 90° while the phone is upright, so it reads in landscape). It is drawn from `DynamoSite.boardData` (assets/board.data.js)
// and replayed by assets/board.player.js. Any element with `data-board` is filled in when the page loads. It starts playing
// when it scrolls into view and plays by itself, with no controls,. A card that changes column
// slides to the top of its new column and the others close the gap; where the person asked for reduced motion the board still
// plays and the cards jump. The look is in assets/board.css. Every text is a key of the
// shared dictionary. Classic script.
(function () {
  'use strict';

  const site = window.DynamoSite;
  const data = site.boardData;
  const count = data.beats.length + 1;
  const motion = window.matchMedia('(prefers-reduced-motion: no-preference)');
  const SVG = 'http://www.w3.org/2000/svg';

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

  // The icon of an open ticket: a ring with a dot, drawn here, in the colour of the column it is in
  function icon() {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('class', 'board__icon');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('role', 'img');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('data-i18n-attr', 'aria-label:board.card.open');
    [['circle', { cx: 8, cy: 8, r: 6, class: 'board__icon-ring' }], ['circle', { cx: 8, cy: 8, r: 2, class: 'board__icon-dot' }]].forEach(function (part) {
      const shape = document.createElementNS(SVG, part[0]);
      Object.keys(part[1]).forEach(function (name) {
        shape.setAttribute(name, String(part[1][name]));
      });
      svg.appendChild(shape);
    });
    return svg;
  }

  // One card per ticket, for the whole life of the board: it is moved from column to column, never drawn again
  function makeCard(ticket) {
    const note = label('p', 'board__note', 'board.note.ready');
    const level = label('span', 'board__level', 'board.level.' + ticket.level);
    const head = element('div', 'board__card-head', {}, [icon(), plain('span', 'board__number', '#' + ticket.number)]);
    const node = element('li', 'board__card', { 'data-ticket': ticket.id }, [
      head,
      label('p', 'board__title', 'board.ticket.' + ticket.id),
      element('div', 'board__card-foot', {}, [level]),
      note,
    ]);
    return { node: node, note: note };
  }

  function mount(root) {
    const cards = {};
    const bodies = {};
    const counts = {};

    // --- The board: one lane per column, in a frame that scrolls sideways on a phone ---
    const grid = element('ol', 'board', { 'data-i18n-attr': 'aria-label:board.label' });
    data.columns.forEach(function (column) {
      const body = element('ol', 'board__body');
      const total = plain('span', 'board__count', '0');
      const head = element('div', 'board__head', {}, [
        element('span', 'board__dot', { 'aria-hidden': 'true' }),
        label('h3', 'board__name', 'board.col.' + column.id),
        total,
      ]);
      const lane = element('li', 'board__column', { 'data-column': column.id }, [head, label('p', 'board__actor', 'board.actor.' + column.actor), body]);
      bodies[column.id] = body;
      counts[column.id] = total;
      grid.appendChild(lane);
    });
    const frame = element('div', 'board-frame', { role: 'group', tabindex: '0', 'data-i18n-attr': 'aria-label:board.frame' }, [grid]);
    data.tickets.forEach(function (ticket) {
      cards[ticket.id] = makeCard(ticket);
    });

    // --- What just happened, and the controls ---
    const what = element('p', 'board-what visually-hidden', { role: 'status' });
    const whatText = label('span', '', 'board.beat.0');
    what.append(label('strong', 'board-what__term', 'board.what'), plain('span', '', ' '), whatText);

    // --- The stage: on a phone (under 640 px) the board is not in the page, only the «See the board» button, and the stage
    // is a full-screen modal; elsewhere the stage is the board in the page, and the button and Close are hidden ---
    const open = label('button', 'button board-open', 'board.open', { type: 'button', 'aria-haspopup': 'dialog' });
    const close = label('button', 'button button--secondary board-close', 'board.close', { type: 'button' });
    const inner = element('div', 'board-stage__inner', {}, [close, frame, what]);
    const stage = element('div', 'board-stage', { 'data-i18n-attr': 'aria-label:board.modal' }, [inner]);
    [open, stage].forEach(function (part) {
      root.appendChild(part);
    });
    const phone = window.matchMedia('(max-width: 39.99rem)');
    const upright = window.matchMedia('(orientation: portrait)');
    // The modal turns the board 90° when the phone is held upright, so that it reads in landscape (see assets/board.css)
    function turned() {
      return stage.classList.contains('board-stage--modal') && upright.matches;
    }

    // --- Drawing a beat ---
    function places() {
      const found = {};
      Object.keys(cards).forEach(function (id) {
        if (!cards[id].node.isConnected) return;
        const box = cards[id].node.getBoundingClientRect();
        // A board that is not shown (a phone with the modal closed) has no place: its cards do not slide
        if (box.width === 0 && box.height === 0) return;
        found[id] = { left: box.left, top: box.top };
      });
      return found;
    }

    function draw(index) {
      const state = site.board.stateAt(data, index);
      const before = places();
      data.columns.forEach(function (column) {
        state.columns[column.id].forEach(function (id) {
          bodies[column.id].appendChild(cards[id].node);
        });
        counts[column.id].textContent = String(state.columns[column.id].length);
      });
      Object.keys(cards).forEach(function (id) {
        cards[id].note.setAttribute('data-i18n', 'board.note.' + state.notes[id]);
      });
      whatText.setAttribute('data-i18n', state.what);
      site.i18n.apply();
      // The cards that changed place start from where they were and slide: the others, closing a gap, do the same
      site.board.slides(before, places(), motion.matches, turned()).forEach(function (slide) {
        cards[slide.id].node.animate(
          [{ transform: 'translate(' + slide.dx + 'px, ' + slide.dy + 'px)', zIndex: 2 }, { transform: 'none', zIndex: 2 }],
          { duration: site.board.SLIDE_MS, easing: 'ease-out' },
        );
      });
    }

    const player = site.board.createPlayer({
      count: count,
      onChange: draw,
      timers: { setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window) },
    });

    // The line is not seen, but a screen reader still announces each beat
    what.setAttribute('aria-live', 'polite');
    draw(0);

    // --- The modal of a phone: it opens from the button, starts the board from the beginning and gives the page back on Close ---
    function openModal() {
      stage.classList.add('board-stage--modal');
      stage.setAttribute('role', 'dialog');
      stage.setAttribute('aria-modal', 'true');
      document.documentElement.classList.add('board-modal-open');
      site.i18n.apply();
      player.go(0);
      player.play();
      close.focus();
    }

    function closeModal() {
      if (!stage.classList.contains('board-stage--modal')) return;
      player.pause();
      stage.classList.remove('board-stage--modal');
      stage.removeAttribute('role');
      stage.removeAttribute('aria-modal');
      document.documentElement.classList.remove('board-modal-open');
      open.focus();
    }

    open.addEventListener('click', openModal);
    close.addEventListener('click', closeModal);
    stage.addEventListener('keydown', function (event) {
      if (!stage.classList.contains('board-stage--modal')) return;
      if (event.key === 'Escape') {
        closeModal();
        return;
      }
      if (event.key !== 'Tab') return;
      // Focus stays inside the modal
      const items = Array.prototype.filter.call(stage.querySelectorAll('button, [tabindex="0"]'), function (item) {
        return !item.disabled && !item.hidden;
      });
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    // Back on a wide screen, the board is in the page again: the modal is closed
    phone.addEventListener('change', function () {
      if (!phone.matches) closeModal();
    });

    // The board sits down the page: it starts playing when it scrolls into view, not before. On a phone it is in the modal, which
    // starts it when it opens.
    if ('IntersectionObserver' in window) {
      const watcher = new IntersectionObserver(
        function (entries) {
          if (phone.matches || !entries.some(function (entry) { return entry.isIntersecting; })) return;
          watcher.disconnect();
          player.play();
        },
        { threshold: 0.5 },
      );
      watcher.observe(root);
    } else if (!phone.matches) {
      player.play();
    }
    return player;
  }

  site.board.mount = mount;
  document.querySelectorAll('[data-board]').forEach(mount);
})();
