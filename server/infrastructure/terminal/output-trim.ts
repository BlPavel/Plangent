const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
const MAX_LINE = 2000;

/** Escape codes, carriage-return progress redraws and runs of identical lines carry no information for an agent. */
export function cleanOutput(text: string): string[] {
  const lines = text.replace(ANSI, '').replace(/\r\n/g, '\n').split('\n').map(line => {
    const visible = line.includes('\r') ? line.split('\r').filter(Boolean).pop() ?? '' : line;
    return visible.length > MAX_LINE ? visible.slice(0, MAX_LINE) + ' … [line cut]' : visible.trimEnd();
  });
  const result: string[] = [];
  for (let i = 0; i < lines.length;) {
    let j = i;
    while (j + 1 < lines.length && lines[j + 1] === lines[i]) j++;
    result.push(lines[i]);
    if (j - i >= 2) result.push(`[previous line repeated ${j - i} more times]`);
    else for (let k = i + 1; k <= j; k++) result.push(lines[k]);
    i = j + 1;
  }
  while (result.length && !result[result.length - 1]) result.pop();
  return result;
}

/**
 * Keeps the start (what was run, first failures) and, with more room, the end (the summary of almost every test runner and compiler).
 * `marker` says what was left out; it is inserted between the two parts.
 */
export function trimOutput(text: string, maxChars: number, marker: (omittedLines: number) => string): { text: string; omittedLines: number } {
  const lines = cleanOutput(text);
  const size = (part: string[]) => part.reduce((sum, line) => sum + line.length + 1, 0);
  if (size(lines) <= maxChars) return { text: lines.join('\n'), omittedLines: 0 };
  const head: string[] = [], tail: string[] = [];
  let headSize = 0, tailSize = 0, start = 0, end = lines.length;
  while (start < end && headSize + lines[start].length + 1 <= maxChars * 0.25) { headSize += lines[start].length + 1; head.push(lines[start++]); }
  while (end > start && tailSize + lines[end - 1].length + 1 <= maxChars * 0.75) { tailSize += lines[end - 1].length + 1; tail.unshift(lines[--end]); }
  const omittedLines = end - start;
  return { text: [...head, marker(omittedLines), ...tail].join('\n'), omittedLines };
}
