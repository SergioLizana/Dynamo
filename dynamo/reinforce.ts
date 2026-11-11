// The reinforcement a project gives its Builder or Reviewer: `.claude/dynamo/<agent>.md`, with a `tools:` line (the tools it adds) and a body
// (the rules it adds). `readReinforced` joins it with Dynamo's own agent file into the one agent that is launched (`--agents`);
// nothing is written to a file, so a project keeps getting Dynamo's improvements. The reinforcement only adds: of its front matter
// only `tools:` is read, so a model, an effort or a tool to remove in it change nothing (the ticket's level sets the first two,
// the agent file of Dynamo has the tools it needs). The Reviewer judges and never changes what it judges,
// so a reinforcement of it that asks for a tool that writes is refused (`refusedTools`). Pure but for the reads of `readReinforced`.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// An agent file: its description, its tools (null when the file has no `tools:` line, so the agent gets the session's) and the
// text below the front matter.
export type AgentFile = { description: string | null; tools: string[] | null; body: string };

// What `--agents` is given for one agent. No model and no effort: the launch's flags set them.
export type JoinedAgent = { description: string; prompt: string; tools?: string[] };

export const HEADING = '## Rules of this project: they add to the rules above, never override them';

// The tools that write files: a Reviewer reinforcement cannot add them. `Edit(<path>)` and the like count by their name.
const WRITING = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];

export function refusedTools(tools: string[] | null): string[] {
  return (tools ?? []).filter((t) => WRITING.includes(t.replace(/\(.*$/, '')));
}

export function parseAgentFile(text: string): AgentFile {
  const lines = text.split('\n');
  const closing = lines[0]?.trimEnd() === '---' ? lines.findIndex((l, i) => i > 0 && l.trimEnd() === '---') : -1;
  if (closing < 0) return { description: null, tools: null, body: text };
  const field = (name: string): string | null => {
    const line = lines.slice(1, closing).find((l) => l.startsWith(`${name}:`));
    return line === undefined ? null : line.slice(name.length + 1).trim();
  };
  const tools = field('tools');
  return {
    description: field('description') || null,
    tools: tools === null ? null : tools.split(',').map((t) => t.trim()).filter((t) => t !== ''),
    body: lines.slice(closing + 1).join('\n').replace(/\r/g, ''),
  };
}

// Dynamo's name and description; its tools plus the project's; its text unchanged, followed (when the project has rules) by the
// heading and the project's rules.
export function joinAgent(dynamo: AgentFile, project: AgentFile): JoinedAgent {
  const rules = project.body.trim();
  return {
    description: dynamo.description ?? `Dynamo's agent`,
    prompt: rules === '' ? dynamo.body : `${dynamo.body.trimEnd()}\n\n${HEADING}\n\n${rules}\n`,
    ...(dynamo.tools === null ? {} : { tools: [...new Set([...dynamo.tools, ...(project.tools ?? [])])] }),
  };
}

// The agent to launch in place of Dynamo's `agent` (`agents/<agent>.md` of the plugin at `plugin`), or null when the project
// (`cwd`, the copy of the ticket) has no reinforcement file for it. It throws, saying why, when the Reviewer's file asks for a
// tool that writes.
export function readReinforced(plugin: string, cwd: string, agent: string): JoinedAgent | null {
  const file = join(cwd, '.claude', 'dynamo', `${agent}.md`);
  if (!existsSync(file)) return null;
  const project = parseAgentFile(readFileSync(file, 'utf8'));
  const refused = agent === 'reviewer' ? refusedTools(project.tools) : [];
  if (refused.length > 0) {
    throw new Error(`.claude/dynamo/reviewer.md asks for ${refused.join(', ')}: the Reviewer judges and must not change what it judges, so a reinforcement of it cannot add a tool that writes files`);
  }
  return joinAgent(parseAgentFile(readFileSync(join(plugin, 'agents', `${agent}.md`), 'utf8')), project);
}
