export type SettingsTab =
  | 'agents' | 'connections'
  | 'skills' | 'instruction-guide' | 'code-fixer' | 'commit-rules' | 'interview'
  | 'plan-template' | 'plan-review'
  | 'architecture-template' | 'architecture-review'
  | 'qa-template' | 'qa-review'
  | 'review-skills' | 'notes'

export interface SettingsNavItem { id: string; label: string; tab?: SettingsTab; children?: { tab: SettingsTab; label: string }[] }

/** Sections with children expand in the navigation; the rest open straight away. */
export const SETTINGS_NAV: SettingsNavItem[] = [
  { id: 'agents', label: 'Агенты', tab: 'agents' },
  { id: 'connections', label: 'Подключения', tab: 'connections' },
  {
    id: 'instructions', label: 'Инструкции',
    children: [
      { tab: 'skills', label: 'Скиллы' },
      { tab: 'instruction-guide', label: 'Руководство по инструкциям' },
      { tab: 'code-fixer', label: 'Агент доработки' },
      { tab: 'commit-rules', label: 'Коммиты' },
      { tab: 'interview', label: 'Уточняющее интервью' },
    ],
  },
  {
    id: 'planning', label: 'Планирование',
    children: [{ tab: 'plan-template', label: 'Шаблон плана' }, { tab: 'plan-review', label: 'Ревью плана' }],
  },
  {
    id: 'architecture', label: 'Архитектура',
    children: [{ tab: 'architecture-template', label: 'Как писать' }, { tab: 'architecture-review', label: 'Ревью' }],
  },
  {
    id: 'qa', label: 'QA',
    children: [{ tab: 'qa-template', label: 'Как писать' }, { tab: 'qa-review', label: 'Ревью' }],
  },
  { id: 'review-skills', label: 'Ревью МР', tab: 'review-skills' },
  { id: 'notes', label: 'Доработки', tab: 'notes' },
]

export const sectionOf = (tab: SettingsTab) => SETTINGS_NAV.find(item => item.children?.some(child => child.tab === tab))?.id

/** What the page header shows for a tab: the section name, with its parent when the tab sits inside one. */
export function settingsPage(tab: SettingsTab): { parent?: string; title: string } {
  for (const item of SETTINGS_NAV) {
    if (item.tab === tab) return { title: item.label }
    const child = item.children?.find(c => c.tab === tab)
    if (child) return { parent: item.label, title: child.label }
  }
  return { title: '' }
}
