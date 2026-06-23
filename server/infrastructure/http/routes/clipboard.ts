import { Router, Request, Response } from 'express';
import { execSync } from 'child_process';

export const clipboardRouter = Router();

// Returns real filesystem paths from macOS NSPasteboard (files copied in Finder)
clipboardRouter.get('/paths', (_req: Request, res: Response) => {
  try {
    const script = [
      'set out to {}',
      'try',
      '  set urls to the clipboard as «class furl»',
      '  if class of urls is not list then set urls to {urls}',
      '  repeat with u in urls',
      '    set end of out to POSIX path of u',
      '  end repeat',
      'end try',
      'set AppleScript\'s text item delimiters to "\\n"',
      'out as text',
    ].join('\n');

    const raw = execSync(`osascript << 'EOF'\n${script}\nEOF`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 3000,
    }).trim();

    const paths = raw
      ? raw.split('\n').map(p => p.trim()).filter(Boolean)
      : [];

    res.json({ paths });
  } catch {
    res.json({ paths: [] });
  }
});
