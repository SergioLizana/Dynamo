#!/usr/bin/env node
// PreToolUse hook for Bash: refuses a command that writes or deletes outside the working tree of the session
// (the repository or the copy it runs in) and the scratchpad (a folder starting with "claude" in the temp folder).
// Claude Code gives the hook a JSON on stdin ({ tool_name, tool_input: { command }, cwd }); exit 2 refuses the
// command and sends stderr to the agent. Reads are not checked. It is a guard for the mistakes of an agent, not a
// jail: the command text is analysed, so a script file that writes elsewhere is not seen (limits in .claude/factory.md).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const WIN = process.platform === 'win32';
const SINKS = new Set(['/dev/null', '/dev/stdout', '/dev/stderr', '/dev/tty', 'nul']);
const PREFIXES = new Set(['sudo', 'command', 'env', 'nohup', 'time', 'exec', 'builtin', 'nice', '{', '}', '!', 'if', 'then', 'do', 'else', 'elif', 'while', 'until', 'fi', 'done']);
const ALL_PATHS = new Set(['touch', 'mkdir', 'rmdir', 'rm', 'unlink', 'truncate', 'mkfifo', 'shred', 'chmod', 'chown', 'chgrp', 'tee', 'mv', 'del', 'erase', 'rd', 'md']);
const LAST_PATH = new Set(['cp', 'ln', 'rsync', 'install']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);
const INTERPRETERS = new Set(['node', 'deno', 'bun', 'python', 'python3', 'py', 'perl', 'ruby', 'php', 'pwsh', 'powershell', 'cmd']);
const INLINE_FLAGS = new Set(['-e', '-p', '-c', '--eval', '-command', '-c', '/c', '/k']);

function real(p) {
  // realpath of the deepest ancestor that exists, so symlinks and short names (GANDAL~1) compare equal
  const rest = [];
  let cur = p;
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(cur), ...rest.reverse());
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return p;
      rest.push(path.basename(cur));
      cur = parent;
    }
  }
}

function treeRoot(dir) {
  if (!dir) return null;
  let cur = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(path.join(cur, '.git'))) return real(cur);
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

function within(root, p) {
  const rel = path.relative(root, p);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function allowed(p, ctx) {
  if (within(ctx.root, p)) return true;
  const rel = path.relative(ctx.tmp, p);
  return !rel.startsWith('..') && !path.isAbsolute(rel) && rel.split(path.sep)[0].toLowerCase().startsWith('claude');
}

// Splits a command text into simple commands: { words: [{ t, dyn }], redirs: [{ kind, w }] }, plus the texts of the
// command substitutions found inside it. dyn marks a word with a variable or substitution the hook cannot expand.
function parse(src) {
  const cmds = [];
  const subs = [];
  const heredocs = [];
  let cur = { words: [], redirs: [] };
  let word = null;
  let pending = null;
  let i = 0;
  const newWord = () => (word ||= { t: '', dyn: false });
  const push = () => {
    if (!word) return;
    if (pending) cur.redirs.push({ kind: pending, w: word });
    else cur.words.push(word);
    pending = null;
    word = null;
  };
  const end = () => {
    push();
    pending = null;
    if (cur.words.length || cur.redirs.length) cmds.push(cur);
    cur = { words: [], redirs: [] };
  };
  const substitution = (open, close) => {
    // src[i] is the first char of the opener; copies the raw text into the word and records the inner text
    let depth = 0;
    let j = i;
    for (; j < src.length; j++) {
      if (src[j] === open) depth++;
      else if (src[j] === close && --depth === 0) break;
    }
    subs.push(src.slice(i + 2, j));
    newWord().t += src.slice(i, j + 1);
    word.dyn = true;
    i = j + 1;
  };

  while (i < src.length) {
    const c = src[i];
    if (c === "'") {
      newWord();
      const j = src.indexOf("'", i + 1);
      const stop = j < 0 ? src.length : j;
      word.t += src.slice(i + 1, stop);
      i = stop + 1;
    } else if (c === '"') {
      newWord();
      i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\' && '"\\$`'.includes(src[i + 1] || '')) {
          word.t += src[i + 1];
          i += 2;
        } else if (src[i] === '$' && src[i + 1] === '(') {
          substitution('(', ')');
        } else {
          if (src[i] === '$' || src[i] === '`') word.dyn = true;
          word.t += src[i++];
        }
      }
      i++;
    } else if (c === '\\') {
      const n = src[i + 1] || '';
      if (n === '\n') i += 2;
      else if (n && ' \t"\'$`\\;|&<>()*?#~'.includes(n)) {
        newWord().t += n;
        i += 2;
      } else {
        newWord().t += '\\'; // a Windows path such as E:\tmp keeps its backslashes
        i++;
      }
    } else if (c === '$' && src[i + 1] === '(') {
      substitution('(', ')');
    } else if (c === '`') {
      const j = src.indexOf('`', i + 1);
      const stop = j < 0 ? src.length : j;
      subs.push(src.slice(i + 1, stop));
      newWord().t += src.slice(i, stop + 1);
      word.dyn = true;
      i = stop + 1;
    } else if (c === '$') {
      newWord().dyn = true;
      if (src[i + 1] === '{') {
        const j = src.indexOf('}', i);
        const stop = j < 0 ? src.length : j;
        word.t += src.slice(i, stop + 1);
        i = stop + 1;
      } else word.t += src[i++];
    } else if (c === ' ' || c === '\t') {
      push();
      i++;
    } else if (c === '\n') {
      end();
      i++;
      for (const h of heredocs.splice(0)) {
        for (;;) {
          if (i >= src.length) break;
          let j = src.indexOf('\n', i);
          if (j < 0) j = src.length;
          const line = src.slice(i, j);
          i = j + 1;
          if ((h.strip ? line.trim() : line) === h.delim) break;
        }
      }
    } else if (c === '#' && !word) {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === ';' || c === '|' || c === '(' || c === ')' || (c === '&' && src[i + 1] !== '>')) {
      end();
      i++;
    } else if (c === '>' || (c === '&' && src[i + 1] === '>')) {
      if (word && /^\d+$/.test(word.t)) word = null;
      else push();
      if (c === '&') i++;
      i++;
      if (src[i] === '>') i++;
      if (src[i] === '|') i++;
      if (src[i] === '&') {
        i++;
        while (/[\d-]/.test(src[i] || '')) i++; // 2>&1: a copy of a descriptor, not a file
      } else pending = 'out';
    } else if (c === '<') {
      push();
      i++;
      if (src[i] === '<' && src[i + 1] !== '<') {
        i++;
        const strip = src[i] === '-';
        if (strip) i++;
        const m = /^\s*(?:'([^']*)'|"([^"]*)"|([^\s;|&<>()]+))/.exec(src.slice(i));
        if (m) {
          heredocs.push({ delim: m[1] ?? m[2] ?? m[3], strip });
          i += m[0].length;
        }
      } else {
        while (src[i] === '<') i++;
        pending = 'in';
      }
    } else {
      newWord().t += c;
      i++;
    }
  }
  end();
  return { cmds, subs };
}

function resolve(w, cwd) {
  let t = w.t;
  if (SINKS.has(t.toLowerCase())) return 'sink';
  if (t === '~' || t.startsWith('~/') || t.startsWith('~\\')) t = os.homedir() + t.slice(1);
  if (/\$|`/.test(t)) {
    t = t.replace(/\$\{?([A-Za-z_]\w*)\}?/g, (m, name) => process.env[name] ?? (name === 'PWD' ? cwd : m));
    if (/\$|`/.test(t)) return null;
  }
  if (WIN) t = t.replace(/^\/([a-zA-Z])(?=\/|$)/, '$1:');
  return real(path.resolve(cwd, t));
}

function analyze(src, ctx, depth = 0) {
  if (depth > 5) return ['a command nested too deep to analyse'];
  const { cmds, subs } = parse(src);
  const bad = [];
  let cwd = ctx.cwd;
  const target = (w) => {
    const p = resolve(w, cwd);
    if (p === 'sink') return;
    if (p === null) bad.push(`"${w.t}" (a variable or substitution the hook cannot expand)`);
    else if (!allowed(p, ctx)) bad.push(p);
  };
  const scanCode = (text) => {
    const found = text.match(/[A-Za-z]:[\\/][^\s'"`)]*|(?<![\w:./])\/[\w.~-][^\s'"`)]*|\.\.[\\/][^\s'"`)]*|~[\\/][^\s'"`)]*/g) || [];
    for (const f of found) target({ t: f, dyn: false });
  };
  const command = (words) => {
    while (words.length && (/^[A-Za-z_]\w*=/.test(words[0].t) || PREFIXES.has(words[0].t))) {
      const prefix = words.shift().t;
      if (PREFIXES.has(prefix)) while (words.length && words[0].t.startsWith('-')) words.shift();
    }
    if (!words.length) return;
    const name = path.basename(words[0].t).toLowerCase().replace(/\.exe$/, '');
    const args = words.slice(1);
    const dashdash = args.findIndex((a) => a.t === '--');
    const paths = args.filter((a, k) => (dashdash >= 0 && k > dashdash) || !a.t.startsWith('-') || a.t === '-');
    const optValue = (...names) => {
      const out = [];
      args.forEach((a, k) => {
        for (const n of names) {
          if (a.t === n && args[k + 1]) out.push(args[k + 1]);
          else if (n.startsWith('--') && a.t.startsWith(n + '=')) out.push({ t: a.t.slice(n.length + 1), dyn: a.dyn });
        }
      });
      return out;
    };

    if (name === 'cd' || name === 'pushd') {
      const p = args[0] && resolve(args[0], cwd);
      if (p && p !== 'sink') cwd = p;
    } else if (ALL_PATHS.has(name)) {
      paths.forEach(target);
    } else if (name === 'mktemp') {
      const t = paths.filter((a) => /[\\/]/.test(a.t));
      if (t.length) t.forEach(target);
      else if (!args.some((a) => a.t === '-p' || a.t.startsWith('--tmpdir'))) bad.push(`${ctx.tmp} (mktemp writes in the temp folder, outside the scratchpad)`);
      optValue('-p', '--tmpdir').forEach(target);
    } else if (LAST_PATH.has(name)) {
      const dirs = optValue('-t', '--target-directory');
      if (dirs.length) dirs.forEach(target);
      else if (name === 'install' && args.some((a) => a.t === '-d')) paths.forEach(target);
      else if (paths.length) target(paths[paths.length - 1]);
    } else if (name === 'dd') {
      args.filter((a) => a.t.startsWith('of=')).forEach((a) => target({ t: a.t.slice(3), dyn: a.dyn }));
    } else if (name === 'sed' || name === 'perl' || name === 'ruby') {
      if (args.some((a) => /^-[a-zA-Z]*i/.test(a.t) || a.t === '--in-place')) paths.forEach(target);
      else if (INTERPRETERS.has(name)) interpreter(args);
    } else if (name === 'tar') {
      optValue('-C', '--directory').forEach(target);
      const cluster = args[0] && args[0].t.replace(/^-/, '');
      if (cluster && /^[a-zA-Z]+$/.test(cluster) && cluster.includes('c') && cluster.includes('f') && args[1]) target(args[1]);
    } else if (name === 'curl' || name === 'wget') {
      optValue('-o', '-O', '-P', '--output', '--output-document', '--output-dir', '--directory-prefix').forEach(target);
    } else if (name === 'unzip') {
      optValue('-d').forEach(target);
    } else if (name === 'git') {
      const rest = [];
      for (let k = 0; k < args.length; k++) {
        if (args[k].t === '-C' || args[k].t === '-c') k++;
        else if (!args[k].t.startsWith('-') || rest.length) rest.push(args[k]);
      }
      const sub = rest.shift();
      const ps = rest.filter((a) => !a.t.startsWith('-'));
      if (sub && sub.t === 'clone' && ps.length > 1) target(ps[1]);
      else if (sub && sub.t === 'init' && ps.length) target(ps[0]);
      else if (sub && sub.t === 'worktree' && rest[0] && rest[0].t === 'add') {
        const vals = rest.slice(1);
        const dest = vals.filter((a, k) => !a.t.startsWith('-') && !(k > 0 && /^-[bB]$/.test(vals[k - 1].t)));
        if (dest.length) target(dest[0]);
      }
    } else if (name === 'find') {
      if (args.some((a) => ['-delete', '-exec', '-execdir', '-fprint', '-fprintf', '-fls'].includes(a.t))) {
        const starts = [];
        for (const a of args) {
          if (a.t.startsWith('-') || a.t === '(' || a.t === '!') break;
          starts.push(a);
        }
        (starts.length ? starts : [{ t: '.', dyn: false }]).forEach(target);
      }
      for (let k = 0; k < args.length; k++) {
        if (args[k].t === '-exec' || args[k].t === '-execdir') {
          let e = k + 1;
          while (e < args.length && args[e].t !== ';' && args[e].t !== '+') e++;
          command(args.slice(k + 1, e).filter((a) => a.t !== '{}'));
        }
      }
    } else if (SHELLS.has(name)) {
      const k = args.findIndex((a) => /^-[a-z]*c$/.test(a.t));
      if (k >= 0 && args[k + 1]) bad.push(...analyze(args[k + 1].t, { ...ctx, cwd }, depth + 1));
    } else if (name === 'eval') {
      bad.push(...analyze(args.map((a) => a.t).join(' '), { ...ctx, cwd }, depth + 1));
    } else if (INTERPRETERS.has(name)) {
      interpreter(args);
    }

    function interpreter(a) {
      const k = a.findIndex((x) => INLINE_FLAGS.has(x.t.toLowerCase()));
      if (k >= 0) scanCode(a.slice(k + 1).map((x) => x.t).join(' '));
    }
  };

  for (const s of subs) bad.push(...analyze(s, { ...ctx, cwd }, depth + 1));
  for (const cmd of cmds) {
    cmd.redirs.filter((r) => r.kind === 'out').forEach((r) => target(r.w));
    command(cmd.words.slice());
  }
  return bad;
}

function main() {
  let input;
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch (e) {
    console.error(`outside-writes hook: cannot read its input (${e.message}); the command is refused.`);
    process.exit(2);
  }
  if (input.tool_name && input.tool_name !== 'Bash') process.exit(0);
  const command = input.tool_input && input.tool_input.command;
  if (typeof command !== 'string') process.exit(0);
  const cwd = path.resolve(input.cwd || process.cwd());
  const root = treeRoot(cwd) || treeRoot(process.env.CLAUDE_PROJECT_DIR) || real(cwd);
  const ctx = { cwd: real(cwd), root, tmp: real(os.tmpdir()) };
  let bad;
  try {
    bad = analyze(command, ctx);
  } catch (e) {
    console.error(`outside-writes hook: cannot analyse the command (${e.message}); it is refused.`);
    process.exit(2);
  }
  if (bad.length) {
    console.error(
      `Refused: this command writes or deletes outside the working tree and the scratchpad: ${[...new Set(bad)].join(', ')}. ` +
        `Allowed: ${ctx.root} and the "claude*" folders of ${ctx.tmp}. Use a path inside your copy or the scratchpad.`,
    );
    process.exit(2);
  }
}

if (require.main === module) main();
module.exports = { analyze };
