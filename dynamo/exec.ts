// Runs a program without a shell, the same on Linux, macOS and Windows, and returns its exit code and output.
import { spawnSync } from 'node:child_process';

export type Env = Record<string, string | undefined>;
export type Options = { cwd?: string; input?: string; env?: Env };
export type Result = { code: number; stdout: string; stderr: string };

// `command` is the program and the arguments that always go first. A program that cannot start (not on the PATH) gives
// code 127 with the reason in stderr, as a shell does; one killed by a signal gives 1.
export function exec(command: string[], args: string[], options: Options = {}): Result {
  const [file, ...first] = command;
  const r = spawnSync(file, [...first, ...args], {
    cwd: options.cwd, env: options.env ?? process.env, input: options.input ?? '',
    encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) return { code: 127, stdout: '', stderr: `${file}: ${r.error.message}` };
  return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
}
