import path from 'node:path';
import { DATA_DIR, getDb } from '../../infrastructure/db/schema';
import { authenticatedRequest } from '../../infrastructure/http/integration-client';
import { broadcast } from '../shared/events';
import { requireConnection } from '../integrations';
import { invalidateFileCache } from '../projects/files';
import { getProject } from '../projects';
import { DocsSource } from './source';
import { discardSyncPlan, syncSource } from './sync';
import { DocsSourceError, SyncOptions, SyncResult } from './types';
export * from './types';
export { validateConfig } from './config';
export { convertBody } from './convert';
export { DocsSource } from './source';
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
  getDb().prepare("UPDATE projects SET sync_status='cancelled',sync_stats=? WHERE source_type='docs' AND sync_status='running'")
    .run(JSON.stringify({ message: 'Previous sync interrupted by server restart' }));
}

/** The project layer can call this facade without handling credentials or transport details. */
export async function syncDocsSource(id: string, options: SyncOptions = {}): Promise<SyncResult> {
  if (active.has(id)) throw new DocsSourceError('A sync is already running for this source', 'sync_running');
  const project = getProject(id);
  if (project?.kind !== 'source' || project.source_type !== 'docs' || !project.connection_id) throw new DocsSourceError('Docs source with a connection is required');
  const source = createDocsSource(project.connection_id, project.docs_config), root = sourceFolder(id), db = getDb();

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
    db.prepare("UPDATE projects SET sync_status='running' WHERE id=?").run(id);
    broadcast({ type: 'docs-sync-status', project_id: id, status: 'running' });
    const result = await syncSource(source, root, project.docs_selection, { ...options, signal, onProgress });
    db.prepare('UPDATE projects SET sync_status=?,last_sync_at=?,sync_stats=?,repo_path=? WHERE id=?')
      .run(result.stats.errors ? 'error' : 'done', result.manifest.synced_at, JSON.stringify({ ...result.stats, warnings: result.warnings }), root, id);
    return result;
  } catch (error) {
    const status = signal.aborted ? 'cancelled' : (error instanceof DocsSourceError && error.code === 'confirmation_required' ? project.sync_status : 'error');
    db.prepare('UPDATE projects SET sync_status=?,sync_stats=? WHERE id=?').run(status, JSON.stringify({ ...project.sync_stats, message: error instanceof Error ? error.message : 'Sync failed', code: (error as { code?: string })?.code, confirmation_count: (error as { count?: number })?.count, found: (error as { found?: number })?.found ?? project.sync_stats?.found }), id);
    throw error;
  } finally {
    invalidateFileCache(root);
    active.delete(id); finish();
    broadcast({ type: 'docs-sync-status', project_id: id, project: getProject(id) });
  }
}
