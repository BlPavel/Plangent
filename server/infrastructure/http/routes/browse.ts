import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';

export const browseRouter = Router();

browseRouter.get('/', (req: Request, res: Response) => {
  const rawPath = (req.query.path as string) || os.homedir();
  const dirPath = path.resolve(rawPath);

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

    const parent = dirPath !== path.parse(dirPath).root ? path.dirname(dirPath) : null;

    res.json({ path: dirPath, parent, entries });
  } catch {
    res.status(403).json({ error: 'Cannot read directory' });
  }
});
