import TurndownService from 'turndown';
import { parseHTML } from 'linkedom';
import path from 'node:path';
import { DocsSourceConfig, ElementValue } from './types';
import { matchLink } from './config';

interface TableNode { innerHTML: string; querySelectorAll(selector: string): ArrayLike<TableNode> }

function value(node: { querySelector(selector: string): { getAttribute(name: string): string | null; textContent: string | null } | null; getAttribute(name: string): string | null; textContent: string | null }, setting?: ElementValue): string {
  const target = setting?.selector ? node.querySelector(setting.selector) : node;
  return setting?.attribute ? target?.getAttribute(setting.attribute) ?? '' : target?.textContent ?? '';
}
function fence(body: string, language = ''): string {
  const marker = '`'.repeat(Math.max(3, ...[...body.matchAll(/`+/g)].map(m => m[0].length + 1)));
  return `\n\n${marker}${language.replace(/[^\w+-]/g, '')}\n${body.replace(/\n$/, '')}\n${marker}\n\n`;
}
/** All service-specific markup is described by selectors in the source configuration. */
export function convertBody(body: string, config: DocsSourceConfig, url: string, currentPath = 'index.md', paths: Map<string, string> = new Map()): string {
  const link = (href: string): string => {
    let target: URL;
    try { target = new URL(href, url); } catch { return ''; }
    if (!['http:', 'https:', 'mailto:'].includes(target.protocol)) return '';
    if (target.origin === new URL(url).origin) {
      const match = matchLink(target.href, config.internal_link_patterns ?? config.link_patterns);
      const file = match?.id ? paths.get(match.id) : undefined;
      if (file) return (path.posix.relative(path.posix.dirname(currentPath), file) || path.posix.basename(file)) + target.hash;
    }
    return target.href;
  };
  if (config.body_format === 'markdown') {
    // Inline destinations and reference definitions; code blocks are left intact.
    let inFence = false, marker = '';
    return body.split('\n').map(line => {
      const f = /^\s*(`{3,}|~{3,})/.exec(line);
      if (f) { if (!inFence) { inFence = true; marker = f[1][0]; } else if (f[1][0] === marker) inFence = false; return line; }
      if (inFence) return line;
      return line.replace(/(\]\()([^\s)]+)([^)]*\))/g, (_, a, href, b) => a + link(href) + b)
        .replace(/^(\s*\[[^\]]+\]:\s*)(\S+)/, (_, a, href) => a + link(href));
    }).join('\n');
  }
  const { document } = parseHTML('<html><body></body></html>');
  // XHTML APIs may use CDATA for literal code; HTML parsers otherwise drop it as a comment.
  document.body.innerHTML = body.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
  for (const n of document.querySelectorAll('script,style,iframe,object')) n.remove();
  for (const n of document.querySelectorAll('a[href],img[src]')) {
    const attribute = n.localName === 'img' ? 'src' : 'href';
    n.setAttribute(attribute, link(n.getAttribute(attribute) ?? ''));
  }
  const converter = new TurndownService({
    headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', preformattedCode: true,
    blankReplacement: (content, node) => {
      const index = node.getAttribute?.('data-plangent-rule');
      const rule = index === null || index === undefined ? undefined : config.conversion_rules?.[Number(index)];
      if (rule?.action === 'unknown') return '\n\n[unknown element: ' + (node.getAttribute('data-plangent-parameter') || node.nodeName.toLowerCase()) + ']\n\n';
      if (rule?.action === 'code') return fence(node.textContent ?? '', node.getAttribute('data-plangent-parameter') ?? '');
      return node.isBlock ? '\n\n' : '';
    },
  });
  converter.addRule('safe-pre', { filter: 'pre', replacement: (_, node) => fence(node.textContent ?? '', node.firstElementChild?.getAttribute('class')?.match(/language-([\w+-]+)/)?.[1]) });
  converter.addRule('tables', {
    filter: 'table', replacement: (_, node) => {
      const rows = Array.from<TableNode>(node.querySelectorAll('tr')).map(row => Array.from<TableNode>(row.querySelectorAll('th,td')).map(cell => converter.turndown(cell.innerHTML).replace(/\|/g, '\\|').replace(/\n+/g, '<br>')));
      const width = Math.max(0, ...rows.map(r => r.length));
      if (!width) return '';
      const render = (row: string[]) => '| ' + Array.from({ length: width }, (_, i) => row[i] ?? '').join(' | ') + ' |';
      return '\n\n' + [render(rows[0]), render(Array(width).fill('---')), ...rows.slice(1).map(render)].join('\n') + '\n\n';
    },
  });
  // Mark the DOM first: Turndown's built-in parser need not implement CSS selectors.
  for (const [i, rule] of (config.conversion_rules ?? []).entries()) {
    for (const node of document.querySelectorAll(rule.selector)) {
      if (node.hasAttribute('data-plangent-rule')) continue; // First configured rule wins.
      if (rule.action === 'skip') { node.remove(); continue; }
      node.setAttribute('data-plangent-rule', String(i));
      node.setAttribute('data-plangent-parameter', (rule.parameter ? value(node, rule.parameter) : '') || rule.label || '');
      if (rule.content) {
        const target = rule.content.selector ? node.querySelector(rule.content.selector) : node;
        const text = rule.content.attribute ? target?.getAttribute(rule.content.attribute) ?? '' : target?.textContent ?? '';
        if (rule.action === 'code') node.textContent = text;
        else if (target && target !== node && !rule.content.attribute) node.innerHTML = target.innerHTML;
        else if (rule.content.attribute) node.textContent = text;
      }
    }
    converter.addRule(`configured-${i}`, {
      filter: node => node.getAttribute('data-plangent-rule') === String(i),
      replacement: (content, node) => {
        const label = node.getAttribute('data-plangent-parameter') ?? '';
        if (rule.action === 'code') return fence(node.textContent ?? '', label);
        if (rule.action === 'callout') return '\n\n' + `${label ? `**${label}**\n\n` : ''}${content.trim()}`.split('\n').map(l => `> ${l}`).join('\n') + '\n\n';
        if (rule.action === 'unknown') return `\n\n[unknown element: ${label || node.nodeName.toLowerCase()}]\n\n`;
        return '\n\n' + content + '\n\n';
      },
    });
  }
  return converter.turndown(document.body.innerHTML);
}
