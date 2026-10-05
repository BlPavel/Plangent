/**
 * `@path` references of a general item that name an existing file or folder, in order, without repeats.
 * Folders are written with or without a trailing slash and saved without it.
 */
export function extractRefs(text: string, files: ReadonlySet<string>, dirs: ReadonlySet<string>): string[] {
  const refs: string[] = []
  for (const match of text.matchAll(/(?:^|\s)@([^\s@]+)/g)) {
    const path = match[1].replace(/[.,;:!?)]+$/, '').replace(/\/$/, '')
    if ((files.has(path) || dirs.has(path)) && !refs.includes(path)) refs.push(path)
  }
  return refs
}
