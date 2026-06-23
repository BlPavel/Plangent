import fs from 'fs';
import path from 'path';
import { LibraryItem, LibraryItemType } from '../../models';

const LIBRARY_DIR = path.join(process.cwd(), 'data', 'library');

function contentDir(type: LibraryItemType, slug: string): string {
  return path.join(LIBRARY_DIR, `${type}s`, slug);
}

function mainContentDir(): string {
  return path.join(LIBRARY_DIR, 'main');
}

export function readItemContent(item: LibraryItem): string {
  const p = getContentPath(item);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
}

export function writeItemContent(item: LibraryItem, content: string): void {
  const p = getContentPath(item);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');
}

export function deleteItemContent(item: LibraryItem): void {
  const p = getContentPath(item);
  if (fs.existsSync(p)) fs.unlinkSync(p);
  // Remove empty parent dirs
  try {
    const dir = path.dirname(p);
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  } catch { /* ignore */ }
}

export function readOverrideContent(item: LibraryItem, agentType: string): string | null {
  const p = getOverridePath(item, agentType);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null;
}

export function writeOverrideContent(item: LibraryItem, agentType: string, content: string): void {
  const p = getOverridePath(item, agentType);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');
}

export function deleteOverrideContent(item: LibraryItem, agentType: string): void {
  const p = getOverridePath(item, agentType);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function getContentPath(item: LibraryItem): string {
  if (item.type === 'main') {
    return path.join(mainContentDir(), `${item.slug}.md`);
  }
  return path.join(contentDir(item.type, item.slug), `${item.type === 'skill' ? 'SKILL' : 'COMMAND'}.md`);
}

function getOverridePath(item: LibraryItem, agentType: string): string {
  const dir = item.type === 'main'
    ? path.join(mainContentDir(), 'overrides')
    : path.join(contentDir(item.type, item.slug), 'overrides');
  return path.join(dir, `${agentType}.md`);
}

export function buildSkillFileContent(item: LibraryItem, body: string): string {
  const fm: Record<string, unknown> = {
    name: item.slug,
    description: item.description || item.title,
    ...item.frontmatter,
  };
  const lines = ['---'];
  for (const [k, v] of Object.entries(fm)) {
    lines.push(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  }
  lines.push('---');
  lines.push('');
  lines.push(body);
  return lines.join('\n');
}
