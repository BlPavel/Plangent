import type { ReviewHistory } from '../types'
import { plural, remarkWord, roundWord } from './words'

/** Sqlite stores UTC as «YYYY-MM-DD HH:MM:SS»: «2 окт». */
export function shortDate(value: string): string {
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z')
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '')
}

export const statusLabel = (item: ReviewHistory) => (item.status === 'open' ? (item.read_only ? 'на паузе' : 'открыто') : item.status === 'abandoned' ? 'брошено' : 'завершено')

/** «2 окт · 2 раунда · 6 замечаний (5 ✓, 1 💬)» */
export function historyDetails(item: ReviewHistory): string {
  const parts = [shortDate(item.created_at), plural(item.rounds, roundWord)]
  parts.push(item.items ? `${plural(item.items, remarkWord)} (${item.resolved} ✓${item.unresolved ? `, ${item.unresolved} 💬` : ''})` : 'без замечаний')
  return parts.filter(Boolean).join(' · ')
}

/** «ветка · 2 окт · 2 раунда · 6 замечаний (5 ✓, 1 💬)» */
export function historyLine(item: ReviewHistory): string {
  return [item.branch ?? 'вне ветки', historyDetails(item)].join(' · ')
}
