import fs from 'fs';
import path from 'path';
import os from 'os';
import { Agent, LayoutProfile, LayoutSlot, LibraryItem, Project } from '../models/types';
import { listLibraryItems } from '../storage/library';
import { listAgents } from '../storage/agents';
import { listProjects } from '../storage/projects';
import { readItemContent, readOverrideContent, buildSkillFileContent } from './library-manager';

const PLANGENT_MARKER_START = (slug: string) => `<!-- plangent:${slug}:start -->`;
const PLANGENT_MARKER_END = (slug: string) => `<!-- plangent:${slug}:end -->`;

function expandHome(p: string): string {
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function getLayoutProfile(agent: Agent): LayoutProfile | null {
  return agent.layout_profile;
}

function getSlot(profile: LayoutProfile, type: LibraryItem['type']): LayoutSlot | null {
  if (type === 'skill') return profile.skills ?? null;
  if (type === 'command') return profile.commands ?? null;
  return null;
}

function resolveTargetPath(slot: LayoutSlot, slug: string, scope: 'global' | 'project', repoCwd?: string): string | null {
  const fileTemplate = slot.file.replace('<slug>', slug);
  if (scope === 'global') {
    const dir = expandHome(slot.global);
    return path.join(dir, fileTemplate);
  } else {
    if (!repoCwd) return null;
    return path.join(repoCwd, slot.dir, fileTemplate);
  }
}

function getMainTarget(profile: LayoutProfile, scope: 'global' | 'project', repoCwd?: string): string | null {
  if (!profile.main) return null;
  if (scope === 'global') return expandHome(profile.main.global);
  if (!repoCwd) return null;
  return path.join(repoCwd, profile.main.file);
}

function isOurFile(filePath: string): boolean {
  const base = path.basename(path.dirname(filePath));
  const name = path.basename(filePath);
  return base.startsWith('plangent-') || name.startsWith('plangent-');
}

function safeWrite(targetPath: string, content: string, ourSlug: string): void {
  if (fs.existsSync(targetPath) && !isOurFile(targetPath)) {
    console.warn(`[syncer] Skipping ${targetPath} — not our file`);
    return;
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content, 'utf-8');
}

function safeDelete(targetPath: string): void {
  if (!isOurFile(targetPath)) return;
  try {
    if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
    const dir = path.dirname(targetPath);
    if (isOurFile(dir) && fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
    }
  } catch { /* ignore */ }
}

function resolveBody(item: LibraryItem, agentType: string): string {
  const override = readOverrideContent(item, agentType);
  return override ?? readItemContent(item);
}

function buildFileContent(item: LibraryItem, body: string): string {
  if (item.type === 'skill') return buildSkillFileContent(item, body);
  if (item.type === 'command') return body;
  return body;
}

// Manage plangent sections inside CLAUDE.md / AGENTS.md
function upsertMainSection(mainFile: string, slug: string, content: string): void {
  const start = PLANGENT_MARKER_START(slug);
  const end = PLANGENT_MARKER_END(slug);
  const block = `${start}\n${content.trim()}\n${end}`;

  if (!fs.existsSync(mainFile)) {
    fs.mkdirSync(path.dirname(mainFile), { recursive: true });
    fs.writeFileSync(mainFile, block + '\n', 'utf-8');
    return;
  }

  let existing = fs.readFileSync(mainFile, 'utf-8');
  const startIdx = existing.indexOf(start);
  const endIdx = existing.indexOf(end);

  if (startIdx !== -1 && endIdx !== -1) {
    existing = existing.slice(0, startIdx) + block + existing.slice(endIdx + end.length);
  } else {
    existing = existing.trimEnd() + '\n\n' + block + '\n';
  }

  fs.writeFileSync(mainFile, existing, 'utf-8');
}

function removeMainSection(mainFile: string, slug: string): void {
  if (!fs.existsSync(mainFile)) return;
  const start = PLANGENT_MARKER_START(slug);
  const end = PLANGENT_MARKER_END(slug);
  let existing = fs.readFileSync(mainFile, 'utf-8');
  const startIdx = existing.indexOf(start);
  const endIdx = existing.indexOf(end);
  if (startIdx === -1 || endIdx === -1) return;
  existing = (existing.slice(0, startIdx) + existing.slice(endIdx + end.length)).replace(/\n{3,}/g, '\n\n');
  if (existing.trim()) {
    fs.writeFileSync(mainFile, existing, 'utf-8');
  } else {
    fs.unlinkSync(mainFile);
  }
}

function applyGitExclude(project: Project): void {
  const gitDir = path.join(project.repo_path, '.git');
  if (!fs.existsSync(gitDir)) return;

  const excludeFile = path.join(gitDir, 'info', 'exclude');
  fs.mkdirSync(path.dirname(excludeFile), { recursive: true });

  const paths = [
    '.claude/skills/plangent-*',
    '.claude/commands/plangent-*',
    '.agents/skills/plangent-*',
    '.plangent/',
  ];

  // Main files (CLAUDE.md / AGENTS.md) — hide them too, but only if this project
  // actually has a main item. .git/info/exclude only affects UNTRACKED files, so a
  // CLAUDE.md the user already committed stays visible; a fully Plangent-managed one
  // (untracked) gets hidden.
  const hasMain = listLibraryItems({ type: 'main', scope: 'project', projectId: project.id, enabledOnly: true }).length > 0;
  if (hasMain) {
    for (const agent of listAgents(true)) {
      const mainFile = agent.layout_profile?.main?.file;
      if (mainFile && !paths.includes(mainFile)) paths.push(mainFile);
    }
  }

  const block = `# >>> plangent\n${paths.join('\n')}\n# <<< plangent`;

  let content = fs.existsSync(excludeFile) ? fs.readFileSync(excludeFile, 'utf-8') : '';
  const start = '# >>> plangent';
  const end = '# <<< plangent';
  const si = content.indexOf(start);
  const ei = content.indexOf(end);

  if (si !== -1 && ei !== -1) {
    content = content.slice(0, si) + block + content.slice(ei + end.length);
  } else {
    content = content.trimEnd() + '\n\n' + block + '\n';
  }
  fs.writeFileSync(excludeFile, content, 'utf-8');
}

function removeGitExclude(project: Project): void {
  const excludeFile = path.join(project.repo_path, '.git', 'info', 'exclude');
  if (!fs.existsSync(excludeFile)) return;
  let content = fs.readFileSync(excludeFile, 'utf-8');
  const start = '# >>> plangent';
  const end = '# <<< plangent';
  const si = content.indexOf(start);
  const ei = content.indexOf(end);
  if (si === -1 || ei === -1) return;
  content = (content.slice(0, si) + content.slice(ei + end.length)).replace(/\n{3,}/g, '\n\n');
  fs.writeFileSync(excludeFile, content, 'utf-8');
}

interface SyncTarget {
  path: string;
  content: string;
  isMain?: boolean;
  mainSlug?: string;
}

function targetsForItem(item: LibraryItem, agent: Agent, project: Project | null): SyncTarget[] {
  const profile = getLayoutProfile(agent);
  if (!profile) return [];

  const agentFilter = item.agent_filter;
  if (agentFilter.length > 0 && !agentFilter.includes(agent.id) && !agentFilter.includes(agent.name)) {
    return [];
  }

  const body = resolveBody(item, agent.id);
  const targets: SyncTarget[] = [];

  if (item.type === 'main') {
    const mainPath = getMainTarget(profile, item.scope, project?.repo_path);
    if (mainPath) {
      targets.push({ path: mainPath, content: body, isMain: true, mainSlug: item.slug });
    }
    return targets;
  }

  const slot = getSlot(profile, item.type);
  if (!slot) return [];

  if (slot.asMerged) {
    const mainPath = getMainTarget(profile, item.scope, project?.repo_path);
    if (mainPath) {
      const content = buildFileContent(item, body);
      targets.push({ path: mainPath, content, isMain: true, mainSlug: `${item.type}-${item.slug}` });
    }
    return targets;
  }

  const targetPath = resolveTargetPath(slot, item.slug, item.scope, project?.repo_path);
  if (targetPath) {
    targets.push({ path: targetPath, content: buildFileContent(item, body) });
  }
  return targets;
}

export function syncItem(item: LibraryItem): void {
  if (!item.enabled) { unsyncItem(item); return; }

  const agents = listAgents(true);
  const projects = item.scope === 'project'
    ? listProjects().filter(p => p.id === item.project_id)
    : [null as unknown as Project];

  for (const agent of agents) {
    for (const project of projects) {
      const targets = targetsForItem(item, agent, project);
      for (const t of targets) {
        if (t.isMain && t.mainSlug) {
          upsertMainSection(t.path, t.mainSlug, t.content);
        } else {
          safeWrite(t.path, t.content, item.slug);
        }
      }
    }
  }

  // Update git exclude for affected projects
  if (item.scope === 'project') {
    const project = listProjects().find(p => p.id === item.project_id);
    if (project?.hide_from_git) applyGitExclude(project);
  }
}

export function unsyncItem(item: LibraryItem): void {
  const agents = listAgents(true);
  const projects = item.scope === 'project'
    ? listProjects().filter(p => p.id === item.project_id)
    : [null as unknown as Project];

  for (const agent of agents) {
    for (const project of projects) {
      const profile = getLayoutProfile(agent);
      if (!profile) continue;

      if (item.type === 'main') {
        const mainPath = getMainTarget(profile, item.scope, project?.repo_path);
        if (mainPath) removeMainSection(mainPath, item.slug);
        continue;
      }

      const slot = getSlot(profile, item.type);
      if (!slot) continue;

      if (slot.asMerged) {
        const mainPath = getMainTarget(profile, item.scope, project?.repo_path);
        if (mainPath) removeMainSection(mainPath, `${item.type}-${item.slug}`);
        continue;
      }

      const targetPath = resolveTargetPath(slot, item.slug, item.scope, project?.repo_path);
      if (targetPath) safeDelete(targetPath);
    }
  }
}

export function syncAll(): void {
  const items = listLibraryItems({ enabledOnly: true });
  const agents = listAgents(true);
  const projects = listProjects();

  // Collect expected paths
  const expectedPaths = new Set<string>();
  const expectedMainSections = new Map<string, Set<string>>(); // mainFilePath → Set<slug>

  for (const item of items) {
    const scopedProjects = item.scope === 'project'
      ? projects.filter(p => p.id === item.project_id)
      : [null as unknown as Project];

    for (const agent of agents) {
      for (const project of scopedProjects) {
        const targets = targetsForItem(item, agent, project);
        for (const t of targets) {
          if (t.isMain && t.mainSlug) {
            if (!expectedMainSections.has(t.path)) expectedMainSections.set(t.path, new Set());
            expectedMainSections.get(t.path)!.add(t.mainSlug);
          } else {
            expectedPaths.add(t.path);
          }
        }
      }
    }
  }

  // Write all expected files
  for (const item of items) {
    syncItem(item);
  }

  // Cleanup orphaned plangent-* files in known directories
  const dirsToScan = new Set<string>();
  for (const p of expectedPaths) {
    dirsToScan.add(path.dirname(p));
    // Also scan parent (e.g. .claude/skills/ to find stale plangent-<slug>/ dirs)
    dirsToScan.add(path.dirname(path.dirname(p)));
  }

  for (const dir of dirsToScan) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.startsWith('plangent-')) continue;
      const fullPath = path.join(dir, entry);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        // Check all files inside
        for (const f of fs.readdirSync(fullPath)) {
          const fp = path.join(fullPath, f);
          if (!expectedPaths.has(fp)) safeDelete(fp);
        }
      } else {
        if (!expectedPaths.has(fullPath)) safeDelete(fullPath);
      }
    }
  }

  // Apply git exclude for projects with hide_from_git
  for (const project of projects) {
    if (project.hide_from_git) applyGitExclude(project);
    else removeGitExclude(project);
  }

  console.log(`[syncer] syncAll complete: ${items.length} items, ${agents.length} agents`);
}

export { applyGitExclude, removeGitExclude };
