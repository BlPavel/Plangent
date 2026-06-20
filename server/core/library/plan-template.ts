import { readItemContent } from './library-manager';
import { listLibraryItems } from './index';

export const PLAN_PROTOCOL_LOCKED = `## Протокол Plangent (не удалять)

Plangent отслеживает шаги плана по строкам-чекбоксам. Держи формат:

- Каждый шаг - отдельная строка вида \`- [ ] текст шага\`.
- \`[ ]\` - не сделано, \`[x]\` - сделано. Других статусов нет.
- Метки \`(pN)\` не трогай и не переименовывай - Plangent проставляет их сам.

Всё остальное в плане - заголовки, описания, примечания - свободный текст,
пиши как нужно. Не начинай строку-примечание с \`- [ ]\` или \`- [x]\`, иначе
она станет новым шагом.`;

export function resolvePlanTemplate(projectId: string): string {
  const projectTemplate = listLibraryItems({
    type: 'plan-template',
    scope: 'project',
    projectId,
    enabledOnly: true,
  })[0];
  if (projectTemplate) return readItemContent(projectTemplate);

  const globalTemplate = listLibraryItems({
    type: 'plan-template',
    scope: 'global',
    projectId: '',
    enabledOnly: true,
  })[0];
  if (globalTemplate) return readItemContent(globalTemplate);

  return '';
}
