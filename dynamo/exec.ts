// Runs a program without a shell, the same on Linux, macOS and Windows, and returns its exit code and output.
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';

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

// How much of the end of stderr `execToFile` keeps: its stdout has no limit, its stderr is only the reason of a failure.
const STDERR = 64 * 1024;

// The same, without waiting, and with the program's stdout written straight to the file `stdout` (created or emptied):
// the child writes to the file descriptor itself, so the file grows while it runs and its size has no limit. Only the
// code and the end of stderr come back; what it printed is read from the file.
export function execToFile(command: string[], args: string[], stdout: string, options: Options = {}): Promise<Omit<Result, 'stdout'>> {
  const [file, ...first] = command;
  const fd = openSync(stdout, 'w');
  return new Promise((resolve) => {
    let stderr = '';
    let ended = false;
    const end = (code: number, extra = '') => {
      if (ended) return;
      ended = true;
      closeSync(fd);
      resolve({ code, stderr: stderr + extra });
    };
    const child = spawn(file, [...first, ...args], {
      cwd: options.cwd, env: options.env ?? process.env, stdio: ['pipe', fd, 'pipe'], windowsHide: true,
    });
    child.on('error', (e) => end(127, `${file}: ${e.message}`));
    child.on('close', (code) => end(code ?? 1));
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-STDERR); });
    // A program that exits without reading its stdin must not fail the run with EPIPE.
    child.stdin?.on('error', () => {});
    child.stdin?.end(options.input ?? '');
  });
}
