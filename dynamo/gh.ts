// `gh`, run by dynamo itself. DYNAMO_GH, a JSON array with a program and its first arguments, takes its place: the tests
// put the fake there (tests/fake-gh.ts) and run with no real gh on the PATH.
import { exec, type Options, type Result } from './exec.ts';

export function gh(args: string[], options: Options = {}): Result {
  const fake = (options.env ?? process.env).DYNAMO_GH;
  return exec(fake ? JSON.parse(fake) : ['gh'], args, options);
}
