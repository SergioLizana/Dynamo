// levels.js — the model and the effort of each level, the one copy every page of the site reads (the journey's steps take it as
// `site.journey.levels`). It mirrors STARTING in dynamo/levels.ts, and dynamo/tests/site-levels.test.ts fails when the two differ.
// `effort: null` is no `--effort` at all: the agent runs with the effort of its own file or of its model.
(function () {
  'use strict';

  const site = (window.DynamoSite = window.DynamoSite || {});

  site.levels = {
    low: { builder: { model: 'sonnet', effort: 'low' }, reviewer: { model: 'sonnet', effort: 'medium' } },
    medium: { builder: { model: 'sonnet', effort: 'medium' }, reviewer: { model: 'sonnet', effort: 'high' } },
    high: { builder: { model: 'sonnet', effort: 'high' }, reviewer: { model: 'opus', effort: null } },
  };
})();
