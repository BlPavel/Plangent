export * from '../../../infrastructure/git/write';
import { serializeGit, check, assertNoGitOperation, stage, runGit as run, GitOperationError, type GitOperationOptions } from '../../../infrastructure/git/write';
import { DomainError } from '../../../models/domain-error';
import { assembleCommitMessage, inspectCommitMessage, type CommitMessageInput } from '../commits/commit-message';
import type { GitSettings } from '../../settings';
import path from 'node:path';
import { codePath } from '../../../infrastructure/files/code-path';

/** The only application commit path, also reused by finish. Settings are resolved inside the queue. */
export async function commit(root: string, input: CommitMessageInput, getSettings: () => GitSettings, options: GitOperationOptions = {}, overrideForbidden = false, paths?: string[]) {
  return serializeGit(root, async () => {
    await check(root, options, true);
    await assertNoGitOperation(root);
    const settings = getSettings();
    let message: string;
    try { message = assembleCommitMessage({ ...input, includeDescription: input.includeDescription ?? settings.include_description }); }
    catch (error) { throw new DomainError((error as Error).message); }
    if (message.length > 1024 * 1024) throw new DomainError('Commit message too large');
    const violations = inspectCommitMessage({ ...input, includeDescription: input.includeDescription ?? settings.include_description }, settings).violations;
    if (violations.some(item => item.kind === 'forbidden') && !overrideForbidden)
      throw new GitOperationError('Forbidden text in commit message. Explicit override is required.', '', 'forbidden_message');
    // Team format rules are warnings; only forbidden attribution requires an explicit override.
    if (paths !== undefined && (!Array.isArray(paths) || !paths.length || paths.length > 10000 || paths.some(file => typeof file !== 'string'))) throw new DomainError('Choose files');
    const selected = paths?.map(file => path.relative(root, codePath(root, file)).replace(/\\/g, '/'));
    if (selected) await stage(root, selected, options);
    return run(root, ['commit', '--cleanup=verbatim', '--file=-', ...(selected ? ['--only', '--', ...selected.map(file => `:(literal)${file}`)] : [])], options, message + '\n');
  });
}

