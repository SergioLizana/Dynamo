# Tickets on GitHub: blockers, "done" and the board

Tested on 2026-10-26 on `SergioLizana/Dynamo` (ticket #1). Template: `.claude/templates/ticket.md`.
States and meaning: plan §6.5. The column names and the ids of their options are in
`.claude/factory.json` (not copied here). The other project data (repository, board, labels) are in
`.claude/factory.md`; here they go between `<…>`: `<repo>`, `<owner>`, `<number>` of the project, `<project-id>`, `<status-field-id>`,
`<option-id>` of a state, `<done>` (done label).

## Blocked by

The **native** GitHub relation is the source of truth. The "Blocked by" section of the body is only for reading.

```bash
# internal id (not the number) of the blocker
ID=$(gh api repos/<repo>/issues/<blocker> --jq .id)
gh api repos/<repo>/issues/<n>/dependencies/blocked_by -F issue_id=$ID
gh api repos/<repo>/issues/<n>/dependencies/blocked_by --jq '.[]|{number,state}'
```

This POST without `-X` is the one `.claude/settings.json` allows; the risk that it lets the API write to `main` is in
`documentation/backlog.md`, "Protect `main`".

Verified:
- A closed blocker **stays in the list** with `state: closed`. `issueDependenciesSummary.blockedBy` (GraphQL) counts
  only the open ones.
- The project has no "Blocked by" field: the blocker is seen on the issue page, not as a board column. I have not been
  able to check from the CLI whether the web interface shows it on the card.

## Done in release

GitHub only closes issues when merging into `main`, and tickets are merged into `release/x.y.z`. Decision:

- When the ticket is merged into the release: label **`in-release`** and card in *Done*. The issue **stays open**.
- "Closed" means "in `main`". The release PR carries `Closes #n` for each ticket so that GitHub closes them by itself.
  *Not tested*: it requires merging into `main`, which is not done without your authorization.
- `/run` frontier (defined and tested by `/run`, stage 3; here only the marking rule): open issues without
  `in-release`, whose card is not in *Needs Human*, and whose blockers have that label or are closed.

```bash
gh issue edit <n> -R <repo> --add-label <done>
```

### Renaming the done label (once, by the human)

The label used to be called `hecho-en-release`; `.claude/factory.md` now names it `in-release`. The human renames it on
GitHub right after ticket #37 merges and before the next run (a run reads the label name when it starts, so the run that
builds #37 is not affected). No agent renames it:

```bash
gh label edit hecho-en-release --name in-release -R <repo>
```

Renaming keeps the label on the issues that already carry it.

## Needs Human (stuck ticket)

A ticket that stops (`/implement`, or the `run` workflow) ends with its card in *Needs Human* and a comment that says
what failed, at which step it stopped, what is left (branch, copy or stash) and how to relaunch it. It is a state of the
card, not a label. **"Blocked by" does not change:** it is still the native GitHub relation (see above), and a ticket in
*Needs Human* does not touch it.

To take a ticket out of *Needs Human*:

1. Solve what stopped it, or decide that it is not done.
2. Move the card to *Todo*, with the one-step command (the *Todo* option is in `.claude/factory.json`):

```bash
gh project item-edit <number> --owner <owner> --url https://github.com/<repo>/issues/<n> --field "Status" --value "Todo"
```

3. Delete or rename the branch and the copy that the comment's "Left" line names. The human deletes them; the agents do
   not delete branches.
4. Relaunch it: `/implement <n>` by hand (`documentation/launch-one-ticket.md`), or `/run <n>`
   (`documentation/launch-list.md`).

## Adding an issue to the board

`gh issue create ... --project "Dynamo"` adds it to the board **with no state** (tested 2026-10-26 with issue #8, since
deleted: only the `AddedToProjectV2Event` event remains). It has to be moved to *Todo* with `move_card`.

In Git Bash, an argument that starts with `/` is rewritten as a Windows path: issue #10 was created with the title
"C:/Program Files/Git/to-tasks…" (2026-10-26). It is avoided by prefixing `MSYS_NO_PATHCONV=1` to the `gh` command; the
body given by `--body-file -` is not affected.

Right after creating an issue, its card takes a few seconds to appear in `gh project item-list`, and `move_card` fails
with "specify the item to edit" (seen 2026-10-26 with #13). Without looking up the card's id, using the issue URL and
the names of the field and the state, it works the first time:

```bash
gh project item-edit <number> --owner <owner> --url https://github.com/<repo>/issues/<n>   --field "Status" --value "Todo"
```

When an issue is deleted, its card stays on the board for a while, empty (`content` and `status` set to `null` in
`gh project item-list`), and `gh project item-delete` rejects it for lack of permissions. GitHub removes it by itself
after a few minutes (seen 2026-10-26 with #9 and #10): nothing to do.

## Moving a card

```bash
move_card() { # $1 = issue number, $2 = option id
  ITEM=$(gh project item-list <number> --owner <owner> --limit 100 --format json \
    --jq ".items[]|select(.content.number==$1)|.id")
  gh project item-edit --id "$ITEM" --project-id <project-id> \
    --field-id <status-field-id> --single-select-option-id "$2"
}
```

The project and Status field ids are in `.claude/factory.md`; those of each state, in `options` of
`.claude/factory.json`.

Tested 2026-10-26 on test issue #6 (since deleted, so no history remains): Todo → In Progress → Verify → In Review →
In Progress → In Review → Done. If a state is renamed or recreated, read them again with
`gh project field-list <number> --owner <owner> --format json`.

## Renaming a column

The human does it on the GitHub website, not through the API (it has not been checked that renaming keeps the option
ids). To go from *In Progress* to *Build* and from *In Review* to *Review*:

1. Merge the ticket that changes `.claude/factory.json` (#41) into the release.
2. Right after, before the next run, on the board: *Settings* → *Status* field → rename the option.
3. Check that the ids are still those in `options` of `.claude/factory.json`:

```bash
gh project field-list <number> --owner <owner> --format json
```

   If an id has changed, fix `options` in the JSON. Until renamed, moving a card to *Build* or *Review* fails.

## Checking which states a card has passed through

GitHub writes this, not the agent: it is the evidence of the state changes. The REST API (`issues/<n>/timeline`) returns
the events but **not** the states; GraphQL has to be used.

```bash
gh api graphql -f query='query{repository(owner:"<owner>",name:"<repo name>"){issue(number:<n>){
  timelineItems(first:50,itemTypes:[PROJECT_V2_ITEM_STATUS_CHANGED_EVENT]){nodes{
  ... on ProjectV2ItemStatusChangedEvent{createdAt previousStatus status}}}}}}' \
  --jq '.data.repository.issue.timelineItems.nodes[]|"\(.createdAt) \(.previousStatus) -> \(.status)"'
```

Tested 2026-10-26 on #1: `Todo -> In Progress`, `In Progress -> Done`, with date. A deleted issue takes its history
with it.
