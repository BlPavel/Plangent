import { Router, type Request, type Response, type NextFunction } from 'express';
import { once } from 'node:events';
import path from 'node:path';
import { getProject } from '../../../core/projects';
import { CodeError, changeStats, codePath, fileTree, imageTypes, readBytes, readCodeFile } from '../../../core/code/files';
import { changedFiles, diffFile, listFiles, oldFile, repositoryInfo } from '../../../core/code/git';
import { searchCode, searchPattern, type SearchOptions } from '../../../core/code/search';
import { localOrigin } from '../local-origin';

export const codeRouter = Router({ mergeParams: true });
codeRouter.use(localOrigin);
const root = (req: Request) => {
  const project = getProject(req.params.projectId);
  if (!project || project.kind === 'group') throw new CodeError('Project not found', 404);
  return project.repo_path;
};
const value = (req: Request, key: string, fallback = ''): string => {
  const value = req.query[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'string') throw new CodeError('Invalid ' + key);
  return value;
};
const flag = (req: Request, key: string) => {
  const text = value(req, key, 'false');
  if (text !== 'true' && text !== 'false') throw new CodeError('Invalid ' + key);
  return text === 'true';
};
const guard = (handler: (req: Request, res: Response) => unknown) => (req: Request, res: Response, _next: NextFunction) => {
  Promise.resolve().then(() => handler(req, res)).catch(error => {
    const status = error instanceof CodeError ? error.status : error.code === 'ENOENT' ? 404 : 500;
    if (!res.headersSent) res.status(status).json({ error: status === 500 ? 'Code operation failed' : error.message });
    else res.end(JSON.stringify({ type: 'error', error: status === 500 ? 'Code operation failed' : error.message }) + '\n');
  });
};
codeRouter.get('/repository', guard(async (req, res) => res.json(await repositoryInfo(root(req)))));
codeRouter.get('/changes', guard(async (req, res) => res.json(await changedFiles(root(req)))));
codeRouter.get('/stats', guard(async (req, res) => res.json(await changeStats(root(req)))));
codeRouter.get('/files', guard(async (req, res) => res.json(await listFiles(root(req), flag(req, 'includeIgnored')))));
codeRouter.get('/tree', guard(async (req, res) => res.json(await fileTree(root(req), value(req, 'path'), flag(req, 'includeIgnored')))));
codeRouter.get('/file', guard(async (req, res) => res.json(await readCodeFile(root(req), value(req, 'path')))));
codeRouter.get('/image', guard(async (req, res) => {
  const file = value(req, 'path');
  const mime = imageTypes[path.extname(file).toLowerCase()];
  if (!mime) throw new CodeError('Not an image');
  const { bytes } = await readBytes(root(req), file);
  if (!bytes) throw new CodeError('File too large', 413);
  res.set({ 'Content-Type': mime, 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'",
    'Cache-Control': 'no-store' }).send(bytes);
}));
codeRouter.get('/old-file', guard(async (req, res) => {
  const file = value(req, 'path');
  codePath(root(req), file);
  res.json({ content: await oldFile(root(req), file, value(req, 'base', 'HEAD')) });
}));
codeRouter.get('/diff', guard(async (req, res) => {
  const file = value(req, 'path');
  codePath(root(req), file);
  res.json({ diff: await diffFile(root(req), file, {
    base: value(req, 'base', 'HEAD'), end: value(req, 'end') || undefined,
    originalPath: value(req, 'originalPath') || undefined, ignoreWhitespace: flag(req, 'ignoreWhitespace'),
  }) });
}));
codeRouter.get('/search', guard(async (req, res) => {
  const controller = new AbortController();
  const close = () => controller.abort();
  res.once('close', close);
  const options: SearchOptions = { query: value(req, 'q'), caseSensitive: flag(req, 'caseSensitive'),
    wholeWord: flag(req, 'wholeWord'), regex: flag(req, 'regex'), mask: value(req, 'mask'), signal: controller.signal };
  searchPattern(options);
  const directory = root(req);
  res.set({ 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
  try {
    for await (const event of searchCode(directory, options)) {
      if (!res.write(JSON.stringify(event) + '\n')) await once(res, 'drain', { signal: controller.signal });
    }
    res.end();
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally { res.off('close', close); }
}));
