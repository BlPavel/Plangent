/**
 * Undo the classic Windows mojibake: UTF-8 text read as Windows-1251 and saved back as UTF-8
 * ("Создать" → "РЎРѕР·РґР°С‚СЊ"). Windows PowerShell 5.1 does exactly this when an agent edits a
 * file with Get-Content/Set-Content. Line by line, because an edit usually breaks only part of a file.
 *
 * A line is replaced only when mapping its characters back to Windows-1251 bytes gives valid
 * UTF-8 — real Russian text in those bytes practically never is, so correct lines stay as they are.
 */
const cp1251 = new TextDecoder('windows-1251');
const toByte = new Map<string, number>();
for (let b = 0; b < 256; b++) toByte.set(cp1251.decode(Uint8Array.of(b)), b);
const strictUtf8 = new TextDecoder('utf-8', { fatal: true });

function repairLine(line: string): string {
  if (!/[^\x00-\x7F]/.test(line)) return line;
  const bytes: number[] = [];
  for (const ch of line) {
    const b = toByte.get(ch);
    if (b === undefined) return line;
    bytes.push(b);
  }
  try { return strictUtf8.decode(Uint8Array.from(bytes)); } catch { return line; }
}

/** Repaired text (BOMs dropped), identical to the input when nothing was broken. */
export function repairMojibake(text: string): string {
  return text.replace(/﻿/g, '').split('\n').map(repairLine).join('\n');
}
