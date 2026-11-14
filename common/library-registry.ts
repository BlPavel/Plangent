import type { LibraryItemType, LibraryScope } from '../contracts';

const levels: readonly LibraryScope[] = ['global', 'project'];
const global: readonly LibraryScope[] = ['global'];
function text(title: string, scopes = levels, editorTitle = title) { return { title, editorTitle, scopes, singlePerLevel: true, text: true as const }; }
function item(title: string, formTitle = title, listTitle = formTitle, singlePerLevel = false) { return { title, formTitle, listTitle, scopes: levels, singlePerLevel, text: false as const }; }

/** Shared policy only. Built-in content and installation belong to the server. */
export const LIBRARY_TYPES = {
  skill: item('скилл', 'Скилл', 'Скиллы'), command: item('команда', 'Команда', 'Команды'), main: item('main', 'Главный файл', 'Главный файл', true),
  'instruction-guide': text('руководство по инструкциям', levels, 'Руководство по инструкциям'),
  'code-fixer-instruction': text('Агент доработки'), 'commit-rules': text('правила коммитов', levels, 'Правила коммитов'),
  'plan-template': text('шаблон плана', levels, 'Шаблон плана'),
  'plan-review-instruction': text('ревью плана', levels, 'Ревью плана'), 'mr-review-instruction': text('ревью МР', levels, 'Ревью МР'),
  'interview-instruction': text('Уточняющее интервью', global),
  'architecture-template': text('Как писать архитектуру'), 'qa-template': text('Как писать QA'),
  'architecture-review-instruction': text('Ревью архитектуры'), 'qa-review-instruction': text('Ревью QA'),
  'review-skill': item('скилл ревью', 'Скилл ревью', 'Ревью МР'), 'plan-review-skill': item('скилл ревью плана', 'Ревью плана'),
  'architecture-review-skill': item('Ревью архитектуры'), 'qa-review-skill': item('Ревью QA'),
} satisfies Record<LibraryItemType, { title: string; editorTitle?: string; formTitle?: string; listTitle?: string; scopes: readonly LibraryScope[]; singlePerLevel: boolean; text: boolean }>;

/** The item form exposes lists/templates; other texts have dedicated editors. Order is UI order. */
export const LIBRARY_FORM_TYPES: LibraryItemType[] = ['skill', 'command', 'main', 'plan-template', 'review-skill',
  'architecture-template', 'qa-template', 'architecture-review-skill', 'qa-review-skill', 'plan-review-skill'];
export function libraryTypeLabel(type: LibraryItemType, usage: 'form' | 'list'): string {
  const definition = LIBRARY_TYPES[type];
  if ('formTitle' in definition) return usage === 'form' ? definition.formTitle : definition.listTitle;
  return definition.editorTitle;
}

export type TextInstructionType = { [K in LibraryItemType]: typeof LIBRARY_TYPES[K]['text'] extends true ? K : never }[LibraryItemType];
export const TEXT_INSTRUCTION_TYPES = (Object.keys(LIBRARY_TYPES) as LibraryItemType[]).filter(type => LIBRARY_TYPES[type].text) as TextInstructionType[];
export const isLibraryItemType = (type: string): type is LibraryItemType => Object.hasOwn(LIBRARY_TYPES, type);
export const isTextInstructionType = (type: string): type is TextInstructionType => isLibraryItemType(type) && LIBRARY_TYPES[type].text;
export const isGlobalOnlyType = (type: string): boolean => isLibraryItemType(type) && !LIBRARY_TYPES[type].scopes.includes('project');

function section<T extends LibraryItemType>(title: string, types: T[]) { return { title, types }; }
export const LIBRARY_SECTIONS = {
  global: {
    skills: section('Скиллы', ['skill']), 'instruction-guide': section('Руководство по инструкциям', ['instruction-guide']),
    'code-fixer': section('Агент доработки', ['code-fixer-instruction']), 'commit-rules': section('Коммиты', ['commit-rules']),
    'plan-template': section('Шаблон плана', ['plan-template']), 'architecture-template': section('Как писать', ['architecture-template']),
    'qa-template': section('Как писать', ['qa-template']), 'plan-review': section('Ревью плана', ['plan-review-instruction']),
    'mr-review': section('Ревью МР', ['mr-review-instruction']), 'architecture-review': section('Ревью', ['architecture-review-instruction']),
    'qa-review': section('Ревью', ['qa-review-instruction']), interview: section('Уточняющее интервью', ['interview-instruction']),
  },
  project: {
    items: section('Элементы', ['skill', 'command', 'main']),
    guide: section('Руководство для агента', ['instruction-guide']), fixer: section('Агент доработки', ['code-fixer-instruction']),
    commits: section('Коммиты', ['commit-rules']),
    'plan-template': section('Шаблон плана', ['plan-template']), 'architecture-template': section('Как писать', ['architecture-template']),
    'qa-template': section('Как писать', ['qa-template']),
    'mr-review': section('Ревью МР', ['mr-review-instruction']), 'plan-review': section('Ревью плана', ['plan-review-instruction']),
    'architecture-review': section('Ревью', ['architecture-review-instruction']), 'qa-review': section('Ревью', ['qa-review-instruction']),
  },
};
export function librarySection(scope: LibraryScope, id: string) {
  const sections: Record<string, { title: string; types: LibraryItemType[] }> = LIBRARY_SECTIONS[scope];
  return Object.hasOwn(sections, id) ? sections[id] : undefined;
}
export function librarySectionForType(scope: LibraryScope, type: LibraryItemType): string | undefined {
  return Object.entries(LIBRARY_SECTIONS[scope]).find(([, value]) => (value.types as readonly LibraryItemType[]).includes(type))?.[0];
}
