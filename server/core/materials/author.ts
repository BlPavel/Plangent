import { getSession, updateSession } from '../agent-sessions/sessions';
import type { AgentSession } from '../agent-sessions/types';
import { getTask } from '../tasks';
import { getProject } from '../projects';
import { analysisToolContext } from '../orchestration/analysis-context';
import { resolveMaterialTemplate } from '../library/section-settings';
import { getLatestMaterial, isMaterialType, parseMaterialIdentifiers, saveMaterial, MaterialConflict, type MaterialType } from './index';
import { getReadyMaterials } from './stages';
import { MATERIAL_KINDS } from './kinds';

/** The material type belongs to the session, not to tool arguments: an architecture author cannot overwrite QA. */
function authorContext(session: AgentSession): { type: MaterialType; taskId: string } {
  const type = session.metadata.material_type;
  if (session.role !== 'material-author' || !isMaterialType(type) || !session.task_id) throw new Error('Not a material author session');
  return { type, taskId: session.task_id };
}
function describe(type: MaterialType, taskId: string) {
  const material = getLatestMaterial(taskId, type);
  return { version: material?.version ?? 0, content: material?.content ?? '', identifiers: material ? parseMaterialIdentifiers(material.content) : [] };
}
/** What get_material returns. Remembers the version read so that submit_material can detect a manual edit in between. */
export function materialToolContext(session: AgentSession): Record<string, unknown> {
  const { type, taskId } = authorContext(session);
  const task = getTask(taskId), project = getProject(session.project_id);
  if (!task || !project) throw new Error('Task not found');
  const kind = MATERIAL_KINDS[type];
  const current = describe(type, taskId);
  updateSession(session.id, { metadata: { ...getSession(session.id).metadata, material_read_version: current.version } });
  // Only a ready architecture is a ground for QA; QA and the plan never ground the architecture.
  const architecture = type === 'qa' ? getReadyMaterials(taskId).architecture : null;
  return {
    task: { key: task.key, title: task.title ?? '', description: task.description ?? '' },
    project: project.name,
    material: type,
    analysis: analysisToolContext(taskId, project.repo_path, task.key),
    current,
    template: resolveMaterialTemplate(type, project.id).trim(),
    format: kind.protocol.trim(),
    ...(type === 'qa' ? architecture
      ? { architecture: { version: architecture.version, content: architecture.content, identifiers: parseMaterialIdentifiers(architecture.content) } }
      : { architecture: null, architectureNote: 'The architecture is not marked ready by the developer, so it is not a ground for QA.' } : {}),
  };
}
/** Saves the whole document of the session's own type, refusing to overwrite what the developer changed after get_material. */
export function submitMaterial(session: AgentSession, args: Record<string, unknown>): { saved: true; version: number; identifiers: string[] } {
  const { type, taskId } = authorContext(session);
  if (typeof args.content !== 'string' || !args.content.trim()) throw new Error('Invalid content');
  const read = getSession(session.id).metadata.material_read_version;
  if (typeof read !== 'number') throw new Error('Call get_material before submit_material.');
  let material;
  try { material = saveMaterial({ task_id: taskId, type, content: args.content, expected_version: read, author: 'agent', session_id: session.id }); }
  catch (error) {
    if (error instanceof MaterialConflict && /changed/.test(error.message))
      throw new Error('Документ изменён, перечитай его через get_material и перенеси свои правки.');
    throw error;
  }
  updateSession(session.id, { metadata: { ...getSession(session.id).metadata, material_read_version: material.version } });
  return { saved: true, version: material.version, identifiers: parseMaterialIdentifiers(material.content) };
}
