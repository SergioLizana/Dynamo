// board.player.js — the logic of the animated board, apart from the page: where every card is after a given beat, which cards have to
// slide between two drawings, and the player that walks the beats (one every 4 seconds, a pause at the end, then it starts
// again). No DOM here, so it can be tested alone; assets/board.js draws it. The player always plays, reduced motion or not (only
// the slide of the cards depends on it). Classic script.
(function () {
  'use strict';

  const site = (window.DynamoSite = window.DynamoSite || {});
  const BEAT_MS = 4000; // between two beats while the board plays
  const END_MS = 6000; // how long the board rests with every ticket Done, before it starts again
  const SLIDE_MS = 600; // how long a card takes to slide to its new column

  // The board after `index` beats (0 is the start): the cards of each column from the top down, the line each card shows and
  // the sentence key of what just happened. Built by replaying the data, so going back is the same as going forward.
  function stateAt(data, index) {
    const columns = {};
    const notes = {};
    data.columns.forEach(function (column) {
      columns[column.id] = [];
    });
    function put(entry, onTop) {
      Object.keys(columns).forEach(function (id) {
        columns[id] = columns[id].filter(function (ticket) {
          return ticket !== entry.id;
        });
      });
      if (onTop) columns[entry.to].unshift(entry.id);
      else columns[entry.to].push(entry.id);
      notes[entry.id] = entry.note;
    }
    data.start.forEach(function (entry) {
      put(entry, false);
    });
    data.beats.slice(0, index).forEach(function (beat) {
      beat.moves.forEach(function (entry) {
        put(entry, true);
      });
    });
    return { columns: columns, notes: notes, what: 'board.beat.' + index };
  }

  // The cards that must slide between two drawings: `before` and `after` map a ticket to its place on the screen. None when
  // the person asked for reduced motion (the cards jump), or when a card has not moved.
  // `turned` is true when the board is turned 90° clockwise (the modal on an upright phone): a card's own axes are then not the
  // screen's, so the shift on the screen (x, y) is the card's (y, -x).
  function slides(before, after, animate, turned) {
    if (!animate) return [];
    return Object.keys(after)
      .filter(function (id) {
        return before[id] && (Math.abs(before[id].left - after[id].left) > 0.5 || Math.abs(before[id].top - after[id].top) > 0.5);
      })
      .map(function (id) {
        const x = before[id].left - after[id].left;
        const y = before[id].top - after[id].top;
        return turned ? { id: id, dx: y, dy: -x } : { id: id, dx: x, dy: y };
      });
  }

  // options: count (of drawings, the start included), onChange(index), timers (setTimeout and clearTimeout)
  function createPlayer(options) {
    const last = options.count - 1;
    let current = 0;
    let timer = null;

    function go(index) {
      current = Math.max(0, Math.min(last, index));
      options.onChange(current);
    }

    function pause() {
      if (timer === null) return;
      options.timers.clearTimeout(timer);
      timer = null;
    }

    // Each beat is its own timeout: the last one waits longer, then the board goes back to the start and goes on
    function schedule() {
      timer = options.timers.setTimeout(function () {
        go(current === last ? 0 : current + 1);
        schedule();
      }, current === last ? END_MS : BEAT_MS);
    }

    function play() {
      if (timer !== null) return;
      schedule();
    }

    return {
      index: function () {
        return current;
      },
      playing: function () {
        return timer !== null;
      },
      go: go,
      play: play,
      pause: pause,
    };
  }

  site.board = Object.assign(site.board || {}, {
    BEAT_MS: BEAT_MS,
    END_MS: END_MS,
    SLIDE_MS: SLIDE_MS,
    stateAt: stateAt,
    slides: slides,
    createPlayer: createPlayer,
  });
})();
