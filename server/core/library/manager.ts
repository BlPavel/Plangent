import fs from 'fs';
import path from 'path';

const SKILLS_DIR = path.join(process.cwd(), 'data', 'skills');

function getCommonSkillsPath(): string {
  return path.join(SKILLS_DIR, 'common.md');
}

function getProjectSkillsPath(projectId: string): string {
  return path.join(SKILLS_DIR, 'projects', `${projectId}.md`);
}

export function readCommonSkills(): string | null {
  const p = getCommonSkillsPath();
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null;
}

export function readProjectSkills(projectId: string): string | null {
  const p = getProjectSkillsPath(projectId);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null;
}

export function saveCommonSkills(content: string): void {
  fs.mkdirSync(SKILLS_DIR, { recursive: true });
  fs.writeFileSync(getCommonSkillsPath(), content);
}

export function saveProjectSkills(projectId: string, content: string): void {
  const dir = path.join(SKILLS_DIR, 'projects');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getProjectSkillsPath(projectId), content);
}
