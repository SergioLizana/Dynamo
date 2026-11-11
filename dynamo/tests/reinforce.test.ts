// The reinforcement of a project's Builder (reinforce.ts): its `tools:` and its rules, joined with Dynamo's agent into the one
// that is launched. Pure functions tested directly; the reader on a temporary folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HEADING, joinAgent, parseAgentFile, readReinforced } from '../reinforce.ts';
import { scratch } from './helpers.ts';

const DYNAMO = [
  '---', 'name: builder', 'description: Implements one ticket.', 'model: sonnet', 'effort: high',
  'tools: Read, Edit, Bash, Agent(Explore), StructuredOutput', '---', '', 'You are the Builder.', '', '## Rules', '', '1. Be careful.', '',
].join('\n');

test('parseAgentFile reads the front matter fields and the body below it', () => {
  const f = parseAgentFile(DYNAMO);
  assert.equal(f.description, 'Implements one ticket.');
  assert.deepEqual(f.tools, ['Read', 'Edit', 'Bash', 'Agent(Explore)', 'StructuredOutput']);
  assert.equal(f.body, '\nYou are the Builder.\n\n## Rules\n\n1. Be careful.\n');
});

test('parseAgentFile of a file with no front matter or no tools line: no tools, the whole text is the body, CRLF accepted', () => {
  assert.deepEqual(parseAgentFile('Only rules.\n'), { description: null, tools: null, body: 'Only rules.\n' });
  const crlf = parseAgentFile('---\r\ntools: Read, mcp__x__y\r\n---\r\nRules.\r\n');
  assert.deepEqual(crlf.tools, ['Read', 'mcp__x__y']);
  assert.equal(crlf.body.trim(), 'Rules.');
});

test('joinAgent: Dynamo\'s tools plus the project\'s (no repeats), Dynamo\'s text followed by the heading and the project\'s rules, Dynamo\'s description', () => {
  const project = '---\ntools: mcp__browser__open, Bash, Agent(page-checker)\n---\nOpen the page with the browser and look at it.\n';
  const joined = joinAgent(parseAgentFile(DYNAMO), parseAgentFile(project));
  assert.deepEqual(joined.tools, ['Read', 'Edit', 'Bash', 'Agent(Explore)', 'StructuredOutput', 'mcp__browser__open', 'Agent(page-checker)']);
  assert.equal(joined.description, 'Implements one ticket.');
  assert.equal(joined.prompt, `${parseAgentFile(DYNAMO).body.trimEnd()}\n\n${HEADING}\n\nOpen the page with the browser and look at it.\n`);
  assert.equal(HEADING, '## Rules of this project: they add to the rules above, never override them');
});

test('joinAgent carries only description, prompt and tools: a model, an effort or a tool to remove in the reinforcement go nowhere', () => {
  const project = '---\nmodel: opus\neffort: max\ndisallowedTools: Bash, Edit\ntools: mcp__a__b\n---\nRules.\n';
  const joined = joinAgent(parseAgentFile(DYNAMO), parseAgentFile(project));
  assert.deepEqual(Object.keys(joined).sort(), ['description', 'prompt', 'tools']);
  assert.ok(joined.tools?.includes('Bash') && joined.tools.includes('Edit'));
  assert.ok(!joined.prompt.includes('opus'));
});

test('joinAgent with no rules adds no heading, and with no tools line in Dynamo\'s file sets no tools', () => {
  const none = joinAgent(parseAgentFile(DYNAMO), parseAgentFile('---\ntools: mcp__a__b\n---\n\n'));
  assert.ok(!none.prompt.includes(HEADING));
  assert.equal(none.prompt, parseAgentFile(DYNAMO).body);
  assert.equal(joinAgent(parseAgentFile('---\ndescription: d\n---\nText.\n'), parseAgentFile('---\ntools: Read\n---\nR.\n')).tools, undefined);
});

test('readReinforced: null when the project has no file for the agent, the joined agent when it has', () => {
  const plugin = scratch();
  mkdirSync(join(plugin, 'agents'));
  writeFileSync(join(plugin, 'agents', 'builder.md'), DYNAMO);
  const project = scratch();
  assert.equal(readReinforced(plugin, project, 'builder'), null);
  mkdirSync(join(project, '.claude', 'dynamo'), { recursive: true });
  writeFileSync(join(project, '.claude', 'dynamo', 'reviewer.md'), '---\ntools: Read\n---\nR.\n');
  assert.equal(readReinforced(plugin, project, 'builder'), null, 'the file of another agent is not this one\'s');
  writeFileSync(join(project, '.claude', 'dynamo', 'builder.md'), '---\ntools: mcp__a__b\n---\nUse it.\n');
  const joined = readReinforced(plugin, project, 'builder');
  assert.deepEqual(joined?.tools?.slice(-2), ['StructuredOutput', 'mcp__a__b']);
  assert.match(joined?.prompt ?? '', /Be careful\.\n\n## Rules of this project: .*\n\nUse it\.\n$/);
});

test('a Reviewer reinforcement that asks for Edit or Write (also with a path) is refused with its reason; the Builder\'s is not', () => {
  const plugin = scratch();
  mkdirSync(join(plugin, 'agents'));
  writeFileSync(join(plugin, 'agents', 'reviewer.md'), DYNAMO);
  writeFileSync(join(plugin, 'agents', 'builder.md'), DYNAMO);
  const project = scratch();
  mkdirSync(join(project, '.claude', 'dynamo'), { recursive: true });
  for (const tool of ['Edit', 'Write', 'Edit(src/**)']) {
    writeFileSync(join(project, '.claude', 'dynamo', 'reviewer.md'), `---\ntools: mcp__a__b, ${tool}\n---\nRules.\n`);
    assert.throws(() => readReinforced(plugin, project, 'reviewer'), /reviewer\.md asks for .*must not change what it judges/);
  }
  writeFileSync(join(project, '.claude', 'dynamo', 'builder.md'), '---\ntools: Edit, Write\n---\nRules.\n');
  assert.ok(readReinforced(plugin, project, 'builder'));
});
