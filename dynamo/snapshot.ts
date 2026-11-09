// The snapshot of a release tag, and its review. `writeSnapshot` puts the published files of the tag in a folder (the clone,
// or a temporary one); `reviewSnapshot` writes it to a temporary folder and refuses it if gitleaks finds a secret or the
// text has an email, a user path or a mention of the private repository. Nothing here touches the clone.
import { join } from 'node:path';
import type { Deps } from './cli.ts';
import { endOf } from './checks.ts';
import { filesUnder, removeFolder, rewriteText, tempFolder, textOrNull, writeText } from './disk.ts';
import { withVersion } from './publishing.ts';
import type { Finding } from './reviewing.ts';
import { gitleaksFindings, refusal, scanText } from './reviewing.ts';

export type Snapshot = {
  top: string;
  tag: string;
  version: string;
  files: string[];
  // The public CI and Dependabot, already read from the tag: their text and the place they go.
  placed: { place: string; text: string }[];
};

// The files of the tag come out with git itself, through an index of their own, so nothing of the development repository is
// touched and nothing is lost on the way (binary files, modes). No line-ending conversion, in either direction: what the
// tag holds is what is published. Then the two public files, and the version in `plugin.json`.
export function writeSnapshot(deps: Deps, snap: Snapshot, dest: string): void {
  const index = tempFolder();
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(index, 'index') };
    const staged = deps.git(['read-tree', snap.tag], { cwd: snap.top, env });
    if (staged.code !== 0) throw new Error(`git read-tree ${snap.tag} failed: ${endOf(staged)}`);
    const out = deps.git(['-c', 'core.autocrlf=false', 'checkout-index', '-f', '-z', '--stdin', `--prefix=${dest.replace(/\\/g, '/')}/`], { cwd: snap.top, env, input: snap.files.join('\0') + '\0' });
    if (out.code !== 0) throw new Error(`git checkout-index failed: ${endOf(out)}`);
  } finally {
    removeFolder(index);
  }
  for (const { place, text } of snap.placed) writeText(join(dest, place), text);
  rewriteText(join(dest, '.claude-plugin', 'plugin.json'), (text) => {
    const set = withVersion(text, snap.version);
    if (set === null) throw new Error('.claude-plugin/plugin.json has no version to set');
    return set;
  });
}

// Reviews what would be committed, in a temporary folder that is removed afterwards. It throws, naming every file and line,
// when there is anything to refuse, and when gitleaks cannot run: a review that did not happen is not a clean one.
export async function reviewSnapshot(deps: Deps, snap: Snapshot, privateRepo: string): Promise<void> {
  const folder = tempFolder();
  try {
    writeSnapshot(deps, snap, folder);
    const findings: Finding[] = [];
    for (const file of filesUnder(folder)) {
      const text = textOrNull(join(folder, file));
      if (text !== null) findings.push(...scanText(file, text, privateRepo));
    }
    findings.push(...(await secretsIn(deps, folder)));
    if (findings.length > 0) throw new Error(refusal(findings));
  } finally {
    removeFolder(folder);
  }
}

// gitleaks over the folder: 0 is clean, 2 is a finding (its JSON report goes to stdout, redacted), anything else, a missing
// program above all (127), is a refusal.
async function secretsIn(deps: Deps, folder: string): Promise<Finding[]> {
  const args = ['dir', folder, '--redact', '--exit-code', '2', '-f', 'json', '-r', '-', '--no-banner', '--no-color', '-l', 'error'];
  const r = await deps.exec(['gitleaks'], args);
  if (r.code === 127) throw new Error('gitleaks is not installed, so the snapshot cannot be reviewed: install it and run publish again; nothing was committed');
  if (r.code === 0) return [];
  if (r.code !== 2) throw new Error(`gitleaks failed (exit ${r.code}), so the snapshot was not reviewed; nothing was committed: ${endOf(r)}`);
  const found = gitleaksFindings(r.stdout, folder);
  return found.length > 0 ? found : [{ file: '?', line: 0, kind: 'secret' }];
}
