// pages.js — the list of subpages of the site, as data. The header (assets/layout.js) draws its menu from it and the
// home page (via assets/cards.js) draws one card per entry. Adding a subpage is adding one entry here plus its texts in
// the dictionary of the home page: `page.<id>.title`, `page.<id>.text` and `page.<id>.preview` (the description of the
// preview for people who cannot see it), under `en` and `es`.
//   id       names the folder and the keys of the texts
//   href     the page, from the root of the site (a folder link would not open from file://, so it names index.html)
//   preview  a small inline SVG, coloured only through the classes of assets/components.css (no screenshots)
(function () {
  'use strict';

  const site = (window.DynamoSite = window.DynamoSite || {});

  site.pages = [
    {
      id: 'journey',
      href: 'journey/index.html',
      // The eight columns of the board, each in its lane colour, with a few cards in them
      preview:
        '<svg viewBox="0 0 240 120" focusable="false">' +
        '<rect class="pv-surface" x="3" y="6" width="26" height="108" rx="4"/>' +
        '<rect class="lane-fill-backlog" x="3" y="6" width="26" height="6" rx="3"/>' +
        '<rect class="lane-fill-backlog" x="7" y="18" width="18" height="10" rx="2"/>' +
        '<rect class="lane-fill-backlog" x="7" y="32" width="18" height="10" rx="2"/>' +
        '<rect class="lane-fill-backlog" x="7" y="46" width="18" height="10" rx="2"/>' +
        '<rect class="pv-surface" x="32" y="6" width="26" height="108" rx="4"/>' +
        '<rect class="lane-fill-todo" x="32" y="6" width="26" height="6" rx="3"/>' +
        '<rect class="lane-fill-todo" x="36" y="18" width="18" height="10" rx="2"/>' +
        '<rect class="lane-fill-todo" x="36" y="32" width="18" height="10" rx="2"/>' +
        '<rect class="pv-surface" x="61" y="6" width="26" height="108" rx="4"/>' +
        '<rect class="lane-fill-build" x="61" y="6" width="26" height="6" rx="3"/>' +
        '<rect class="lane-fill-build" x="65" y="18" width="18" height="10" rx="2"/>' +
        '<rect class="pv-surface" x="90" y="6" width="26" height="108" rx="4"/>' +
        '<rect class="lane-fill-verify" x="90" y="6" width="26" height="6" rx="3"/>' +
        '<rect class="lane-fill-verify" x="94" y="18" width="18" height="10" rx="2"/>' +
        '<rect class="pv-surface" x="119" y="6" width="26" height="108" rx="4"/>' +
        '<rect class="lane-fill-review" x="119" y="6" width="26" height="6" rx="3"/>' +
        '<rect class="pv-surface" x="148" y="6" width="26" height="108" rx="4"/>' +
        '<rect class="lane-fill-merge" x="148" y="6" width="26" height="6" rx="3"/>' +
        '<rect class="pv-surface" x="177" y="6" width="26" height="108" rx="4"/>' +
        '<rect class="lane-fill-needs-human" x="177" y="6" width="26" height="6" rx="3"/>' +
        '<rect class="pv-surface" x="206" y="6" width="26" height="108" rx="4"/>' +
        '<rect class="lane-fill-done" x="206" y="6" width="26" height="6" rx="3"/>' +
        '<rect class="lane-fill-done" x="210" y="18" width="18" height="10" rx="2"/>' +
        '<rect class="lane-fill-done" x="210" y="32" width="18" height="10" rx="2"/>' +
        '<rect class="lane-fill-done" x="210" y="46" width="18" height="10" rx="2"/>' +
        '<rect class="lane-fill-done" x="210" y="60" width="18" height="10" rx="2"/>' +
        '</svg>',
    },
    {
      id: 'map',
      href: 'map/index.html',
      // A central node joined to four others
      preview:
        '<svg viewBox="0 0 240 120" focusable="false">' +
        '<path class="pv-line" d="M96 52 L72 22 M144 52 L168 22 M96 68 L72 98 M144 68 L168 98"/>' +
        '<rect class="pv-accent" x="96" y="44" width="48" height="32" rx="6"/>' +
        '<rect class="pv-surface" x="16" y="10" width="56" height="24" rx="6"/>' +
        '<rect class="pv-muted" x="24" y="19" width="32" height="6" rx="3"/>' +
        '<rect class="pv-surface" x="168" y="10" width="56" height="24" rx="6"/>' +
        '<rect class="pv-muted" x="176" y="19" width="32" height="6" rx="3"/>' +
        '<rect class="pv-surface" x="16" y="86" width="56" height="24" rx="6"/>' +
        '<rect class="pv-muted" x="24" y="95" width="32" height="6" rx="3"/>' +
        '<rect class="pv-surface" x="168" y="86" width="56" height="24" rx="6"/>' +
        '<rect class="pv-muted" x="176" y="95" width="32" height="6" rx="3"/>' +
        '</svg>',
    },
    {
      id: 'install',
      href: 'install/index.html',
      // A terminal window with three prompts
      preview:
        '<svg viewBox="0 0 240 120" focusable="false">' +
        '<rect class="pv-surface" x="6" y="6" width="228" height="108" rx="6"/>' +
        '<circle class="pv-muted" cx="20" cy="18" r="4"/>' +
        '<circle class="pv-muted" cx="32" cy="18" r="4"/>' +
        '<circle class="pv-muted" cx="44" cy="18" r="4"/>' +
        '<path class="pv-accent-line" d="M18 40 L26 46 L18 52 M18 62 L26 68 L18 74 M18 84 L26 90 L18 96"/>' +
        '<rect class="pv-muted" x="34" y="42" width="110" height="8" rx="4"/>' +
        '<rect class="pv-muted" x="34" y="64" width="150" height="8" rx="4"/>' +
        '<rect class="pv-muted" x="34" y="86" width="70" height="8" rx="4"/>' +
        '<rect class="pv-accent" x="112" y="85" width="8" height="12"/>' +
        '</svg>',
    },
    {
      id: 'concepts',
      href: 'concepts/index.html',
      // A page with a heading and lines of text, and a small accented block for a term
      preview:
        '<svg viewBox="0 0 240 120" focusable="false">' +
        '<rect class="pv-surface" x="6" y="6" width="228" height="108" rx="6"/>' +
        '<rect class="pv-accent" x="20" y="18" width="70" height="10" rx="5"/>' +
        '<rect class="pv-muted" x="20" y="40" width="190" height="7" rx="3"/>' +
        '<rect class="pv-muted" x="20" y="55" width="160" height="7" rx="3"/>' +
        '<rect class="pv-accent" x="20" y="74" width="46" height="8" rx="4"/>' +
        '<rect class="pv-muted" x="20" y="90" width="180" height="7" rx="3"/>' +
        '</svg>',
    },
  ];
})();
