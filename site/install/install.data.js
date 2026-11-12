// install.data.js — the steps of the install simulator, as data. The page (install.js) draws one tab per entry, in this order;
// adding a step is adding one entry here and its texts to install.i18n.js, with no markup change.
//   id      names the step and the keys of its texts: `install.step.<id>.tab`, `.title`, `.text` and, for each `say` and `ask` line, `.<n>`
//   lines   what the terminal shows, in order:
//             { run: 'text', prompt: 'shell' | 'claude' }   a command typed by the person, exactly as README.md gives it (the same in every language)
//             { say: 'n' }                                   a line the terminal prints, text key `install.step.<id>.<n>`
//             { file: 'path', code: ['line', …], rules: 'n' } a file of the project: its path, its lines as written (the same in every
//                                                            language) and the rules of its body, text key `install.step.<id>.<n>`
//             { ask: 'n', choices: ['English', 'Español'] }  a question the skill asks, with its answers
// The example project is `~/code/my-site`: nothing of a real machine or project.
(function () {
  'use strict';

  const site = (window.DynamoSite = window.DynamoSite || {});

  site.install = {
    directory: '~/code/my-site',
    steps: [
      {
        id: 'prepare',
        lines: [
          { run: 'gh auth login', prompt: 'shell' },
          { say: 'login' },
          { run: 'gh auth refresh -s project', prompt: 'shell' },
          { say: 'refresh' },
        ],
      },
      {
        id: 'marketplace',
        lines: [
          { run: 'claude plugin marketplace add SergioLizana/Dynamo', prompt: 'shell' },
          { say: 'added' },
        ],
      },
      {
        id: 'plugin',
        lines: [
          { run: 'claude plugin install dynamo@dynamo --scope project', prompt: 'shell' },
          { say: 'installed' },
        ],
      },
      {
        id: 'setup',
        lines: [
          { run: '/dynamo:setup', prompt: 'claude' },
          { say: 'checks' },
          { ask: 'language', choices: ['English', 'Español'] },
          { say: 'rehearsal' },
          { say: 'written' },
        ],
      },
      {
        id: 'agents',
        lines: [
          {
            file: '.claude/dynamo/reviewer.md',
            code: [
              '---',
              'tools: mcp__playwright__browser_navigate, mcp__playwright__browser_snapshot, mcp__playwright__browser_resize',
              '---',
            ],
            rules: 'rules',
          },
          { say: 'builder' },
          { say: 'limits' },
        ],
      },
      {
        id: 'discover',
        lines: [
          { run: '/dynamo:discover add a dark mode to the settings page', prompt: 'claude' },
          { say: 'rounds' },
          { run: '/dynamo:to-spec', prompt: 'claude' },
          { say: 'spec' },
          { run: '/dynamo:to-tickets', prompt: 'claude' },
          { say: 'tickets' },
        ],
      },
      {
        id: 'autopilot',
        lines: [
          { run: '/dynamo:autopilot', prompt: 'claude' },
          { say: 'running' },
          { say: 'result' },
        ],
      },
      {
        id: 'release',
        lines: [
          { say: 'report' },
          { run: '/dynamo:close-release', prompt: 'claude' },
          { say: 'closed' },
          { run: '/dynamo:new-release patch', prompt: 'claude' },
          { say: 'opened' },
        ],
      },
    ],
  };
})();
