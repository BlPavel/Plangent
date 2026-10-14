import { IntegrationError } from '../integrations';
import type { DiffPosition, MrDiff, MrVersion } from '../../models/code-host';
/** Resolve context coordinates from hunks, including offsets after earlier edits. */
export function buildPosition(version: MrVersion, file: MrDiff, side: 'old' | 'new', line: number): DiffPosition {
  if (!Number.isSafeInteger(line) || line < 1 || !['old', 'new'].includes(side))
    throw new IntegrationError('Invalid diff line');
  let old = 0, fresh = 0, oldLeft = 0, newLeft = 0;
  for (const raw of file.diff.split('\n')) {
    const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw);
    if (h) {
      old = +h[1];
      fresh = +h[3];
      oldLeft = h[2] === undefined ? 1 : +h[2];
      newLeft = h[4] === undefined ? 1 : +h[4];
      continue;
    }
    if ((!oldLeft && !newLeft) || ![' ', '+', '-'].includes(raw[0]))
      continue;
    const old_line = raw[0] === '+' ? undefined : old++, new_line = raw[0] === '-' ? undefined : fresh++;
    if (old_line !== undefined)
      oldLeft--;
    if (new_line !== undefined)
      newLeft--;
    if ((side === 'old' ? old_line : new_line) === line)
      return {
        position_type: 'text', base_sha: version.base_commit_sha, start_sha: version.start_commit_sha, head_sha: version.head_commit_sha,
        old_path: file.old_path, new_path: file.new_path, ...(old_line !== undefined ? { old_line } : {}), ...(new_line !== undefined ? { new_line } : {}),
      };
  }
  throw new IntegrationError('Строка отсутствует в diff выбранной версии');
}
