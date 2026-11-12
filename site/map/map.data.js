// map.data.js — the nodes and edges of the map, as data. The page (map.js) draws the lists and the detail from it, and
// `dynamo/tests/site-map.test.ts` checks it against the repository: every skill, agent, hook and subcommand has a node, and
// no node names something that does not exist. Adding a skill, a subcommand, an agent or a hook is adding one node here,
// its five texts in map.i18n.js and its box in the Archify sources (map.en.archify.json and map.es.archify.json).
//   id      `<kind>-<name>`, the same id the Archify sources use for the box
//   kind    skill (skills/<name>/SKILL.md), command (a subcommand of dynamo/dynamo.ts), agent (agents/<name>.md),
//           hook (hooks/hooks.json) or feature (something the engine does that no file of the plugin names)
//   name    what the person types or reads: it is the same in both languages, so it is not in the dictionary
//   source  the file of the repository that holds it
// The texts of a node are the keys `map.node.<id>.does`, `.when`, `.takes`, `.leaves` and `.example` of map.i18n.js.
//   edges   `from` acts on `to`; `type` is one of `edgeTypes` (its two phrases are `map.edge.<type>.out` and `.in`)
(function () {
  'use strict';

  const site = (window.DynamoSite = window.DynamoSite || {});

  site.map = {
    kinds: ['skill', 'command', 'agent', 'hook', 'feature'],
    edgeTypes: ['launches', 'next', 'reads', 'guards', 'shapes'],
    nodes: [
      { id: 'skill-discover', kind: 'skill', name: '/dynamo:discover', source: 'skills/discover/SKILL.md' },
      { id: 'skill-to-spec', kind: 'skill', name: '/dynamo:to-spec', source: 'skills/to-spec/SKILL.md' },
      { id: 'skill-to-tickets', kind: 'skill', name: '/dynamo:to-tickets', source: 'skills/to-tickets/SKILL.md' },
      { id: 'skill-autopilot', kind: 'skill', name: '/dynamo:autopilot', source: 'skills/autopilot/SKILL.md' },
      { id: 'skill-backlog', kind: 'skill', name: '/dynamo:backlog', source: 'skills/backlog/SKILL.md' },
      { id: 'skill-park', kind: 'skill', name: '/dynamo:park', source: 'skills/park/SKILL.md' },
      { id: 'skill-setup', kind: 'skill', name: '/dynamo:setup', source: 'skills/setup/SKILL.md' },
      { id: 'skill-close-release', kind: 'skill', name: '/dynamo:close-release', source: 'skills/close-release/SKILL.md' },
      { id: 'skill-new-release', kind: 'skill', name: '/dynamo:new-release', source: 'skills/new-release/SKILL.md' },

      { id: 'command-run', kind: 'command', name: 'dynamo run', source: 'dynamo/run.ts' },
      { id: 'command-card', kind: 'command', name: 'dynamo card', source: 'dynamo/card.ts' },
      { id: 'command-setup', kind: 'command', name: 'dynamo setup', source: 'dynamo/setup.ts' },
      { id: 'command-release', kind: 'command', name: 'dynamo release', source: 'dynamo/release.ts' },
      { id: 'command-copy', kind: 'command', name: 'dynamo copy', source: 'dynamo/copy.ts' },
      { id: 'command-verify', kind: 'command', name: 'dynamo verify', source: 'dynamo/verify.ts' },
      { id: 'command-merge', kind: 'command', name: 'dynamo merge', source: 'dynamo/merge.ts' },
      { id: 'command-comment', kind: 'command', name: 'dynamo comment', source: 'dynamo/comment.ts' },
      { id: 'command-report', kind: 'command', name: 'dynamo report', source: 'dynamo/report.ts' },
      { id: 'command-board', kind: 'command', name: 'dynamo board', source: 'dynamo/board.ts' },
      { id: 'command-status', kind: 'command', name: 'dynamo status', source: 'dynamo/status.ts' },
      { id: 'command-publish', kind: 'command', name: 'dynamo publish', source: 'dynamo/publish.ts' },

      { id: 'agent-builder', kind: 'agent', name: 'dynamo:builder', source: 'agents/builder.md' },
      { id: 'agent-reviewer', kind: 'agent', name: 'dynamo:reviewer', source: 'agents/reviewer.md' },

      { id: 'hook-outside-writes', kind: 'hook', name: 'outside-writes', source: 'hooks/outside-writes.js' },
      { id: 'hook-main-folder-lock', kind: 'hook', name: 'main-folder-lock', source: 'hooks/main-folder-lock.js' },

      { id: 'feature-levels', kind: 'feature', name: 'levels', source: 'dynamo/levels.ts' },
      { id: 'feature-reinforcement', kind: 'feature', name: 'reinforcement', source: 'dynamo/reinforce.ts' },
      { id: 'feature-resume', kind: 'feature', name: 'resume', source: 'dynamo/resumes.ts' },
    ],
    edges: [
      { from: 'skill-autopilot', to: 'command-run', type: 'launches' },
      { from: 'skill-backlog', to: 'command-card', type: 'launches' },
      { from: 'skill-park', to: 'command-card', type: 'launches' },
      { from: 'skill-setup', to: 'command-setup', type: 'launches' },
      { from: 'skill-close-release', to: 'command-release', type: 'launches' },
      { from: 'skill-new-release', to: 'command-release', type: 'launches' },

      { from: 'command-run', to: 'command-card', type: 'launches' },
      { from: 'command-run', to: 'command-copy', type: 'launches' },
      { from: 'command-run', to: 'command-verify', type: 'launches' },
      { from: 'command-run', to: 'command-merge', type: 'launches' },
      { from: 'command-run', to: 'command-comment', type: 'launches' },
      { from: 'command-run', to: 'command-report', type: 'launches' },
      { from: 'command-run', to: 'command-board', type: 'launches' },
      { from: 'command-run', to: 'agent-builder', type: 'launches' },
      { from: 'command-run', to: 'agent-reviewer', type: 'launches' },

      { from: 'skill-discover', to: 'skill-to-spec', type: 'next' },
      { from: 'skill-discover', to: 'skill-to-tickets', type: 'next' },
      { from: 'skill-to-spec', to: 'skill-to-tickets', type: 'next' },

      { from: 'command-status', to: 'command-run', type: 'reads' },

      { from: 'hook-outside-writes', to: 'agent-builder', type: 'guards' },
      { from: 'hook-main-folder-lock', to: 'command-run', type: 'guards' },

      { from: 'feature-levels', to: 'agent-builder', type: 'shapes' },
      { from: 'feature-levels', to: 'agent-reviewer', type: 'shapes' },
      { from: 'feature-reinforcement', to: 'agent-builder', type: 'shapes' },
      { from: 'feature-reinforcement', to: 'agent-reviewer', type: 'shapes' },
      { from: 'feature-resume', to: 'command-run', type: 'shapes' },
    ],
  };

  // Who runs each node: a skill is read and run by the model of the person's own Claude Code session (`session`); an agent is
  // run by its own level's model and effort (`builder` or `reviewer`, from assets/levels.js); a subcommand, a hook and an engine
  // feature are plain code, no model runs them (`none`).
  site.map.nodes.forEach(function (node) {
    node.runner = node.kind === 'skill' ? 'session' : node.kind === 'agent' ? node.id.slice('agent-'.length) : 'none';
  });
})();
