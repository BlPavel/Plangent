import type { Remark, RemarkCategory } from './types'

export const CATEGORY_LABELS: Record<Exclude<RemarkCategory, ''>, string> = {
  architecture: 'Архитектура', bug: 'Баг', risk: 'Риск', tests: 'Тесты', performance: 'Производительность', security: 'Безопасность', style: 'Стиль', other: 'Другое',
}
export const categoryOptions = [{ value: '', label: 'Без категории' }, ...Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label }))]
export const remarkPlace = (r: Pick<Remark, 'path' | 'line' | 'side'>) => r.path ? r.path + ':' + r.line + (r.side === 'old' ? ' (было)' : '') : 'МР целиком'

/** Remarks as markdown, for a review without a merge request: the developer pastes them on the hosting. */
export function remarksMarkdown(remarks: Remark[]): string {
  return remarks.map(r => '- ' + (r.path ? '`' + r.path + ':' + r.line + '` — ' : '') + r.body.replace(/\n/g, '\n  ')).join('\n')
}
export const plural = (n: number, one: string, few: string, many: string) =>
  n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many
