import { LIBRARY_SECTIONS } from '../../../../../common/library-registry'
export type SettingsTab = keyof typeof LIBRARY_SECTIONS.global | 'agents' | 'connections' | 'notes'

export interface SettingsNavItem { id: string; label: string; tab?: SettingsTab; children?: { tab: SettingsTab; label: string }[] }

/** Sections with children expand in the navigation; the rest open straight away. */
export const SETTINGS_NAV: SettingsNavItem[] = [
  { id: 'agents', label: 'Агенты', tab: 'agents' },
  { id: 'connections', label: 'Подключения', tab: 'connections' },
  {
    id: 'instructions', label: 'Инструкции',
    children: [
      { tab: 'skills', label: LIBRARY_SECTIONS.global['skills'].title },
      { tab: 'instruction-guide', label: LIBRARY_SECTIONS.global['instruction-guide'].title },
      { tab: 'code-fixer', label: LIBRARY_SECTIONS.global['code-fixer'].title },
      { tab: 'commit-rules', label: LIBRARY_SECTIONS.global['commit-rules'].title },
      { tab: 'interview', label: LIBRARY_SECTIONS.global['interview'].title },
    ],
  },
  {
    id: 'planning', label: 'Планирование',
    children: [{ tab: 'plan-template', label: LIBRARY_SECTIONS.global['plan-template'].title }, { tab: 'plan-review', label: LIBRARY_SECTIONS.global['plan-review'].title }],
  },
  {
    id: 'architecture', label: 'Архитектура',
    children: [{ tab: 'architecture-template', label: LIBRARY_SECTIONS.global['architecture-template'].title }, { tab: 'architecture-review', label: LIBRARY_SECTIONS.global['architecture-review'].title }],
  },
  {
    id: 'qa', label: 'QA',
    children: [{ tab: 'qa-template', label: LIBRARY_SECTIONS.global['qa-template'].title }, { tab: 'qa-review', label: LIBRARY_SECTIONS.global['qa-review'].title }],
  },
  { id: 'mr-review', label: LIBRARY_SECTIONS.global['mr-review'].title, tab: 'mr-review' },
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
