import { ICON_SET } from './icon-set'

// Names refer to the vscode-icons set (MIT); scripts/gen-file-icons.cjs extracts the ones used here into icon-set.ts.
const byName: Record<string, string> = {
  'package.json': 'file-type-npm', 'package-lock.json': 'file-type-npm', '.npmrc': 'file-type-npm',
  dockerfile: 'file-type-docker', '.dockerignore': 'file-type-docker', 'docker-compose.yml': 'file-type-docker', 'docker-compose.yaml': 'file-type-docker',
  '.gitignore': 'file-type-git', '.gitattributes': 'file-type-git', '.gitmodules': 'file-type-git',
  'tsconfig.json': 'file-type-tsconfig', '.editorconfig': 'file-type-editorconfig', '.env': 'file-type-dotenv',
  license: 'file-type-license', 'license.md': 'file-type-license', 'license.txt': 'file-type-license',
  'eslint.config.mjs': 'file-type-eslint', 'eslint.config.js': 'file-type-eslint', '.eslintrc.json': 'file-type-eslint',
}
const byPrefix: [string, string][] = [['tsconfig.', 'file-type-tsconfig'], ['vite.config.', 'file-type-vite'], ['.env.', 'file-type-dotenv']]
const byExtension: Record<string, string> = {
  ts: 'file-type-typescript-official', mts: 'file-type-typescript-official', cts: 'file-type-typescript-official', tsx: 'file-type-typescript-official',
  js: 'file-type-js-official', mjs: 'file-type-js-official', cjs: 'file-type-js-official', jsx: 'file-type-js-official',
  vue: 'file-type-vue', json: 'file-type-json', jsonc: 'file-type-json', json5: 'file-type-json',
  css: 'file-type-css', scss: 'file-type-scss', sass: 'file-type-sass', less: 'file-type-less',
  html: 'file-type-html', htm: 'file-type-html', xml: 'file-type-xml', md: 'file-type-markdown', markdown: 'file-type-markdown', mdx: 'file-type-markdown',
  yml: 'file-type-yaml', yaml: 'file-type-yaml', toml: 'file-type-toml', ini: 'file-type-ini', conf: 'file-type-config', cfg: 'file-type-config',
  py: 'file-type-python', go: 'file-type-go', rs: 'file-type-rust', java: 'file-type-java', kt: 'file-type-kotlin', swift: 'file-type-swift',
  c: 'file-type-c', h: 'file-type-c', cpp: 'file-type-cpp', cc: 'file-type-cpp', hpp: 'file-type-cpp', php: 'file-type-php', rb: 'file-type-ruby',
  sql: 'file-type-sql', sh: 'file-type-shell', bash: 'file-type-shell', zsh: 'file-type-shell', bat: 'file-type-bat', cmd: 'file-type-bat', ps1: 'file-type-powershell',
  svg: 'file-type-svg', png: 'file-type-image', jpg: 'file-type-image', jpeg: 'file-type-image', gif: 'file-type-image', webp: 'file-type-image', ico: 'file-type-image', bmp: 'file-type-image',
  txt: 'file-type-text', log: 'file-type-log', pdf: 'file-type-pdf', zip: 'file-type-zip', gz: 'file-type-zip', tgz: 'file-type-zip', '7z': 'file-type-zip',
  ttf: 'file-type-font', otf: 'file-type-font', woff: 'file-type-font', woff2: 'file-type-font',
  mp3: 'file-type-audio', wav: 'file-type-audio', mp4: 'file-type-video', mov: 'file-type-video', webm: 'file-type-video',
  exe: 'file-type-binary', dll: 'file-type-binary', node: 'file-type-binary', bin: 'file-type-binary', db: 'file-type-binary', sqlite: 'file-type-binary',
}
const folders: Record<string, string> = {
  src: 'folder-type-src', dist: 'folder-type-dist', build: 'folder-type-dist', out: 'folder-type-dist', node_modules: 'folder-type-node',
  test: 'folder-type-test', tests: 'folder-type-test', __tests__: 'folder-type-test', docs: 'folder-type-docs', doc: 'folder-type-docs',
  '.git': 'folder-type-git', '.github': 'folder-type-github', '.gitlab': 'folder-type-gitlab', '.vscode': 'folder-type-vscode',
}

export function fileIconName(name: string): string {
  const lower = name.toLowerCase()
  const exact = byName[lower]
  if (exact) return exact
  const prefix = byPrefix.find(([p]) => lower.startsWith(p))
  if (prefix) return prefix[1]
  const dot = lower.lastIndexOf('.')
  return (dot > 0 || (dot === 0 && lower.length > 1) ? byExtension[lower.slice(dot + 1)] : undefined) ?? 'default-file'
}

export function folderIconName(name: string, open: boolean): string {
  const base = folders[name.toLowerCase()] ?? 'default-folder'
  return open ? base + '-opened' : base
}

/** Inline SVG markup for an icon name; the set is bundled (not user input), so it is safe for v-html. */
export function iconSvg(icon: string): string {
  const entry = ICON_SET.icons[icon] ?? ICON_SET.icons['default-file']
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ICON_SET.size} ${ICON_SET.size}" width="1em" height="1em">${entry}</svg>`
}
