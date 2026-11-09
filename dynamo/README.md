# dynamo

The program that runs the factory's loop: plain Node with TypeScript run by type stripping, no build step and no
dependencies.

## Node version

It needs **Node 24.22.2** (built and tested on it), for three reasons:

- type stripping: `node dynamo/dynamo.ts` runs the `.ts` files directly, with no compiler;
- `node --test "dynamo/tests/*.test.ts"` runs the tests with a process per file; `node` itself expands the pattern, so
  it works the same with no shell. (A folder as the argument is resolved as a module from Node 24, not searched.)
- Node 24.15.0 has a bug on Windows ([nodejs/node#56645](https://github.com/nodejs/node/issues/56645), fixed by
  [#61999](https://github.com/nodejs/node/pull/61999) in 24.20.0): a process can crash on exit with
  `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` after doing its work. It failed between 1 and 7 tests in each
  Windows run of the CI, always in the fake gh. 24.22.2 is the version Dynamo was tested on once the bug was fixed.

An older Node may not run the `.ts` files or may not find the tests, and before 24.20.0 it may crash on exit on Windows.

## Launching a list of tickets

In a Claude Code session opened at the root of the repository, `/dynamo:autopilot` launches `dynamo run`, the engine of the plugin, in the
background and gives its JSON line when it exits:

```text
/dynamo:autopilot 34 35
```

- With numbers it builds those tickets (one, or a list); with none, every open ticket that is ready.
- `dynamo run` decides everything else: which tickets are ready, the order (a ticket starts once its blockers of the list
  are merged), how many run at once (`project.ticketsAtOnce` of `.claude/factory.json`) and when a ticket stops. Each ticket is
  built in its own copy, checked, reviewed and merged into the working branch, one merge at a time.
- One run at a time: it keeps `.claude/worktrees/run.json` (its pid, its start, a heartbeat rewritten every minute). A
  second `dynamo run` while that run is alive exits 1 at once and names the pid; a dead pid or a heartbeat over 5 minutes
  old is not a run, and the new one goes on.
- Before the lock and before any card moves, `dynamo run` asks GitHub for the name behind `project.repo`. If the repository
  was renamed it stops, saying «the repository is now <current>; change `project.repo`»; nothing is started.
- A ticket a run began leaves its file `.claude/worktrees/runs/<n>.json` (pid, start, round, phase) until it ends, merged
  or in *Needs Human*. If the run that wrote it is dead (killed, or stopped by the usage limit), launching `dynamo run`
  again goes on from the phase of that file, on the same branch and copy: a new Builder in the Builder's phase, Verify
  run again and the reviewer from the start in theirs, the merge (which does only what is missing: the label, the card,
  the comment) in the last. A file whose run is alive refuses the ticket («#<n> is held by the run of pid N since T»).
  A card in a phase column with no file is skipped with its reason: move it by hand.
- It never pushes and never opens a PR. When the list ends it writes the release report and prints the commands you run
  next; a run that pauses at the usage limit, or has nothing to do, does not rewrite the report.
- The notice: with the environment variable `DYNAMO_NOTIFY_URL` set (an ntfy.sh topic, for one), `dynamo run` POSTs one
  line to it when the list ends and when it pauses (the tickets, when the limit resets and the command to go on). With
  no variable there is no notice. Keep the URL in your environment, never in git.
- The exit code is 0 when every ticket was merged, 1 when one stopped or the list paused, and 2 when it was called
  wrong (a bad ticket number).
- `dynamo status` reads the logs of the run while it goes.

## Launching it every hour from the system

A list paused by the usage limit at night goes on only when `dynamo run` is launched again. To have the system do it
with nobody at the PC, make its task scheduler launch the engine's `run` (no numbers: every open ticket that is ready)
**every hour, in the folder of the repository**. Nothing in `dynamo` installs the task: you add it once, by hand.

The task names the engine by its full path, `/path/to/dynamo/dynamo.ts` below. In a project that installed the plugin, the
engine is not in the repository: it is `dynamo/dynamo.ts` under the `installPath` that `claude plugin list --json` prints
for `dynamo@dynamo`. That path holds the version of the plugin, so after `claude plugin update` the task must be changed
to the new one. In a clone of Dynamo it is that clone's `dynamo/dynamo.ts`.

What the three need alike:

- The folder is the main folder of the repository (not a copy under `.claude/worktrees/`), with the working branch
  checked out.
- The task finds `node`, `git`, `gh` and `claude` and their sign-in. A task does not read your shell's profile, so use
  the full path of `node` below (`which node` / `where node`), and make sure `PATH` and `gh auth status` hold for the user
  the task runs as.
- For the notice (below) `DYNAMO_NOTIFY_URL` must be in the task's environment, not only in your shell: set it in the
  crontab, in the plist or in the task's environment. Keep it out of git.
- The run's one JSON line goes to the file the task redirects it to; `/path/to/repo` and `/path/to/node` are yours.

### Linux: cron

Add the line with `crontab -e` (minute 0 of every hour):

```text
DYNAMO_NOTIFY_URL=https://ntfy.sh/your-topic
0 * * * * cd /path/to/repo && /path/to/node /path/to/dynamo/dynamo.ts run >> .claude/worktrees/cron.log 2>&1
```

Remove it: `crontab -e` and delete the two lines (`crontab -l` shows what is left).

### macOS: launchd

Save `~/Library/LaunchAgents/dev.dynamo.run.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>dev.dynamo.run</string>
  <key>ProgramArguments</key>
  <array><string>/path/to/node</string><string>/path/to/dynamo/dynamo.ts</string><string>run</string></array>
  <key>WorkingDirectory</key><string>/path/to/repo</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    <key>DYNAMO_NOTIFY_URL</key><string>https://ntfy.sh/your-topic</string>
  </dict>
  <key>StartInterval</key><integer>3600</integer>
  <key>StandardOutPath</key><string>/path/to/repo/.claude/worktrees/launchd.log</string>
  <key>StandardErrorPath</key><string>/path/to/repo/.claude/worktrees/launchd.log</string>
</dict>
</plist>
```

Start it with `launchctl load ~/Library/LaunchAgents/dev.dynamo.run.plist`. Remove it with `launchctl unload
~/Library/LaunchAgents/dev.dynamo.run.plist` and delete the file.

### Windows: Task Scheduler

From a terminal (`schtasks` ships with Windows), once; `/sc hourly` repeats it every hour and `cd /d` moves to the repository:

```text
schtasks /create /tn "DynamoRun" /sc hourly /tr "cmd /c cd /d C:\path\to\repo && C:\path\to\node.exe C:\path\to\dynamo\dynamo.ts run >> .claude\worktrees\task.log 2>&1"
```

Set `DYNAMO_NOTIFY_URL` as a user environment variable (`setx DYNAMO_NOTIFY_URL https://ntfy.sh/your-topic`, then sign
out and in) so the task sees it. Remove the task with `schtasks /delete /tn "DynamoRun" /f`; `schtasks /query /tn
"DynamoRun"` shows it.

### Why launching it again is safe

- **A second run exits while one is alive.** The run's lock (`.claude/worktrees/run.json`) holds its pid and a heartbeat
  rewritten every minute: a launch while that run is alive exits 1 at once, naming the pid, and touches nothing. A dead
  pid or a heartbeat over 5 minutes old is not a run, and the new one goes on.
- **A run before the reset time launches no agent.** A ticket paused by the usage limit keeps the time the limit resets
  in its file `.claude/worktrees/runs/<n>.json`; a run launched before then does not touch it (no agent, no card, no
  copy) and says it «resets at …». The first hourly run after the reset goes on from the phase the file names, on the same
  branch and copy.
- **An outage of the permission check spends no round.** A Builder that stops while the check of `auto` gives no verdict
  (it asks for the human or ends with no answer) goes on with its conversation after 3 minutes, at most twice; if the
  check is still down, the ticket goes to *Needs Human* with the Builder's reason.
- **A run over a finished state changes nothing.** Merged tickets are not taken twice and a ticket in *Needs Human* is
  skipped; with nothing ready the run starts nothing, rewrites no report and sends no notice.

### What you get when a list ends or pauses, and where

- **The notice**, when `DYNAMO_NOTIFY_URL` is set: one line POSTed to it. When the list **ends**: how many tickets were
  merged and how many stopped, and the path of the report. When it **pauses** at the usage limit: the tickets, when the
  limit resets and the command to go on. With no variable there is no notice.
- **The report**, only when a list ends (a pause or an idle run does not write it):
  `.claude/worktrees/release-report-<base>.md`, with the tickets merged, those in *Needs Human* and the cost; the JSON
  line of that run (in the task's log file) also carries the commands to run next.
- A ticket that stopped has its comment in GitHub, with where it stopped and what is left; one that paused has its
  «run · paused» comment with the reset time and the raw end of the agent.

## What the CI checks

`.github/workflows/ci.yml` runs on every pull request to `main`, and not on the push to it (that push repeats the tree
the pull request already checked). A newer push to the same pull request cancels the run in progress. What depends on
the system runs on three; what does not runs once:

- **On Ubuntu only**: `claude plugin validate . --strict` and `git diff --check` against the base of the change.
  `claude plugin validate` needs the `claude` program, which the workflow installs with npm, but no login.
- **On Ubuntu, Windows and macOS**: the tests, `node --test "dynamo/tests/*.test.ts"`, with the Node version above.
  This is what shows that Dynamo works on the three systems.
- **A secret scan** (Ubuntu): the `gitleaks` program, run by the workflow with no commit range, so it scans every commit
  of the history on each pull request, failing the job on a finding. `gitleaks/gitleaks-action` is not used: on a pull
  request it scans only the commits of that pull request.

`dynamo` neither runs nor waits for the CI: Verify stays local and is the gate of each ticket. In a private repository
on the Free plan the CI warns (a red cross on the pull request) and does not block the merge, since there are no rulesets
to require it. Pushing the workflow is the human's, with the release.

## Setting up a project

`node dynamo/dynamo.ts setup --check <command> [--check <command>]...` (run in the project) writes `.claude/factory.json` with the
board, `.claude/settings.json` and `.gitignore`, creates the labels and seeds or checks the CI. What it wrote is committed on the working branch (last bullet).
The path of the engine changes with each version of the plugin, so a person launches it with the skill `/dynamo:setup`
(`skills/setup/SKILL.md`): it proposes the checks from the scripts of the project, the human confirms them, and it runs
the command with one `--check` each and reports what it printed.

- `repo` and `boardOwner` are read with gh, `mainBranch` from git (the branch `origin/HEAD` points to, else the one
  checked out); every other value comes from `templates/factory.json`. A project with no `factory.json` needs at least one `--check`.
- Each check is run once before anything is written, in a temporary detached worktree of `HEAD` (what is committed, not
  the loose files), as Verify runs it, with `<base>` as `HEAD`. The worktree is removed afterwards.
- A check that fails leaves nothing written: the output says which one and how it ended. One that gives 127 (its program
  could not start) comes with the form to write instead: `node --run <script>` for a script of `package.json`, since
  `npm` cannot run without a shell on Windows.
- The board is a copy of the template board (`TEMPLATE_BOARD` in `dynamo/setups.ts`: owner SergioLizana, number 3), made after the
  checks pass, titled as the repository (its name without the owner) and with the owner passed by name. It is then linked to the
  repository, since a copy loses the link. Its ids (number, id, name, the Status field and the id of each column) are read back
  with `gh project view` and `gh project field-list` into the `board` block; a column of Dynamo missing from the board is an
  error and nothing is written.
- `.claude/settings.json` gets the permission rules of `templates/settings.json` (gaps `<repo>`, `<boardOwner>`,
  `<mainBranch>`, `<boardNumber>`, `<boardId>` and `<statusFieldId>` filled from the project and the board), one
  `Bash(<check>)` rule per check, and `attribution`, `worktree` and the plugin. The merge (`dynamo/setupsettings.ts`) keeps
  what the file had: its rules in their order, with the missing ones added at the end once each, and every key the template
  does not name; a file that is not JSON stops the setup before anything is written. `.claude/worktrees/` is added to
  `.gitignore` unless a line already ignores it.
- `project.doneLabel` and `project.epicLabel` are created in the repository if it lacks them.
- It can run again. With a `board` block it copies no second board and reads the ids again (also after a column is
  renamed), and labels that exist are left alone; the settings and `.gitignore` get nothing twice. With no `--check` it keeps the checks of the file and runs none; with a
  `--check` it runs them and, if they pass, replaces the file's checks.
- After the file is written: with `package-lock.json` it writes `.github/dependabot.yml` for npm, with all updates in one
  group; with another package manager (or none) it says so and goes on, and a `dependabot.yml` or `dependabot.yaml` the
  project already has is not touched.
- For a public repository (`isPrivate` false in `gh repo view`) it calls `PATCH repos/<repo>/code-scanning/default-setup`
  with `state=configured`; a private one gets no call. A refusal of gh is reported in `codeScanning`, not fatal.
- The CI (`dynamo/setupci.ts`). With no `.github/workflows/*.yml` or `.yaml`, it writes `.github/workflows/ci.yml`: on pull requests
  to the main branch, on Node 24, one step per check, with `<base>` written `origin/${{ github.base_ref }}`; from then on the file
  is the project's and the setup never changes it. With workflows, none is changed: each check is looked for in their `run:` lines
  (whole words, any spacing, `<base>` standing for any one word, comment lines of a block not counted) and the ones no line runs
  are named in `ciMissing`; the setup goes on.
- The commit (`dynamo/setupcommit.ts`), last. Copies start from the working branch and `dynamo merge` needs a clean main folder, so the files
  this run wrote are committed on `release/x.y.z` (the greatest above the last tag; with none it makes the next minor after the tag,
  `release/0.1.0` with no tag, at `HEAD`), and the folder stays on it. Only the files it wrote are added; any other file is left as it was
  (`clean` in the output says whether the folder ends clean). With nothing new to commit it makes no commit (`commit` is null),
  but the folder still ends on the working branch: a setup that started on another branch switches to it, whether it was made in
  this run or already existed.
  Nothing is pushed: `push` is the command for the human, the push and the pull request being theirs.

## Reading the board and the report

Both are commands of the program, not skills:

- `node dynamo/dynamo.ts board [n ...]`: for each ticket (the numbers given, or every open issue) its column, its done
  label, its blockers, and whether it is ready and why not. Run it before launching to see what a list would find.
- `node dynamo/dynamo.ts report [base]`: the release report of the working branch (or of the base given), written to
  `.claude/worktrees/release-report-<base>.md`: the tickets merged since the main branch, their last result comment, the
  tickets in *Needs Human* and the cost of each ticket's agents with the release's total. `dynamo run` already writes it at the end of a
  list; run it by hand to rebuild it.

## Closing a release

`node dynamo/dynamo.ts release close --bump <patch|minor|major> [--dry-run]` (the `/dynamo:close-release` skill runs it) works
once the release PR is merged. It makes the milestone `v<x.y.z>` with the tickets merged in the release, the tag, the
GitHub Release and the next branch, and finally **closes the milestone**, so nothing is left to close by hand. With
`--dry-run` it says all of that, including the closing of the milestone, and writes nothing.

## Preparing the public release

`node dynamo/dynamo.ts publish <tag> <clone>` (for example `publish v0.5.0 <your clone of the public repository>`) turns
a release tag into one commit in a separate clone of the public repository. The clone is always the second argument;
nothing in the repository stores its path.

- It copies only the allowlisted files of the tag (the ones that make the plugin), sets the version of the tag in
  `.claude-plugin/plugin.json`, and commits them on `publish/x.y.z` with the tip of the public `main` as the only parent
  (after a `git fetch origin`, when the clone has an `origin`). Files the tag no longer has are gone from the commit.
- The public repository has its own CI and Dependabot: the tag holds them as `public/ci.yml` and
  `public/dependabot.yml`, and the commit places them as `.github/workflows/ci.yml` and `.github/dependabot.yml`; any
  other CI file of the tag is not copied. The public CI can be launched by hand (`workflow_dispatch`) and every job
  passes with no pull request; Dependabot covers the Actions only. A tag without those two files is refused.
- Author and committer are always `Sergio Lizana <28341710+SergioLizana@users.noreply.github.com>`, whatever the local
  git config or environment say. Once the commit is made it is read back: if a hook or a wrapper changed the author or
  the committer, `publish` refuses, puts the clone back and prints no push.
- Before it fetches, checks out or commits anything, it reviews the snapshot: the files that would be committed are
  written to a temporary folder and read there. It refuses, naming every file and line, an email other than the noreply
  ones (the human's and GitHub's own), a user path in any form (`C:\Users\<name>` in any case, `/c/Users/<name>`,
  `/mnt/c/Users/<name>`, `/Users/<name>`, `/home/<name>`; a placeholder such as `<name>` and the path of a URL are not
  findings) and any mention of the private development repository. It also runs
  [gitleaks](https://github.com/gitleaks/gitleaks) on that folder and refuses a secret (it reports file and line, never the
  secret). With gitleaks missing or failing it commits nothing and says so; installing it is up to the human. A refusal
  leaves the clone exactly as it was. The review does not look for machine names: a pattern catches only Windows' default
  names, never a renamed machine.
- In an empty clone the commit has no parent and goes on `main`: it prints the push of the first release.
- It prints the `git push` and `gh pr create` commands and pushes nothing. It refuses an unknown tag, the development
  repository as the clone, a clone with changes, and a `publish/x.y.z` that already exists; none of them commits.

### The first release

> [!WARNING]
> Until the public repository exists, its name redirects to the private repository. A clone made before that holds the
> private history, and nothing in `publish` can tell it apart from a good one: delete it, and clone again only once the
> public repository exists and is empty.

The steps, in this order:

1. Create the public repository **empty**: no README, no license and no `.gitignore`, so that it has no commit.
2. Only now clone it, in a folder of its own outside the development repository.
3. Confirm that the clone has no commits: `git -C <clone> log` says there are none, and `git -C <clone> branch -a` lists
   nothing. If it shows any history, it is the private one: delete the clone and go back to step 2.
4. `node dynamo/dynamo.ts publish <tag> <clone>`. In an empty clone it makes the commit on `main`, with no parent, and
   prints the push.
5. Run the push it printed (`git -C <clone> push -u origin main`). This is the first thing that reaches the public
   repository.
6. Launch the CI by hand (`gh workflow run ci.yml -R <public repository>`, or the Actions tab) and wait for it to pass
   (`gh run watch -R <public repository>`). There is no pull request yet, so this is the only way to run it; its checks
   must have run once before a ruleset can require them.
7. Create the ruleset of `main`: a pull request is required and the checks of the CI must pass, so every later release
   goes through its `publish/x.y.z` branch.
8. `node dynamo/dynamo.ts publish <tag> <clone> --merged`. It checks the commit on the public `main` (below) and prints
   the `gh release create` command.
9. Run the `gh release create` it printed.

### Later releases and the check after the merge

A later release is prepared the same way, on `publish/x.y.z`, and `publish` prints the push and the `gh pr create` to run.
After the human pushed the branch and merged the pull request, `publish <tag> <clone> --merged` checks the commit the
merge left on the public `main` (after a `git fetch origin`). It must be this release (its `plugin.json` carries the
version of the tag), its author must be the noreply identity (name and email), and its committer that identity or
GitHub's own (`GitHub <noreply@github.com>`, the committer of a squash merge); any other name or email fails and
nothing is printed. Only when the
check passes does it print the `gh release create` command, run from the clone: it makes the tag on that commit and the
GitHub Release together, so the tag is GitHub's and carries no tagger email. It changes nothing in the clone.

## Relaunching a ticket from Needs Human

A ticket that stops ends with its card in *Needs Human* and a comment that says what failed, where it stopped and what
is left (the copy and the branch). `dynamo run` skips a ticket in that column, so to relaunch it:

1. Solve what stopped it, or decide it is not done.
2. Move its card to *Todo* (`guides/github-board.md` of the plugin, «Needs Human»).
3. Delete or rename the branch `ticket/<n>-*` and remove its copy, the ones the comment's «Left» line names: `dynamo
   copy add` refuses while either exists, and agents do not delete branches.
4. Launch it again: `/dynamo:autopilot <n>`.

If `dynamo run` itself breaks, fix it in a plain session; there is no other launcher.
