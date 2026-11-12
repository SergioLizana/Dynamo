// story.data.js — the lists of the home page's story, as data. story.js draws each one into the element marked
// `data-slot="<name>"`; the texts are keys of story.i18n.js, so adding an entry is adding it here plus its texts, in `en`
// and `es`: no markup changes.
//   chain    the steps from an idea to one pull request, in order. `command` is the skill that runs the step (a command is
//            not translated); a step with no command is the result. Texts: `chain.step.<id>.title` and `.gains`.
//   truth    what lives in the issues and on the board. Texts: `truth.item.<id>.title` and `.text`.
//   origins  the people whose public work Dynamo took ideas from: `who`, the `url` of their public repository, the `repo`
//            shown as the link, and the `ideas` taken. Each idea has `origin.<idea>.idea` (what was taken) and
//            `origin.<idea>.adds` (what Dynamo adds to it). A link is read again the day it is written.
(function () {
  'use strict';

  const site = (window.DynamoSite = window.DynamoSite || {});

  site.chain = [
    { id: 'discover', command: '/dynamo:discover' },
    { id: 'spec', command: '/dynamo:to-spec' },
    { id: 'tickets', command: '/dynamo:to-tickets' },
    { id: 'autopilot', command: '/dynamo:autopilot' },
    { id: 'pr', command: null },
  ];

  site.truth = [{ id: 'decisions' }, { id: 'state' }, { id: 'why' }];

  site.origins = [
    {
      id: 'pocock',
      who: 'Matt Pocock',
      url: 'https://github.com/mattpocock/skills',
      repo: 'github.com/mattpocock/skills',
      ideas: ['pocock-chain', 'pocock-unattended'],
    },
    {
      id: 'tan',
      who: 'Lauren Tan',
      url: 'https://github.com/poteto/plugins/tree/main/pstack',
      repo: 'github.com/poteto/plugins/tree/main/pstack',
      ideas: ['tan-never-block', 'tan-prove-it'],
    },
  ];
})();
