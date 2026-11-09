// The disk `dynamo setup` touches, kept apart so setup.ts imports no `node:fs`: the template of factory.json that ships with
// the plugin, the project's own factory.json, and the temporary folder the checks are rehearsed in.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Factory } from './factory.ts';
import { FORMAT_VERSION, readFactory } from './factory.ts';

export type Files = {
  template: () => Factory;
  hasFactory: (root: string) => boolean;
  readFactory: (root: string) => Factory;
  // Whether a path, relative to the project, exists; and writing a new file there (its folders are made).
  has: (root: string, path: string) => boolean;
  write: (root: string, path: string, text: string) => void;
  writeFactory: (root: string, factory: Factory) => string;
  // The text of each workflow of the project (`.github/workflows/*.yml` or `.yaml`, files only); none if there is no folder.
  workflows: (root: string) => string[];
  // The text of a file of the project, or null if there is none.
  read: (root: string, path: string) => string | null;
  // `templates/settings.json` of the plugin, and the project's own `.claude/settings.json` (null if none; it throws, saying so,
  // if the file is not JSON) and writing it.
  settingsTemplate: () => unknown;
  readSettings: (root: string) => unknown;
  writeSettings: (root: string, settings: unknown) => string;
  tempFolder: () => string;
  removeFolder: (path: string) => void;
};

// `templates/factory.json` of the plugin: the engine lives in `dynamo/`, next to it.
export function readTemplate(): Factory {
  const template = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'templates', 'factory.json'), 'utf8'));
  if (template?.version !== FORMAT_VERSION || typeof template.project !== 'object' || template.project === null) {
    throw new Error(`templates/factory.json is not a factory.json of version ${FORMAT_VERSION}`);
  }
  return template;
}

const factoryPath = (root: string) => join(root, '.claude', 'factory.json');
const settingsPath = (root: string) => join(root, '.claude', 'settings.json');

export const files: Files = {
  template: readTemplate,
  hasFactory: (root) => existsSync(factoryPath(root)),
  readFactory,
  has: (root, path) => existsSync(join(root, path)),
  write: (root, path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  },
  writeFactory: (root, factory) => {
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(factoryPath(root), JSON.stringify(factory, null, 2) + '\n');
    return factoryPath(root);
  },
  workflows: (root) => {
    const folder = join(root, '.github', 'workflows');
    if (!existsSync(folder)) return [];
    return readdirSync(folder, { withFileTypes: true }).filter((e) => e.isFile() && /\.ya?ml$/.test(e.name)).map((e) => readFileSync(join(folder, e.name), 'utf8'));
  },
  read: (root, path) => (existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : null),
  settingsTemplate: () => JSON.parse(readFileSync(join(import.meta.dirname, '..', 'templates', 'settings.json'), 'utf8')),
  readSettings: (root) => {
    if (!existsSync(settingsPath(root))) return null;
    try { return JSON.parse(readFileSync(settingsPath(root), 'utf8')); } catch { throw new Error(`${settingsPath(root)} is not valid JSON; nothing was written`); }
  },
  writeSettings: (root, settings) => {
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(settingsPath(root), JSON.stringify(settings, null, 2) + '\n');
    return settingsPath(root);
  },
  // In the system's real form (Windows short names expanded), the same path git prints.
  tempFolder: () => realpathSync.native(mkdtempSync(join(tmpdir(), 'dynamo-setup-'))),
  removeFolder: (path) => rmSync(path, { recursive: true, force: true }),
};
