/** Date and time for status lines; also accepts SQLite's UTC "YYYY-MM-DD HH:MM:SS". */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return ''
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(value) ? value.replace(' ', 'T') + 'Z' : value
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
