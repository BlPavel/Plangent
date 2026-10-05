/** Russian plural: [one, few, many] — 1 замечание, 2 замечания, 5 замечаний. */
export type Forms = [string, string, string]

export const remarkWord: Forms = ['замечание', 'замечания', 'замечаний']
export const roundWord: Forms = ['раунд', 'раунда', 'раундов']
export const commitWord: Forms = ['коммит', 'коммита', 'коммитов']
export const fileWord: Forms = ['файл', 'файла', 'файлов']
export const draftWord: Forms = ['черновик', 'черновика', 'черновиков']

export function word(n: number, forms: Forms): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 14) return forms[2]
  const unit = n % 10
  return unit === 1 ? forms[0] : unit >= 2 && unit <= 4 ? forms[1] : forms[2]
}

/** «3 коммита» */
export const plural = (n: number, forms: Forms) => `${n} ${word(n, forms)}`
