import * as queries from '../../../infrastructure/db/repositories/projects/sources/index';
import path from 'node:path';
import { DATA_DIR } from '../../../infrastructure/paths';
import { authenticatedRequest } from '../../integrations';
import { broadcast } from '../../shared';
import { requireConnection } from '../../integrations';
import { invalidateFileCache } from '../../files';
import { getProject } from '..';
import { DocsSource } from '../../../infrastructure/docs-sources/source';
import { discardSyncPlan, syncSource } from './sync';
import { DocsSourceError, SyncOptions, SyncResult } from '../../../models/docs-sources';
export * from '../../../models/docs-sources';
export { validateConfig } from '../../../infrastructure/docs-sources/config';
export { convertBody } from '../../../infrastructure/docs-sources/convert';
export { DocsSource } from '../../../infrastructure/docs-sources/source';
export { readManifest, syncSource } from './sync';

export function sourceFolder(id: string): string {
  if (!/^[a-z0-9-]+$/i.test(id)) throw new DocsSourceError('Invalid source id');
  return path.join(DATA_DIR, 'sources', id);
}
export function createDocsSource(connectionId: string, config: unknown): DocsSource {
  const connection = requireConnection(connectionId);
  return new DocsSource(connection.base_url, config, (endpoint, signal) => authenticatedRequest(connectionId, endpoint, { signal }));
}

const active = new Map<string, { controller: AbortController; done: Promise<void> }>();
export function isDocsSyncRunning(id: string): boolean { return active.has(id); }
export async function cancelDocsSync(id: string): Promise<void> {
  discardSyncPlan(sourceFolder(id));
  const job = active.get(id);
  if (job) { job.controller.abort(); await job.done; }
}
export function resetInterruptedDocsSyncs(): void {
  queries.resetInterruptedDocsSyncsUpdateProjects(JSON.stringify({ message: 'Previous sync interrupted by server restart' }));
}

/** The project layer can call this facade without handling credentials or transport details. */
export async function syncDocsSource(id: string, options: SyncOptions = {}): Promise<SyncResult> {
  if (active.has(id)) throw new DocsSourceError('A sync is already running for this source', 'sync_running');
  const project = getProject(id);
  if (project?.kind !== 'source' || project.source_type !== 'docs' || !project.connection_id) throw new DocsSourceError('Docs source with a connection is required');
  const source = createDocsSource(project.connection_id, project.docs_config), root = sourceFolder(id);

  const controller = new AbortController();
  let finish!: () => void;
  const done = new Promise<void>(resolve => { finish = resolve; });
  active.set(id, { controller, done });
  const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
  const onProgress: SyncOptions['onProgress'] = progress => {
    broadcast({ type: 'docs-sync-progress', project_id: id, progress });
    options.onProgress?.(progress);
  };

  try {
    queries.syncDocsSourceUpdateProjects(id);
    broadcast({ type: 'docs-sync-status', project_id: id, status: 'running' });
    const result = await syncSource(source, root, project.docs_selection, { ...options, signal, onProgress });
    queries.syncDocsSourceUpdateProjects2(result.stats.errors ? 'error' : 'done', result.manifest.synced_at, JSON.stringify({ ...result.stats, warnings: result.warnings }), root, id);
    return result;
  } catch (error) {
    const status = signal.aborted ? 'cancelled' : (error instanceof DocsSourceError && error.code === 'confirmation_required' ? project.sync_status : 'error');
    queries.syncDocsSourceUpdateProjects3(status, JSON.stringify({ ...project.sync_stats, message: error instanceof Error ? error.message : 'Sync failed', code: (error as { code?: string })?.code, confirmation_count: (error as { count?: number })?.count, found: (error as { found?: number })?.found ?? project.sync_stats?.found }), id);
    throw error;
  } finally {
    invalidateFileCache(root);
    active.delete(id); finish();
    broadcast({ type: 'docs-sync-status', project_id: id, project: getProject(id) });
  }
}
