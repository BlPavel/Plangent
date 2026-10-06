import hljs from 'highlight.js/lib/common'

const byExtension: Record<string, string> = {
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'typescript', js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  vue: 'xml', html: 'xml', htm: 'xml', svg: 'xml', xml: 'xml', json: 'json', jsonc: 'json', json5: 'json', css: 'css', scss: 'scss', less: 'less',
  md: 'markdown', markdown: 'markdown', yml: 'yaml', yaml: 'yaml', py: 'python', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', swift: 'swift',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp', php: 'php', rb: 'ruby', sh: 'bash', bash: 'bash', zsh: 'bash', ps1: 'powershell',
  sql: 'sql', ini: 'ini', toml: 'ini', diff: 'diff', patch: 'diff', graphql: 'graphql', lua: 'lua', r: 'r',
}
const byName: Record<string, string> = { dockerfile: 'dockerfile', makefile: 'makefile' }

export function languageFor(path: string): string | undefined {
  const name = path.split('/').pop()!.toLowerCase()
  const language = byName[name] ?? byExtension[name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '']
  return language && hljs.getLanguage(language) ? language : undefined
}

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Splits highlighted HTML into per-line HTML, closing and reopening spans that cross a line break. */
export function splitLines(html: string): string[] {
  const lines: string[] = []
  const open: string[] = []
  let current = ''
  for (const part of html.split(/(<[^>]+>|\n)/)) {
    if (part === '\n') {
      lines.push(current + '</span>'.repeat(open.length))
      current = open.join('')
    } else if (part.startsWith('</')) { open.pop(); current += part }
    else if (part.startsWith('<')) { open.push(part); current += part }
    else current += part
  }
  lines.push(current + '</span>'.repeat(open.length))
  return lines
}

/** Per-line HTML of a source file; unknown languages are escaped without highlighting. */
export function highlightLines(path: string, content: string, enabled = true): string[] {
  const language = enabled ? languageFor(path) : undefined
  const html = language ? hljs.highlight(content, { language, ignoreIllegals: true }).value : escapeHtml(content)
  const lines = splitLines(html)
  // A trailing newline does not start a new visible line.
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}
