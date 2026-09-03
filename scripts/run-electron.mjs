// Starts Electron, or electron-vite, with the flags the current platform needs. npm scripts
// cannot branch on the platform, and the two flags below are Linux only, so the branch lives
// here instead of being spelled out in every script.
// Run with: node scripts/run-electron.mjs <dev|preview|app> [--env KEY=VALUE]... [extra args]
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { argv, env, execPath, exit, platform, stderr } from 'node:process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Electron picks the Ozone platform before the main script runs, so the X11 backend has to be
// asked for on the command line. Unpackaged Electron on Ubuntu 24.04+ also aborts without
// --no-sandbox, because AppArmor blocks unprivileged user namespaces and the setuid helper in
// node_modules is not root owned. Neither flag means anything off Linux.
const LINUX_FLAGS = ['--ozone-platform=x11', '--no-sandbox'];

const [mode, ...rest] = argv.slice(2);
const childEnv = { ...env };
/** @type {string[]} */
const extra = [];
for (let i = 0; i < rest.length; i++) {
  const arg = rest[i] ?? '';
  if (arg !== '--env') {
    extra.push(arg);
    continue;
  }
  const pair = rest[++i] ?? '';
  const eq = pair.indexOf('=');
  if (eq < 1) {
    stderr.write(`run-electron: --env wants KEY=VALUE, got "${pair}"\n`);
    exit(2);
  }
  childEnv[pair.slice(0, eq)] = pair.slice(eq + 1);
}

const flags = platform === 'linux' ? LINUX_FLAGS : [];
const electronVite = join(
  dirname(require.resolve('electron-vite/package.json')),
  'bin',
  'electron-vite.js',
);
/** Required from Node rather than from Electron, so this is the path of the binary. @type {unknown} */
const electron = require('electron');
if (typeof electron !== 'string') {
  stderr.write('run-electron: the electron package did not resolve to a binary path\n');
  exit(2);
}

/** @returns {string[]} */
function command() {
  switch (mode) {
    case 'dev':
      return [execPath, electronVite, 'dev', '--', ...flags, ...extra];
    case 'preview':
      return [execPath, electronVite, 'preview', '--', ...flags, ...extra];
    case 'app':
      return [electron, '.', ...flags, ...extra];
    default:
      stderr.write(`run-electron: unknown mode "${mode ?? ''}", expected dev, preview or app\n`);
      return exit(2);
  }
}

const [bin = '', ...args] = command();
const child = spawn(bin, args, { cwd: root, env: childEnv, stdio: 'inherit' });
child.on('exit', (code, signal) => {
  exit(signal === null ? (code ?? 1) : 1);
});
