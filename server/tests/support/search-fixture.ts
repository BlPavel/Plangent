import fs from 'node:fs/promises';
import path from 'node:path';
import searchFixture from '../../../tests/fixtures/files/search.json';

export { searchFixture };

export async function writeSearchFixture(root: string): Promise<void> {
  for (const [relativePath, content] of Object.entries(searchFixture.files)) {
    const file = path.join(root, relativePath);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content, 'utf8');
  }
}
