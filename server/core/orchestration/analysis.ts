import { v4 as uuid } from 'uuid';
import path from 'path';
import fs from 'fs';
import { getSession } from '../agent-sessions/sessions';
import { getDb } from '../../infrastructure/db/schema';
import { getTask } from '../tasks';
import { getProject } from '../projects';
import { getQueue } from './queue';
import { broadcast } from '../shared/events';
import { materializeAnalysis, deleteTaskDirectory, getAnalysisDirectory } from './task-files';
import type { AnalysisSection, AnalysisFile, TaskQueue } from '../../models';

export const MAX_ANALYSIS_FILE_SIZE = 25 * 1024 * 1024;
export function assertAnalysisEditable(taskId: string): void {
  const task = getTask(taskId);
  if (!task) throw new Error('Задача не найдена');
  if (task.status === 'done') throw new Error('Анализ завершённой задачи доступен только для чтения');
  const queue = getQueue(taskId, task.project_id);
  assertQueueAllowsAnalysis(queue);
}
export function assertQueueAllowsAnalysis(queue: TaskQueue): void {
  const working = queue.stages.flatMap(s => s.sessions).some(s => {
    if (!['running', 'reviewing'].includes(s.status)) return false;
    const id = s.status === 'reviewing' ? s.reviewSessionId : s.sessionId;
    return !id || getSession(id)?.status !== 'waiting';
  });
  if (queue.status === 'running' && working) throw new Error('Анализ нельзя менять, пока агенты выполняют очередь');
}
export function listAnalysisSections(taskId: string): AnalysisSection[] {
  return getDb().prepare('SELECT * FROM analysis_sections WHERE task_id=? ORDER BY position, created_at, id')
    .all(taskId) as AnalysisSection[];
}
export function getAnalysisSection(id: string): AnalysisSection | null {
  return (getDb().prepare('SELECT * FROM analysis_sections WHERE id=?').get(id) as AnalysisSection | undefined) ?? null;
}
function sectionForWrite(id: string): AnalysisSection {
  const section = getAnalysisSection(id);
  if (!section) throw new Error('Раздел не найден');
  assertAnalysisEditable(section.task_id);
  return section;
}
export function listAnalysisFiles(sectionId: string): AnalysisFile[] {
  return getDb().prepare('SELECT * FROM analysis_files WHERE section_id=? ORDER BY created_at, id').all(sectionId) as AnalysisFile[];
}
export function getAnalysisFile(id: string): AnalysisFile | null {
  return (getDb().prepare('SELECT * FROM analysis_files WHERE id=?').get(id) as AnalysisFile | undefined) ?? null;
}
function validateSection(data: { title: string; description: string; kind: string; author: string }): void {
  if (typeof data.title !== 'string' || !data.title.trim()) throw new Error('Нужен заголовок раздела');
  if (typeof data.description !== 'string') throw new Error('Описание должно быть текстом');
  if (!['source', 'worked'].includes(data.kind)) throw new Error('Недопустимый вид раздела');
  if (!['developer', 'agent'].includes(data.author)) throw new Error('Недопустимый автор');
}
export function createAnalysisSection(data: { task_id: string; title: string; description?: string;
  kind?: AnalysisSection['kind']; author?: AnalysisSection['author'] }): AnalysisSection {
  assertAnalysisEditable(data.task_id);
  const value = { title: data.title, description: data.description ?? '', kind: data.kind ?? 'source', author: data.author ?? 'developer' };
  validateSection(value);
  let base = data.title.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 80) || 'section';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base)) base = 'section-' + base;
  const sections = listAnalysisSections(data.task_id);
  let slug = base;
  for (let suffix = 2; sections.some(s => s.slug.toLowerCase() === slug.toLowerCase()); suffix++) slug = base + '-' + suffix;
  const id = uuid();
  getDb().prepare('INSERT INTO analysis_sections (id, task_id, slug, title, description, kind, author, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, data.task_id, slug, value.title, value.description, value.kind, value.author, Math.max(-1, ...sections.map(s => s.position)) + 1);
  changed(data.task_id, value.author);
  return getAnalysisSection(id)!;
}
export function updateAnalysisSection(id: string, data: Partial<Pick<AnalysisSection, 'title' | 'description' | 'kind'>>, actor: AnalysisSection['author'] = 'developer'): AnalysisSection {
  const section = sectionForWrite(id);
  const value = { ...section, title: data.title ?? section.title, description: data.description ?? section.description, kind: data.kind ?? section.kind };
  validateSection(value);
  getDb().prepare("UPDATE analysis_sections SET title=?, description=?, kind=?, updated_at=datetime('now') WHERE id=?")
    .run(value.title, value.description, value.kind, id);
  changed(section.task_id, actor);
  return getAnalysisSection(id)!;
}
export function reorderAnalysisSections(taskId: string, ids: string[], actor: AnalysisSection['author'] = 'developer'): void {
  assertAnalysisEditable(taskId);
  const sections = listAnalysisSections(taskId);
  if (ids.length !== sections.length || new Set(ids).size !== ids.length || ids.some(id => !sections.some(s => s.id === id)))
    throw new Error('Нужен список всех разделов задачи без повторений');
  const statement = getDb().prepare("UPDATE analysis_sections SET position=?, updated_at=datetime('now') WHERE id=?");
  getDb().transaction(() => ids.forEach((id, i) => statement.run(i, id)))();
  changed(taskId, actor);
}
export function deleteAnalysisSection(id: string, actor: AnalysisSection['author'] = 'developer'): void {
  const section = sectionForWrite(id);
  getDb().prepare('DELETE FROM analysis_sections WHERE id=?').run(id);
  changed(section.task_id, actor);
}
export function addAnalysisFile(sectionId: string, data: { name: string; mime?: string; content: Buffer }, actor: AnalysisSection['author'] = 'developer'): AnalysisFile {
  const section = sectionForWrite(sectionId);
  if (!Buffer.isBuffer(data.content) || data.content.length > MAX_ANALYSIS_FILE_SIZE) throw new Error('Лимит вложения — 25 МБ');
  if (typeof data.name !== 'string' || !data.name || /[<>:"/\\|?*\x00-\x1f]/.test(data.name)
    || /[. ]$/.test(data.name) || data.name === '.' || data.name === '..'
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(data.name)) throw new Error('Недопустимое имя файла');
  const existing = new Set(['readme.md', ...listAnalysisFiles(sectionId).map(f => f.name.toLowerCase())]);
  let name = data.name;
  const extension = path.extname(name), stem = name.slice(0, name.length - extension.length);
  for (let suffix = 2; existing.has(name.toLowerCase()); suffix++) name = stem + '-' + suffix + extension;
  const id = uuid();
  getDb().prepare('INSERT INTO analysis_files (id, section_id, name, mime, size, content) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, sectionId, name, data.mime ?? 'application/octet-stream', data.content.length, data.content);
  changed(section.task_id, actor);
  return getAnalysisFile(id)!;
}
export function deleteAnalysisFile(id: string, actor: AnalysisSection['author'] = 'developer'): void {
  const file = getAnalysisFile(id);
  if (!file) throw new Error('Файл не найден');
  const section = sectionForWrite(file.section_id);
  getDb().prepare('DELETE FROM analysis_files WHERE id=?').run(id);
  changed(section.task_id, actor);
}
export function materializeTaskAnalysis(taskId: string, ingestDisk = false): void {
  const task = getTask(taskId);
  if (!task) return;
  const project = getProject(task.project_id);
  if (!project) return;
  if (task.status === 'done') { deleteTaskDirectory(task, project.repo_path); return; }
  let sections = listAnalysisSections(taskId);
  if (ingestDisk) {
    try {
      assertAnalysisEditable(taskId);
      const statement = getDb().prepare("UPDATE analysis_sections SET description=?, updated_at=datetime('now') WHERE id=?");
      getDb().transaction(() => {
        for (const section of sections) {
          const file = path.join(getAnalysisDirectory(project.repo_path, task.key), section.slug, 'README.md');
          if (fs.existsSync(file)) statement.run(fs.readFileSync(file, 'utf8'), section.id);
        }
      })();
      sections = listAnalysisSections(taskId);
    } catch { /* restore the DB copy when writes are forbidden */ }
  }
  materializeAnalysis(task, project.repo_path, sections, sections.flatMap(s => listAnalysisFiles(s.id)), updates => {
    try {
      assertAnalysisEditable(taskId);
      const statement = getDb().prepare("UPDATE analysis_sections SET description=?, updated_at=datetime('now') WHERE id=? AND task_id=?");
      getDb().transaction(() => updates.forEach(u => statement.run(u.description, u.id, taskId)))();
      changed(taskId);
    } catch { materializeTaskAnalysis(taskId); }
  });
}
function changed(taskId: string, actor: AnalysisSection['author'] = 'developer'): void {
  materializeTaskAnalysis(taskId);
  broadcast({ type: 'analysis_updated', taskId, actor });
}
