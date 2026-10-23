import type { Remark } from './types'

export const remarkPlace = (r: Pick<Remark, 'path' | 'line' | 'side'>) => r.path ? r.path + ':' + r.line + (r.side === 'old' ? ' (было)' : '') : 'МР целиком'

/** Remarks as markdown, for a review without a merge request: the developer pastes them on the hosting. */
export function remarksMarkdown(remarks: Remark[]): string {
  return remarks.map(r => '- ' + (r.path ? '`' + r.path + ':' + r.line + '` — ' : '') + r.body.replace(/\n/g, '\n  ')).join('\n')
}
export const plural = (n: number, one: string, few: string, many: string) =>
  n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many
