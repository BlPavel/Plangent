import { Router, Request, Response, NextFunction, json } from 'express';
import {
  listAnalysisSections, getAnalysisSection, createAnalysisSection, updateAnalysisSection,
  reorderAnalysisSections, deleteAnalysisSection, listAnalysisFiles, getAnalysisFile,
  addAnalysisFile, deleteAnalysisFile, assertAnalysisEditable, MAX_ANALYSIS_FILE_SIZE,
} from '../../../core/orchestration/analysis';
import { getTask } from '../../../core/tasks';
import { getLatestPlan, parsePlanSteps } from '../../../core/orchestration/plans';
import type { AnalysisFile, AnalysisSection } from '../../../models';

export const analysisRouter = Router({ mergeParams: true });
// A 25 MB binary file occupies about 34 MB in base64 JSON.
analysisRouter.use(json({ limit: '35mb' }));

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function metadata(file: AnalysisFile) {
  const { content: _content, ...value } = file;
  return value;
}
function section(req: Request): AnalysisSection {
  const value = getAnalysisSection(req.params.sectionId);
  if (!value || value.task_id !== req.params.taskId) throw new HttpError(404, 'Section not found');
  return value;
}
function file(req: Request): AnalysisFile {
  const parent = section(req);
  const value = getAnalysisFile(req.params.fileId);
  if (!value || value.section_id !== parent.id) throw new HttpError(404, 'File not found');
  return value;
}
function editable(req: Request) {
  try { assertAnalysisEditable(req.params.taskId); }
  catch (error) { throw new HttpError(409, (error as Error).message); }
}
function body(req: Request): Record<string, unknown> {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))
    throw new HttpError(400, 'JSON object required');
  return req.body;
}
function fields(data: Record<string, unknown>, creating = false) {
  if ((creating || 'title' in data) && (typeof data.title !== 'string' || !data.title.trim()))
    throw new HttpError(400, 'Non-empty title required');
  if ('description' in data && typeof data.description !== 'string')
    throw new HttpError(400, 'description must be a string');
  if ('kind' in data && !['source', 'worked'].includes(data.kind as string))
    throw new HttpError(400, 'kind must be source or worked');
  return data as { title: string; description?: string; kind?: AnalysisSection['kind'] };
}
// Resolve warnings directly from the current plan; no persisted link model is needed.
function references(taskId: string, slug: string, name?: string) {
  const plan = getLatestPlan(taskId);
  if (!plan) return [];
  return parsePlanSteps(plan.content).filter(step => {
    const links = [...step.text.matchAll(/\[\[([^\]]+)\]\]/g)].map(match => match[1]);
    return links.some(link => name ? link === slug + '/' + name : link === slug || link.startsWith(slug + '/'));
  });
}
function confirmDeletion(req: Request, res: Response, value: AnalysisSection, name?: string): boolean {
  const steps = references(req.params.taskId, value.slug, name);
  if (steps.length && req.query.confirm !== 'true') {
    res.status(409).json({ error: 'Plan steps reference this item', confirmation_required: true, references: steps });
    return false;
  }
  return true;
}
analysisRouter.use((req: Request, _res: Response, next: NextFunction) => {
  const task = getTask(req.params.taskId);
  if (!task || task.project_id !== req.params.projectId) return next(new HttpError(404, 'Task not found'));
  next();
});
analysisRouter.get('/', (req: Request, res: Response) => {
  res.json(listAnalysisSections(req.params.taskId).map(value => ({
    ...value, files: listAnalysisFiles(value.id).map(metadata),
  })));
});
analysisRouter.post('/', (req: Request, res: Response) => {
  editable(req);
  const data = fields(body(req), true);
  res.status(201).json(createAnalysisSection({
    task_id: req.params.taskId, title: data.title, description: data.description, kind: data.kind, author: 'developer',
  }));
});
analysisRouter.post('/reorder', (req: Request, res: Response) => {
  editable(req);
  const ids = body(req).ids;
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw new HttpError(400, 'ids must be a string array');
  reorderAnalysisSections(req.params.taskId, ids);
  res.json(listAnalysisSections(req.params.taskId));
});
analysisRouter.get('/:sectionId', (req: Request, res: Response) => {
  const value = section(req);
  res.json({ ...value, files: listAnalysisFiles(value.id).map(metadata) });
});
analysisRouter.patch('/:sectionId', (req: Request, res: Response) => {
  const value = section(req);
  editable(req);
  const data = fields(body(req));
  res.json(updateAnalysisSection(value.id, {
    title: data.title, description: data.description, kind: data.kind,
  }));
});
analysisRouter.delete('/:sectionId', (req: Request, res: Response) => {
  const value = section(req);
  editable(req);
  if (!confirmDeletion(req, res, value)) return;
  deleteAnalysisSection(value.id);
  res.sendStatus(204);
});
analysisRouter.get('/:sectionId/files', (req: Request, res: Response) => {
  res.json(listAnalysisFiles(section(req).id).map(metadata));
});
analysisRouter.post('/:sectionId/files', (req: Request, res: Response) => {
  const value = section(req);
  editable(req);
  const data = body(req);
  if (typeof data.name !== 'string' || typeof data.data !== 'string')
    throw new HttpError(400, 'name and base64 data required');
  let mime = data.mime;
  let encoded = data.data;
  const url = encoded.match(/^data:([^;,]*);base64,([\s\S]*)$/);
  if (encoded.startsWith('data:') && !url) throw new HttpError(400, 'Invalid base64 data URL');
  if (url) { encoded = url[2]; mime ??= url[1] || undefined; }
  if (mime !== undefined && (typeof mime !== 'string' || !/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(mime)))
    throw new HttpError(400, 'Invalid MIME type');
  if (encoded.length > Math.ceil(MAX_ANALYSIS_FILE_SIZE / 3) * 4) throw new HttpError(413, 'File exceeds 25 MB');
  const padding = encoded.indexOf('=');
  if (encoded.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(encoded)
    || (padding !== -1 && !/^={1,2}$/.test(encoded.slice(padding))))
    throw new HttpError(400, 'Invalid base64');
  const content = Buffer.from(encoded, 'base64');
  if (content.length > MAX_ANALYSIS_FILE_SIZE) throw new HttpError(413, 'File exceeds 25 MB');
  res.status(201).json(metadata(addAnalysisFile(value.id, {
    name: data.name, mime: mime as string | undefined, content,
  })));
});
analysisRouter.get('/:sectionId/files/:fileId', (req: Request, res: Response) => {
  const value = file(req);
  res.setHeader('Content-Type', value.mime);
  res.setHeader('Content-Length', value.size);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Sandbox uploaded active content while allowing ordinary images and documents.
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
  const disposition = req.query.download === 'true' ? 'attachment' : 'inline';
  res.setHeader('Content-Disposition', disposition + "; filename*=UTF-8''" + encodeURIComponent(value.name).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16)));
  res.send(value.content);
});
analysisRouter.delete('/:sectionId/files/:fileId', (req: Request, res: Response) => {
  const value = file(req);
  editable(req);
  if (!confirmDeletion(req, res, section(req), value.name)) return;
  deleteAnalysisFile(value.id);
  res.sendStatus(204);
});
analysisRouter.use((error: Error & { status?: number; type?: string }, _req: Request, res: Response, _next: NextFunction) => {
  res.status(error.status ?? 400).json({ error: error.message });
});
