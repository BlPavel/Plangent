/** Server messages that a feature rewrites for the user: [pattern, text or builder from the match]. */
export type ErrorDictionary = readonly (readonly [RegExp, string | ((match: RegExpMatchArray) => string)])[]

const COMMON: ErrorDictionary = [
  [/^Failed to fetch|NetworkError|Load failed/i, 'Нет связи с сервером Plangent. Перезапустите приложение.'],
]

/** A thrown API error as a sentence for the user: the feature's dictionary first, then the raw message. */
export function errorText(error: unknown, dictionary: ErrorDictionary = []): string {
  const raw = (error instanceof Error ? error.message : String(error)).replace(/^Error:\s*/, '').trim()
  for (const [pattern, text] of [...dictionary, ...COMMON]) {
    const match = raw.match(pattern)
    if (match) return typeof text === 'string' ? text : text(match)
  }
  return raw || 'Неизвестная ошибка'
}
