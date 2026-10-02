import path from 'path';
import { listAnalysisSections, listAnalysisFiles, createAnalysisSection, updateAnalysisSection } from './analysis';
import { getAnalysisDirectory } from './task-files';
import { parsePlanSteps } from './plans';
import type { AnalysisSection } from '../../models';

export function analysisToolContext(taskId: string, repoPath: string, taskKey: string) {
  const directory = getAnalysisDirectory(repoPath, taskKey);
  return { directory, groups: ['source', 'worked'].map(kind => ({
    kind, sections: listAnalysisSections(taskId).filter(s => s.kind === kind).map(section => ({
      ...section, path: path.join(directory, section.slug, 'README.md'),
      files: listAnalysisFiles(section.id).map(({ content: _content, ...file }) => ({
        ...file, path: path.join(directory, section.slug, file.name),
      })),
    })),
  })) };
}
export function validateAnalysisLinks(taskId: string, content: string): void {
  const targets = new Set(listAnalysisSections(taskId).flatMap(s => [s.slug, ...listAnalysisFiles(s.id).map(f => s.slug + '/' + f.name)]));
  for (const step of parsePlanSteps(content)) for (const link of step.analysisLinks ?? [])
    if (!targets.has(link)) throw new Error('Unknown analysis reference [[' + link + ']]. Call get_plan and fix the link.');
}
export function saveAnalystSection(taskId: string, args: Record<string, unknown>) {
  if (typeof args.title !== 'string' || !args.title.trim() || typeof args.description !== 'string')
    throw new Error('title and description must be strings; title must not be empty');
  if (args.slug !== undefined && (typeof args.slug !== 'string' || !args.slug.trim())) throw new Error('Invalid slug');
  if (args.kind !== undefined && !['source', 'worked'].includes(String(args.kind))) throw new Error('Invalid kind');
  if (args.source_requested !== undefined && typeof args.source_requested !== 'boolean') throw new Error('Invalid source_requested');
  const section = args.slug === undefined ? undefined : listAnalysisSections(taskId).find(s => s.slug === args.slug);
  if (args.slug !== undefined && !section) throw new Error('Section not found in this task');
  const kind = (args.kind ?? section?.kind ?? 'worked') as AnalysisSection['kind'];
  if ((kind === 'source' || section?.kind === 'source' || section?.author === 'developer') && args.source_requested !== true)
    throw new Error('Editing developer materials or source sections requires an explicit developer request (source_requested=true).');
  const value = { title: args.title, description: args.description, kind };
  return section ? updateAnalysisSection(section.id, value, 'agent')
    : createAnalysisSection({ task_id: taskId, ...value, author: 'agent' });
}
export function selectedAnalysisContext(taskId: string, repoPath: string, taskKey: string, content: string, points?: string[]): string {
  const links = new Set(parsePlanSteps(content).filter(s => points === undefined || (s.id && points.includes(s.id)))
    .flatMap(s => s.analysisLinks ?? []));
  if (!links.size) return '';
  const directory = getAnalysisDirectory(repoPath, taskKey);
  const lines: string[] = [], known = new Set<string>();
  for (const section of listAnalysisSections(taskId)) {
    const allFiles = listAnalysisFiles(section.id);
    known.add(section.slug);
    allFiles.forEach(f => known.add(section.slug + '/' + f.name));
    const whole = links.has(section.slug);
    const files = allFiles.filter(f => whole || links.has(section.slug + '/' + f.name));
    if (!whole && !files.length) continue;
    lines.push('### ' + section.title);
    if (whole) lines.push(path.join(directory, section.slug, 'README.md'), section.description);
    for (const file of files) {
      lines.push('File: ' + path.join(directory, section.slug, file.name) + ' (' + file.mime + ', ' + file.size + ' bytes)');
      if (/^(text\/|application\/(json|xml|yaml|x-yaml))/.test(file.mime)) lines.push(file.content.toString('utf8'));
    }
    lines.push('');
  }
  for (const link of links) if (!known.has(link)) lines.push('Missing analysis material: [[' + link + ']]');
  return lines.join('\n');
}
