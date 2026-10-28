'use strict';
// `node --test tests/workflows/` with a folder as the argument: from Node 24 the argument is a path or a glob, not a folder
// to search, and a folder is resolved as a module (this file). So this file runs every test of the folder, and the command
// of the tickets works on old and new Node alike. On older Node the folder is searched and this file is not a test by name.
const fs = require('fs');
const path = require('path');

for (const f of fs.readdirSync(__dirname).filter((n) => n.endsWith('.test.js')).sort()) require(path.join(__dirname, f));
