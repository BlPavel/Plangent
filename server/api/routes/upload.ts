import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';

export const uploadRouter = Router();

const UPLOAD_DIR = path.join(os.tmpdir(), 'plangent-uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// POST /api/upload-temp — accepts { data: base64, name: string }
// Saves to temp dir and returns { path }
uploadRouter.post('/', (req: Request, res: Response) => {
  const { data, name } = req.body as { data?: string; name?: string };
  if (!data || !name) return res.status(400).json({ error: 'data and name required' });

  const base64 = data.replace(/^data:[^;]+;base64,/, '');
  const ext = path.extname(name) || '.bin';
  const filename = `upload-${Date.now()}${ext}`;
  const filePath = path.join(UPLOAD_DIR, filename);

  try {
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
    res.json({ path: filePath });
  } catch {
    res.status(500).json({ error: 'Failed to save file' });
  }
});
