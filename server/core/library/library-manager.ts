import { writeLibraryFile, deleteLibraryFile } from './file-transaction';
import fs from 'fs';
import path from 'path';
import { LibraryItem, LibraryItemType } from '../../models';
import { isTextInstructionType } from '../../../common/library-registry';
import { listLibraryItems } from '../../infrastructure/db/repositories/library';

const LIBRARY_DIR = path.join(process.cwd(), 'data', 'library');

// A project's detached copy keeps its own folder: it shares the slug with the group's item it came from.
const MATERIAL_FILES: Partial<Record<LibraryItemType, string>> = {
  'interview-instruction': 'INTERVIEW_INSTRUCTION.md',
  'architecture-template': 'ARCHITECTURE_TEMPLATE.md', 'architecture-review-instruction': 'ARCHITECTURE_REVIEW_INSTRUCTION.md',
  'architecture-review-skill': 'ARCHITECTURE_REVIEW_SKILL.md', 'qa-template': 'QA_TEMPLATE.md',
  'qa-review-instruction': 'QA_REVIEW_INSTRUCTION.md', 'qa-review-skill': 'QA_REVIEW_SKILL.md',
};

function contentDir(type: LibraryItemType, slug: string, item?: LibraryItem): string {
  return path.join(LIBRARY_DIR, `${type}s`, item?.detached_from ? `${slug}~${item.id}` : slug);
}

function mainContentDir(item: LibraryItem): string {
  return path.join(LIBRARY_DIR, 'main', ...(item.detached_from ? [`${item.slug}~${item.id}`] : []));
}

export function readItemContent(item: LibraryItem): string {
  const own = getContentPath(item);
  const p = fs.existsSync(own) ? own : legacyContentPath(item);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
}

export function writeItemContent(item: LibraryItem, content: string): void {
  const p = getContentPath(item);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  writeLibraryFile(p, content);
}

export function deleteItemContent(item: LibraryItem): void {
  const p = getContentPath(item);
  if (fs.existsSync(p)) deleteLibraryFile(p);
  const legacy = legacyContentPath(item);
  // Older text instructions can share a slug across levels. Keep the legacy text
  // available to the other levels until each one has its own content file.
  if (legacy !== p && fs.existsSync(legacy) && !listLibraryItems({ type: item.type }).some(other => other.id !== item.id && legacyContentPath(other) === legacy)) deleteLibraryFile(legacy);
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
  writeLibraryFile(p, content);
}

export function deleteOverrideContent(item: LibraryItem, agentType: string): void {
  const p = getOverridePath(item, agentType);
  if (fs.existsSync(p)) deleteLibraryFile(p);
}

function getContentPath(item: LibraryItem): string {
  const legacy = legacyContentPath(item);
  return (item.type === 'main' || isTextInstructionType(item.type)) && item.type !== 'commit-rules'
    ? path.join(LIBRARY_DIR, 'texts', item.id, path.basename(legacy)) : legacy;
}

/** Preserve overrides when an item's storage identity changes or a group copy is made. */
export function transferItemFiles(before: LibraryItem, after: LibraryItem, copy: boolean): string[] {
  const beforeDir = path.dirname(getOverridePath(before, '_'));
  const afterDir = path.dirname(getOverridePath(after, '_'));
  const agents: string[] = [];
  if (beforeDir !== afterDir && fs.existsSync(beforeDir)) {
    for (const file of fs.readdirSync(beforeDir)) {
      if (!file.endsWith('.md') || !fs.statSync(path.join(beforeDir, file)).isFile()) continue;
      const agent = file.slice(0, -3);
      writeOverrideContent(after, agent, fs.readFileSync(path.join(beforeDir, file), 'utf-8'));
      agents.push(agent);
      if (!copy && !listLibraryItems().some(other => other.id !== before.id && path.dirname(getOverridePath(other, '_')) === beforeDir)) deleteOverrideContent(before, agent);
    }
  }
  if (!copy && getContentPath(before) !== getContentPath(after)) deleteItemContent(before);
  return agents;
}

function legacyContentPath(item: LibraryItem): string {
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
  if (item.type === 'plan-review-skill') {
    return path.join(contentDir(item.type, item.slug, item), 'PLAN_REVIEW_SKILL.md');
  }
  if (item.type === 'mr-rules') {
    return path.join(contentDir(item.type, item.slug, item), 'MR_RULES.md');
  }
  if (item.type === 'mr-review-instruction') {
    return path.join(contentDir(item.type, item.slug, item), 'MR_REVIEW_INSTRUCTION.md');
  }
  if (item.type === 'plan-review-instruction') {
    return path.join(contentDir(item.type, item.slug, item), 'PLAN_REVIEW_INSTRUCTION.md');
  }
  const material = MATERIAL_FILES[item.type];
  if (material) return path.join(contentDir(item.type, item.slug, item), material);
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
