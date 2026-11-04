import type { ErrorResponse } from '../typed-route';
import { typedRoutes } from '../typed-route';
import { rootForViewing } from '../../../core/workspaces/viewing';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { once } from 'node:events';
import path from 'node:path';
import { getProject } from '../../../core/projects';
import { CodeError, changeStats, codePath, fileTree, imageTypes, readBytes, readCodeFile } from '../../../core/code/files';
import { changedFiles, diffFile, listFiles, oldFile, repositoryInfo } from '../../../core/code/git';
import { searchCode, searchPattern, type SearchOptions } from '../../../core/code/search';
import { localOrigin } from '../local-origin';

export const codeRouter = Router({ mergeParams: true });
const codeRouterRoutes = typedRoutes(codeRouter, '/api/projects/:projectId/code');
codeRouter.use(localOrigin);
const root = (req: Request) => {
  const project = getProject(req.params.projectId);
  if (!project || project.kind === 'group') throw new CodeError('Project not found', 404);
  return rootForViewing(project.id, req.query.workspace);
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

codeRouterRoutes.json('GET /api/projects/:projectId/code/repository', async (req, res) => { try { return res.json(await repositoryInfo(root(req))); } catch (routeError) { return handleRouteError(routeError, res); } });
codeRouterRoutes.json('GET /api/projects/:projectId/code/changes', async (req, res) => { try { return res.json(await changedFiles(root(req))); } catch (routeError) { return handleRouteError(routeError, res); } });
codeRouterRoutes.json('GET /api/projects/:projectId/code/stats', async (req, res) => { try { return res.json(await changeStats(root(req))); } catch (routeError) { return handleRouteError(routeError, res); } });
codeRouterRoutes.json('GET /api/projects/:projectId/code/files', async (req, res) => { try { return res.json(await listFiles(root(req), flag(req, 'includeIgnored'))); } catch (routeError) { return handleRouteError(routeError, res); } });
codeRouterRoutes.json('GET /api/projects/:projectId/code/tree', async (req, res) => { try { return res.json(await fileTree(root(req), value(req, 'path'), flag(req, 'includeIgnored'))); } catch (routeError) { return handleRouteError(routeError, res); } });
codeRouterRoutes.json('GET /api/projects/:projectId/code/file', async (req, res) => { try { return res.json(await readCodeFile(root(req), value(req, 'path'))); } catch (routeError) { return handleRouteError(routeError, res); } });
codeRouterRoutes.file('GET /api/projects/:projectId/code/image', async (req, res) => { try { 
  const file = value(req, 'path');
  const mime = imageTypes[path.extname(file).toLowerCase()];
  if (!mime) throw new CodeError('Not an image');
  const { bytes } = await readBytes(root(req), file);
  if (!bytes) throw new CodeError('File too large', 413);
  res.set({ 'Content-Type': mime, 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'",
    'Cache-Control': 'no-store' }).send(bytes);
 } catch (routeError) { return handleRouteError(routeError, res); } });
codeRouterRoutes.json('GET /api/projects/:projectId/code/old-file', async (req, res) => { try { 
  const file = value(req, 'path');
  codePath(root(req), file);
  res.json({ content: await oldFile(root(req), file, value(req, 'base', 'HEAD')) });
 } catch (routeError) { return handleRouteError(routeError, res); } });
codeRouterRoutes.json('GET /api/projects/:projectId/code/diff', async (req, res) => { try { 
  const file = value(req, 'path');
  codePath(root(req), file);
  res.json({ diff: await diffFile(root(req), file, {
    base: value(req, 'base', 'HEAD'), end: value(req, 'end') || undefined,
    originalPath: value(req, 'originalPath') || undefined, ignoreWhitespace: flag(req, 'ignoreWhitespace'),
  }) });
 } catch (routeError) { return handleRouteError(routeError, res); } });
codeRouterRoutes.stream('GET /api/projects/:projectId/code/search', async (req, res) => { try { 
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
      if (!res.event(event)) await once(res, 'drain', { signal: controller.signal });
    }
    res.end();
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally { res.off('close', close); }
 } catch (routeError) {
   if (res.headersSent) {
     res.event({ type: 'error', error: routeError instanceof CodeError ? routeError.message : 'Code operation failed' });
     res.end();
   } else handleRouteError(routeError, res);
 } });

function handleRouteError(error: unknown, res: ErrorResponse) {
    const status = error instanceof CodeError ? error.status : (error as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 500;
    if (!res.headersSent) res.status(status).json({ error: status === 500 ? 'Code operation failed' : (error as Error).message });
    else res.end();
  }
