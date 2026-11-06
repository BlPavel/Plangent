import { LIBRARY_SECTIONS } from '../../../../../common/library-registry'
import type { NavTreeItem } from '@shared/ui'
export type SettingsTab = keyof typeof LIBRARY_SECTIONS.global | 'agents' | 'connections' | 'git-agents' | 'notes'

/** Sections with children expand in the navigation; the rest open straight away. Grouped like a project's settings. */
export const SETTINGS_NAV: NavTreeItem[] = [
  { id: 'agents', label: 'Агенты', page: 'agents' },
  { id: 'connections', label: 'Подключения', page: 'connections' },
  { id: 'git', label: 'Git', children: [{ page: 'git-agents', label: 'Агенты' }] },
  {
    id: 'instructions', label: 'Инструкции',
    children: [
      { page: 'skills', label: LIBRARY_SECTIONS.global['skills'].title },
      { page: 'instruction-guide', label: LIBRARY_SECTIONS.global['instruction-guide'].title },
      { page: 'code-fixer', label: LIBRARY_SECTIONS.global['code-fixer'].title },
      { page: 'commit-rules', label: LIBRARY_SECTIONS.global['commit-rules'].title },
      { page: 'interview', label: LIBRARY_SECTIONS.global['interview'].title },
    ],
  },
  {
    id: 'templates', label: 'Шаблоны',
    children: [{ page: 'plan-template', label: 'План' }, { page: 'architecture-template', label: 'Архитектура' }, { page: 'qa-template', label: 'QA' }],
  },
  {
    id: 'review', label: 'Ревью',
    children: [{ page: 'mr-review', label: 'Merge request' }, { page: 'plan-review', label: 'План' }, { page: 'architecture-review', label: 'Архитектура' }, { page: 'qa-review', label: 'QA' }],
  },
  { id: 'notes', label: 'Доработки', page: 'notes' },
]
