// `dynamo release <action> [arguments]`: what is done with a release once its tickets are merged. Each action is its own
// module and its line here.
import type { Subcommand } from './cli.ts';
import { usage } from './cli.ts';
import { releaseCheck } from './release-check.ts';
import { releaseClose } from './release-close.ts';

const actions = new Map<string, Subcommand>([
  ['check', releaseCheck],
  ['close', releaseClose],
]);

export const release: Subcommand = (args, deps) => {
  const [name, ...rest] = args;
  const action = name === undefined ? undefined : actions.get(name);
  if (!action) usage(`usage: release <${[...actions.keys()].join('|')}> [arguments]`);
  return action(rest, deps);
};
