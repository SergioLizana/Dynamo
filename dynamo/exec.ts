// Runs a program without a shell, the same on Linux, macOS and Windows, and returns its exit code and output: `exec`
// waits (the short gh and git calls), `execAsync` and `execToFile` do not (what takes minutes).
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';

export type Env = Record<string, string | undefined>;
// `signal` closes a program started with `execToFile`, together with every process it started, when it aborts.
// `timeoutMs` does the same to a program started with `execAsync` that is still running after that long.
export type Options = { cwd?: string; input?: string; env?: Env; signal?: AbortSignal; timeoutMs?: number };
// `timedOut` is set only by `execAsync` with `timeoutMs`, when it closed the program for going past it.
export type Result = { code: number; stdout: string; stderr: string; timedOut?: boolean };

// The code of a program closed for going past its limit, the one `timeout(1)` uses.
const TIMED_OUT = 124;

// The environment of every program: the one given (or dynamo's own) with path conversion off. Git Bash rewrites an argument
// that starts with a slash as a Windows path (a commit titled with a skill name once got «C:/Program Files/Git/» in front);
// the variable does nothing on Linux and macOS, so there is no branch per system. Set here, it reaches gh, git and the agents.
function childEnv(env: Env | undefined): Env {
  return { ...(env ?? process.env), MSYS_NO_PATHCONV: '1' };
}

// Waits for the program, so only for short calls. `command` is the program and the arguments that always go first. A
// program that cannot start (not on the PATH) gives code 127 with the reason in stderr, as a shell does; one killed by a
// signal gives 1.
export function exec(command: string[], args: string[], options: Options = {}): Result {
  const [file, ...first] = command;
  const r = spawnSync(file, [...first, ...args], {
    cwd: options.cwd, env: childEnv(options.env), input: options.input ?? '',
    encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) return { code: 127, stdout: '', stderr: `${file}: ${r.error.message}` };
  return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
}

// Closes the process `pid` and every process it started. This is the one place with a branch per system (every
// other module runs the same everywhere), because a child that outlives its parent (a shell an agent left running)
// holds the pipes, the ports and the files of the copy, and Node's `kill` reaches only the process itself.
// Windows: `taskkill /T` walks the tree of the pid. Linux and macOS: the program was started as the leader of its own
// process group (`detached` in `execToFile` and `execAsync`), and a negative pid signals the whole group.
function closeTree(pid: number): void {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    return;
  }
  try { process.kill(-pid, 'SIGKILL'); } catch { /* the group is already gone */ }
}

// The same, without waiting, and with a time limit: what the automatic check runs (verify and the merge's suite), which
// takes minutes. `dynamo run` stays free meanwhile, so it keeps watching the agents of the other tickets. A program still
// running after `timeoutMs` is closed with every process it started (`closeTree`) and comes back with `timedOut` and code
// 124; with no `timeoutMs` it has no limit. Its pipes are normally closed with the tree; if a process that got away holds
// them, the result is given 5 s after the close anyway.
export function execAsync(command: string[], args: string[], options: Options = {}): Promise<Result> {
  const [file, ...first] = command;
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let done = false;
    let timer: NodeJS.Timeout | undefined;
    let backstop: NodeJS.Timeout | undefined;
    const finish = (code: number, extra = '') => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(backstop);
      for (const stream of [child.stdin, child.stdout, child.stderr]) stream?.destroy();
      child.unref();
      resolve({ code: timedOut ? TIMED_OUT : code, stdout, stderr: stderr + extra, ...(timedOut ? { timedOut } : {}) });
    };
    const child = spawn(file, [...first, ...args], {
      cwd: options.cwd, env: childEnv(options.env), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
      detached: process.platform !== 'win32', // its own process group, so `closeTree` can reach the whole tree
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d: string) => { stdout += d; });
    child.stderr.on('data', (d: string) => { stderr += d; });
    // A program that exits without reading its stdin must not fail the run with EPIPE.
    child.stdin.on('error', () => {});
    child.stdin.end(options.input ?? '');
    child.on('error', (e) => finish(127, `${file}: ${e.message}`));
    child.on('close', (code) => finish(code ?? 1));
    if (options.timeoutMs !== undefined) {
      timer = setTimeout(() => {
        timedOut = true;
        if (child.pid !== undefined) closeTree(child.pid);
        backstop = setTimeout(() => finish(1), 5000);
      }, options.timeoutMs);
    }
  });
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
      options.signal?.removeEventListener('abort', close);
      closeSync(fd);
      resolve({ code, stderr: stderr + extra });
    };
    const child = spawn(file, [...first, ...args], {
      cwd: options.cwd, env: childEnv(options.env), stdio: ['pipe', fd, 'pipe'], windowsHide: true,
      detached: process.platform !== 'win32', // its own process group, so `closeTree` can reach the whole tree
    });
    const close = () => { if (child.pid !== undefined) closeTree(child.pid); };
    if (options.signal?.aborted) close();
    else options.signal?.addEventListener('abort', close, { once: true });
    child.on('error', (e) => end(127, `${file}: ${e.message}`));
    child.on('close', (code) => end(code ?? 1));
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-STDERR); });
    // A program that exits without reading its stdin must not fail the run with EPIPE.
    child.stdin?.on('error', () => {});
    child.stdin?.end(options.input ?? '');
  });
}
