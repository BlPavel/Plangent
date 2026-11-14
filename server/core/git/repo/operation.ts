import { randomUUID } from 'node:crypto';
import { DomainError } from '../../../models/domain-error';
import { broadcast } from '../../shared';
import { assertRepositoryIdle } from './git-busy';
import type { GitOperationOptions } from '../../../infrastructure/git/write';

const operations = new Map<string, { projectId: string; controller: AbortController }>();

export function cancelGitOperation(projectId: string, operationId: string): void {
  const operation = operations.get(operationId);
  if (!operation || operation.projectId !== projectId) throw new DomainError('Operation not found', 404);
  operation.controller.abort();
}

/** Shared by HTTP and agent callers; the transport owns its cancellation signal. */
export async function executeGitOperation<T>(input: { projectId: string; root: string; operationId?: unknown; signal?: AbortSignal; onProgress?: (event: { operationId: string; state?: 'started' | 'finished'; output?: string }) => void }, action: (root: string, options: GitOperationOptions) => Promise<T>) {
  const { projectId, root, signal } = input;
  const id = input.operationId ?? randomUUID();
  if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(id) || operations.has(id)) throw new DomainError('Invalid operation ID');
  const controller = new AbortController();
  const abort = () => controller.abort();
  operations.set(id, { projectId, controller });
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  broadcast({ type: 'git:progress', project_id: projectId, operationId: id, state: 'started' });
  try {
    input.onProgress?.({ operationId: id, state: 'started' });
    const output = await action(root, { signal: controller.signal,
      assertIdle: () => assertRepositoryIdle(projectId, undefined, root),
      onOutput: output => { broadcast({ type: 'git:progress', project_id: projectId, operationId: id, output }); input.onProgress?.({ operationId: id, output }); } });
    return { operationId: id, output };
  } finally {
    broadcast({ type: 'code:changed', projectId });
    operations.delete(id);
    signal?.removeEventListener('abort', abort);
    broadcast({ type: 'git:progress', project_id: projectId, operationId: id, state: 'finished' });
    input.onProgress?.({ operationId: id, state: 'finished' });
  }
}
