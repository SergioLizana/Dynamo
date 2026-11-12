// home.i18n.js — the texts of the home page itself (the hero, the board's title, «Take it apart» and the install), in
// English and Spanish under the same keys. The story's texts are in story.i18n.js and the pages' names and texts
// (`page.<id>.*`) in assets/shared.i18n.js.
(function () {
  'use strict';

  window.DynamoSite.i18n.register({
    en: {
      'page.title': 'Dynamo: ideas that do not get lost, one pull request to approve',
      'hero.title': 'Ideas get lost in the chat. Every session starts from zero.',
      'hero.promise':
        'Dynamo is an agent factory for Claude Code. It writes your ideas down as tickets on a board, builds, checks and reviews them with no one in front, and hands you one pull request to approve.',
      'hero.cta': 'Take it apart',
      'board.title': 'Watch the board',
      'board.intro': 'Three example tickets cross the eight columns of the board at once, within a limit, as they do in a real run.',
      'board.more': 'See the board at work',
      'explore.title': 'Take it apart',
      'explore.intro': 'Three pages show how Dynamo works and how to set it up.',
      'install.title': 'Install it',
      'install.requirements':
        'You need Claude Code, Node.js 24.22.2, git and the GitHub CLI. Run these two commands at the root of your project.',
      'install.commands': 'Install commands',
      'install.copy': 'Copy the install commands',
      'install.copy.label': 'Copy',
    },
    es: {
      'page.title': 'Dynamo: ideas que no se pierden, un solo pull request que aprobar',
      'hero.title': 'Las ideas se pierden en el chat. Cada sesión empieza de cero.',
      'hero.promise':
        'Dynamo es una fábrica de agentes para Claude Code. Escribe tus ideas como tickets en un tablero, los construye, comprueba y revisa sin nadie delante, y te entrega un solo pull request que aprobar.',
      'hero.cta': 'Desmóntalo',
      'board.title': 'Mira el tablero',
      'board.intro': 'Tres tickets de ejemplo cruzan a la vez las ocho columnas del tablero, dentro de un límite, como en una ejecución real.',
      'board.more': 'Ver el tablero en marcha',
      'explore.title': 'Desmóntalo',
      'explore.intro': 'Tres páginas muestran cómo funciona Dynamo y cómo ponerlo en marcha.',
      'install.title': 'Instálalo',
      'install.requirements':
        'Necesitas Claude Code, Node.js 24.22.2, git y la CLI de GitHub. Ejecuta estos dos comandos en la raíz de tu proyecto.',
      'install.commands': 'Comandos de instalación',
      'install.copy': 'Copiar los comandos de instalación',
      'install.copy.label': 'Copiar',
    },
  });
})();
