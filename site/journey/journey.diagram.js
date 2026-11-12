// journey.diagram.js — shows the diagram of the whole board, drawn with the archify skill (journey.board.<lang>.json, drawn
// into journey.board.<lang>.html next to it), in the page with the shared `DynamoSite.diagram.mount` (assets/diagram.js).
// Classic script.
(function () {
  'use strict';

  window.DynamoSite.diagram.mount(document.querySelector('[data-diagram]'), 'journey.board');
})();
