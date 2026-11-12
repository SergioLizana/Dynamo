# The Dynamo site

A small interactive site, in English and Spanish, that says what Dynamo is, what it is for and how to install it. It is
plain HTML, CSS and JavaScript: no build step, no dependency, no framework, no CDN. Every page also works opened from the
disk (`file://`), so the scripts are classic scripts, never `fetch` or ES modules.

It is not part of the plugin, but `site/` is published with it: it is deployed on GitHub Pages from the public repository
(the workflow `public/pages.yml`, placed by `dynamo publish` as `.github/workflows/pages.yml`).

## How it is laid out

```text
site/
  index.html          the home page, as a story in seven parts: the hero, the chain, the board (three tickets at once,
                      animated), the issues as the source of truth, where it comes from, «Take it apart» (one card per
                      subpage) and the install
  home.css            what only the home page needs
  home.i18n.js        the texts of the home page itself (hero, titles, install), in `en` and `es`
  story.data.js       the lists of the story, as data: the chain's steps, the parts of the source of truth, the people
                      whose ideas Dynamo took and the ideas
  story.js            draws those lists into the page
  story.i18n.js       the texts of the story
  README.md           this file
  assets/             the shared layer, linked by every page
    tokens.css        colours (light and dark), the lane colour of each column of the board, fonts, sizes, motion
    base.css          reset, page defaults, container, sections, hidden text, no motion under prefers-reduced-motion
    components.css    header, toggles, buttons, code block, cards, the shared surface and choice control of every page, the classes of the SVG previews, footer
    theme.js          light and dark theme (loaded in <head>, before the first paint)
    i18n.js           the language: dictionary, `?lang=`, localStorage, `lang` of <html>
    shared.i18n.js    the texts of the shared layer
    pages.js          the list of subpages, as data
    layout.js         draws the header and the footer from that list
    toc.js            the side index of a subpage: one link per `h2` of `<main>`, marking the section in view; it folds
                      above the content on a phone
    cards.js          draws one card per subpage from that list
    copy.js           the copy button
    diagram.js        what a page needs to show an archify diagram: `DynamoSite.diagram.url(file, embed)`, `.prepare()`, `.onTheme(fn)`
    dynamo-logo.svg, dynamo-logo-dark.svg, dynamo-logo-light.svg
                      Dynamo's logo, copied from `assets/` of the repository, which holds the originals (the site is
                      published only from `site/`); the header shows the dark or the light one by the theme
    favicon.svg       the favicon of every page: only the logo's grid of cells, square, with no text
    hero-logo.js      draws the logo inline in the hero, so its cells fill once, in order (not under reduced motion)
    motion.js         the sections come in when they scroll into view (not under prefers-reduced-motion)
    levels.js         the models and efforts of each level, the one copy every page reads (a test checks it against
                      `STARTING` in `dynamo/levels.ts`)
    board.data.js     the simulation of the board, as data: the eight columns (who acts and what runs in each), the three example
                      tickets, where they start, and the beats that move them (one or two cards each)
    board.player.js   the logic of the animated board without the page: where every card is after a beat, which cards have
                      to slide, and the player (one beat every 4 seconds, a rest at the end, never by itself under reduced motion)
    board.i18n.js     the texts of the board: its labels, the tickets, the line of each card and the sentence of each beat
    board.js          the board, drawn from that data: `data-board` on the home page and on the journey page. It looks like
                      a GitHub Projects board, plays by itself with no controls, and its cards slide
    board.css         the look of the board and the lane colour of a column (`--lane`); it scrolls sideways inside its own frame
                      on a narrow screen
  <subpage>/          one folder per subpage (`journey/`, `map/`, `install/`): its index.html and its own files
  journey/            «The board at work»: the board, one prose section per column and the diagram
    index.html        the page
    journey.css       the prose of the columns and the table of the levels (the board is the shared component, `assets/board.css`)
    journey.i18n.js   the texts of the page and the prose of each column, in `en` and `es`
    journey.js        draws one prose section per column of the board, with the model and effort of the Builder and the Reviewer
    journey.diagram.js  shows the diagram drawn with archify, in the file of the active language, in the page
    journey.board.<lang>.json   the source of that diagram (an archify `lifecycle`), kept to edit and draw again
    journey.board.<lang>.html   the diagram archify drew from it
  map/                the map of everything Dynamo offers
    index.html        the page: the diagram, a button per node and the detail of the one picked
    map.data.js       the nodes (skills, subcommands, agents, hooks, engine features) and the edges between them, as data
    map.i18n.js       the texts of the page and the two texts of every node, in `en` and `es`
    map.js            draws the lists and the detail panel (it closes with its button or Escape) from that data
    map.css           what only this page needs
    map.<lang>.archify.json     the source of the diagram, one per language (edit it, then draw it again)
    map.diagram.<lang>.html     the diagram Archify drew from it, shown in the page
  concepts/           the general concepts of working with an LLM (an LLM, a model, the effort, tokens and cost, the context window)
    index.html        the page: one section per concept, drawn from the data
    concepts.data.js  the concepts, in order, and the Anthropic documentation each rests on with the day it was read
    concepts.i18n.js  the texts of the page and of every concept (`.title`, `.p1`, `.p2`) and source, in `en` and `es`
    concepts.js       draws the sections and their sources from that data
    concepts.css      what only this page needs
  install/            the install simulator
    index.html        the page: a tab per step, the simulated terminal of the one shown, Back and Next
    install.data.js   the steps (commands of `README.md`, and the lines the terminal prints), as data
    install.i18n.js   the texts of the page and of every step, in `en` and `es`
    install.js        draws the tabs and the terminal from that data; arrow keys, Home and End move between steps
    install.css       what only this page needs
```

To add a step to the simulator, add one entry to `steps` in `install/install.data.js` and its texts
(`install.step.<id>.tab`, `.title`, `.text` and one key per line it prints or asks) to `install/install.i18n.js`, in `en` and `es`.

A page links the shared layer and adds only its own files. A rule or a script that two pages need goes to `assets/`,
never copied.

### The rules the code follows

- **Text is data.** Every visible text is a key in a dictionary with `en` and `es` under the same keys; the HTML only
  names the key (`data-i18n="key"`, or `data-i18n-attr="aria-label:key"` for an attribute). `i18n.js` warns in the
  console when a key is missing in one language.
- **Lists are data.** The subpages' cards come from `assets/pages.js`; later, the map's nodes, the board's tickets and beats,
  and the simulator's steps are lists too, and the page draws them.
- **CSS is built on the tokens.** No colour or size is written outside `tokens.css`, there are no inline styles, and
  class names go by component. The lane colours (`--lane-<column>`) are used wherever a column of the board appears.
- **Semantic HTML.** One `h1` per page and headings in order, the landmarks `header`, `nav`, `main` and `footer`, real
  buttons and links, a visible focus, `aria` only where HTML has no element for it, and a description for every SVG.
- **Language.** English by default. The language is, in order: `?lang=` in the address, the choice remembered in
  `localStorage` (always inside try/catch), English. Every relative link carries `?lang=`, so the choice travels to the
  other pages. `lang` of `<html>` is the active language.
- **Theme.** Starts from `prefers-color-scheme`, the toggle switches it, and the choice is remembered. Motion is only
  declared inside `prefers-reduced-motion: no-preference`.
- **Privacy.** The site holds nothing personal, no link to the development repository, and it never names the real
  project the factory was proven on.

## How to change the story of the home page

The chain, the parts of the source of truth and the ideas taken from others are lists in `story.data.js`; `story.js`
draws them and the texts are in `story.i18n.js`, in `en` and `es`. No markup changes.

- A step of the chain: one entry in `site.chain` (`id` and `command`, the skill that runs it, or null for the result) and
  `chain.step.<id>.title` and `.gains`.
- A part of the source of truth: one entry in `site.truth` and `truth.item.<id>.title` and `.text`.
- An idea taken from someone: add its id to the `ideas` of the person in `site.origins` (or add the person, with `who`,
  the `url` of their public repository and the `repo` shown as the link), and write `origin.<idea>.idea` (what was taken)
  and `origin.<idea>.adds` (what Dynamo adds to it). Read the link again the day you write it: it must open.

## How to add a section to a page

1. In the page's HTML, add a `<section class="section" aria-labelledby="…">` inside `<main>` with its heading and a
   container for the content (the home page's lists are drawn into places named `data-slot="chain"`,
   `"truth"` and `"origin"`).
2. Add the texts to the page's `*.i18n.js`, under the same keys in `en` and `es`.
3. If the content is a list, keep the list as data in a file of its own, and draw it from there. If another page
   needs the same rule or script, move it to `assets/`.

## How to add a subpage

1. Create the folder, for example `site/<id>/`, with an `index.html` that follows the home page: `data-page="<id>"` and
   `data-root="../"` on `<html>`, the shared stylesheets and scripts linked as `../assets/…`, its own CSS and
   dictionary files, `<header data-site-header>` and `<footer data-site-footer>`.
2. Add one entry to the list in `assets/pages.js`: `id`, `href` (`<id>/index.html`) and a small inline `preview` SVG
   that uses only the classes of `components.css`. The header menu and the card on the home page appear by themselves.
3. Add `page.<id>.title`, `page.<id>.text` and `page.<id>.preview` to `assets/shared.i18n.js`, in `en` and `es`. The texts of
   the shared layer (header, footer, cards) live in the shared dictionary, which every page loads; no page loads the
   dictionary of another page.

## How to change the concepts

A concept is one entry in `site.concepts` (`concepts/concepts.data.js`) with its `id` and the `sources` it rests on, and
`concepts.<id>.title`, `.p1` and `.p2` in `concepts/concepts.i18n.js`, in `en` and `es`. A source is `id`, `url` and `read`,
the day it was read; its title is `concepts.source.<id>`. A general statement links Anthropic's documentation with that day:
read the source again, and write the day, when you write or change the statement. No price and no figure of a model.

## How the map is kept

The map is read from what exists in the plugin, and `dynamo/tests/site-map.test.ts` checks it: every skill of `skills/`, agent
of `agents/`, hook of `hooks/hooks.json` and subcommand of `dynamo/dynamo.ts` must be a node of `map/map.data.js`, no node
may name something that does not exist, and the two Archify sources must hold the same nodes and edges as the data.

To add a skill, a subcommand, an agent or a hook:

1. Add one entry to `nodes` in `map/map.data.js` (`id` is `<kind>-<name>`), and its edges to `edges`.
2. Add `map.node.<id>.does` and `map.node.<id>.when` to `map/map.i18n.js`, in `en` and `es`, and with them `.takes`, `.leaves` and `.example`: every node has the five parts.
3. Add its box and its edges, with the same ids, to `map/map.en.archify.json` and `map/map.es.archify.json`, and draw them
   again with the `archify` skill (`finalize architecture <source> <output>`, with `--out-dir` in a folder outside the
   site). Delete the `*.delivery*.json` file it leaves next to the page: it holds the path of the machine.

The diagram is the one Archify draws; the lists and the detail are drawn by the page from the data.

## How to change the board

The board is all data in `assets/board.data.js`: the columns, the tickets, where they start and the beats.

1. A beat is one entry of `beats`: one or two `moves` (`id` of the ticket, the column it goes `to` and the `note` it shows
   there). Add its sentence `board.beat.<n>` (n counts the beats, the start being 0), and any new `board.note.<note>`, to
   `assets/board.i18n.js`, in `en` and `es`.
2. A ticket is one entry of `tickets` and one of `start`, with `board.ticket.<id>` in `assets/board.i18n.js`.
3. `dynamo/tests/site-board.test.ts` replays the beats and fails if more than `slots` tickets are between Build and Merge, if
   two are in Merge, or if a ticket does not take its route.

The prose of the journey page has one section per column, from the same data: `journey.col.<column>.what`, `.who` and `.next`
in `journey/journey.i18n.js`. The diagram of the page is a separate file per language: to change it, edit `journey/journey.board.<lang>.json` and draw it again with the `archify` skill:
`node <archify>/bin/archify.mjs finalize lifecycle site/journey/journey.board.<lang>.json site/journey/journey.board.<lang>.html --quality showcase`,
then delete the receipts it writes next to the output (they hold the paths of the machine).

## How a page shows an archify diagram

An archify page reads its theme from `?theme=light|dark` and starts Still unless `localStorage` holds `archify-motion` =
`live`. A page that frames or links a diagram never writes that address by hand; it loads `assets/diagram.js` (after
`theme.js`) and uses `DynamoSite.diagram`:

- `url(file, embed)` returns the file with `?theme=<the site's active theme>`, plus `&embed=1` when `embed` is true.
  `embed=1` is archify's embedded mode: it hides archify's own toolbar, header, cards, node index and guides and keeps
  only the diagram, so the map's frame uses it; a link that opens the diagram on its own does not.
- `prepare()` stores `archify-motion` = `live` (inside try/catch) before a diagram loads or opens, and stores nothing under
  `prefers-reduced-motion`, where archify keeps the diagram still. Call it when the frame's `src` or the link's `href` is
  set, and on the link's click.
- `mount(figure, name)` shows `<name>.<lang>.html` in the page: `figure` holds an iframe `[data-diagram-frame]` and a button
  `[data-diagram-toggle]`; the diagram loads embedded, follows the language and the theme, and the button (or Escape) puts
  it over the whole screen (`diagram--full`) and back. The journey and the map use it (markup in `journey/index.html` and `map/index.html`; the styles are in
  `assets/components.css`, and each page sets only its diagram's ratio).
- `onTheme(fn)` calls `fn` when the reader changes the theme; the page sets the frame's `src` and the link's `href` again,
  so the frame reloads in the new theme.

## How to add a language

1. Add its code to `LANGS` in `assets/i18n.js`, and to the `dictionary` object next to it.
2. Add its block, under the same keys, to every dictionary file (`assets/shared.i18n.js`, `home.i18n.js` and the
   subpages' own); the console names any key that is missing.
3. Add its key `lang.<code>` to the dictionary and its button to `languageToggles()` in `assets/layout.js`.
4. Draw the diagrams of the pages that have one in that language too (`journey/journey.board.<code>.json` and its
   `.html`), since archify writes its text in one language per file.

## How the human publishes it

Nothing by hand: each release that `dynamo publish` brings to `main` of the public repository runs the Pages workflow, which
deploys only `site/`. It lives at https://sergiolizana.github.io/Dynamo/ (Pages is turned on once in the repository's
settings, with GitHub Actions as the source).

Before a release, open `index.html` from the disk in a browser: check both languages, both themes, the copy button
and the keyboard.
