import fs from 'fs';
import path from 'path';

// Works from sources, compiled output and Electron's app.asar without copying a version string.
function readAppVersion(): string {
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    const file = path.join(dir, 'package.json');
    if (fs.existsSync(file)) {
      const pkg = JSON.parse(fs.readFileSync(file, 'utf8')) as { name?: string; version?: string };
      if (pkg.name === 'plangent' && pkg.version) return pkg.version;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return '0.0.0';
}

export const APP_VERSION = readAppVersion();
