// story.i18n.js — the texts of the home page's story (the chain, the issues as the source of truth, where it comes from), in
// English and Spanish under the same keys. The lists they belong to are in story.data.js: a step needs
// `chain.step.<id>.title` and `.gains`, a part of the source of truth `truth.item.<id>.title` and `.text`, an idea taken
// `origin.<idea>.idea` and `.adds`.
(function () {
  'use strict';

  window.DynamoSite.i18n.register({
    en: {
      'chain.title': 'The chain: from an idea to one pull request',
      'chain.intro':
        'Four commands, each one leaving the next what it needs. This is what every step gains.',
      'chain.step.discover.title': 'Discover',
      'chain.step.discover.gains':
        'The facts are checked in the repository instead of asked, and every decision is closed before anything is written.',
      'chain.step.spec.title': 'Spec',
      'chain.step.spec.gains':
        'The decisions are written down in one place, so nobody has to remember them and no agent has to guess them.',
      'chain.step.tickets.title': 'Tickets',
      'chain.step.tickets.gains':
        'The spec is cut into vertical slices that each fit one context, with their blockers; you approve the list once.',
      'chain.step.autopilot.title': 'Autopilot',
      'chain.step.autopilot.gains':
        'Each ticket is built, checked and reviewed with no one in front of it, in its own working copy.',
      'chain.step.pr.title': 'One pull request',
      'chain.step.pr.gains': 'You review one pull request instead of a stream of changes: the only thing left that needs you.',
      'truth.title': 'The issues are the one source of truth',
      'truth.intro':
        'Every list of work lives as issues on a board. Nothing depends on a chat that is gone tomorrow, and a new session reads the same place the last one wrote.',
      'truth.item.decisions.title': 'The decisions',
      'truth.item.decisions.text':
        'Each spec closes its decisions and keeps them in its epic, so the agent that builds a ticket reads them instead of guessing.',
      'truth.item.state.title': 'The state',
      'truth.item.state.text':
        'The column of a ticket on the board says where it is: waiting, being built, being checked, in review, merged or stopped for you.',
      'truth.item.why.title': 'The why',
      'truth.item.why.text':
        'The problem, what the change delivers and how it is proved stay in the issue, so months later you can see why a change was made.',
      'origin.title': 'Where it comes from',
      'origin.intro':
        'Dynamo did not invent its method. It took ideas from two people who share their work in public, and added what it needed to run on its own.',
      'origin.repo.label': 'Public repository:',
      'origin.adds.label': 'What Dynamo adds:',
      'origin.pocock-chain.idea':
        'Talk the idea through, check facts instead of asking them, close the decisions, write the spec and split it into vertical slices that each fit one context.',
      'origin.pocock-chain.adds':
        'Each of those steps is a skill of its own, and what they produce is written as issues on a board, so nothing stays in the chat.',
      'origin.pocock-unattended.idea':
        'Once the list is approved, hand it to agents with no human gates: one working copy per ticket and one pull request at the end.',
      'origin.pocock-unattended.adds':
        'A board of eight columns that carries the state, an automatic check and a separate reviewer on every ticket, and a stop that waits for you and resumes where it left off.',
      'origin.tan-never-block.idea':
        '«Never block on the human»: on reversible work, go on, show the result and let the person correct course.',
      'origin.tan-never-block.adds':
        'The run stops only for a decision that is yours, parks the ticket in Needs Human with the reason, and carries on with the rest.',
      'origin.tan-prove-it.idea':
        '«Prove it works»: work in small units that each end in a check against the real result, verified before the next.',
      'origin.tan-prove-it.adds':
        'The check of each ticket is run by the program, not by the agent that wrote the change, and a second agent reviews it by reading the code.',
    },
    es: {
      'chain.title': 'La cadena: de una idea a un solo pull request',
      'chain.intro':
        'Cuatro comandos, cada uno deja al siguiente lo que necesita. Esto es lo que gana cada paso.',
      'chain.step.discover.title': 'Descubrir',
      'chain.step.discover.gains':
        'Los hechos se comprueban en el repositorio en vez de preguntarse, y cada decisión se cierra antes de escribir nada.',
      'chain.step.spec.title': 'Especificar',
      'chain.step.spec.gains':
        'Las decisiones quedan escritas en un solo sitio, así nadie tiene que recordarlas y ningún agente tiene que adivinarlas.',
      'chain.step.tickets.title': 'Tickets',
      'chain.step.tickets.gains':
        'La especificación se corta en rebanadas verticales que caben cada una en un contexto, con sus bloqueos; apruebas la lista una vez.',
      'chain.step.autopilot.title': 'Piloto automático',
      'chain.step.autopilot.gains':
        'Cada ticket se construye, se comprueba y se revisa sin nadie delante, en su propia copia de trabajo.',
      'chain.step.pr.title': 'Un solo pull request',
      'chain.step.pr.gains': 'Revisas un pull request en vez de un reguero de cambios: lo único que aún te necesita.',
      'truth.title': 'Los issues son la única fuente de verdad',
      'truth.intro':
        'Cada lista de trabajo vive como issues en un tablero. Nada depende de un chat que mañana ya no está, y una sesión nueva lee el mismo sitio donde escribió la anterior.',
      'truth.item.decisions.title': 'Las decisiones',
      'truth.item.decisions.text':
        'Cada especificación cierra sus decisiones y las guarda en su épica, así el agente que construye un ticket las lee en vez de adivinar.',
      'truth.item.state.title': 'El estado',
      'truth.item.state.text':
        'La columna de un ticket en el tablero dice dónde está: esperando, en construcción, en comprobación, en revisión, fusionado o parado a la espera de ti.',
      'truth.item.why.title': 'El porqué',
      'truth.item.why.text':
        'El problema, lo que entrega el cambio y cómo se prueba quedan en el issue, así meses después se ve por qué se hizo un cambio.',
      'origin.title': 'De dónde viene',
      'origin.intro':
        'Dynamo no inventó su método. Tomó ideas de dos personas que comparten su trabajo en público, y añadió lo que necesitaba para funcionar solo.',
      'origin.repo.label': 'Repositorio público:',
      'origin.adds.label': 'Lo que añade Dynamo:',
      'origin.pocock-chain.idea':
        'Hablar la idea, comprobar los hechos en vez de preguntarlos, cerrar las decisiones, escribir la especificación y partirla en rebanadas verticales que caben cada una en un contexto.',
      'origin.pocock-chain.adds':
        'Cada uno de esos pasos es una skill propia, y lo que producen se escribe como issues en un tablero, así nada se queda en el chat.',
      'origin.pocock-unattended.idea':
        'Con la lista aprobada, entregarla a agentes sin puertas humanas: una copia de trabajo por ticket y un solo pull request al final.',
      'origin.pocock-unattended.adds':
        'Un tablero de ocho columnas que lleva el estado, una comprobación automática y un revisor aparte en cada ticket, y una parada que espera por ti y se reanuda donde se quedó.',
      'origin.tan-never-block.idea':
        '«Nunca bloquear al humano»: en trabajo reversible, seguir, mostrar el resultado y dejar que la persona corrija el rumbo.',
      'origin.tan-never-block.adds':
        'La ejecución solo se detiene ante una decisión que es tuya, aparca el ticket en Needs Human con el motivo, y sigue con el resto.',
      'origin.tan-prove-it.idea':
        '«Demuéstralo»: trabajar en unidades pequeñas que acaban cada una en una comprobación contra el resultado real, verificada antes de la siguiente.',
      'origin.tan-prove-it.adds':
        'La comprobación de cada ticket la ejecuta el programa, no el agente que escribió el cambio, y un segundo agente lo revisa leyendo el código.',
    },
  });
})();
