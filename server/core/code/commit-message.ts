import type { GitSettings } from '../projects/git-settings';

export interface Coauthor { name: string; email: string }
export interface CommitMessageInput {
  title: string; body?: string; includeDescription?: boolean;
  includeCoauthors?: boolean; coauthors?: Coauthor[];
}
export interface CommitViolation { kind: 'forbidden' | 'format'; severity: 'error' | 'warning'; line: number; text: string; pattern: string }
const trailer = /^\s*co-authored-by\s*:/i;
function removeCoauthorTrailers(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let continuation = false;
  return lines.filter(line => {
    if (trailer.test(line)) { continuation = true; return false; }
    if (continuation && /^\s+\S/.test(line)) return false;
    continuation = false; return true;
  }).join('\n').trimEnd();
}
export function assembleCommitMessage(input: CommitMessageInput): string {
  if (!input || typeof input.title !== 'string' || /[\r\n\0]/.test(input.title) || !input.title.trim()) throw new Error('Enter a single-line commit title');
  if (input.body !== undefined && (typeof input.body !== 'string' || input.body.includes('\0'))) throw new Error('Invalid commit description');
  if (input.includeDescription !== undefined && typeof input.includeDescription !== 'boolean') throw new Error('Invalid description flag');
  if (input.includeCoauthors !== undefined && typeof input.includeCoauthors !== 'boolean') throw new Error('Invalid coauthor flag');
  const title = removeCoauthorTrailers(input.title.trim());
  if (!title) throw new Error('Enter a commit title');
  const body = input.includeDescription ? removeCoauthorTrailers(input.body ?? '').trim() : '';
  const authors: string[] = [];
  if (input.includeCoauthors) {
    if (!Array.isArray(input.coauthors) || !input.coauthors.length || input.coauthors.length > 100) throw new Error('Specify coauthors');
    for (const author of input.coauthors) {
      if (!author || typeof author.name !== 'string' || !author.name.trim() || /[\r\n<>\0]/.test(author.name) || typeof author.email !== 'string' || !/^[^\s<>@]+@[^\s<>@]+$/.test(author.email)) throw new Error('Invalid coauthor name or email');
      authors.push('Co-authored-by: ' + author.name.trim() + ' <' + author.email + '>');
    }
  }
  return [title, body, [...new Set(authors)].join('\n')].filter(Boolean).join('\n\n');
}
export function validateCommitMessage(message: string, settings: Pick<GitSettings, 'forbidden_patterns' | 'commit_pattern'>): CommitViolation[] {
  const violations: CommitViolation[] = [];
  for (const pattern of settings.forbidden_patterns) {
    const regex = new RegExp(pattern, 'gim');
    for (const match of message.matchAll(regex)) {
      violations.push({ kind: 'forbidden', severity: 'error', line: message.slice(0, match.index).split('\n').length, text: match[0], pattern });
    }
  }
  if (settings.commit_pattern && !new RegExp(settings.commit_pattern).test(message))
    violations.push({ kind: 'format', severity: 'warning', line: 1, text: message.split('\n')[0], pattern: settings.commit_pattern });
  return violations;
}
/** Strip complete matching lines and all embedded coauthor trailers before showing generated text. */
export function cleanCommitMessage(message: string, settings: Pick<GitSettings, 'forbidden_patterns'>): string {
  const text = removeCoauthorTrailers(message), removed = new Set<number>();
  for (const pattern of settings.forbidden_patterns) {
    for (const match of text.matchAll(new RegExp(pattern, 'gim'))) {
      const start = text.slice(0, match.index).split('\n').length - 1;
      const end = text.slice(0, match.index + match[0].length).split('\n').length - 1;
      for (let line = start; line <= end; line++) removed.add(line);
    }
  }
  return text.split('\n').filter((_, line) => !removed.has(line)).join('\n').trimEnd();
}

/** Check the text the user typed as well as explicit coauthors, before assembly strips trailers. */
export function inspectCommitMessage(input: CommitMessageInput, settings: Pick<GitSettings, 'forbidden_patterns' | 'commit_pattern'>) {
  const message = assembleCommitMessage(input);
  const raw = [input.title.trim(), input.includeDescription ? (input.body ?? '').trim() : ''].filter(Boolean).join('\n\n');
  const rawViolations = validateCommitMessage(raw, settings);
  const addedViolations = validateCommitMessage(message, { ...settings, commit_pattern: '' }).filter(item =>
    !rawViolations.some(existing => existing.pattern === item.pattern && existing.text === item.text));
  const cleanedCoauthors = input.includeCoauthors ? (input.coauthors ?? []).filter(author =>
    !validateCommitMessage('Co-authored-by: ' + author.name + ' <' + author.email + '>', { ...settings, commit_pattern: '' }).length) : [];
  return { message, violations: [...rawViolations, ...addedViolations], cleaned: cleanCommitMessage(raw, settings), cleanedCoauthors };
}
