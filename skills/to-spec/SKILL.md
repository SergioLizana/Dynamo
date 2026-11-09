---
name: to-spec
description: Write the spec closed in the current conversation (right after /dynamo:discover) with the request template, as one epic issue per block with no card on the board, deciding nothing new. Use when the human runs /dynamo:to-spec in the same session as /dynamo:discover.
argument-hint: (none - the source is this conversation)
disable-model-invocation: true
---

# /dynamo:to-spec

Turn what was already agreed in this conversation into one or more epics that `/dynamo:to-tickets` can split. Talk to the
human in the language their `CLAUDE.md` asks for; write the epics in `project.documentsLanguage`. Every project value
comes from `.claude/factory.json`, with its meaning in `${CLAUDE_PLUGIN_ROOT}/guides/factory.md`.

This is synthesis, not an interview: do not ask the human to decide anything. You write down decisions, you never
make them. Write them yourself, in this session, with no agents: an agent would write from a summary of the
conversation, not from the conversation.

## 1. Gather the source

- The source is the current conversation: the idea, the facts checked in the repo and the decisions closed in
  `/dynamo:discover`, and above all its summary (step 4 of `/dynamo:discover`).
- If the conversation has no idea to write down (no `/dynamo:discover`, nothing agreed), say so and stop. Do not invent one.
- If a fact an epic relies on can be checked in the repo (a file exists, a command works), check it before writing
  it. A fact you cannot check goes to «Notes» as unverified.
- If `/dynamo:discover` started from an epic (`/dynamo:discover #<n>`), that epic is the **parent** of what you write now.

## 2. One epic per block

- `/dynamo:discover` said «one spec»: one epic. «Several specs»: one epic per block, in the order the human approved.
- The decisions common to every block go into each block's epic, marked `(common)`: each epic is read alone, by
  `/dynamo:to-tickets` and by the Builders it points to.
- A block left pending is not an epic of its own yet: it goes as `Pending: Block <name>: <what is left to decide>;
  depends on <…>` into the «Notes» of the epic it depends on, or of the first epic if it depends on none. If every
  block is pending, write one epic with only the common decisions and the pending blocks.
- With a parent, the first line of «Notes» of each epic is `Parent: #<n>`. Do not use the sub-issue relation: an
  epic's sub-issues are its tickets, and an epic is not one.

## 3. Fill the template

Read `${CLAUDE_PLUGIN_ROOT}/templates/request.md` and fill every section of each epic, in its order, without adding or removing
sections:

- **Problem**, **Solution** and **What changes for the user**: from the point of view of the person who uses it,
  not of the code.
- **Decisions**: only the ones closed in the conversation, one per line with its reason, among them the modules touched
  and the tests to follow, if they were agreed. Do not add a decision that was not taken, even if it looks obvious.
- **How it is tested**: commands or readings that show it works, as agreed. If none was agreed, write «Not agreed»
  and add it to «Notes» as pending.
- **Out of scope**: what the conversation left out. If nothing was said, «None».
- **Notes**: the parent line, links, facts checked in the repo, and every open question.

Anything that was discussed but **not closed** goes to «Notes» as `Pending: <the doubt>`, never into «Decisions»
or «Solution». If two things said in the conversation contradict each other, write both under «Notes» as pending;
do not pick one. `/dynamo:to-tickets` does not split an epic with a pending item.

No ticket split: that is `/dynamo:to-tickets`'s job.

## 4. Show and approve

Show the human, for each epic, its title (a short sentence, not starting with «/») and its body, and which epic
blocks which. Fix them until the human approves. Do not create anything before that.

## 5. Create the epics

For each epic, in order:

1. Write its body to a file in the scratchpad, and create it with the label `project.epicLabel`:
   `gh issue create -R <repo> --title <title> --label <epicLabel> --body-file <file>`. Do not pass `--parent` and do
   not add it to the board.
2. Read it back: `gh issue view <n> -R <repo> --json number,labels,projectItems`. It must carry the label and have no
   item in `projectItems`; if it has a card, stop and say so with the output.
3. Where one block gates another, the «Blocked by» commands of `${CLAUDE_PLUGIN_ROOT}/guides/github-board.md`: the epic that
   waits is blocked by the one it waits on. Read the relation back with the same file's command.

With a parent, edit its body last (`gh issue edit <parent> -R <repo> --body-file <file>`): each pending block written
now becomes `Block <name>: #<its epic>`, and nothing else in the body changes. Read it back.

Do not commit, write files in the repository or create tickets.

## 6. Hand over

Tell the human, in a short summary:
- each epic's number and title, and the blockers between them;
- the pending items per epic (an epic with any of them is not split until they are closed);
- the next step, literally: `/dynamo:to-tickets #<epic>` per epic without pending items, in their order, and
  `/dynamo:discover #<epic>` in its own session for each pending block.
