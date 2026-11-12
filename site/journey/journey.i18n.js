// journey.i18n.js — the texts of the journey page («The board at work»), in English and Spanish under the same keys: its titles,
// the labels of the prose, and the prose of each column (`journey.col.<column>.what`, `.who` and `.next`). The names of the
// columns and of who acts are in assets/shared.i18n.js and assets/board.i18n.js. The diagram (journey.board.<lang>.json, drawn
// with archify) carries its own text in each language, in its own file.
(function () {
  'use strict';

  window.DynamoSite.i18n.register({
    en: {
      'journey.page.title': 'The board at work: Dynamo',
      'journey.title': 'The board at work',
      'journey.lead':
        'Dynamo does not move one ticket at a time. Watch three example tickets cross the board at once, within a limit, and then read what happens in each column.',
      'journey.walk.title': 'Three tickets at once',
      'journey.walk.intro':
        'Each beat moves one or two cards.',
      'journey.columns.title': 'Column by column',
      'journey.columns.intro':
        'The eight columns of the board, in order: what happens in each one, who acts, what runs there, and where the card goes next, also backwards.',
      'journey.term.what': 'What happens',
      'journey.term.who': 'Who acts',
      'journey.term.runs': 'Runs with',
      'journey.term.next': 'Where the card goes next',
      'journey.line.session': 'The model and effort of your Claude Code session',
      'journey.line.program': 'No model: it is Dynamo’s own code',
      'journey.effort': 'effort',
      'journey.effort.low': 'low',
      'journey.effort.medium': 'medium',
      'journey.effort.high': 'high',
      'journey.effort.none': 'its own',
      'journey.level.caption': 'Each ticket has a level. It sets the model and the effort its two agents run with.',
      'journey.level.level': 'Level',
      'journey.level.runs': 'Model and effort',
      'journey.diagram.title': 'The whole board, as a diagram',
      'journey.diagram.text':
        'The same journey as one diagram: the main path across the columns, the way back to Build while a round is left, and the stop in Needs Human.',
      'journey.diagram.source': 'Its source is journey.board.en.json, next to the page, drawn with the archify skill.',

      'journey.col.backlog.what':
        'Something worth doing comes up. You put it on the board with /dynamo:backlog, as one short note and nothing more: it is not a ticket yet. When it is worth doing, you run /dynamo:discover, /dynamo:to-spec and /dynamo:to-tickets. The questions are closed one by one, a spec is written, and the work is cut into small tickets, each with checkboxes that can be proven, its blockers and a Level line.',
      'journey.col.backlog.who': 'With Claude, in your own session.',
      'journey.col.backlog.next': 'When the tickets are written, /dynamo:to-tickets moves their cards to Todo.',
      'journey.col.todo.what':
        'A ticket in Todo is ready and waits for its turn. It does not start while a ticket it depends on is still open, nor while every slot is taken: Dynamo runs at most as many tickets at once as project.ticketsAtOnce says, 3 on the board above. You run /dynamo:autopilot and walk away; the program takes the tickets that are ready, reads the Level line of each and creates a branch and its own copy of the repository, so nothing touches your main branch.',
      'journey.col.todo.who': 'It picks the tickets that are ready.',
      'journey.col.todo.next':
        'To Build when it is its turn. A ticket you answered in Needs Human comes back here, and goes on from the phase where it stopped.',
      'journey.col.build.what':
        'The program moves the card to Build and starts the Builder. It reads the ticket, writes the failing test first, makes it pass, commits, and brings the release branch into its own. When the ticket needs a decision only you can take, the Builder does not guess: it says what is missing and stops. A second round starts with exactly what failed and fixes that and nothing more: a ticket gets at most two rounds.',
      'journey.col.build.who': 'An agent the program starts, with the level of the ticket.',
      'journey.col.build.next':
        'To Verify when it is done, or to Needs Human when it stops to ask. It comes back here from Verify when the checks fail, and from Review when the Reviewer says FAIL, while a round is left.',
      'journey.col.verify.what':
        'The program runs your checks: tests, linter, build. Nothing reaches the Reviewer unless they pass. When one fails, its output is kept word for word for the next round.',
      'journey.col.verify.who': 'It runs the checks, with no agent.',
      'journey.col.verify.next': 'To Review when the checks pass; back to Build when they fail and a round is left.',
      'journey.col.review.what':
        'A separate, read-only Reviewer, with no part in the Builder’s conversation, reads the ticket and the change and checks every checkbox against evidence. It can only say PASS or FAIL, and it leaves a verdict comment on the ticket with the evidence for each checkbox.',
      'journey.col.review.who': 'An agent the program starts, with the level of the ticket.',
      'journey.col.review.next': 'To Merge on PASS; back to Build on FAIL while a round is left.',
      'journey.col.merge.what':
        'The program merges the ticket’s branch into the release branch, one ticket at a time, however many are ready. It leaves a merge commit on the release branch and a result comment on the ticket with its cost. If the merge conflicts, it counts like a failed round.',
      'journey.col.merge.who': 'It makes the merge.',
      'journey.col.merge.next': 'To Done when the merge is made; back to Build if it conflicts and a round is left.',
      'journey.col.needs-human.what':
        'The Builder stopped because only you can decide something, or the ticket hit a time limit, a budget or a missing result. The program writes a comment with what it needs and keeps the copy, the branch and the Builder’s conversation as they are. You read it and answer in a comment of your own. A stop by a limit needs no answer.',
      'journey.col.needs-human.who': 'Reading the comment and answering it.',
      'journey.col.needs-human.next':
        'You take the card out of Needs Human, to Todo, and launch /dynamo:autopilot again. The program finds the copy and the branch where they were, gives the Builder your answer and resumes its own conversation, so the ticket goes on from the phase where it stopped and does not start over.',
      'journey.col.done.what':
        'The ticket is merged. The program never pushes during a run and never touches your main branch. When the list ends you read the release report, open the pull request and approve it.',
      'journey.col.done.who': 'The pull request is yours to approve.',
      'journey.col.done.next': 'Nowhere: the ticket is finished.',
    },
    es: {
      'journey.page.title': 'El tablero en marcha: Dynamo',
      'journey.title': 'El tablero en marcha',
      'journey.lead':
        'Dynamo no mueve un ticket cada vez. Mira cómo tres tickets de ejemplo cruzan el tablero a la vez, dentro de un límite, y después lee qué pasa en cada columna.',
      'journey.walk.title': 'Tres tickets a la vez',
      'journey.walk.intro':
        'Cada tiempo mueve una o dos tarjetas.',
      'journey.columns.title': 'Columna por columna',
      'journey.columns.intro':
        'Las ocho columnas del tablero, en orden: qué pasa en cada una, quién actúa, qué se ejecuta allí y adónde va la tarjeta después, también hacia atrás.',
      'journey.term.what': 'Qué pasa',
      'journey.term.who': 'Quién actúa',
      'journey.term.runs': 'Se ejecuta con',
      'journey.term.next': 'Adónde va la tarjeta después',
      'journey.line.session': 'El modelo y el esfuerzo de tu sesión de Claude Code',
      'journey.line.program': 'Sin modelo: es código propio de Dynamo',
      'journey.effort': 'esfuerzo',
      'journey.effort.low': 'bajo',
      'journey.effort.medium': 'medio',
      'journey.effort.high': 'alto',
      'journey.effort.none': 'el suyo',
      'journey.level.caption': 'Cada ticket tiene un nivel. Fija el modelo y el esfuerzo con que se ejecutan sus dos agentes.',
      'journey.level.level': 'Nivel',
      'journey.level.runs': 'Modelo y esfuerzo',
      'journey.diagram.title': 'El tablero entero, como diagrama',
      'journey.diagram.text':
        'El mismo viaje en un solo diagrama: el camino principal por las columnas, la vuelta a Build mientras queda una ronda y la parada en Needs Human.',
      'journey.diagram.source': 'Su fuente es journey.board.es.json, junto a la página, dibujada con la skill archify.',

      'journey.col.backlog.what':
        'Surge algo que merece la pena hacer. Lo pones en el tablero con /dynamo:backlog, en una nota corta y nada más: todavía no es un ticket. Cuando merece la pena, ejecutas /dynamo:discover, /dynamo:to-spec y /dynamo:to-tickets. Las preguntas se cierran una a una, se escribe una spec y el trabajo se corta en tickets pequeños, cada uno con casillas que se pueden demostrar, sus bloqueos y una línea de nivel.',
      'journey.col.backlog.who': 'Con Claude, en tu propia sesión.',
      'journey.col.backlog.next': 'Cuando los tickets están escritos, /dynamo:to-tickets mueve sus tarjetas a Todo.',
      'journey.col.todo.what':
        'Un ticket en Todo está listo y espera su turno. No empieza mientras siga abierto un ticket del que depende, ni mientras todos los huecos estén ocupados: Dynamo ejecuta a la vez como máximo los tickets que diga project.ticketsAtOnce, 3 en el tablero de arriba. Ejecutas /dynamo:autopilot y te vas; el programa toma los tickets que están listos, lee la línea de nivel de cada uno y crea una rama y su propia copia del repositorio, así que nada toca tu rama principal.',
      'journey.col.todo.who': 'Elige los tickets que están listos.',
      'journey.col.todo.next':
        'A Build cuando le toca. Un ticket al que respondiste en Needs Human vuelve aquí y sigue desde la fase donde se detuvo.',
      'journey.col.build.what':
        'El programa mueve la tarjeta a Build y arranca al Builder. Lee el ticket, escribe primero la prueba que falla, la hace pasar, hace commit y trae la rama de release a la suya. Cuando el ticket necesita una decisión que solo tú puedes tomar, el Builder no adivina: dice qué falta y se detiene. Una segunda ronda empieza con exactamente lo que falló y arregla eso y nada más: un ticket tiene como máximo dos rondas.',
      'journey.col.build.who': 'Un agente que arranca el programa, con el nivel del ticket.',
      'journey.col.build.next':
        'A Verify cuando termina, o a Needs Human cuando se detiene a preguntar. Vuelve aquí desde Verify cuando los checks fallan, y desde Review cuando el Reviewer dice FAIL, mientras queda una ronda.',
      'journey.col.verify.what':
        'El programa ejecuta tus checks: pruebas, linter, build. Nada llega al Reviewer si no pasan. Cuando uno falla, su salida se guarda palabra por palabra para la ronda siguiente.',
      'journey.col.verify.who': 'Ejecuta los checks, sin ningún agente.',
      'journey.col.verify.next': 'A Review cuando los checks pasan; de vuelta a Build cuando fallan y queda una ronda.',
      'journey.col.review.what':
        'Un Reviewer aparte, de solo lectura y sin parte en la conversación del Builder, lee el ticket y el cambio y comprueba cada casilla con pruebas. Solo puede decir PASS o FAIL, y deja en el ticket un comentario con el veredicto y la prueba de cada casilla.',
      'journey.col.review.who': 'Un agente que arranca el programa, con el nivel del ticket.',
      'journey.col.review.next': 'A Merge con un PASS; de vuelta a Build con un FAIL mientras queda una ronda.',
      'journey.col.merge.what':
        'El programa fusiona la rama del ticket en la rama de release, un ticket a la vez, aunque haya varios listos. Deja un commit de fusión en la rama de release y un comentario de resultado en el ticket con su coste. Si la fusión tiene conflicto, cuenta como una ronda fallida.',
      'journey.col.merge.who': 'Hace la fusión.',
      'journey.col.merge.next': 'A Done cuando se hace la fusión; de vuelta a Build si hay conflicto y queda una ronda.',
      'journey.col.needs-human.what':
        'El Builder se detuvo porque solo tú puedes decidir algo, o el ticket llegó a un tiempo máximo, un presupuesto o un resultado que falta. El programa escribe un comentario con lo que necesita y conserva la copia, la rama y la conversación del Builder tal como estaban. Lo lees y respondes con un comentario tuyo. Una parada por un límite no necesita respuesta.',
      'journey.col.needs-human.who': 'Leyendo el comentario y respondiéndolo.',
      'journey.col.needs-human.next':
        'Sacas la tarjeta de Needs Human, a Todo, y vuelves a lanzar /dynamo:autopilot. El programa encuentra la copia y la rama donde estaban, le da al Builder tu respuesta y retoma su propia conversación, así que el ticket sigue desde la fase donde se detuvo y no empieza de cero.',
      'journey.col.done.what':
        'El ticket está fusionado. El programa nunca hace push durante una ejecución ni toca tu rama principal. Cuando acaba la lista lees el informe de la release, abres el pull request y lo apruebas.',
      'journey.col.done.who': 'El pull request es tuyo para aprobarlo.',
      'journey.col.done.next': 'A ninguna parte: el ticket ha terminado.',
    },
  });
})();
