import type { MaterialType } from './index';
import type { LibraryItemType } from '../../models';

/** Texts and library types of a preparation section; kept free of imports from the library to avoid cycles. */
export interface MaterialKind {
  templateType: LibraryItemType; reviewInstructionType: LibraryItemType; reviewSkillType: LibraryItemType;
  idPrefix: 'D' | 'Q'; title: string; defaultTemplate: string; protocol: string;
  defaultReviewInstruction: string; reviewSkillAuthoring: string;
}

const COMMON_PROTOCOL = (id: 'D' | 'Q', noun: string) => `## Протокол Plangent (не удалять)

Документ - свободный Markdown. Читай его через get_material, сохраняй полный текст только через submit_material
с версией, которую вернул get_material. Если документ изменён разработчиком, сохранение отклоняется:
перечитай документ и перенеси свои правки, ручную правку не затирай.

- Текст и просьба разработчика важнее шаблона: шаблон - подсказка для пустого документа, написанный набросок
  под него не перестраивай. Блоки шаблона можно объединять, опускать и менять.
- Если просят только оформить текст, смысл, решения и формулировки не меняй.
- Замеченные противоречия и пробелы называй в чате, а не исправляй молча.
- ${noun} можно пометить стабильным идентификатором: жирный \`**${id}1**\` в начале строки или заголовка, затем \`**${id}2**\` и так далее.
  Существующие идентификаторы не перенумеровывай и не переиспользуй; на них ссылаются план и замечания ревью.
- Ссылки на материалы анализа: [[раздел]] или [[раздел/файл]]; раздел и файл должны существовать.
- Схемы пиши текстом Mermaid в блоке кода \`\`\`mermaid. Схема изображает только написанное, без новых компонентов и связей.
- Готовность раздела отмечает только разработчик. Ты её не отмечаешь, а остановку работы готовностью не считай.`;

export const ARCHITECTURE_TEMPLATE = `# Архитектура

Мягкий набросок для пустого документа. Блоки можно объединять, опускать и менять; готовность не зависит от заполненности.

## Контекст и границы
Что меняется и что не затрагивается, откуда взяты требования (ссылки на анализ), какие проектные правила применимы.

## Компоненты и взаимодействия
Какие части затронуты и за что отвечают, основной поток, владение состоянием, ошибки и конкурентные операции, если важно.
Существующее отделяй от предлагаемого. Схему рисуй, только когда текста недостаточно.

## Решения и ограничения
**D1** Решение - причина и последствия.

## Исключения и открытые вопросы
Осознанные отступления от правил и то, что ещё не решено.

Не пересказывай проект, не перечисляй классы, не превращай документ в пошаговый план.`;

export const QA_TEMPLATE = `# QA

Мягкий набросок для пустого документа. Блоки можно объединять, опускать и менять; готовность не зависит от заполненности.

Критерий переводит требование в поведение, проверяемое кодом и автоматическими тестами:
условие, действие, ожидаемый результат, граница и основание (ссылка на анализ).

**Q1** Условие -> действие -> ожидаемый результат. Основание: [[раздел]].

Различай явное требование, предложение уточнения и открытый вопрос. Поведение, которого нет в материалах, не придумывай;
неоднозначность выноси вопросом. Правила устройства кода относятся к архитектуре, а не к QA.`;

const ARCHITECTURE_REVIEW = `# Architecture review
1. Check that the document follows the analysis materials and the current code. QA and the plan are not grounds for this review: they depend on the architecture.
2. Check the project's architectural rules: name the exact rule and the dependency that violates it. Explicit exceptions are allowed.
3. Check responsibility and data ownership of the affected components, error handling and concurrent operations where they matter.
4. Check that text and diagrams agree, component names are uniform, and existing parts are told apart from proposed ones.
5. Look for needless complication and for details that free interpretation would change.
Back every remark with a place of the document (decision id or quote), the code or the requirement, and the consequence. Keep violations apart from matters of taste.`;

const QA_REVIEW = `# QA review
1. Check that every criterion rests on the analysis materials and that no behaviour is invented. Find requirements without a criterion and criteria without a basis.
2. Check that ambiguities are raised as questions and are not decided silently; a strengthening of a requirement needs a decision.
3. Check that criteria agree with each other and with the ready architecture.
4. Check that boundaries, errors and expected results are exact and observable by code and automated tests.
Back every remark with a place of the document (criterion id or quote) and the source it conflicts with. Keep violations apart from suggestions.`;

export const MATERIAL_KINDS: Record<MaterialType, MaterialKind> = {
  architecture: {
    templateType: 'architecture-template', reviewInstructionType: 'architecture-review-instruction',
    reviewSkillType: 'architecture-review-skill', idPrefix: 'D', title: 'Архитектура', defaultTemplate: ARCHITECTURE_TEMPLATE,
    protocol: COMMON_PROTOCOL('D', 'Решение'), defaultReviewInstruction: ARCHITECTURE_REVIEW,
    reviewSkillAuthoring: 'An architecture-review-skill (type "architecture-review-skill") is the developer\'s rules for reviewing the architecture of a task in this project or group: module boundaries, allowed dependencies, ownership conventions. The general checks are given by the global review instruction, so do not repeat them. It is never synced to agent folders; the description is a one-line summary shown in the picker. Do not put an output format in the skill.',
  },
  qa: {
    templateType: 'qa-template', reviewInstructionType: 'qa-review-instruction', reviewSkillType: 'qa-review-skill',
    idPrefix: 'Q', title: 'QA', defaultTemplate: QA_TEMPLATE, protocol: COMMON_PROTOCOL('Q', 'Критерий'),
    defaultReviewInstruction: QA_REVIEW,
    reviewSkillAuthoring: 'A qa-review-skill (type "qa-review-skill") is the developer\'s domain rules for reviewing QA criteria of this project or group (for example "dates and times use the user\'s time zone"). The general checks are given by the global review instruction, so do not repeat them. It is never synced to agent folders; the description is a one-line summary shown in the picker. Do not put an output format in the skill.',
  },
};
