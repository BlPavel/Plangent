/** «Завершение работ» scenarios, as the settings, the task and the Code tab name them. */
export const FINISH_SCENARIOS = {
  nothing: { label: 'Ничего', hint: 'Plangent ничего не коммитит — изменения остаются в рабочей папке.' },
  commits: { label: 'Только коммиты', hint: 'Агент подготовит локальные коммиты. Без push.' },
  push: { label: 'Коммиты и push', hint: 'Создание коммитов и push в origin.' },
  full: { label: 'Полный цикл', hint: 'Создание коммитов, push и МР в целевую ветку.' },
} as const
export type FinishScenario = keyof typeof FINISH_SCENARIOS
export const finishScenarioLabels = Object.fromEntries(Object.entries(FINISH_SCENARIOS).map(([key, value]) => [key, value.label])) as Record<FinishScenario, string>
