// The file system questions `dynamo copy` and `dynamo publish` need, kept apart so copy.ts and publish.ts import no
// `node:fs` (they get their edges from here).
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';

// Whether something is on disk at `path` that git cannot make a copy over: a file, or a folder with content. An empty
// folder is fine for `git worktree add`.
export function occupied(path: string): boolean {
  if (!existsSync(path)) return false;
  return !statSync(path).isDirectory() || readdirSync(path).length > 0;
}

export function isFolder(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

// A new folder in the system's temp folder, and its removal.
export function tempFolder(): string {
  return mkdtempSync(join(tmpdir(), 'dynamo-publish-'));
}

export function removeFolder(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

// A file written with `text` as it is, its folder made if it is missing.
export function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

// The text of a file changed by `change`, written back as it is (LF stays LF).
export function rewriteText(path: string, change: (text: string) => string): void {
  writeFileSync(path, change(readFileSync(path, 'utf8')));
}

// Every file under `folder`, as paths relative to it with `/`, sorted.
export function filesUnder(folder: string): string[] {
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : e.isFile() ? [join(dir, e.name)] : []));
  return walk(folder).map((p) => relative(folder, p).split(sep).join('/')).sort();
}

// The text of a file, or null when it is binary (a NUL byte in it): a binary file has no lines to review.
export function textOrNull(path: string): string | null {
  const bytes = readFileSync(path);
  return bytes.includes(0) ? null : bytes.toString('utf8');
}
