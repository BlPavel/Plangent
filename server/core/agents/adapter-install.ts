import spawn from 'cross-spawn';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DATA_DIR } from '../../infrastructure/db/schema';

// `npx --yes pkg@1.2.3` keeps npx and two cmd.exe wrappers alive for the whole session (~95 MB per chat)
// and asks the registry on every start. A pinned adapter is installed once into the data folder and
// started with node directly; anything else (unpinned, not npx, failed install) still goes through npx.

const INSTALL_TIMEOUT = 5 * 60_000;
const installs = new Map<string, Promise<string | null>>();
type Env = Record<string, string | undefined>;

function pinned(command: string, args: string[]): { name: string; version: string; rest: string[] } | null {
  if (path.basename(command).replace(/\.cmd$/i, '').toLowerCase() !== 'npx') return null;
  if (args[0] !== '--yes' && args[0] !== '-y') return null;
  const match = /^(@[^/@]+\/[^@]+|[^@/]+)@(\d[\w.+-]*)$/.exec(args[1] ?? '');
  return match ? { name: match[1], version: match[2], rest: args.slice(2) } : null;
}

/** The package's JS bin inside an install folder, or null when it is missing or not a node script. */
function binEntry(dir: string, name: string): string | null {
  const pkgDir = path.join(dir, 'node_modules', ...name.split('/'));
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')) as { bin?: string | Record<string, string> };
    const bins = typeof pkg.bin === 'string' ? { [name.split('/').pop()!]: pkg.bin } : pkg.bin ?? {};
    const bin = bins[name.split('/').pop()!] ?? Object.values(bins)[0];
    if (!bin) return null;
    const file = path.join(pkgDir, bin);
    const head = fs.readFileSync(file, 'utf8').slice(0, 200);
    return /\.[cm]?js$/i.test(file) || /^#!.*\bnode\b/.test(head) ? file : null;
  } catch { return null; }
}

function npmInstall(prefix: string, spec: string, env: Env): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['install', '--prefix', prefix, '--no-save', '--no-package-lock', '--no-audit', '--no-fund', '--omit=dev', '--loglevel=error', spec],
      { cwd: os.tmpdir(), env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let stderr = '';
    child.stderr!.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
    const timer = setTimeout(() => { child.kill(); reject(new Error('npm install не уложился в 5 минут')); }, INSTALL_TIMEOUT);
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('exit', code => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`npm install завершился (${code}). ${stderr}`)); });
  });
}

async function install(name: string, version: string, env: Env): Promise<string | null> {
  const root = path.join(DATA_DIR, 'adapters');
  const folder = `${name.replace('/', '+')}@`;
  const dir = path.join(root, folder + version);
  const ready = binEntry(dir, name);
  if (ready) return ready;
  // Installed next to the final folder and renamed only when complete, so a crash never leaves a half install.
  const temp = `${dir}.tmp-${process.pid}-${Date.now()}`;
  fs.mkdirSync(temp, { recursive: true });
  try {
    await npmInstall(temp, `${name}@${version}`, env);
    if (!binEntry(temp, name)) throw new Error(`В пакете ${name} нет node-скрипта для запуска`);
    try { fs.renameSync(temp, dir); } catch (error) { if (!binEntry(dir, name)) throw error; }
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  // Older versions of the same adapter are no longer used; a copy still running elsewhere stays locked and is skipped.
  for (const entry of fs.readdirSync(root)) {
    if (entry.startsWith(folder) && entry !== folder + version) {
      try { fs.rmSync(path.join(root, entry), { recursive: true, force: true }); } catch { /* in use */ }
    }
  }
  return binEntry(dir, name);
}

/** How to start an adapter: `node <installed bin>` for pinned npx packages, the command as given otherwise. */
export async function resolveAdapter(command: string, args: string[], env: Env): Promise<{ command: string; args: string[] }> {
  const spec = pinned(command, args);
  if (!spec) return { command, args };
  const key = `${spec.name}@${spec.version}`;
  if (!installs.has(key)) {
    installs.set(key, install(spec.name, spec.version, env).catch(error => {
      console.warn(`[adapters] ${key}: ${error instanceof Error ? error.message : String(error)}; запускаю через npx`);
      installs.delete(key);
      return null;
    }));
  }
  const entry = await installs.get(key)!;
  return entry ? { command: 'node', args: [entry, ...spec.rest] } : { command, args };
}
