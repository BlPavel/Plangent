import fs from 'fs';
import path from 'path';
import { LibraryItem, LibraryItemType } from '../../models';

const LIBRARY_DIR = path.join(process.cwd(), 'data', 'library');

// A project's detached copy keeps its own folder: it shares the slug with the group's item it came from.
function contentDir(type: LibraryItemType, slug: string, item?: LibraryItem): string {
  return path.join(LIBRARY_DIR, `${type}s`, item?.detached_from ? `${slug}~${item.id}` : slug);
}

function mainContentDir(item: LibraryItem): string {
  return path.join(LIBRARY_DIR, 'main', ...(item.detached_from ? [`${item.slug}~${item.id}`] : []));
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
    return path.join(mainContentDir(item), `${item.slug}.md`);
  }
  if (item.type === 'code-fixer-instruction') {
    return path.join(contentDir(item.type, item.slug, item), 'CODE_FIXER_INSTRUCTION.md');
  }
  if (item.type === 'commit-rules') {
    // One text per level: global, group and project items share the slug, so the folder is keyed by the item.
    return path.join(contentDir(item.type, `${item.slug}~${item.id}`), 'COMMIT_RULES.md');
  }
  if (item.type === 'instruction-guide') {
    return path.join(contentDir(item.type, item.slug, item), 'INSTRUCTION_GUIDE.md');
  }
  if (item.type === 'review-skill') {
    return path.join(contentDir(item.type, item.slug, item), 'REVIEW_SKILL.md');
  }
  if (item.type === 'plan-review-instruction') {
    return path.join(contentDir(item.type, item.slug, item), 'PLAN_REVIEW_INSTRUCTION.md');
  }
  if (item.type === 'plan-template') {
    return path.join(contentDir(item.type, item.slug, item), 'PLAN_TEMPLATE.md');
  }
  return path.join(contentDir(item.type, item.slug, item), `${item.type === 'skill' ? 'SKILL' : 'COMMAND'}.md`);
}

function getOverridePath(item: LibraryItem, agentType: string): string {
  const dir = item.type === 'main'
    ? path.join(mainContentDir(item), 'overrides')
    : path.join(contentDir(item.type, item.slug, item), 'overrides');
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

/** Plan review used to be a library skill; its old files are read once by the migration to the instruction. */
function legacyPlanReviewPath(item: LibraryItem): string {
  return path.join(LIBRARY_DIR, 'plan-review-skills', item.detached_from ? `${item.slug}~${item.id}` : item.slug, 'PLAN_REVIEW_SKILL.md');
}
export function takeLegacyPlanReviewContent(item: LibraryItem): string {
  const p = legacyPlanReviewPath(item);
  const content = fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
  try {
    fs.rmSync(path.dirname(p), { recursive: true, force: true });
    const parent = path.dirname(path.dirname(p));
    if (!fs.readdirSync(parent).length) fs.rmdirSync(parent);
  } catch { /* ignore */ }
  return content;
}
