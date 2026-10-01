import { readItemContent } from './library-manager';
import { libraryItemsFor, listLibraryItems } from './index';
import { getProject } from '../projects';

export const PLAN_PROTOCOL_LOCKED = `## Протокол Plangent (не удалять)

Plangent отслеживает шаги плана по строкам-чекбоксам. Держи формат:

- Каждый шаг - отдельная строка вида \`- [ ] текст шага\`.
- \`[ ]\` - не сделано, \`[x]\` - сделано. Других статусов нет.
- У уже существующих шагов метку \`(pN)\` не трогай и не переименовывай.
- Для НОВОГО шага метку \`(pN)\` не пиши сам - оставь только \`- [ ] текст шага\`.
  Plangent присвоит номер по порядку автоматически, как только сохранишь файл.

Всё остальное в плане - заголовки, описания, примечания - свободный текст,
пиши как нужно. Не начинай строку-примечание с \`- [ ]\` или \`- [x]\`, иначе
она станет новым шагом.

Ссылки на материалы анализа добавляй в строку шага: [[раздел]] или [[раздел/файл]].
Используй slug раздела и точное имя файла из get_plan; ссылка должна существовать.`;

export function resolvePlanTemplate(projectId: string): string {
  const project = getProject(projectId);
  const templates = project
    ? libraryItemsFor(project, 'plan-template').filter(t => t.enabled)
    : listLibraryItems({ type: 'plan-template', projectId: '', enabledOnly: true }).map(t => ({ ...t, origin: 'global' as const }));
  // The closest level wins: the project itself, then its group, then the global template.
  const template = (['direct', 'group', 'global'] as const).map(origin => templates.find(t => t.origin === origin)).find(Boolean);
  return template ? readItemContent(template) : '';
}
