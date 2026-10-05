import type { ReviewHistory } from '../types'
import { plural, remarkWord, roundWord } from './words'

const short = (hash: string | null | undefined) => (hash ? hash.slice(0, 7) : '')

/** Sqlite stores UTC as «YYYY-MM-DD HH:MM:SS»: «2 окт». */
export function shortDate(value: string): string {
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z')
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '')
}

export const statusLabel = (item: ReviewHistory) => (item.status === 'open' ? (item.read_only ? 'на паузе' : 'открыто') : item.status === 'abandoned' ? 'брошено' : 'завершено')

/** «ветка · 2 окт · 2 раунда · 6 замечаний (5 ✓, 1 💬) · a1b2c3 → d4e5f6» */
export function historyLine(item: ReviewHistory): string {
  const parts = [item.branch ?? 'вне ветки', shortDate(item.created_at), plural(item.rounds, roundWord)]
  parts.push(item.items ? `${plural(item.items, remarkWord)} (${item.resolved} ✓${item.unresolved ? `, ${item.unresolved} 💬` : ''})` : 'без замечаний')
  const end = item.head_end ?? item.head_last
  if (item.head_start) parts.push(`${short(item.head_start)} → ${short(end)}`)
  return parts.filter(Boolean).join(' · ')
}
