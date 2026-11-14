import { transaction } from '../../../infrastructure/db/repositories/preparation/transaction';
import * as queries from '../../../infrastructure/db/repositories/preparation/materials/index';
import type { MaterialType, Material } from '@contracts';
export type { MaterialType, Material } from '@contracts';
import { v4 as uuid } from 'uuid';
import { getTask } from '../../tasks';
import { getProject } from '../../projects';
import { assertAnalysisEditable } from '../analysis';
import { materializeMaterial } from '../../tasks';
import { broadcast } from '../../shared';
import { emitMaterialSaved } from './events';



export class MaterialConflict extends Error { status = 409; }
export function isMaterialType(value: unknown): value is MaterialType {
  return value === 'architecture' || value === 'qa';
}
export function listMaterials(taskId: string, type: MaterialType): Material[] {
  return queries.listMaterialsSelectMaterials(taskId, type) as Material[];
}
export function getLatestMaterial(taskId: string, type: MaterialType): Material | null {
  return (queries.getLatestMaterialSelectMaterials(taskId, type) as Material) ?? null;
}
const IDENTIFIER_LINE = /^ {0,3}(?:#{1,6}\s+)?\*\*((?:D|Q)[1-9]\d*)\*\*(?=\s|[:.\-—]|$)/;
/** Identifiers in prose/code examples must not become reference targets. `boundary`: the line starts an identifier or a heading. */
function scanMaterial(content: string, visit: (line: string, id: string | undefined, boundary: boolean) => void): void {
  let fence: string | undefined;
  for (const line of content.split(/\r?\n/)) {
    const delimiter = line.match(/^\s*(`{3,}|~{3,})/);
    if (delimiter) {
      if (!fence) fence = delimiter[1];
      else if (delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length) fence = undefined;
      visit(line, undefined, false);
      continue;
    }
    if (fence) { visit(line, undefined, false); continue; }
    const id = line.match(IDENTIFIER_LINE)?.[1];
    visit(line, id, !!id || /^ {0,3}#{1,6}\s/.test(line));
  }
}
export function parseMaterialIdentifiers(content: string): string[] {
  const ids = new Set<string>();
  scanMaterial(content, (_line, id) => { if (id) ids.add(id); });
  return [...ids];
}
/** The text of every identified decision or criterion: from its line to the next identifier or heading, diagrams included. */
export function materialBlocks(content: string): Map<string, string> {
  const blocks = new Map<string, string>();
  let current: string | undefined;
  scanMaterial(content, (line, id, boundary) => {
    if (boundary) current = id;
    if (current) blocks.set(current, blocks.has(current) ? blocks.get(current)! + '\n' + line : line);
  });
  return blocks;
}
export function saveMaterial(data: { task_id: string; type: MaterialType; content: string;
  expected_version?: number; author?: Material['author']; session_id?: string | null }): Material {
  if (!isMaterialType(data.type) || typeof data.content !== 'string'
    || (data.author !== undefined && !['developer', 'agent'].includes(data.author))) throw new Error('Invalid material');
  if (data.expected_version !== undefined && (!Number.isSafeInteger(data.expected_version) || data.expected_version < 0))
    throw new Error('Invalid expected_version');
  try { assertAnalysisEditable(data.task_id); } catch (error) { throw new MaterialConflict((error as Error).message); }
  let previousContent = '';
  const material = transaction(() => {
    const previous = getLatestMaterial(data.task_id, data.type);
    previousContent = previous?.content ?? '';
    if (data.expected_version !== undefined && data.expected_version !== (previous?.version ?? 0))
      throw new MaterialConflict('Material has changed; reload before saving');
    const id = uuid();
    queries.materialInsertMaterials(id, data.task_id, data.type, data.content, (previous?.version ?? 0) + 1, data.author ?? 'developer', data.author === 'agent' ? data.session_id ?? null : null);
    return getLatestMaterial(data.task_id, data.type)!;
  });
  const task = getTask(data.task_id)!;
  const project = getProject(task.project_id)!;
  materializeMaterial(task, project.repo_path, material.type, material.content);
  broadcast({ type: 'material_updated', taskId: task.id, materialType: material.type, version: material.version });
  emitMaterialSaved({ taskId: task.id, type: material.type, content: material.content, previousContent, version: material.version, sessionId: material.session_id });
  return material;
}
