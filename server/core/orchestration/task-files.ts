import fs from 'fs';
import path from 'path';
import type { Task, AnalysisSection, AnalysisFile } from '../../models';

// Readable (non-percent-encoded) markdown destination; angle brackets allow spaces and parentheses.
function linkTarget(value: string): string {
  return '<' + value.replace(/[<>\r\n]/g, '') + '>';
}

function component(value: string): string {
  if (!value || value === '.' || value === '..' || /[<>:"/\\|?*\x00-\x1f]/.test(value) || /[. ]$/.test(value)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) throw new Error('Недопустимое имя папки или файла');
  return value;
}
export function getTaskDirectory(repoPath: string, key: string): string {
  return path.join(path.resolve(repoPath), '.plangent', component(key));
}
export function getPlanFilePath(repoPath: string, key: string): string {
  return path.join(getTaskDirectory(repoPath, key), 'plan.md');
}
export function getAnalysisDirectory(repoPath: string, key: string): string {
  return path.join(getTaskDirectory(repoPath, key), 'analysis');
}
export function migratePlanFile(repoPath: string, key: string): void {
  const oldPath = path.join(path.resolve(repoPath), '.plangent', component(key) + '.plan.md');
  const newPath = getPlanFilePath(repoPath, key);
  if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
    fs.mkdirSync(path.dirname(newPath), { recursive: true });
    fs.renameSync(oldPath, newPath);
  }
}

const watchers = new Map<string, { watchers: fs.FSWatcher[]; timer?: NodeJS.Timeout }>();
export function stopWatchAnalysis(taskId: string): void {
  const entry = watchers.get(taskId);
  if (!entry) return;
  if (entry.timer) clearTimeout(entry.timer);
  entry.watchers.forEach(w => w.close());
  watchers.delete(taskId);
}
export function deleteTaskDirectory(task: Task, repoPath: string): void {
  stopWatchAnalysis(task.id);
  // getTaskDirectory validates the key and always resolves beneath .plangent.
  fs.rmSync(getTaskDirectory(repoPath, task.key), { recursive: true, force: true });
}

function writeIfChanged(file: string, content: string | Buffer): void {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  if (fs.existsSync(file) && fs.readFileSync(file).equals(buffer)) return;
  fs.writeFileSync(file, buffer);
}
export function materializeAnalysis(task: Task, repoPath: string, sections: AnalysisSection[], files: AnalysisFile[],
  syncDescription: (updates: { id: string; description: string }[]) => void): void {
  stopWatchAnalysis(task.id);
  if (task.status === 'done') return;
  const root = getAnalysisDirectory(repoPath, task.key);
  fs.mkdirSync(root, { recursive: true });
  const keep = new Set(sections.map(s => component(s.slug)));
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && !keep.has(entry.name)) fs.rmSync(path.join(root, entry.name), { recursive: true, force: true });
  }
  const toc = ['# Анализ', ''];
  for (const kind of ['source', 'worked'] as const) {
    toc.push(kind === 'source' ? '## Исходные' : '## Проработанные', '');
    for (const section of sections.filter(s => s.kind === kind)) {
      const dir = path.join(root, component(section.slug));
      fs.mkdirSync(dir, { recursive: true });
      // README contains only the editable description; metadata belongs to the DB and index.
      writeIfChanged(path.join(dir, 'README.md'), section.description);
      const attachments = files.filter(f => f.section_id === section.id);
      const names = new Set(['README.md', ...attachments.map(f => component(f.name))]);
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isFile() && !names.has(entry.name)) fs.unlinkSync(path.join(dir, entry.name));
      }
      for (const file of attachments) writeIfChanged(path.join(dir, component(file.name)), file.content);
      toc.push('- [' + section.title.replace(/[\[\]\r\n]/g, ' ') + '](' + linkTarget(section.slug + '/README.md') + ') — '
        + (section.author === 'developer' ? 'ты' : 'агент'));
      for (const file of attachments) toc.push('  - [' + file.name.replace(/[\[\]]/g, '') + ']('
        + linkTarget(section.slug + '/' + file.name) + ')');
    }
    toc.push('');
  }
  writeIfChanged(path.join(root, 'README.md'), toc.join('\n'));
  const entry: { watchers: fs.FSWatcher[]; timer?: NodeJS.Timeout } = { watchers: [] };
  const onChange = () => {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      const updates: { id: string; description: string }[] = [];
      for (const section of sections) {
        const file = path.join(root, section.slug, 'README.md');
        try {
          const description = fs.readFileSync(file, 'utf8');
          if (description !== section.description) updates.push({ id: section.id, description });
        } catch { /* an editor may be replacing the file */ }
      }
      if (updates.length) syncDescription(updates);
    }, 200);
  };
  entry.watchers.push(fs.watch(root, onChange));
  for (const section of sections) entry.watchers.push(fs.watch(path.join(root, section.slug), onChange));
  watchers.set(task.id, entry);
}
