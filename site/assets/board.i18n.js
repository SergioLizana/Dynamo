// board.i18n.js — the texts of the animated board (assets/board.js), in English and Spanish under the same keys: its labels, who acts in
// each column, the three example tickets, the line a card shows in each state (`board.note.<note>`) and the sentence of each beat
// (`board.beat.<n>`, the «What just happened» line). The names of the columns and of the levels are in assets/shared.i18n.js.
// The tickets are of a made-up project (a recipe app); the numbers in the sentences are the numbers on the cards.
(function () {
  'use strict';

  window.DynamoSite.i18n.register({
    en: {
      'board.label': 'The eight columns of the board, with three example tickets',
      'board.frame': 'The board: scroll sideways to see every column',
      'board.card.open': 'Open ticket',
      'board.what': 'What just happened:',
      'board.open': 'See the board',
      'board.close': 'Close',
      'board.modal': 'The board, full screen',

      'board.actor.you': 'You',
      'board.actor.builder': 'The Builder',
      'board.actor.program': 'The program',
      'board.actor.reviewer': 'The Reviewer',

      'board.ticket.a': 'Add a search box',
      'board.ticket.b': 'Save favourite recipes',
      'board.ticket.c': 'Choose the sign-in method',

      'board.note.ready': 'Ready: waits its turn',
      'board.note.building': 'The Builder is at work',
      'board.note.checking': 'Checks running',
      'board.note.passed': 'Checks passed',
      'board.note.pass': 'Reviewer: PASS',
      'board.note.merged': 'Merged',
      'board.note.failedChecks': 'Checks failed: back to Build',
      'board.note.asks': 'The Builder asks: needs you',
      'board.note.answered': 'You answered: it goes on',
      'board.note.resumed': 'The Builder resumes where it stopped',

      'board.beat.0': 'Three tickets of an example project wait in Todo. Dynamo will run at most 3 at once.',
      'board.beat.1': 'The program takes #1 and #2 and moves them to Build: a Builder starts on each.',
      'board.beat.2': '#3 starts too, and #1 is built, so its checks run in Verify. Three tickets are between Build and Merge: the limit.',
      'board.beat.3': '#1 passes its checks and goes to Review. #3’s Builder needs a decision only you can take, so its card stops in Needs Human and frees its slot.',
      'board.beat.4': 'The Reviewer says PASS on #1, so it goes to Merge. #2 is built and goes to Verify.',
      'board.beat.5': '#1 is merged and is Done. #2 fails its checks and goes back to Build.',
      'board.beat.6': 'You answer #3 and move it from Needs Human to Todo.',
      'board.beat.7': '#2 is fixed and goes to Verify. #3 goes on in Build, the phase where it stopped.',
      'board.beat.8': '#2 passes its checks and goes to Review. #3 is built and goes to Verify.',
      'board.beat.9': 'The Reviewer says PASS on #2, which goes to Merge. #3 passes its checks and goes to Review.',
      'board.beat.10': '#2 is merged and Done. #3 gets PASS and goes to Merge.',
      'board.beat.11': '#3 is merged: all three tickets are Done. The board rests a moment and starts again.',
    },
    es: {
      'board.label': 'Las ocho columnas del tablero, con tres tickets de ejemplo',
      'board.frame': 'El tablero: desplázate hacia los lados para ver todas las columnas',
      'board.card.open': 'Ticket abierto',
      'board.what': 'Lo que acaba de pasar:',
      'board.open': 'Ver el tablero',
      'board.close': 'Cerrar',
      'board.modal': 'El tablero, a pantalla completa',

      'board.actor.you': 'Tú',
      'board.actor.builder': 'El Builder',
      'board.actor.program': 'El programa',
      'board.actor.reviewer': 'El Reviewer',

      'board.ticket.a': 'Añadir un buscador',
      'board.ticket.b': 'Guardar recetas favoritas',
      'board.ticket.c': 'Elegir el método de acceso',

      'board.note.ready': 'Listo: espera su turno',
      'board.note.building': 'El Builder trabaja',
      'board.note.checking': 'Checks en marcha',
      'board.note.passed': 'Checks superados',
      'board.note.pass': 'Reviewer: PASS',
      'board.note.merged': 'Fusionado',
      'board.note.failedChecks': 'Los checks fallaron: vuelve a Build',
      'board.note.asks': 'El Builder pregunta: te necesita',
      'board.note.answered': 'Respondiste: sigue adelante',
      'board.note.resumed': 'El Builder sigue donde se quedó',

      'board.beat.0': 'Tres tickets de un proyecto de ejemplo esperan en Todo. Dynamo ejecutará como máximo 3 a la vez.',
      'board.beat.1': 'El programa toma el #1 y el #2 y los mueve a Build: un Builder empieza con cada uno.',
      'board.beat.2': 'También empieza el #3, y el #1 está construido, así que sus checks corren en Verify. Hay tres tickets entre Build y Merge: el límite.',
      'board.beat.3': 'El #1 supera sus checks y pasa a Review. El Builder del #3 necesita una decisión que solo tú puedes tomar, así que su tarjeta se para en Needs Human y libera su hueco.',
      'board.beat.4': 'El Reviewer dice PASS al #1, que pasa a Merge. El #2 está construido y pasa a Verify.',
      'board.beat.5': 'El #1 se fusiona y queda Done. El #2 falla sus checks y vuelve a Build.',
      'board.beat.6': 'Respondes al #3 y lo mueves de Needs Human a Todo.',
      'board.beat.7': 'El #2 está arreglado y pasa a Verify. El #3 sigue en Build, la fase donde se quedó.',
      'board.beat.8': 'El #2 supera sus checks y pasa a Review. El #3 está construido y pasa a Verify.',
      'board.beat.9': 'El Reviewer dice PASS al #2, que pasa a Merge. El #3 supera sus checks y pasa a Review.',
      'board.beat.10': 'El #2 se fusiona y queda Done. El #3 recibe PASS y pasa a Merge.',
      'board.beat.11': 'El #3 se fusiona: los tres tickets están Done. El tablero descansa un momento y vuelve a empezar.',
    },
  });
})();
