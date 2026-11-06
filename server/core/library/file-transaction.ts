import fs from 'fs';
import path from 'path';

let journal: Map<string, Buffer | null> | undefined;

function remember(file: string): void {
  if (journal && !journal.has(file)) journal.set(file, fs.existsSync(file) ? fs.readFileSync(file) : null);
}
export function writeLibraryFile(file: string, content: string): void {
  remember(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf-8');
}
export function deleteLibraryFile(file: string): void {
  remember(file);
  fs.unlinkSync(file);
}
export function rethrowFileError(error: unknown): void {
  if (journal) throw error;
}

/** Includes the database commit: commit failures restore disk bytes as well. Synchronous only. */
export function withLibraryFiles<T>(work: () => T): T {
  if (journal) throw new Error('Nested library file transaction');
  const files = new Map<string, Buffer | null>();
  journal = files;
  try { return work(); }
  catch (error) {
    const failures: unknown[] = [];
    for (const [file, bytes] of [...files].reverse()) {
      try {
        if (bytes === null) { if (fs.existsSync(file)) fs.unlinkSync(file); }
        else { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); }
      } catch (restoreError) { failures.push(restoreError); }
    }
    if (failures.length) throw new AggregateError([error, ...failures], 'Library save and file restoration failed');
    throw error;
  } finally { journal = undefined; }
}
