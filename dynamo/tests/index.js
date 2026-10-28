// `node --test dynamo/tests/` with a folder as the argument: from Node 24 a folder is resolved as a module (this file),
// not searched for tests, and Node does not look for an index.ts. So this file imports every test of the folder.
import { readdirSync } from 'node:fs';

for (const f of readdirSync(import.meta.dirname).filter((n) => n.endsWith('.test.ts')).sort()) await import(new URL(f, import.meta.url));
