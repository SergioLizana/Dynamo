// install.i18n.js — the texts of the install simulator, in English and Spanish under the same keys: the page's own texts and,
// for every step of install.data.js, `install.step.<id>.tab`, `.title`, `.text` and one key per line the terminal prints or asks.
// What the terminal prints is a short sketch of what the real command does, not a copy of its output.
(function () {
  'use strict';

  window.DynamoSite.i18n.register({
    en: {
      'install.page.title': 'Install simulator',
      'install.sim.title': 'Install Dynamo, step by step',
      'install.sim.lead':
        'Everything it takes to run Dynamo, from a clean machine to the first list of tickets turned into a pull request, in a simulated terminal. The example project is my-site; the commands are the ones of the README.',
      'install.sim.repo': 'Open Dynamo on GitHub',
      'install.sim.heading': 'The steps',
      'install.sim.tabs': 'Install steps',
      'install.sim.back': 'Back',
      'install.sim.next': 'Next',
      'install.sim.hint': 'Use the buttons, or the arrow keys on the tabs, Home and End to move between steps.',

      'install.step.prepare.tab': 'Prerequisites',
      'install.step.prepare.title': 'Prepare your machine',
      'install.step.prepare.text':
        'You need Claude Code, signed in; Node.js 24.22.2, because Dynamo runs TypeScript directly and an older Node may not run it; git, with a name and an email; and the GitHub CLI, signed in with access to Projects. Your project must be a cloned GitHub repository with at least one commit.',
      'install.step.prepare.login': 'You are signed in to GitHub.',
      'install.step.prepare.refresh': 'The project scope is added, so Dynamo can use the board.',

      'install.step.marketplace.tab': 'Marketplace',
      'install.step.marketplace.title': 'Add the marketplace',
      'install.step.marketplace.text': 'From a terminal at the root of your project, tell Claude Code where Dynamo is published.',
      'install.step.marketplace.added': 'The marketplace dynamo is added.',

      'install.step.plugin.tab': 'Plugin',
      'install.step.plugin.title': 'Install the plugin',
      'install.step.plugin.text':
        'The project scope installs the plugin for this project only, so Dynamo stays out of your other projects. Then open Claude Code in the project, or restart the session, so that the skills and agents load.',
      'install.step.plugin.installed': 'The plugin dynamo is installed for this project.',

      'install.step.setup.tab': 'Setup',
      'install.step.setup.title': 'Set up your project',
      'install.step.setup.text':
        'The skill reads your project’s scripts, proposes your automatic checks and asks you to confirm them and to choose the language of the documents. Each check is rehearsed once, in a clean copy, before anything is written.',
      'install.step.setup.checks': 'Checks found in your scripts: lint, test and build. Do you confirm them?',
      'install.step.setup.language': 'In which language should tickets, specs and verdicts be written?',
      'install.step.setup.rehearsal': 'Rehearsing each check in a clean copy… all of them pass.',
      'install.step.setup.written':
        'Board linked, factory.json and settings.json written, labels created, everything committed on the release branch. Push it with the git command shown.',

      'install.step.agents.tab': 'Agents (optional)',
      'install.step.agents.title': 'Customize the agents (optional)',
      'install.step.agents.text':
        'Dynamo’s Builder and Reviewer carry the tools every project has. If yours needs more, a browser to check a page for example, add them in a file committed in the project; with no file, they run as they are and keep getting Dynamo’s improvements.',
      'install.step.agents.rules':
        'Body: when a checkbox is about what a page shows, open it with the browser tools and look at it at 1024 px and at 390 px wide before judging; a checkbox about a page that nobody saw is not proven.',
      'install.step.agents.builder':
        'The file .claude/dynamo/builder.md reinforces the Builder the same way: a tools: line and the rules in its body.',
      'install.step.agents.limits':
        'A reinforcement only adds. It cannot remove Dynamo’s rules or tools, change the model or the effort, or give the Reviewer Edit or Write.',

      'install.step.discover.tab': 'Tickets',
      'install.step.discover.title': 'Write the tickets',
      'install.step.discover.text':
        'The discovery asks you in rounds until every decision is closed, the spec writes those decisions as an epic, and the tickets are created on the board only once you approve the list.',
      'install.step.discover.rounds': 'Round 1 of questions… every decision is closed. Result: one spec.',
      'install.step.discover.spec': 'The epic is written as an issue.',
      'install.step.discover.tickets': 'The tickets are proposed with their blockers. Approved: created on the board.',

      'install.step.autopilot.tab': 'Launch',
      'install.step.autopilot.title': 'Launch the list',
      'install.step.autopilot.text':
        'The list runs in the background, but the agents run on your computer, so it has to stay on. Name tickets to build only those; with none, every ticket that is ready is built.',
      'install.step.autopilot.running': 'Each ticket: build, check, review, merge into the release branch.',
      'install.step.autopilot.result': 'The list ends with one JSON line: the result of each ticket.',

      'install.step.release.tab': 'Release',
      'install.step.release.title': 'Review and release',
      'install.step.release.text':
        'Read the report, push the release branch and open the pull request with the commands the JSON line gives: Dynamo does not run them, that step is yours. Once the pull request is merged, close the release; when you decide to start the next one, open it.',
      'install.step.release.report': 'The release report is in .claude/worktrees/release-report-<base>.md.',
      'install.step.release.closed': 'The milestone, the tag and the GitHub Release are made.',
      'install.step.release.opened': 'The next release branch is made and checked out.',
    },
    es: {
      'install.page.title': 'Simulador de instalación',
      'install.sim.title': 'Instala Dynamo, paso a paso',
      'install.sim.lead':
        'Todo lo que hace falta para ejecutar Dynamo, desde una máquina limpia hasta la primera lista de tickets convertida en una pull request, en un terminal simulado. El proyecto de ejemplo es my-site; los comandos son los del README.',
      'install.sim.repo': 'Abrir Dynamo en GitHub',
      'install.sim.heading': 'Los pasos',
      'install.sim.tabs': 'Pasos de la instalación',
      'install.sim.back': 'Atrás',
      'install.sim.next': 'Siguiente',
      'install.sim.hint': 'Usa los botones, o las flechas en las pestañas, Inicio y Fin para moverte entre pasos.',

      'install.step.prepare.tab': 'Requisitos',
      'install.step.prepare.title': 'Prepara tu máquina',
      'install.step.prepare.text':
        'Necesitas Claude Code, con la sesión iniciada; Node.js 24.22.2, porque Dynamo ejecuta TypeScript directamente y un Node más antiguo puede no poder; git, con nombre y correo; y la CLI de GitHub, con la sesión iniciada y acceso a Projects. Tu proyecto debe ser un repositorio de GitHub clonado con al menos un commit.',
      'install.step.prepare.login': 'Has iniciado sesión en GitHub.',
      'install.step.prepare.refresh': 'Se añade el permiso project, para que Dynamo pueda usar el tablero.',

      'install.step.marketplace.tab': 'Marketplace',
      'install.step.marketplace.title': 'Añade el marketplace',
      'install.step.marketplace.text': 'Desde un terminal en la raíz de tu proyecto, dile a Claude Code dónde está publicado Dynamo.',
      'install.step.marketplace.added': 'El marketplace dynamo está añadido.',

      'install.step.plugin.tab': 'Plugin',
      'install.step.plugin.title': 'Instala el plugin',
      'install.step.plugin.text':
        'El ámbito project instala el plugin solo para este proyecto, así que Dynamo queda fuera de tus otros proyectos. Después abre Claude Code en el proyecto, o reinicia la sesión, para que carguen las skills y los agentes.',
      'install.step.plugin.installed': 'El plugin dynamo está instalado para este proyecto.',

      'install.step.setup.tab': 'Configuración',
      'install.step.setup.title': 'Configura tu proyecto',
      'install.step.setup.text':
        'La skill lee los scripts de tu proyecto, propone tus comprobaciones automáticas y te pide confirmarlas y elegir el idioma de los documentos. Cada comprobación se ensaya una vez, en una copia limpia, antes de escribir nada.',
      'install.step.setup.checks': 'Comprobaciones encontradas en tus scripts: lint, test y build. ¿Las confirmas?',
      'install.step.setup.language': '¿En qué idioma se escriben los tickets, las specs y los veredictos?',
      'install.step.setup.rehearsal': 'Ensayando cada comprobación en una copia limpia… todas pasan.',
      'install.step.setup.written':
        'Tablero enlazado, factory.json y settings.json escritos, etiquetas creadas, todo confirmado en la rama de release. Súbela con el comando git que se muestra.',

      'install.step.agents.tab': 'Agentes (opcional)',
      'install.step.agents.title': 'Personaliza los agentes (opcional)',
      'install.step.agents.text':
        'El Builder y el Reviewer de Dynamo llevan las herramientas que tiene todo proyecto. Si el tuyo necesita más, un navegador para comprobar una página por ejemplo, añádelas en un fichero confirmado en el proyecto; sin fichero, funcionan tal cual y siguen recibiendo las mejoras de Dynamo.',
      'install.step.agents.rules':
        'Cuerpo: cuando una casilla trate de lo que muestra una página, ábrela con las herramientas del navegador y mírala a 1024 px y a 390 px de ancho antes de juzgar; una casilla sobre una página que nadie vio no está demostrada.',
      'install.step.agents.builder':
        'El fichero .claude/dynamo/builder.md refuerza al Builder del mismo modo: una línea tools: y las reglas en su cuerpo.',
      'install.step.agents.limits':
        'Un refuerzo solo añade. No puede quitar reglas ni herramientas de Dynamo, cambiar el modelo ni el esfuerzo, ni dar Edit o Write al Reviewer.',

      'install.step.discover.tab': 'Tickets',
      'install.step.discover.title': 'Escribe los tickets',
      'install.step.discover.text':
        'El descubrimiento te pregunta por rondas hasta cerrar cada decisión, la spec escribe esas decisiones como una épica, y los tickets se crean en el tablero solo cuando apruebas la lista.',
      'install.step.discover.rounds': 'Ronda 1 de preguntas… todas las decisiones cerradas. Resultado: una spec.',
      'install.step.discover.spec': 'La épica está escrita como una issue.',
      'install.step.discover.tickets': 'Se proponen los tickets con sus bloqueos. Aprobados: creados en el tablero.',

      'install.step.autopilot.tab': 'Lanzar',
      'install.step.autopilot.title': 'Lanza la lista',
      'install.step.autopilot.text':
        'La lista corre en segundo plano, pero los agentes corren en tu ordenador, así que debe seguir encendido. Nombra tickets para construir solo esos; sin ninguno, se construyen todos los que están listos.',
      'install.step.autopilot.running': 'Cada ticket: construir, comprobar, revisar y fusionar en la rama de release.',
      'install.step.autopilot.result': 'La lista termina con una línea JSON: el resultado de cada ticket.',

      'install.step.release.tab': 'Release',
      'install.step.release.title': 'Revisa y publica',
      'install.step.release.text':
        'Lee el informe, sube la rama de release y abre la pull request con los comandos que da la línea JSON: Dynamo no los ejecuta, ese paso es tuyo. Cuando la pull request esté fusionada, cierra la release; cuando decidas empezar la siguiente, ábrela.',
      'install.step.release.report': 'El informe de la release está en .claude/worktrees/release-report-<base>.md.',
      'install.step.release.closed': 'Se crean el hito, la etiqueta y la GitHub Release.',
      'install.step.release.opened': 'Se crea la siguiente rama de release y se cambia a ella.',
    },
  });
})();
