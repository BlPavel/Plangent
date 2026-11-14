import { resolveProjectPath } from '../../../core/files';
import { typedRoutes } from '../typed-route';
import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';

export const browseRouter = Router();
const browseRouterRoutes = typedRoutes(browseRouter, '/api/browse');

// Above a drive root on Windows: the list of drives, so a folder on D: can be reached from C:.
const DRIVES = '::drives';

browseRouterRoutes.json('GET /api/browse', (req, res) => {
  const rawPath = (req.query.path as string) || os.homedir();
  if (rawPath === DRIVES) {
    const drives = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(l => `${l}:\\`).filter(d => { try { return fs.existsSync(d); } catch { return false; } });
    return res.json({ path: '', parent: null, entries: drives.map(d => ({ name: d, path: d, isDir: true })) });
  }
  const requestedPath = path.resolve(rawPath);
  const dirPath = resolveProjectPath(path.parse(requestedPath).root, requestedPath);

  if (!fs.existsSync(dirPath)) {
    return res.status(404).json({ error: 'Path not found' });
  }

  const stat = fs.statSync(dirPath);
  if (!stat.isDirectory()) {
    return res.status(400).json({ error: 'Not a directory' });
  }

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => ({ name: e.name, isDir: true }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const parent = dirPath !== path.parse(dirPath).root ? path.dirname(dirPath) : process.platform === 'win32' ? DRIVES : null;

    res.json({ path: dirPath, parent, entries });
  } catch {
    res.status(403).json({ error: 'Cannot read directory' });
  }
});
