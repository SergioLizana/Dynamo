// board.data.js — the board's simulation, as data: three example tickets of a made-up project moving across the eight columns of
// the board, one beat at a time, as `dynamo run` would move them with `project.ticketsAtOnce` set to 3. assets/board.player.js
// replays it (`DynamoSite.board.stateAt`), assets/board.js draws it, and journey/journey.js reads the columns for the prose.
//   columns   the eight columns, in order, each with `actor`, who acts there (`board.actor.<actor>`), and `runs`, what runs there:
//             `session` (the model and effort of your Claude Code session), `program` (no model) or an agent (`builder`,
//             `reviewer`), whose model and effort at each level come from assets/levels.js
//   slots     how many tickets may be between Build and Merge at once (`running`); only one may be in Merge
//   tickets   one per card: its `number`, its `level` and its title `board.ticket.<id>`
//   start     where every ticket is before the first beat, and the line of its card (`board.note.<note>`)
//   beats     what changes at each beat: `moves` (one or two cards, each to a column, with the line it shows there) and the
//             sentence `board.beat.<n>` that says what just happened. A card is put on top of the column it arrives in.
//   Tickets: 1 goes straight to Done; 2 fails in Verify and goes back to Build; 3 stops in Needs Human and, once you move it to
//   Todo, goes on in Build, the phase where it stopped.
// A test (dynamo/tests/site-board.test.ts) replays the beats and checks the limits, so a change here cannot break them.
(function () {
  'use strict';

  const site = (window.DynamoSite = window.DynamoSite || {});

  function move(id, to, note) {
    return { id: id, to: to, note: note };
  }

  site.boardData = {
    columns: [
      { id: 'backlog', actor: 'you', runs: 'session' },
      { id: 'todo', actor: 'program', runs: 'program' },
      { id: 'build', actor: 'builder', runs: 'builder' },
      { id: 'verify', actor: 'program', runs: 'program' },
      { id: 'review', actor: 'reviewer', runs: 'reviewer' },
      { id: 'merge', actor: 'program', runs: 'program' },
      { id: 'needs-human', actor: 'you', runs: 'session' },
      { id: 'done', actor: 'you', runs: 'session' },
    ],

    // The columns that count against `slots`: from Build up to and including Merge
    running: ['build', 'verify', 'review', 'merge'],
    slots: 3,

    tickets: [
      { id: 'a', number: 1, level: 'low' },
      { id: 'b', number: 2, level: 'medium' },
      { id: 'c', number: 3, level: 'high' },
    ],

    // The order is the order from the top of Todo down
    start: [move('a', 'todo', 'ready'), move('b', 'todo', 'ready'), move('c', 'todo', 'ready')],

    beats: [
      { moves: [move('a', 'build', 'building'), move('b', 'build', 'building')] },
      { moves: [move('c', 'build', 'building'), move('a', 'verify', 'checking')] },
      { moves: [move('a', 'review', 'passed'), move('c', 'needs-human', 'asks')] },
      { moves: [move('a', 'merge', 'pass'), move('b', 'verify', 'checking')] },
      { moves: [move('a', 'done', 'merged'), move('b', 'build', 'failedChecks')] },
      { moves: [move('c', 'todo', 'answered')] },
      { moves: [move('b', 'verify', 'checking'), move('c', 'build', 'resumed')] },
      { moves: [move('b', 'review', 'passed'), move('c', 'verify', 'checking')] },
      { moves: [move('b', 'merge', 'pass'), move('c', 'review', 'passed')] },
      { moves: [move('b', 'done', 'merged'), move('c', 'merge', 'pass')] },
      { moves: [move('c', 'done', 'merged')] },
    ],
  };
})();
