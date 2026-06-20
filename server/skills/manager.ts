import fs from 'fs';
import path from 'path';
import os from 'os';

const SKILLS_DIR = path.join(process.cwd(), 'data', 'skills');
const TEMP_BASE = path.join(os.tmpdir(), 'plangent-skills');

export function getCommonSkillsPath(): string {
  return path.join(SKILLS_DIR, 'common.md');
}

export function getProjectSkillsPath(projectId: string): string {
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

export function deploySkillsToTemp(projectId: string, agentType: string): string {
  const tempDir = path.join(TEMP_BASE, `${agentType}-${projectId}-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  const common = readCommonSkills();
  const project = readProjectSkills(projectId);

  if (agentType === 'claude') {
    const commandsDir = path.join(tempDir, '.claude', 'commands');
    fs.mkdirSync(commandsDir, { recursive: true });
    if (common) fs.writeFileSync(path.join(commandsDir, 'plangent-common.md'), common);
    if (project) fs.writeFileSync(path.join(commandsDir, 'plangent-project.md'), project);
  } else if (agentType === 'codex') {
    const parts = [common, project].filter(Boolean);
    if (parts.length > 0) {
      fs.writeFileSync(path.join(tempDir, 'AGENTS.md'), parts.join('\n\n---\n\n'));
    }
  }

  return tempDir;
}

export function cleanupTempSkills(): void {
  if (fs.existsSync(TEMP_BASE)) {
    fs.rmSync(TEMP_BASE, { recursive: true, force: true });
    fs.mkdirSync(TEMP_BASE, { recursive: true });
  }
}

export function initDefaultSkills(): void {
  fs.mkdirSync(SKILLS_DIR, { recursive: true });
  fs.mkdirSync(path.join(SKILLS_DIR, 'projects'), { recursive: true });

  const commonPath = getCommonSkillsPath();
  if (!fs.existsSync(commonPath)) {
    fs.writeFileSync(commonPath, DEFAULT_COMMON_SKILLS);
  }
}

const DEFAULT_COMMON_SKILLS = `# Plangent — общие инструкции

## Работа с планом

Перед началом работы прочитай файл PLAN.md в корне проекта (если он есть).
После выполнения каждого шага:
1. Отметь его выполненным: замени \`- [ ]\` на \`- [x]\`
2. Сохрани обновлённый PLAN.md

## Формат плана

\`\`\`markdown
# План: [название задачи]

- [x] Выполненный шаг
- [ ] Невыполненный шаг
- [ ] Ещё один шаг
\`\`\`

## Завершение работы

Когда все шаги выполнены или ты прерываешься, убедись что PLAN.md сохранён с актуальным состоянием.
Напиши краткое резюме: что сделано, что осталось и почему остановился.
`.trim();
