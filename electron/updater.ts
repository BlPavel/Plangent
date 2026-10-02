import { app, BrowserWindow, net, shell } from 'electron';
import { autoUpdater, type UpdateInfo } from 'electron-updater';
import { execFileSync, spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// Keep in sync with UpdateState in client/src/core/platform/types.ts.
export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'up-to-date' }
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'ready'; version: string }
  // The update cannot be installed in place (an unsigned mac app running outside /Applications,
  // a failed download…): the developer downloads it from the release page.
  | { status: 'manual'; version: string; url: string }
  | { status: 'error'; message: string };

const CHECK_DELAY_MS = 10_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

let state: UpdateState = { status: 'idle' };
let enabled = false;

function log(message: string) {
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'updater.log'), `${new Date().toISOString()} ${message}\n`);
  } catch { /* diagnostic logging must never break updates */ }
}

function setState(next: UpdateState) {
  state = next;
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('update:state', state);
}

export const getUpdateState = () => state;

// ---------------------------------------------------------------------------
// Windows: electron-updater downloads the NSIS installer and runs it silently.
// macOS: Squirrel.Mac refuses unsigned apps, so electron-updater only finds the release; the zip is
// downloaded here (no browser → no quarantine flag → no Gatekeeper prompt) and swapped in by a
// small shell script once the app has quit.
// ---------------------------------------------------------------------------
const isMac = process.platform === 'darwin';

/** Release page of a version; the publish target comes from the app-update.yml electron-builder bakes in. */
function releasePage(version: string): string {
  try {
    const yml = fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8');
    const owner = /^owner:\s*(\S+)/m.exec(yml)?.[1];
    const repo = /^repo:\s*(\S+)/m.exec(yml)?.[1];
    if (owner && repo) return `https://github.com/${owner}/${repo}/releases/tag/v${version}`;
  } catch { /* fall through */ }
  return 'https://github.com/BlPavel/Plangent/releases/latest';
}

export function initUpdater(): void {
  if (!app.isPackaged) return;
  enabled = true;
  autoUpdater.logger = { info: log, warn: log, error: log, debug: () => {} };
  autoUpdater.autoDownload = !isMac;
  autoUpdater.autoInstallOnAppQuit = !isMac;

  autoUpdater.on('checking-for-update', () => {
    if (state.status !== 'downloading' && state.status !== 'ready') setState({ status: 'checking' });
  });
  autoUpdater.on('update-not-available', () => setState({ status: 'up-to-date' }));
  autoUpdater.on('update-available', (info: UpdateInfo) => {
    if (isMac) void downloadMac(info);
    else setState({ status: 'downloading', version: info.version, percent: 0 });
  });
  autoUpdater.on('download-progress', p => {
    if (state.status === 'downloading') setState({ ...state, percent: Math.round(p.percent) });
  });
  autoUpdater.on('update-downloaded', (info: UpdateInfo) => setState({ status: 'ready', version: info.version }));
  autoUpdater.on('error', err => {
    log(`error: ${err?.stack ?? err}`);
    // A failed download still leaves the release page as a way out.
    if (state.status === 'downloading') setState({ status: 'manual', version: state.version, url: releasePage(state.version) });
    else if (state.status !== 'ready' && state.status !== 'manual') setState({ status: 'error', message: String(err?.message ?? err) });
  });

  setTimeout(() => void checkForUpdates(), CHECK_DELAY_MS);
  setInterval(() => void checkForUpdates(), CHECK_INTERVAL_MS);
  if (isMac) app.on('will-quit', () => installMac(false));
}

async function checkForUpdates(): Promise<void> {
  if (!enabled) return;
  // Nothing to look for while an update is on its way or waiting for a restart.
  if (state.status === 'checking' || state.status === 'downloading' || state.status === 'ready') return;
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    log(`check failed: ${err instanceof Error ? err.stack : err}`);
    setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
  }
}

/** Quit and install the downloaded update. The caller has already stopped the backend. */
export function installUpdate(): void {
  if (state.status !== 'ready') return;
  if (isMac) {
    installMac(true);
    app.quit();
  } else {
    // Not silent: the installer's own progress window bridges the gap between this window closing
    // and the new version starting. build/installer.nsh skips its questions and finish page on updates.
    autoUpdater.quitAndInstall(false, true);
  }
}

export function openReleasePage(): void {
  if (state.status === 'manual') void shell.openExternal(state.url);
}

// ---------------------------------------------------------------------------
// macOS in-place update
// ---------------------------------------------------------------------------
let macPending: { bundle: string; newBundle: string } | null = null;
let macInstalling = false;

/** The running .app bundle, when it can be replaced in place. */
function replaceableBundle(): string | null {
  const bundle = path.resolve(app.getPath('exe'), '..', '..', '..');
  if (!bundle.endsWith('.app')) return null;
  // Gatekeeper runs quarantined apps from a read-only random path; a mounted dmg is read-only too.
  if (bundle.includes('/AppTranslocation/') || bundle.startsWith('/Volumes/')) return null;
  try {
    fs.accessSync(path.dirname(bundle), fs.constants.W_OK);
    fs.accessSync(bundle, fs.constants.W_OK);
  } catch {
    return null;
  }
  return bundle;
}

async function downloadMac(info: UpdateInfo): Promise<void> {
  const manual = () => setState({ status: 'manual', version: info.version, url: releasePage(info.version) });
  const bundle = replaceableBundle();
  const zips = info.files.filter(f => f.url.endsWith('.zip'));
  const file = process.arch === 'arm64'
    ? zips.find(f => f.url.includes('arm64')) ?? zips.find(f => !f.url.includes('x64'))
    : zips.find(f => !f.url.includes('arm64'));
  if (!bundle || !file) {
    log(`manual update: bundle=${bundle} zip=${file?.url}`);
    return manual();
  }

  setState({ status: 'downloading', version: info.version, percent: 0 });
  const dir = path.join(app.getPath('temp'), 'plangent-update');
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const url = /^https?:/.test(file.url) ? file.url : releasePage(info.version).replace('/tag/', '/download/') + '/' + file.url;
    const zipPath = path.join(dir, 'update.zip');
    const sha512 = await download(url, zipPath, file.size, percent => setState({ status: 'downloading', version: info.version, percent }));
    if (file.sha512 && sha512 !== file.sha512) throw new Error('checksum mismatch');

    const extracted = path.join(dir, 'app');
    execFileSync('ditto', ['-x', '-k', zipPath, extracted]);
    const newBundle = fs.readdirSync(extracted).find(n => n.endsWith('.app'));
    if (!newBundle) throw new Error('no .app in the update archive');
    const newPath = path.join(extracted, newBundle);
    try { execFileSync('xattr', ['-dr', 'com.apple.quarantine', newPath]); } catch { /* not quarantined */ }
    fs.rmSync(zipPath, { force: true });

    macPending = { bundle, newBundle: newPath };
    setState({ status: 'ready', version: info.version });
  } catch (err) {
    log(`mac download failed: ${err instanceof Error ? err.stack : err}`);
    manual();
  }
}

/** Stream `url` into `dest`, reporting progress; resolves with the file's base64 sha512. */
async function download(url: string, dest: string, size: number | undefined, progress: (percent: number) => void): Promise<string> {
  const res = await net.fetch(url);
  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`);
  const total = size || Number(res.headers.get('content-length')) || 0;
  const out = fs.createWriteStream(dest);
  const reader = res.body.getReader();
  const hash = crypto.createHash('sha512');
  let received = 0;
  let reported = -1;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      hash.update(value);
      if (!out.write(value)) await new Promise<void>(resolve => out.once('drain', () => resolve()));
      const percent = total ? Math.floor((received / total) * 100) : 0;
      if (percent !== reported) { reported = percent; progress(percent); }
    }
  } finally {
    await new Promise<void>(resolve => out.end(resolve));
  }
  return hash.digest('base64');
}

/** Hand the swap over to a detached script that waits for this process to exit. */
function installMac(relaunch: boolean) {
  if (!macPending || macInstalling) return;
  macInstalling = true;
  const script = path.join(app.getPath('temp'), 'plangent-update', 'install.sh');
  fs.writeFileSync(script, [
    '#!/bin/sh',
    'PID="$1"; TARGET="$2"; NEW="$3"; RELAUNCH="$4"',
    'while kill -0 "$PID" 2>/dev/null; do sleep 0.2; done',
    'BACKUP="$TARGET.update-backup"',
    'rm -rf "$BACKUP"',
    'if mv "$TARGET" "$BACKUP"; then',
    '  if mv "$NEW" "$TARGET"; then rm -rf "$BACKUP"; else mv "$BACKUP" "$TARGET"; fi',
    'fi',
    '[ "$RELAUNCH" = "1" ] && open "$TARGET"',
    'exit 0',
    '',
  ].join('\n'), { mode: 0o755 });
  log(`installing ${macPending.newBundle} → ${macPending.bundle} (relaunch=${relaunch})`);
  spawn('/bin/sh', [script, String(process.pid), macPending.bundle, macPending.newBundle, relaunch ? '1' : '0'], {
    detached: true,
    stdio: 'ignore',
  }).unref();
}
