// map.i18n.js — the texts of the map page, in English and Spanish under the same keys: the page's own texts, the names of
// the kinds and of the edge types, and the five texts of every node (`map.node.<id>.does`, `.when`, `.takes`, `.leaves` and `.example`, per node of
// map.data.js; the sixth part, its file, is the `source` of the data). The names of the nodes (`/dynamo:autopilot`, `dynamo run`) are the same in both languages and live in the data.
(function () {
  'use strict';

  window.DynamoSite.i18n.register({
    en: {
      'map.page.title': 'The map: everything Dynamo offers',
      'map.title': 'Everything Dynamo offers, on one map',
      'map.lead':
        'The skills you type, the subcommands behind them, the two agents, the hooks that guard the work, and three things the engine does. Click any of them to see what it does and when to use it.',
      'map.diagram.heading': 'How they connect',
      'map.diagram.title': 'Diagram of the skills, subcommands, agents, hooks and engine features, and how they connect',
      'map.list.heading': 'Pick one',
      'map.detail.heading': 'What it is',
      'map.detail.empty': 'Pick a skill, subcommand, agent, hook or engine feature to see what it does and when to use it.',
      'map.detail.runner': 'Who runs it',
      'map.runner.session':
        'You, through the model and the effort of your own Claude Code session. A skill does not choose them: whatever the session uses, it uses.',
      'map.runner.builder':
        'The Builder agent, with the model and the effort of the ticket’s level. Nothing in the session sets them.',
      'map.runner.reviewer':
        'The Reviewer agent, with the model and the effort of the ticket’s level. Nothing in the session sets them.',
      'map.runner.none': 'No model runs it: it is plain code of Dynamo’s program, and it does the same every time.',
      'map.level.caption': 'The model and the effort at each level, and why',
      'map.level.level': 'Level',
      'map.level.model': 'Model',
      'map.level.effort': 'Effort',
      'map.level.why': 'Why',
      'map.level.default': 'A ticket with no level runs as high. There is no Haiku level: a cheap Builder that fails and repeats costs more than a good one that gets it right the first time.',
      'map.effort.low': 'low',
      'map.effort.medium': 'medium',
      'map.effort.high': 'high',
      'map.effort.none': 'its own (the one of its model)',
      'map.level.low.builder.why': 'An easy ticket needs less thinking, so it costs less.',
      'map.level.low.reviewer.why': 'The same easy ticket, judged with a little more care than it was built with.',
      'map.level.medium.builder.why': 'A ticket of normal size gets a middle effort.',
      'map.level.medium.reviewer.why': 'The judge thinks harder than the builder, so a miss is caught here.',
      'map.level.high.builder.why': 'A hard ticket, or one with no level, gets the full effort.',
      'map.level.high.reviewer.why': 'The strongest model judges the hardest tickets.',
      'map.detail.does': 'What it does',
      'map.detail.when': 'When to use it',
      'map.detail.source': 'Where it is',
      'map.detail.links': 'How it connects',
      'map.detail.none': 'Nothing launches it, and it launches nothing: you run it yourself.',
      'map.detail.takes': 'What it takes',
      'map.detail.leaves': 'What it leaves',
      'map.detail.example': 'An example',
      'map.detail.close': 'Close the detail',
      'map.kind.skill': 'Skill',
      'map.kind.command': 'Subcommand',
      'map.kind.agent': 'Agent',
      'map.kind.hook': 'Hook',
      'map.kind.feature': 'Engine feature',
      'map.kind.skill.title': 'Skills',
      'map.kind.skill.intro': 'What you type in Claude Code to talk to Dynamo.',
      'map.kind.command.title': 'Subcommands',
      'map.kind.command.intro': 'The program behind the skills: it does the steps that must not depend on a model’s mood.',
      'map.kind.agent.title': 'Agents',
      'map.kind.agent.intro': 'The two that build and judge each ticket, launched by the program.',
      'map.kind.hook.title': 'Hooks',
      'map.kind.hook.intro': 'Guards that act by themselves before a tool runs.',
      'map.kind.feature.title': 'Engine features',
      'map.kind.feature.intro': 'Things the program does that no file of the plugin names.',
      'map.edge.launches.out': 'Launches',
      'map.edge.launches.in': 'Launched by',
      'map.edge.next.out': 'Comes next',
      'map.edge.next.in': 'Comes after',
      'map.edge.reads.out': 'Reads the logs of',
      'map.edge.reads.in': 'Its logs are read by',
      'map.edge.guards.out': 'Guards',
      'map.edge.guards.in': 'Guarded by',
      'map.edge.shapes.out': 'Shapes',
      'map.edge.shapes.in': 'Shaped by',

      'map.node.skill-discover.does':
        'Talks an idea through with you, checks facts in the repository instead of asking you, and closes every decision in rounds of questions. It ends with one ticket or one or more specs.',
      'map.node.skill-discover.when':
        'When you have an idea, or an epic with a block left pending, and nothing is written yet.',
      'map.node.skill-to-spec.does':
        'Writes the spec closed in the conversation as one epic issue per block, with no card on the board and deciding nothing new.',
      'map.node.skill-to-spec.when': 'Right after /dynamo:discover, in the same session, when its result is one or more specs.',
      'map.node.skill-to-tickets.does':
        'Splits an epic, the conversation or a spec file into vertical-slice tickets with their blockers, agrees the list with you and, only after you approve, creates them on the board.',
      'map.node.skill-to-tickets.when':
        'When /dynamo:discover said one ticket, or after /dynamo:to-spec wrote an epic, to get tickets ready for the factory.',
      'map.node.skill-autopilot.does':
        'Launches dynamo run in the background for the tickets you name, or for every ticket ready, and shows the JSON line it printed when it ends.',
      'map.node.skill-autopilot.when':
        'When the tickets are written and you want agents to build, check, review and merge them.',
      'map.node.skill-backlog.does':
        'Puts one idea on the board: a short issue with the idea label and its card in the Backlog column, and nothing more.',
      'map.node.skill-backlog.when': 'When you find something that is not a ticket yet and must not be lost.',
      'map.node.skill-park.does': 'Moves the card of each ticket you give to the parking column of the board and says the result of each.',
      'map.node.skill-park.when': 'For tickets that are written but must wait and not be built.',
      'map.node.skill-setup.does':
        'Puts the factory in the current project: proposes its checks from its scripts, has you confirm them and choose the language of the documents, runs dynamo setup and reports what it printed. It also brings a project up to date after an update of the plugin.',
      'map.node.skill-setup.when':
        'In a project that has no board or no .claude/factory.json yet, or to set it up again, for example after updating the plugin.',
      'map.node.skill-close-release.does':
        'Closes the release once you merged its release PR: checks the merged PR, rewrites its release report, makes the milestone, the tag and the GitHub Release, with no questions. It only closes the release: /dynamo:new-release opens the next one.',
      'map.node.skill-close-release.when':
        'After you merged the release PR in GitHub.',
      'map.node.skill-new-release.does':
        'Opens the next release branch: fetches, makes release/<last tag + bump> from the main branch on origin, pushes it and checks it out, with no questions.',
      'map.node.skill-new-release.when':
        'When you decide to start the next release, with the bump as its argument: patch, minor or major.',

      'map.node.command-run.does':
        'Takes a list of tickets through the loop, several at once: a copy per ticket, the Builder, the automatic check, the Reviewer and the merge. At the end of the list it writes the release report. It never pushes.',
      'map.node.command-run.when':
        'Through /dynamo:autopilot, or by hand, to build the tickets that are ready. Launching it again goes on from the phase each ticket was in.',
      'map.node.command-card.does':
        'Moves the card of a ticket to a column of the board and checks it by reading that issue again, never the board’s whole list.',
      'map.node.command-card.when': 'To move a card by hand. The skills /dynamo:backlog and /dynamo:park and dynamo run use it.',
      'map.node.command-setup.does':
        'Puts the factory in a project: it rehearses each check, copies the template board, writes factory.json and the settings, creates the labels and seeds the CI. Run again, it changes nothing it has made.',
      'map.node.command-setup.when': 'Through /dynamo:setup, once per project.',
      'map.node.command-release.does':
        'What is done with a release once its tickets are merged: check compares the Closes lines of the open release PR with what was merged; close makes the tag, the milestone and the GitHub Release; new makes the next release branch.',
      'map.node.command-release.when':
        'check on the open release PR; close through /dynamo:close-release after you merged it; new through /dynamo:new-release.',
      'map.node.command-copy.does':
        'Makes the copy of a ticket (a git worktree on its own branch) or removes it, keeping a branch that was blocked for you.',
      'map.node.command-copy.when': 'dynamo run uses it. By hand, to open or clean the copy of a ticket.',
      'map.node.command-verify.does':
        'Runs every command of the project’s checks in a ticket’s copy and reports the exit code of each. The decision is the exit codes, not what an agent says it saw.',
      'map.node.command-verify.when': 'dynamo run uses it after the Builder. By hand, to see if a copy would pass.',
      'map.node.command-merge.does':
        'Merges a ticket’s branch into the working branch with --no-ff, runs the checks on the merge and only if they all pass moves the branch, then adds the done label.',
      'map.node.command-merge.when': 'dynamo run uses it after the Reviewer passes. By hand, for a branch a stopped ticket left.',
      'map.node.command-comment.does':
        'Posts a file as a comment on a ticket and reads the comments back to check it. It never posts twice.',
      'map.node.command-comment.when': 'To leave a result on a ticket. dynamo run uses it for its comments.',
      'map.node.command-report.does':
        'Writes the release report of the working branch: the tickets merged, the last result of each, the ones in Needs Human and the cost of each ticket’s agents. It prints the commands to push and open the PR, and runs none.',
      'map.node.command-report.when': 'At the end of a run, or by hand before you open the release PR.',
      'map.node.command-board.does':
        'Shows, for each ticket, its column, its blockers and whether it is ready and why not, reading only those issues.',
      'map.node.command-board.when': 'To know what is ready before you launch a run.',
      'map.node.command-status.does':
        'Shows one row per ticket of a run from the logs it writes: column, round, the agent’s last step, turns and cost. It runs no gh and no git.',
      'map.node.command-status.when': 'While a list runs, to look at it without disturbing it.',
      'map.node.command-publish.does':
        'Prepares the public release: one commit with only the allowlisted files of a tag, in a public clone, after reviewing the snapshot. It prints the push and the PR commands for you and pushes nothing.',
      'map.node.command-publish.when': 'When you publish a release, from a clone of the public repository.',

      'map.node.agent-builder.does':
        'Implements one ticket in its own copy, changing only what it asks, writing the failing test first, and commits. It never pushes, merges or moves a card.',
      'map.node.agent-builder.when': 'Never by hand: dynamo run launches it for each ticket, and again for a second round if the check or the review fails.',
      'map.node.agent-reviewer.does':
        'A read-only judge: reads the change against the ticket’s checkboxes, flags anything outside the ticket and returns PASS or FAIL with evidence.',
      'map.node.agent-reviewer.when': 'Never by hand: dynamo run launches it once the automatic check passes.',

      'map.node.skill-discover.takes': 'A loose idea, or an epic with a block left pending.',
      'map.node.skill-discover.leaves': 'One ticket, or one or more specs closed in the conversation. Nothing is written yet.',
      'map.node.skill-discover.example': '/dynamo:discover I want the map to open a panel with the detail of each node',
      'map.node.skill-to-spec.takes': 'The spec closed in the conversation by /dynamo:discover.',
      'map.node.skill-to-spec.leaves': 'One epic issue per block, with no card on the board.',
      'map.node.skill-to-spec.example': '/dynamo:to-spec',
      'map.node.skill-to-tickets.takes': 'An epic, the conversation or a spec file.',
      'map.node.skill-to-tickets.leaves': 'Vertical-slice tickets with their blockers, created on the board only after you approve the list.',
      'map.node.skill-to-tickets.example': '/dynamo:to-tickets #296',
      'map.node.skill-autopilot.takes': 'The numbers of the tickets, or nothing for every ticket ready.',
      'map.node.skill-autopilot.leaves': 'Tickets built, checked, reviewed and merged into the release branch, and the JSON line dynamo run printed.',
      'map.node.skill-autopilot.example': '/dynamo:autopilot 308 309',
      'map.node.skill-backlog.takes': 'One idea in a sentence.',
      'map.node.skill-backlog.leaves': 'A short issue with the idea label and its card in the Backlog column.',
      'map.node.skill-backlog.example': '/dynamo:backlog a page that explains what a model’s effort is',
      'map.node.skill-park.takes': 'The numbers of one or more tickets.',
      'map.node.skill-park.leaves': 'Each card in the parking column, and the result of each.',
      'map.node.skill-park.example': '/dynamo:park 312 313',
      'map.node.skill-setup.takes': 'The current project: its scripts, which you confirm, and the language of the documents you choose.',
      'map.node.skill-setup.leaves': '.claude/factory.json, the settings, the labels, the board and the seed CI.',
      'map.node.skill-setup.example': '/dynamo:setup',
      'map.node.skill-close-release.takes': 'The release PR already merged in GitHub. No argument: the release is read from the working branch.',
      'map.node.skill-close-release.leaves': 'The release report rewritten, the milestone, the tag and the GitHub Release.',
      'map.node.skill-close-release.example': '/dynamo:close-release',
      'map.node.skill-new-release.takes': 'The bump: patch, minor or major.',
      'map.node.skill-new-release.leaves': 'The branch release/<last tag + bump>, pushed and checked out in your folder.',
      'map.node.skill-new-release.example': '/dynamo:new-release minor',
      'map.node.agent-builder.takes': 'The ticket, the branch of its copy, the base branch and, from round 2, what failed.',
      'map.node.agent-builder.leaves': 'A commit on the ticket’s branch with the base already merged in, and a report of what it published and what leaves no trace.',
      'map.node.agent-builder.example': 'For ticket #308 it writes the failing test first, makes the change and leaves it in one commit ending in (#308).',
      'map.node.agent-reviewer.takes': 'The ticket, the branch with the Builder’s commit and the result of the automatic check.',
      'map.node.agent-reviewer.leaves': 'A verdict: approved, or rejected with a «For the Builder» note, word for word.',
      'map.node.agent-reviewer.example': 'It reads each checkbox of the ticket, proves it against the change and returns approved or the list of what fails.',

      'map.node.command-run.takes': 'The numbers of the tickets, or nothing for every ticket ready.',
      'map.node.command-run.leaves': 'The tickets merged into the release branch, the release report and one short JSON line with the result. It never pushes.',
      'map.node.command-run.example': 'dynamo run 308 309',
      'map.node.command-card.takes': 'The number of a ticket and the name of a column of the board.',
      'map.node.command-card.leaves': 'The card in that column, checked by reading the issue again.',
      'map.node.command-card.example': 'dynamo card 312 Backlog',
      'map.node.command-setup.takes': 'One or more checks with --check and, if you want, the language of the documents with --language.',
      'map.node.command-setup.leaves': '.claude/factory.json, the settings, the labels, the board and the seed CI. Nothing already made is touched.',
      'map.node.command-setup.example': 'dynamo setup --check "npm test" --language English',
      'map.node.command-release.takes': 'An action: check, close or new, with its arguments.',
      'map.node.command-release.leaves': 'With check, a verdict on the Closes lines; with close, the tag, the milestone and the GitHub Release; with new, the next release branch.',
      'map.node.command-release.example': 'dynamo release check',
      'map.node.command-copy.takes': 'The action add or remove and the number of a ticket.',
      'map.node.command-copy.leaves': 'With add, a git worktree on the ticket’s branch; with remove, the copy deleted, except a branch that was blocked for you.',
      'map.node.command-copy.example': 'dynamo copy add 309',
      'map.node.command-verify.takes': 'The folder of a ticket’s copy and the base branch.',
      'map.node.command-verify.leaves': 'The exit code of each check of the project, in one short JSON line.',
      'map.node.command-verify.example': 'dynamo verify .claude/worktrees/ticket-309 release/0.6.0',
      'map.node.command-merge.takes': 'The number of a ticket and, if you want, the sha already verified with --verified.',
      'map.node.command-merge.leaves': 'The ticket’s branch merged with --no-ff into the working branch, and the done label. If a check fails, the branch does not move.',
      'map.node.command-merge.example': 'dynamo merge 309',
      'map.node.command-comment.takes': 'The number of a ticket and a file with the text, with --body-file.',
      'map.node.command-comment.leaves': 'A comment on the ticket, checked by reading it back. If it is already there, it does not post it again.',
      'map.node.command-comment.example': 'dynamo comment 309 --body-file result.md',
      'map.node.command-report.takes': 'The base branch, if it is not the working one, and a file of skipped tickets if you have one.',
      'map.node.command-report.leaves': 'The release report as a file, and the push and PR commands printed, not run.',
      'map.node.command-report.example': 'dynamo report',
      'map.node.command-board.takes': 'The numbers of the tickets you want to see.',
      'map.node.command-board.leaves': 'One line per ticket: column, blockers, and whether it is ready and why not. It changes nothing.',
      'map.node.command-board.example': 'dynamo board 308 309',
      'map.node.command-status.takes': 'The logs of a run, in their usual folder or the one you give with --logs.',
      'map.node.command-status.leaves': 'One row per ticket with column, round, last step, turns and cost; with --json, the same data as JSON.',
      'map.node.command-status.example': 'dynamo status',
      'map.node.command-publish.takes': 'The tag of the release and the folder of a clone of the public repository.',
      'map.node.command-publish.leaves': 'One commit in the clone with only the allowlisted files, and the push and PR commands printed. It pushes nothing.',
      'map.node.command-publish.example': 'dynamo publish v0.5.0 ../dynamo',

      'map.node.hook-outside-writes.takes': 'Every Bash command a tool is about to run, in a project with the factory.',
      'map.node.hook-outside-writes.leaves': 'Nothing if the command stays inside; a refusal with its reason if it writes or deletes outside the working tree and the scratchpad.',
      'map.node.hook-outside-writes.example': 'An agent tries to delete a file in your home folder: the hook refuses the command and the agent sees it. An ls outside passes, because reads are not checked.',
      'map.node.hook-main-folder-lock.takes': 'Every change to a file that a tool is about to make while a dynamo run is alive.',
      'map.node.hook-main-folder-lock.leaves': 'Nothing if the file is in a copy under .claude/worktrees/ or no run is alive; a refusal if it is in the main folder.',
      'map.node.hook-main-folder-lock.example': 'With a run going, editing a file of the main folder is refused; editing the same file in the ticket’s copy works.',

      'map.node.feature-levels.takes': 'The Level line of each ticket (low, medium or high) and the values of project.levels in factory.json.',
      'map.node.feature-levels.leaves': 'The model and the effort the Builder and the Reviewer of that ticket are launched with.',
      'map.node.feature-levels.example': 'A ticket with Level: low is built with less effort and costs less; one with no Level line runs as high.',
      'map.node.feature-reinforcement.takes': 'The project’s file .claude/dynamo/builder.md or .claude/dynamo/reviewer.md, with its rules and tools.',
      'map.node.feature-reinforcement.leaves': 'The agent launched with Dynamo’s file and the project’s joined, nothing copied. A Reviewer never gets a tool that writes.',
      'map.node.feature-reinforcement.example': 'You add “always run the linter” to .claude/dynamo/builder.md: from the next run, every Builder follows it.',
      'map.node.feature-resume.takes': 'The run file of each ticket, with its phase, and, in Needs Human, your answer as a comment on the ticket.',
      'map.node.feature-resume.leaves': 'The ticket going on from its phase, in the same copy, without repeating what was done.',
      'map.node.feature-resume.example': 'The run died with ticket 309 in review: you launch dynamo run 309 again and it goes on from the review.',

      'map.node.hook-outside-writes.does':
        'Refuses a Bash command that writes or deletes outside the working tree of the session and the scratchpad. Reads are not checked.',
      'map.node.hook-outside-writes.when':
        'You do not call it: it acts by itself before every Bash command, in a project with the factory. It guards against an agent’s mistakes; it is not a jail.',
      'map.node.hook-main-folder-lock.does':
        'While a dynamo run is alive, refuses a change to a file of the main folder, because dynamo merge stops when that folder is not clean.',
      'map.node.hook-main-folder-lock.when':
        'You do not call it: it acts by itself. The copies under .claude/worktrees/ stay writable, and with no run alive it refuses nothing.',

      'map.node.feature-levels.does':
        'Each ticket has a Level (low, medium or high) that sets the model and the effort of the Builder and of the Reviewer. A project changes the values in project.levels of its factory.json; a ticket with no level runs as high.',
      'map.node.feature-levels.when':
        '/dynamo:to-tickets sets the level of each ticket. Change its Level line, or the project’s values, to spend less on easy tickets.',
      'map.node.feature-reinforcement.does':
        'A project adds rules and tools to the Builder or the Reviewer in .claude/dynamo/<agent>.md. It is joined with Dynamo’s own agent file when the agent is launched, nothing is copied, so the project keeps Dynamo’s improvements. A Reviewer cannot get a tool that writes.',
      'map.node.feature-reinforcement.when':
        'When your project needs the agents to follow its own rules or to have more tools.',
      'map.node.feature-resume.does':
        'A ticket whose run died goes on from its phase when you launch dynamo run again. One that stopped in Needs Human goes on when you answer on the ticket: the Builder gets your comments. One stopped by a time limit, a budget or a missing result goes on where it was when relaunched.',
      'map.node.feature-resume.when':
        'After a stop, a crash or the usage limit: launch the same run again. For Needs Human, write your answer as a comment on the ticket first.',
    },
    es: {
      'map.page.title': 'El mapa: todo lo que ofrece Dynamo',
      'map.title': 'Todo lo que ofrece Dynamo, en un mapa',
      'map.lead':
        'Las skills que escribes, los subcomandos que hay detrás, los dos agentes, los hooks que vigilan el trabajo y tres cosas que hace el motor. Haz clic en cualquiera para ver qué hace y cuándo usarlo.',
      'map.diagram.heading': 'Cómo se conectan',
      'map.diagram.title': 'Diagrama de las skills, los subcomandos, los agentes, los hooks y las funciones del motor, y cómo se conectan',
      'map.list.heading': 'Elige uno',
      'map.detail.heading': 'Qué es',
      'map.detail.empty': 'Elige una skill, un subcomando, un agente, un hook o una función del motor para ver qué hace y cuándo usarlo.',
      'map.detail.runner': 'Quién lo ejecuta',
      'map.runner.session':
        'Tú, con el modelo y el esfuerzo de tu propia sesión de Claude Code. Una skill no los elige: usa los que use la sesión.',
      'map.runner.builder':
        'El agente Builder, con el modelo y el esfuerzo del nivel del ticket. Nada de la sesión los fija.',
      'map.runner.reviewer':
        'El agente Reviewer, con el modelo y el esfuerzo del nivel del ticket. Nada de la sesión los fija.',
      'map.runner.none': 'Ningún modelo lo ejecuta: es código del programa de Dynamo y hace lo mismo cada vez.',
      'map.level.caption': 'El modelo y el esfuerzo de cada nivel, y por qué',
      'map.level.level': 'Nivel',
      'map.level.model': 'Modelo',
      'map.level.effort': 'Esfuerzo',
      'map.level.why': 'Por qué',
      'map.level.default': 'Un ticket sin nivel se ejecuta como high. No hay un nivel con Haiku: un Builder barato que falla y repite cuesta más que uno bueno que acierta a la primera.',
      'map.effort.low': 'bajo',
      'map.effort.medium': 'medio',
      'map.effort.high': 'alto',
      'map.effort.none': 'el suyo (el de su modelo)',
      'map.level.low.builder.why': 'Un ticket fácil necesita pensar menos, así que cuesta menos.',
      'map.level.low.reviewer.why': 'El mismo ticket fácil, juzgado con algo más de cuidado que el que se usó al construirlo.',
      'map.level.medium.builder.why': 'Un ticket de tamaño normal recibe un esfuerzo intermedio.',
      'map.level.medium.reviewer.why': 'El juez piensa más que el constructor, así que aquí se atrapa un fallo.',
      'map.level.high.builder.why': 'Un ticket difícil, o sin nivel, recibe el esfuerzo completo.',
      'map.level.high.reviewer.why': 'El modelo más fuerte juzga los tickets más difíciles.',
      'map.detail.does': 'Qué hace',
      'map.detail.when': 'Cuándo usarlo',
      'map.detail.source': 'Dónde está',
      'map.detail.links': 'Cómo se conecta',
      'map.detail.none': 'Nada lo lanza y él no lanza nada: lo ejecutas tú.',
      'map.detail.takes': 'Qué toma',
      'map.detail.leaves': 'Qué deja',
      'map.detail.example': 'Un ejemplo',
      'map.detail.close': 'Cerrar el detalle',
      'map.kind.skill': 'Skill',
      'map.kind.command': 'Subcomando',
      'map.kind.agent': 'Agente',
      'map.kind.hook': 'Hook',
      'map.kind.feature': 'Función del motor',
      'map.kind.skill.title': 'Skills',
      'map.kind.skill.intro': 'Lo que escribes en Claude Code para hablar con Dynamo.',
      'map.kind.command.title': 'Subcomandos',
      'map.kind.command.intro': 'El programa que hay detrás de las skills: hace los pasos que no deben depender del ánimo de un modelo.',
      'map.kind.agent.title': 'Agentes',
      'map.kind.agent.intro': 'Los dos que construyen y juzgan cada ticket, lanzados por el programa.',
      'map.kind.hook.title': 'Hooks',
      'map.kind.hook.intro': 'Vigilantes que actúan solos antes de que se ejecute una herramienta.',
      'map.kind.feature.title': 'Funciones del motor',
      'map.kind.feature.intro': 'Cosas que hace el programa y que ningún fichero del plugin nombra.',
      'map.edge.launches.out': 'Lanza',
      'map.edge.launches.in': 'Lo lanza',
      'map.edge.next.out': 'Viene después',
      'map.edge.next.in': 'Viene tras',
      'map.edge.reads.out': 'Lee los logs de',
      'map.edge.reads.in': 'Sus logs los lee',
      'map.edge.guards.out': 'Protege a',
      'map.edge.guards.in': 'Lo protege',
      'map.edge.shapes.out': 'Ajusta a',
      'map.edge.shapes.in': 'Lo ajusta',

      'map.node.skill-discover.does':
        'Conversa una idea contigo, comprueba los hechos en el repositorio en lugar de preguntarte y cierra cada decisión en rondas de preguntas. Termina con un ticket o con una o varias specs.',
      'map.node.skill-discover.when':
        'Cuando tienes una idea, o una épica con un bloque pendiente, y todavía no hay nada escrito.',
      'map.node.skill-to-spec.does':
        'Escribe la spec cerrada en la conversación como una issue de épica por bloque, sin tarjeta en el tablero y sin decidir nada nuevo.',
      'map.node.skill-to-spec.when': 'Justo después de /dynamo:discover, en la misma sesión, cuando su resultado es una o varias specs.',
      'map.node.skill-to-tickets.does':
        'Divide una épica, la conversación o un fichero de spec en tickets de corte vertical con sus bloqueos, acuerda la lista contigo y, solo cuando la apruebas, los crea en el tablero.',
      'map.node.skill-to-tickets.when':
        'Cuando /dynamo:discover dijo un ticket, o después de que /dynamo:to-spec escribiera una épica, para dejar tickets listos para la fábrica.',
      'map.node.skill-autopilot.does':
        'Lanza dynamo run en segundo plano para los tickets que nombras, o para todos los que están listos, y muestra la línea JSON que imprimió al terminar.',
      'map.node.skill-autopilot.when':
        'Cuando los tickets están escritos y quieres que los agentes los construyan, comprueben, revisen y fusionen.',
      'map.node.skill-backlog.does':
        'Pone una idea en el tablero: una issue corta con la etiqueta idea y su tarjeta en la columna Backlog, y nada más.',
      'map.node.skill-backlog.when': 'Cuando encuentras algo que todavía no es un ticket y no debe perderse.',
      'map.node.skill-park.does': 'Mueve la tarjeta de cada ticket que le das a la columna de aparcados del tablero y dice el resultado de cada uno.',
      'map.node.skill-park.when': 'Para tickets que están escritos pero deben esperar y no construirse.',
      'map.node.skill-setup.does':
        'Pone la fábrica en el proyecto actual: propone sus comprobaciones a partir de sus scripts, te hace confirmarlas y elegir el idioma de los documentos, ejecuta dynamo setup y cuenta lo que imprimió. También pone al día un proyecto tras actualizar el plugin.',
      'map.node.skill-setup.when':
        'En un proyecto que todavía no tiene tablero ni .claude/factory.json, o para configurarlo de nuevo, por ejemplo tras actualizar el plugin.',
      'map.node.skill-close-release.does':
        'Cierra la release una vez fusionado su PR: comprueba el PR fusionado, reescribe su informe de release, crea el hito, la etiqueta y la GitHub Release, sin preguntas. Solo cierra la release: /dynamo:new-release abre la siguiente.',
      'map.node.skill-close-release.when':
        'Después de fusionar el PR de la release en GitHub.',
      'map.node.skill-new-release.does':
        'Abre la rama de la release siguiente: hace fetch, crea release/<última etiqueta + salto> desde la rama principal de origin, la sube y la activa, sin preguntas.',
      'map.node.skill-new-release.when':
        'Cuando decides empezar la release siguiente, con el salto como argumento: patch, minor o major.',

      'map.node.command-run.does':
        'Lleva una lista de tickets por el bucle, varios a la vez: una copia por ticket, el Builder, la comprobación automática, el Reviewer y la fusión. Al acabar la lista escribe el informe de release. Nunca hace push.',
      'map.node.command-run.when':
        'Con /dynamo:autopilot, o a mano, para construir los tickets que están listos. Si lo lanzas otra vez, sigue desde la fase en que estaba cada ticket.',
      'map.node.command-card.does':
        'Mueve la tarjeta de un ticket a una columna del tablero y lo comprueba leyendo de nuevo esa issue, nunca la lista entera del tablero.',
      'map.node.command-card.when': 'Para mover una tarjeta a mano. Lo usan las skills /dynamo:backlog y /dynamo:park y dynamo run.',
      'map.node.command-setup.does':
        'Pone la fábrica en un proyecto: ensaya cada comprobación, copia el tablero plantilla, escribe factory.json y los ajustes, crea las etiquetas y siembra la CI. Si lo repites, no cambia nada de lo que ya hizo.',
      'map.node.command-setup.when': 'Con /dynamo:setup, una vez por proyecto.',
      'map.node.command-release.does':
        'Lo que se hace con una release cuando sus tickets están fusionados: check compara las líneas Closes del PR abierto de la release con lo fusionado; close crea la etiqueta, el hito y la GitHub Release; new crea la rama de la release siguiente.',
      'map.node.command-release.when':
        'check sobre el PR abierto de la release; close con /dynamo:close-release después de que lo fusiones; new con /dynamo:new-release.',
      'map.node.command-copy.does':
        'Crea la copia de un ticket (un git worktree en su propia rama) o la borra, conservando una rama que se bloqueó para que la veas.',
      'map.node.command-copy.when': 'Lo usa dynamo run. A mano, para abrir o limpiar la copia de un ticket.',
      'map.node.command-verify.does':
        'Ejecuta cada comando de las comprobaciones del proyecto en la copia de un ticket y da el código de salida de cada uno. Decide el código de salida, no lo que un agente dice haber visto.',
      'map.node.command-verify.when': 'Lo usa dynamo run tras el Builder. A mano, para ver si una copia pasaría.',
      'map.node.command-merge.does':
        'Fusiona la rama de un ticket en la rama de trabajo con --no-ff, ejecuta las comprobaciones sobre la fusión y solo si todas pasan mueve la rama; después añade la etiqueta de hecho.',
      'map.node.command-merge.when': 'Lo usa dynamo run cuando el Reviewer da el visto bueno. A mano, para una rama que dejó un ticket detenido.',
      'map.node.command-comment.does':
        'Publica un fichero como comentario en un ticket y lee los comentarios para comprobarlo. Nunca publica dos veces.',
      'map.node.command-comment.when': 'Para dejar un resultado en un ticket. dynamo run lo usa para sus comentarios.',
      'map.node.command-report.does':
        'Escribe el informe de release de la rama de trabajo: los tickets fusionados, el último resultado de cada uno, los que están en Needs Human y el coste de los agentes de cada ticket. Imprime los comandos para hacer push y abrir el PR, y no ejecuta ninguno.',
      'map.node.command-report.when': 'Al final de una ejecución, o a mano antes de abrir el PR de la release.',
      'map.node.command-board.does':
        'Muestra, de cada ticket, su columna, sus bloqueos y si está listo y por qué no, leyendo solo esas issues.',
      'map.node.command-board.when': 'Para saber qué está listo antes de lanzar una ejecución.',
      'map.node.command-status.does':
        'Muestra una fila por ticket de una ejecución a partir de los logs que escribe: columna, ronda, último paso del agente, turnos y coste. No ejecuta gh ni git.',
      'map.node.command-status.when': 'Mientras corre una lista, para mirarla sin molestarla.',
      'map.node.command-publish.does':
        'Prepara la release pública: un commit con solo los ficheros permitidos de una etiqueta, en un clon público, tras revisar la instantánea. Imprime los comandos de push y de PR para ti y no hace push.',
      'map.node.command-publish.when': 'Cuando publicas una release, desde un clon del repositorio público.',

      'map.node.agent-builder.does':
        'Implementa un ticket en su propia copia, cambiando solo lo que pide, escribiendo antes la prueba que falla, y hace commit. Nunca hace push, fusiona ni mueve una tarjeta.',
      'map.node.agent-builder.when': 'Nunca a mano: dynamo run lo lanza por cada ticket, y otra vez en una segunda ronda si falla la comprobación o la revisión.',
      'map.node.agent-reviewer.does':
        'Un juez de solo lectura: lee el cambio frente a las casillas del ticket, señala lo que queda fuera del ticket y devuelve PASS o FAIL con pruebas.',
      'map.node.agent-reviewer.when': 'Nunca a mano: dynamo run lo lanza cuando pasa la comprobación automática.',

      'map.node.skill-discover.takes': 'Una idea suelta, o una épica con un bloque pendiente.',
      'map.node.skill-discover.leaves': 'Un ticket, o una o más specs cerradas en la conversación. Nada se escribe todavía.',
      'map.node.skill-discover.example': '/dynamo:discover quiero que el mapa abra un panel con el detalle de cada nodo',
      'map.node.skill-to-spec.takes': 'La spec cerrada en la conversación con /dynamo:discover.',
      'map.node.skill-to-spec.leaves': 'Una issue de épica por bloque, sin tarjeta en el tablero.',
      'map.node.skill-to-spec.example': '/dynamo:to-spec',
      'map.node.skill-to-tickets.takes': 'Una épica, la conversación o un fichero de spec.',
      'map.node.skill-to-tickets.leaves': 'Tickets de corte vertical con sus bloqueos, creados en el tablero solo después de que apruebes la lista.',
      'map.node.skill-to-tickets.example': '/dynamo:to-tickets #296',
      'map.node.skill-autopilot.takes': 'Los números de los tickets, o nada para todos los que están listos.',
      'map.node.skill-autopilot.leaves': 'Tickets construidos, comprobados, revisados y fusionados en la rama de la release, y la línea JSON que imprimió dynamo run.',
      'map.node.skill-autopilot.example': '/dynamo:autopilot 308 309',
      'map.node.skill-backlog.takes': 'Una idea en una frase.',
      'map.node.skill-backlog.leaves': 'Una issue corta con la etiqueta idea y su tarjeta en la columna Backlog.',
      'map.node.skill-backlog.example': '/dynamo:backlog una página que explique qué es el esfuerzo de un modelo',
      'map.node.skill-park.takes': 'Los números de uno o más tickets.',
      'map.node.skill-park.leaves': 'Cada tarjeta en la columna de aparcados, y el resultado de cada una.',
      'map.node.skill-park.example': '/dynamo:park 312 313',
      'map.node.skill-setup.takes': 'El proyecto actual: sus scripts, que tú confirmas, y el idioma de los documentos que eliges.',
      'map.node.skill-setup.leaves': '.claude/factory.json, los ajustes, las etiquetas, el tablero y el CI de partida.',
      'map.node.skill-setup.example': '/dynamo:setup',
      'map.node.skill-close-release.takes': 'La PR de la release ya fusionada en GitHub. Sin argumento: la release se lee de la rama de trabajo.',
      'map.node.skill-close-release.leaves': 'El informe de la release reescrito, el hito, la etiqueta y la GitHub Release.',
      'map.node.skill-close-release.example': '/dynamo:close-release',
      'map.node.skill-new-release.takes': 'El bump: patch, minor o major.',
      'map.node.skill-new-release.leaves': 'La rama release/<última etiqueta + bump>, subida y activa en tu carpeta.',
      'map.node.skill-new-release.example': '/dynamo:new-release minor',
      'map.node.agent-builder.takes': 'El ticket, la rama de su copia, la rama base y, desde la ronda 2, lo que falló.',
      'map.node.agent-builder.leaves': 'Un commit en la rama del ticket con la base ya fusionada, y un informe de lo publicado y de lo que no deja rastro.',
      'map.node.agent-builder.example': 'Para el ticket #308 escribe primero el test que falla, hace el cambio y lo deja en un commit que termina en (#308).',
      'map.node.agent-reviewer.takes': 'El ticket, la rama con el commit del Builder y el resultado de la comprobación automática.',
      'map.node.agent-reviewer.leaves': 'Un veredicto: aprobado, o rechazado con un «Para el Builder» palabra por palabra.',
      'map.node.agent-reviewer.example': 'Lee cada casilla del ticket, la prueba contra el cambio y devuelve aprobado o la lista de lo que falla.',

      'map.node.command-run.takes': 'Los números de los tickets, o nada para todos los que están listos.',
      'map.node.command-run.leaves': 'Los tickets fusionados en la rama de la release, el informe de release y una línea JSON corta con el resultado. Nunca hace push.',
      'map.node.command-run.example': 'dynamo run 308 309',
      'map.node.command-card.takes': 'El número de un ticket y el nombre de una columna del tablero.',
      'map.node.command-card.leaves': 'La tarjeta en esa columna, comprobada leyendo de nuevo la issue.',
      'map.node.command-card.example': 'dynamo card 312 Backlog',
      'map.node.command-setup.takes': 'Una o más comprobaciones con --check y, si quieres, el idioma de los documentos con --language.',
      'map.node.command-setup.leaves': '.claude/factory.json, los ajustes, las etiquetas, el tablero y el CI de partida. Nada de lo ya hecho se toca.',
      'map.node.command-setup.example': 'dynamo setup --check "npm test" --language English',
      'map.node.command-release.takes': 'Una acción: check, close o new, con sus argumentos.',
      'map.node.command-release.leaves': 'Con check, un veredicto sobre las líneas Closes; con close, la etiqueta, el hito y la GitHub Release; con new, la rama de la release siguiente.',
      'map.node.command-release.example': 'dynamo release check',
      'map.node.command-copy.takes': 'La acción add o remove y el número de un ticket.',
      'map.node.command-copy.leaves': 'Con add, un worktree de git en la rama del ticket; con remove, la copia borrada, salvo una rama bloqueada para ti.',
      'map.node.command-copy.example': 'dynamo copy add 309',
      'map.node.command-verify.takes': 'La carpeta de la copia de un ticket y la rama base.',
      'map.node.command-verify.leaves': 'El código de salida de cada comprobación del proyecto, en una línea JSON corta.',
      'map.node.command-verify.example': 'dynamo verify .claude/worktrees/ticket-309 release/0.6.0',
      'map.node.command-merge.takes': 'El número de un ticket y, si quieres, el sha ya verificado con --verified.',
      'map.node.command-merge.leaves': 'La rama del ticket fusionada con --no-ff en la rama de trabajo, y la etiqueta de hecho. Si falla una comprobación, la rama no se mueve.',
      'map.node.command-merge.example': 'dynamo merge 309',
      'map.node.command-comment.takes': 'El número de un ticket y un fichero con el texto, con --body-file.',
      'map.node.command-comment.leaves': 'Un comentario en el ticket, comprobado al leerlo de nuevo. Si ya estaba, no lo publica otra vez.',
      'map.node.command-comment.example': 'dynamo comment 309 --body-file resultado.md',
      'map.node.command-report.takes': 'La rama base, si no es la de trabajo, y un fichero de saltados si lo tienes.',
      'map.node.command-report.leaves': 'El informe de release como fichero, y los comandos de push y de PR impresos, sin ejecutar.',
      'map.node.command-report.example': 'dynamo report',
      'map.node.command-board.takes': 'Los números de los tickets que quieres ver.',
      'map.node.command-board.leaves': 'Una línea por ticket: columna, bloqueos y si está listo y por qué no. No cambia nada.',
      'map.node.command-board.example': 'dynamo board 308 309',
      'map.node.command-status.takes': 'Los logs de una ejecución, en su carpeta de siempre o la que indiques con --logs.',
      'map.node.command-status.leaves': 'Una fila por ticket con columna, ronda, último paso, turnos y coste; con --json, los mismos datos como JSON.',
      'map.node.command-status.example': 'dynamo status',
      'map.node.command-publish.takes': 'La etiqueta de la release y la carpeta de un clon del repositorio público.',
      'map.node.command-publish.leaves': 'Un commit en el clon con solo los ficheros permitidos, y los comandos de push y de PR impresos. No hace push.',
      'map.node.command-publish.example': 'dynamo publish v0.5.0 ../dynamo',

      'map.node.hook-outside-writes.takes': 'Cada comando de Bash que una herramienta va a ejecutar en un proyecto con la fábrica.',
      'map.node.hook-outside-writes.leaves': 'Nada si el comando está dentro; un rechazo con su motivo si escribe o borra fuera del árbol de trabajo y de la carpeta temporal.',
      'map.node.hook-outside-writes.example': 'Un agente intenta borrar un fichero en tu carpeta personal: el hook rechaza el comando y el agente lo ve. Un ls fuera pasa, porque las lecturas no se comprueban.',
      'map.node.hook-main-folder-lock.takes': 'Cada cambio de un fichero que una herramienta va a hacer mientras una dynamo run está viva.',
      'map.node.hook-main-folder-lock.leaves': 'Nada si el fichero está en una copia bajo .claude/worktrees/ o si no hay ejecución viva; un rechazo si está en la carpeta principal.',
      'map.node.hook-main-folder-lock.example': 'Con una ejecución en marcha, editar un fichero de la carpeta principal es rechazado; editar el mismo fichero en la copia del ticket funciona.',

      'map.node.feature-levels.takes': 'La línea Level de cada ticket (low, medium o high) y los valores de project.levels de factory.json.',
      'map.node.feature-levels.leaves': 'El modelo y el esfuerzo con que se lanzan el Builder y el Reviewer de ese ticket.',
      'map.node.feature-levels.example': 'Un ticket con Level: low se construye con menos esfuerzo y cuesta menos; uno sin línea Level se ejecuta como high.',
      'map.node.feature-reinforcement.takes': 'El fichero .claude/dynamo/builder.md o .claude/dynamo/reviewer.md del proyecto, con sus reglas y herramientas.',
      'map.node.feature-reinforcement.leaves': 'El agente lanzado con el fichero de Dynamo y el del proyecto unidos, sin copiar nada. Un Reviewer nunca recibe una herramienta que escriba.',
      'map.node.feature-reinforcement.example': 'Añades en .claude/dynamo/builder.md «ejecuta siempre el linter»: desde la siguiente ejecución, cada Builder lo sigue.',
      'map.node.feature-resume.takes': 'El fichero de ejecución de cada ticket, con su fase, y, en Needs Human, tu respuesta como comentario del ticket.',
      'map.node.feature-resume.leaves': 'El ticket continuando desde su fase, en la misma copia, sin repetir lo ya hecho.',
      'map.node.feature-resume.example': 'La ejecución murió con el ticket 309 en revisión: lanzas dynamo run 309 otra vez y sigue desde la revisión.',

      'map.node.hook-outside-writes.does':
        'Rechaza un comando de Bash que escribe o borra fuera del árbol de trabajo de la sesión y de la carpeta temporal de trabajo. Las lecturas no se comprueban.',
      'map.node.hook-outside-writes.when':
        'No lo llamas: actúa solo antes de cada comando de Bash, en un proyecto con la fábrica. Protege de los errores de un agente; no es una cárcel.',
      'map.node.hook-main-folder-lock.does':
        'Mientras una dynamo run está viva, rechaza un cambio en un fichero de la carpeta principal, porque dynamo merge se detiene cuando esa carpeta no está limpia.',
      'map.node.hook-main-folder-lock.when':
        'No lo llamas: actúa solo. Las copias bajo .claude/worktrees/ siguen siendo escribibles, y sin ninguna ejecución viva no rechaza nada.',

      'map.node.feature-levels.does':
        'Cada ticket tiene un nivel (low, medium o high) que fija el modelo y el esfuerzo del Builder y del Reviewer. Un proyecto cambia los valores en project.levels de su factory.json; un ticket sin nivel se ejecuta como high.',
      'map.node.feature-levels.when':
        '/dynamo:to-tickets fija el nivel de cada ticket. Cambia su línea Level, o los valores del proyecto, para gastar menos en tickets fáciles.',
      'map.node.feature-reinforcement.does':
        'Un proyecto añade reglas y herramientas al Builder o al Reviewer en .claude/dynamo/<agente>.md. Se une al fichero de agente propio de Dynamo cuando se lanza el agente, no se copia nada, así que el proyecto sigue recibiendo las mejoras de Dynamo. Un Reviewer no puede recibir una herramienta que escriba.',
      'map.node.feature-reinforcement.when':
        'Cuando tu proyecto necesita que los agentes sigan sus propias reglas o tengan más herramientas.',
      'map.node.feature-resume.does':
        'Un ticket cuya ejecución murió sigue desde su fase cuando lanzas dynamo run otra vez. Uno que se detuvo en Needs Human sigue cuando respondes en el ticket: el Builder recibe tus comentarios. Uno detenido por un tiempo máximo, un presupuesto o un resultado que falta sigue donde estaba al relanzarlo.',
      'map.node.feature-resume.when':
        'Tras una parada, una caída o el límite de uso: lanza la misma ejecución otra vez. En Needs Human, escribe antes tu respuesta como comentario del ticket.',
    },
  });
})();
