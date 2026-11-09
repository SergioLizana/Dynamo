// `git`, run by dynamo itself, in the folder of `options.cwd` (the current one if not given).
import { exec, type Options, type Result } from './exec.ts';

export function git(args: string[], options: Options = {}): Result {
  return exec(['git'], args, options);
}
