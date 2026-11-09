# Tickets on GitHub: blockers, "done" and the board

Template: `templates/ticket.md`.
The column names are Dynamo's (`dynamo/columns.ts`); the ids of their options are in the `board` block of
`.claude/factory.json` (not copied here). The other project data (repository, board, labels) are in the `project` and
`board` blocks of the same file (`factory.md` explains each value); here they go between `<…>`: `<repo>`, `<owner>`, `<number>` of the project, `<project-id>`, `<status-field-id>`,
`<option-id>` of a state, `<done>` (done label).

## Blocked by

The **native** GitHub relation is the source of truth. The "Blocked by" section of the body is only for reading.

```bash
# internal id (not the number) of the blocker
ID=$(gh api repos/<repo>/issues/<blocker> --jq .id)
gh api repos/<repo>/issues/<n>/dependencies/blocked_by -F issue_id=$ID
gh api repos/<repo>/issues/<n>/dependencies/blocked_by --jq '.[]|{number,state}'
```

This POST without `-X` is the one `.claude/settings.json` allows; the same permission lets `gh api` write to `main`
through the API, which no local rule stops.

Verified:
- A closed blocker **stays in the list** with `state: closed`. `issueDependenciesSummary.blockedBy` (GraphQL) counts
  only the open ones.
- The project has no "Blocked by" field: the blocker is seen on the issue page, not as a board column. Whether the
  web interface shows it on the card could not be checked from the CLI.

## Pre-push hook: nothing from this clone reaches `main`

The hook guards only a repository that carries `.githooks/pre-push`; a project without that file has no such guard.
`.githooks/pre-push` (POSIX `sh`) reads the remote refs git gives it and refuses the push if any is
`refs/heads/<mainBranch of .claude/factory.json>`, however the command is written (`HEAD:refs/heads/main`, inside
`sh -c`, an alias). The message says to merge the release PR on GitHub. Git does not use a hooks folder from the
repository until it is told to, so the human runs this **once per clone**:

```bash
git config core.hooksPath .githooks
```

`.claude/settings.json` denies `git push` with `--no-verify`, `git config` and edits to `.githooks/**` and `.git/**`, so
an agent cannot switch the hook off.

What the hook does **not** cover: pushes from other machines or clones where the setting was not made, the GitHub web
interface, and the API (`gh api` can write to `main` through the REST API). Only GitHub Pro (rulesets) or a
token without write access to contents closes those.

## Done in release

GitHub only closes issues when merging into `main`, and tickets are merged into `release/x.y.z`. Decision:

- When the ticket is merged into the release: the done label (`<done>`) and card in *Done*. The issue **stays open**.
- "Closed" means "in `main`". The release PR carries `Closes #n` for each ticket, so GitHub closes them when it is
  merged into `main`.
- Which tickets are ready to run: `board-guide.md`, «When a ticket is ready».

```bash
gh issue edit <n> -R <repo> --add-label <done>
```

## Needs Human (stuck ticket)

A ticket that stops (`dynamo run`) ends with its card in *Needs Human* and a comment that says
what failed, at which step it stopped, what is left (branch or copy) and how to relaunch it. It is a state of the
card, not a label. **"Blocked by" does not change:** it is still the native GitHub relation (see above), and a ticket in
*Needs Human* does not touch it.

To take a ticket out of *Needs Human*:

1. Solve what stopped it, or decide that it is not done.
2. Move the card to *Todo*, with the one-step command:

```bash
gh project item-edit <number> --owner <owner> --url https://github.com/<repo>/issues/<n> --field "Status" --value "Todo"
```

3. Delete or rename the branch and the copy that the comment's "Left" line names. The human deletes them; the agents do
   not delete branches.
4. Relaunch it with `/dynamo:autopilot <n>` (`dynamo/README.md`).

## Adding an issue to the board

`gh issue create ... --project "<boardName>"` adds it to the board **with no state** (the only event it leaves is
`AddedToProjectV2Event`). It has to be moved to *Todo* with `move_card`.

In Git Bash, an argument that starts with `/` is rewritten as a Windows path: an issue was once created with the title
"C:/Program Files/Git/to-tasks…". It is avoided by prefixing `MSYS_NO_PATHCONV=1` to the `gh` command; the
body given by `--body-file -` is not affected.

`dynamo` already sets `MSYS_NO_PATHCONV=1` for the agents it launches (the Builder and the reviewer) and for every gh and
git command it runs itself (`dynamo/exec.ts`, the one place that starts programs), so none of them needs the prefix. It is
still needed by hand in a plain session, where nothing sets it.

Right after creating an issue, its card takes a few seconds to appear. `move_card` moves by
the issue URL and the names of the field and the state, with no card id to look up, so it works the first time:

```bash
gh project item-edit <number> --owner <owner> --url https://github.com/<repo>/issues/<n>   --field "Status" --value "Todo"
```

When an issue is deleted, its card stays on the board for a while, empty (`content` and `status` set to `null` in
`gh project item-list`), and `gh project item-delete` rejects it for lack of permissions. GitHub removes it by itself
after a few minutes: nothing to do.

## Sub-issues (an epic and its tickets)

An epic is an issue with the epic label whose tickets are its sub-issues. The relation is native, like «Blocked by».
Tried with gh 2.102.0 by `/dynamo:to-tickets`, which creates the tickets of an epic as its sub-issues. None of
the three commands needs REST.

```bash
# 1. Create with a parent. Prints only the new issue's URL.
gh issue create -R <repo> --title "<title>" --body-file <file> --parent <epic>

# 2. Set (or change) the parent of an issue that already exists. Prints the issue URL.
gh issue edit <n> -R <repo> --parent <epic>

# 3. Read the parent of a ticket, and the sub-issues of an epic.
gh issue view <n> -R <repo> --json parent
gh issue view <epic> -R <repo> --json subIssues
```

What each prints:

- `gh issue create --parent` prints the URL of the new issue and nothing else.
- `gh issue edit --parent` prints the URL of the edited issue. **Not tried**: the flag is
  listed by `gh issue edit --help` (with `--remove-parent` and `--add-sub-issue`), but its effect on a real issue
  has not been seen.
- `--json parent` on a sub-issue prints `{"parent":{"id":…,"number":12,"state":"OPEN","title":…,"url":…}}`; on an
  issue with no parent it prints `{"parent":null}` (seen on a ticket with no epic).
- `--json subIssues` on the epic prints `{"subIssues":{"nodes":[{"id":…,"number":13,"state":…,"title":…,"url":…},…],
  "totalCount":3}}`: the numbers are in `subIssues.nodes[].number` (`[13, 14, 15]` for epic 12).

**The board does not add a sub-issue by itself.** A sub-issue created with `--parent` and no `--project` had `projectItems` =
`[]` on three reads over about a minute; `gh issue edit <n> -R <repo> --add-project "<boardName>"` added it. To get a
card, create the sub-issue with `--project "<boardName>"` too: it comes with a card and no
state, and is moved to *Todo* as any new issue (see «Adding an issue to the board»). Probable cause, not checked (the
project's built-in workflows cannot be read with `gh`): GitHub's auto-add of sub-issues acts only when the parent is on
the board, and an epic is not.

## Moving a card

```bash
move_card() { # $1 = issue number, $2 = column name (from the code, dynamo/columns.ts)
  gh project item-edit <number> --owner <owner> --url https://github.com/<repo>/issues/$1 \
    --field "Status" --value "$2"
  gh issue view $1 -R <repo> --json projectItems --jq '.projectItems[0].status.name'
}
```

The second command reads back only that issue: it must print the column. It never lists the board (`gh project
item-list` returns every card ever made and fills the context; `board-guide.md`). The column names
are Dynamo's, in `dynamo/columns.ts`. `dynamo card` moves by the column name and compares what it reads back with the
option id in `board.options` of `.claude/factory.json`, so a stale id makes the move fail (below).

Tested on a test issue: Todo → Build → Verify → Review → Build →
Review → Done. If a state is renamed or recreated, read them again with
`gh project field-list <number> --owner <owner> --format json`.

## Reading the option ids again

If a column is renamed or recreated on the board, check that the ids are still those in `board.options` of
`.claude/factory.json`:

```bash
gh project field-list <number> --owner <owner> --format json
```

If an id has changed, fix `board.options` in the JSON; until then, moving a card to that column fails.

## Checking which states a card has passed through

GitHub writes this, not the agent: it is the evidence of the state changes. The REST API (`issues/<n>/timeline`) returns
the events but **not** the states; GraphQL has to be used.

```bash
gh api graphql -f query='query{repository(owner:"<owner>",name:"<repo name>"){issue(number:<n>){
  timelineItems(first:50,itemTypes:[PROJECT_V2_ITEM_STATUS_CHANGED_EVENT]){nodes{
  ... on ProjectV2ItemStatusChangedEvent{createdAt previousStatus status}}}}}}' \
  --jq '.data.repository.issue.timelineItems.nodes[]|"\(.createdAt) \(.previousStatus) -> \(.status)"'
```

Tested on an issue: `Todo -> Build`, `Build -> Done`, with date. A deleted issue takes its history
with it.
