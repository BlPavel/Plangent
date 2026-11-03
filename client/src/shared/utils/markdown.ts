import MarkdownIt from 'markdown-it'
import type { DocumentLinks } from '@shared/composables/documentLinks'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.css'

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  highlight: (code, lang) => (lang && hljs.getLanguage(lang) ? hljs.highlight(code, { language: lang, ignoreIllegals: true }).value : ''),
})

// Links in agent output open outside the app window.
const defaultLink = md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet('target', '_blank')
  tokens[idx].attrSet('rel', 'noopener noreferrer')
  return defaultLink(tokens, idx, options, env, self)
}

md.inline.ruler.before('link', 'analysis_reference', (state, silent) => {
  if (state.src.slice(state.pos, state.pos + 2) !== '[[') return false
  const end = state.src.indexOf(']]', state.pos + 2)
  if (end < 0 || end >= state.posMax) return false
  if (!silent) {
    const token = state.push('analysis_reference', '', 0)
    token.content = state.src.slice(state.pos + 2, end)
  }
  state.pos = end + 2
  return true
})
md.renderer.rules.analysis_reference = (tokens, index, _options, env) => {
  const target = tokens[index].content
  const label = md.utils.escapeHtml(target)
  const links = env?.links as DocumentLinks | undefined
  if (!links) return md.utils.escapeHtml('[[' + target + ']]')
  const valid = links.exists(target)
  return '<button type="button" class="btn btn-subtle btn-xs" data-analysis-target="' + md.utils.escapeHtml(target)
    + '" title="' + (valid ? 'Открыть анализ' : 'Раздел или файл не найден')
    + '"' + (valid ? '' : ' disabled style="color:var(--danger)"') + '>' + label + '</button>'
}
export const renderMarkdown = (value: string, links?: DocumentLinks) => md.render(value, { links })

// A ```mermaid block is kept as source; MessageMarkdown turns it into a diagram after rendering (the library loads lazily).
const defaultFence = md.renderer.rules.fence!
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  if (token.info.trim().split(/\s+/)[0] !== 'mermaid') return defaultFence(tokens, idx, options, env, self)
  return '<div class="mermaid-block" data-mermaid><pre><code>' + md.utils.escapeHtml(token.content) + '</code></pre></div>\n'
}
/** True when the markdown has a mermaid block, so the diagram library is worth loading. */
export const hasMermaid = (value: string) => /^ {0,3}(`{3,}|~{3,})\s*mermaid\b/m.test(value)
