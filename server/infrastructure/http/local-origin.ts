
import { Request, Response, NextFunction } from 'express';

/** Integration management is a loopback API, never an endpoint for arbitrary websites. */
export function localOrigin(req: Request, res: Response, next: NextFunction): void {
  const loopback = new Set(['127.0.0.1', 'localhost', '[::1]']);
  if (!loopback.has(req.hostname)) { res.status(403).json({ error: 'Local API host required' }); return; }
  const origin = req.get('origin');
  if (origin) {
    try {
      const url = new URL(origin);
      const same = url.origin === req.protocol + '://' + req.get('host');
      // Vite uses a different local origin in development; packaged builds use the API origin.
      const dev = process.env.NODE_ENV !== 'production' && url.protocol === 'http:' && loopback.has(url.hostname) && url.port === '5173';
      if (!same && !dev) throw new Error();
    } catch { res.status(403).json({ error: 'Untrusted browser origin' }); return; }
  }
  next();
}
