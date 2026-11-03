import path from 'path';
import { listAnalysisSections, listAnalysisFiles, createAnalysisSection, updateAnalysisSection } from './analysis';
import { getAnalysisDirectory } from './task-files';
import { parsePlanSteps } from './plans';
import type { AnalysisSection } from '../../models';
import { parseMaterialLink } from '../materials/links';
import { parseMaterialIdentifiers } from '../materials';
import { getReadyMaterials } from '../materials/stages';

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
  const ready = getReadyMaterials(taskId);
  for (const step of parsePlanSteps(content)) for (const link of step.analysisLinks ?? []) {
    const material = parseMaterialLink(link);
    if (material) {
      const document = ready[material.type];
      if (!document) throw new Error('Reference [[' + link + ']]: the ' + material.type + ' is not marked ready by the developer, so it is not a ground for the plan. Call get_plan and remove the link.');
      const identifiers = parseMaterialIdentifiers(document.content);
      if (material.id && !identifiers.includes(material.id))
        throw new Error('Unknown identifier in [[' + link + ']]. Known in ' + material.type + ': ' + (identifiers.join(', ') || 'none') + '. Call get_plan and fix the link.');
    } else if (!targets.has(link)) throw new Error('Unknown analysis reference [[' + link + ']]. Call get_plan and fix the link.');
  }
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
/** Analysis and material parts that the steps of one executor session refer to. */
export function selectedStepContext(taskId: string, repoPath: string, taskKey: string, content: string, points?: string[]) {
  const steps = parsePlanSteps(content).filter(s => points === undefined || !points.length || (s.id && points.includes(s.id)));
  const links = new Set(steps.flatMap(s => s.analysisLinks ?? []));
  const directory = getAnalysisDirectory(repoPath, taskKey);
  const analysis: { section: string; title: string; readme?: { path: string; description: string };
    files: { name: string; path: string; mime: string; size: number; content?: string }[] }[] = [];
  const known = new Set<string>();
  for (const section of listAnalysisSections(taskId)) {
    const allFiles = listAnalysisFiles(section.id);
    known.add(section.slug);
    allFiles.forEach(f => known.add(section.slug + '/' + f.name));
    const whole = links.has(section.slug);
    const files = allFiles.filter(f => whole || links.has(section.slug + '/' + f.name));
    if (!whole && !files.length) continue;
    analysis.push({ section: section.slug, title: section.title,
      ...(whole ? { readme: { path: path.join(directory, section.slug, 'README.md'), description: section.description } } : {}),
      files: files.map(file => ({ name: file.name, path: path.join(directory, section.slug, file.name), mime: file.mime, size: file.size,
        ...(/^(text\/|application\/(json|xml|yaml|x-yaml))/.test(file.mime) ? { content: file.content.toString('utf8') } : {}) })) });
  }
  const ready = getReadyMaterials(taskId);
  const materials = (['architecture', 'qa'] as const).flatMap((type): Record<string, unknown>[] => {
    const refs = [...links].map(parseMaterialLink).filter((m): m is NonNullable<typeof m> => !!m && m.type === type);
    if (!refs.length) return [];
    const document = ready[type];
    if (!document) return [{ type, available: false, note: 'The ' + type + ' is no longer marked ready; ask the developer through request_help if the steps depend on it.' }];
    const whole = refs.some(ref => !ref.id), referenced = [...new Set(refs.flatMap(ref => ref.id ? [ref.id] : []))];
    // A criterion shared by several steps is verified only after the last of them.
    const sharedWith = Object.fromEntries(referenced.map(id => [id, parsePlanSteps(content)
      .filter(s => (s.analysisLinks ?? []).includes(type + '#' + id)).map(s => ({ id: s.id, done: s.done }))]));
    return [{ type, available: true, version: document.version, content: document.content, referenced: whole ? 'all' : referenced,
      identifiers: parseMaterialIdentifiers(document.content), stepsPerIdentifier: sharedWith }];
  });
  const missing = [...links].filter(link => !known.has(link) && !parseMaterialLink(link));
  return { steps: steps.map(s => ({ id: s.id, text: s.text, done: s.done })), analysis, materials, missing };
}
