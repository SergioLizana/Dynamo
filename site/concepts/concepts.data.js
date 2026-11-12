// concepts.data.js — the concepts of the page, as data: one entry per concept, in the order of the page, and the Anthropic
// documentation each general statement rests on. A source has its `id` (the key `concepts.source.<id>` is its title), its
// `url` and `read`, the day it was read (YYYY-MM-DD). When a statement is written or changed, read the source again and
// write that day. No price and no figure of a model goes into the page: they go out of date.
(function () {
  'use strict';

  const site = (window.DynamoSite = window.DynamoSite || {});

  const models = { id: 'models', url: 'https://platform.claude.com/docs/en/models/overview', read: '2026-11-12' };
  const effort = { id: 'effort', url: 'https://platform.claude.com/docs/en/build-with-claude/effort', read: '2026-11-12' };
  const context = { id: 'context', url: 'https://platform.claude.com/docs/en/build-with-claude/context-windows', read: '2026-11-12' };
  const pricing = { id: 'pricing', url: 'https://platform.claude.com/docs/en/about-claude/pricing', read: '2026-11-12' };

  const subagents = { id: 'subagents', url: 'https://code.claude.com/docs/en/sub-agents', read: '2026-11-12' };

  // `files` is what a statement about Dynamo rests on: a file of the repository or an epic (#222 for the levels). Shown as
  // text, not as a link: the repository may be private.
  site.concepts = [
    { id: 'llm', sources: [models] },
    { id: 'model', sources: [models] },
    { id: 'effort', sources: [effort] },
    { id: 'tokens', sources: [pricing, context] },
    { id: 'context', sources: [context] },
    { id: 'agent', sources: [subagents], files: ['agents/builder.md', 'agents/reviewer.md', 'dynamo/agents.ts'] },
    { id: 'two', sources: [], files: ['agents/builder.md', 'agents/reviewer.md', 'dynamo/agents.ts', 'README.md'] },
    { id: 'levels', sources: [], files: ['#222', 'dynamo/levels.ts'] },
    { id: 'why', sources: [], files: ['README.md', 'dynamo/dynamo.ts'] },
  ];
})();
