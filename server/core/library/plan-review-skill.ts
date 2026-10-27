import { readItemContent } from './library-manager';
import { getLibraryItem, libraryItemsFor, libraryOrigin } from './index';
import { getProject } from '../projects';
import type { LibraryOrigin } from './index';

export const DEFAULT_PLAN_REVIEW_SKILL = `# Ревью плана
1. Проверь, что шаги не противоречат друг другу и материалам анализа.
2. Проверь исполнимость порядка: после шага N есть всё необходимое для шага N+1, нет зависимостей от будущих шагов. Параллельные шаги не должны пересекаться по изменяемым файлам.
3. Сопоставь каждое требование анализа с шагами плана. Найди непокрытые требования и лишние работы, не следующие из материалов задачи.
4. Проверь проверяемость каждого шага: из описания должно быть понятно, когда он выполнен.
Обосновывай замечания конкретными шагами и материалами. Предлагай исправление, когда оно понятно.`;

export const PLAN_REVIEW_SKILL_AUTHORING = 'A plan-review-skill (type "plan-review-skill") defines what to check when reviewing a task plan against its analysis: contradictions, executable order, parallel file overlap, requirement coverage, unnecessary work and verifiable completion criteria. ' +
  'It applies at project, group or global level and is never synced to agent folders. The description is a one-line picker summary, not an invocation trigger. Plangent defines the output protocol; do not put an output format in the skill.';

export interface PlanReviewSkill { id: string; title: string; description: string; origin: LibraryOrigin }

export function planReviewSkills(projectId: string): PlanReviewSkill[] {
  const project = getProject(projectId);
  if (!project) return [];
  const order = { direct: 0, group: 1, global: 2 };
  return libraryItemsFor(project, 'plan-review-skill').filter(item => item.enabled)
    .sort((a, b) => order[a.origin] - order[b.origin])
    .map(item => ({ id: item.id, title: item.title, description: item.description, origin: item.origin }));
}

export function resolvePlanReviewSkill(projectId: string, skillId?: string | null): { id: string | null; title: string; content: string } {
  const project = getProject(projectId);
  const chosen = skillId ? getLibraryItem(skillId) : null;
  const item = chosen && chosen.type === 'plan-review-skill' && chosen.enabled && project && libraryOrigin(chosen, project) ? chosen
    : (() => { const first = planReviewSkills(projectId)[0]; return first ? getLibraryItem(first.id) : null; })();
  return item ? { id: item.id, title: item.title, content: readItemContent(item) }
    : { id: null, title: 'Стандартный', content: DEFAULT_PLAN_REVIEW_SKILL };
}
