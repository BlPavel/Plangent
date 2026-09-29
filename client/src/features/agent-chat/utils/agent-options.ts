import type { SelectOption } from '@shared/ui/AppSelect.vue'

/** What an ACP agent reports about itself: `configOptions` (current spec) or the older `modes`/`models`. */
export interface AgentOptionsSource {
  configOptions?: RawConfigOption[] | null
  modes?: { currentModeId?: string; availableModes: { id: string; name: string; description?: string | null }[] } | null
  models?: { currentModelId?: string; availableModels: { modelId: string; name: string; description?: string | null }[] } | null
}
interface RawChoice { value: string; name: string; description?: string | null; options?: RawChoice[] }
interface RawConfigOption { id: string; name?: string; category?: string | null; type?: string; currentValue?: string; options?: RawChoice[] }

/** One selector in the composer: `kind` decides which server action changes it. */
export interface AgentSelect {
  kind: 'mode' | 'model' | 'config'
  configId: string
  category: string
  heading: string
  prefix?: string
  current: string
  options: SelectOption[]
}

// Modes that skip permission prompts would bypass Plangent's own policy, so they are never offered.
export const isBypassMode = (id: string) => /bypass|full.?access|yolo|dangerous/i.test(id)

const RU: Record<string, Record<string, [string, string]>> = {
  mode: {
    default: ['Обычный', 'Спрашивает разрешение перед изменениями — ответ даёт настройка «Разрешения»'],
    acceptEdits: ['Сам принимает правки', 'Правит файлы без вопросов, остальное — с разрешения'],
    plan: ['Обсуждение (план)', 'Только изучает код и предлагает план, ничего не меняя'],
    auto: ['Авто', 'Агент сам решает, что безопасно делать без вопросов'],
    'read-only': ['С подтверждением', 'Спрашивает перед правками и командами'],
    agent: ['Агент', 'Спрашивает только про потенциально опасные действия'],
  },
  collaboration_mode: {
    default: ['Сразу к делу', 'Агент сразу выполняет задачу'],
    plan: ['Сначала план', 'Агент сначала составляет план и согласует его с вами'],
  },
  thought_level: {
    default: ['По умолчанию', 'Уровень, который агент выбирает сам'],
    low: ['Низкая', 'Быстрые ответы, меньше рассуждений'],
    medium: ['Средняя', 'Баланс скорости и глубины'],
    high: ['Высокая', 'Глубже думает над сложными задачами'],
    xhigh: ['Очень высокая', 'Для очень сложных задач: медленнее, больше расход лимита'],
    max: ['Максимальная', 'Самые трудные задачи, максимальный расход лимита'],
    ultra: ['Ультра', 'Максимум рассуждений с автоматической разбивкой задачи'],
  },
}
const HEADINGS: Record<string, [string, string?]> = {
  mode: ['Режим — как агент ведёт себя в работе: сразу действует, сам принимает правки или только обсуждает'],
  model: ['Модель, которая отвечает в этом чате'],
  thought_level: ['Глубина рассуждений: выше — тщательнее, но медленнее и расходует больше лимита', 'Рассуждения'],
  collaboration_mode: ['Планирование: работать сразу или сначала согласовать план', 'План'],
}
const HIDDEN = new Set(['model_config']) // e.g. "fast mode": pricier, rarely wanted per chat

function choice(category: string, c: { value: string; name: string; description?: string | null }): SelectOption {
  const ru = RU[category]?.[c.value]
  if (ru) return { value: c.value, label: ru[0], description: ru[1] }
  // Agent-provided names like "Opus 5.5 · Best for everyday tasks": split into label and hint.
  const [head, ...rest] = (c.description ?? '').split(' · ')
  return category === 'model' && rest.length ? { value: c.value, label: head, description: rest.join(' · ') } : { value: c.value, label: c.name, description: c.description ?? undefined }
}

export function agentSelects(source: AgentOptionsSource | null | undefined): AgentSelect[] {
  if (!source) return []
  const selects: AgentSelect[] = []
  for (const o of source.configOptions ?? []) {
    const category = o.category ?? o.id
    if (HIDDEN.has(category) || (o.type && o.type !== 'select')) continue
    const flat = (o.options ?? []).flatMap(c => c.options ?? [c]).filter(c => category !== 'mode' || !isBypassMode(c.value))
    if (!flat.length) continue
    const [heading, prefix] = HEADINGS[category] ?? [o.name ?? category]
    selects.push({ kind: category === 'mode' ? 'mode' : category === 'model' ? 'model' : 'config', configId: o.id, category, heading, prefix, current: o.currentValue ?? '', options: flat.map(c => choice(category, c)) })
  }
  if (!selects.some(s => s.category === 'mode') && source.modes?.availableModes?.length) {
    selects.push({ kind: 'mode', configId: 'mode', category: 'mode', heading: HEADINGS.mode[0], current: source.modes.currentModeId ?? '',
      options: source.modes.availableModes.filter(m => !isBypassMode(m.id)).map(m => choice('mode', { value: m.id, name: m.name, description: m.description })) })
  }
  if (!selects.some(s => s.category === 'model') && source.models?.availableModels?.length) {
    selects.push({ kind: 'model', configId: 'model', category: 'model', heading: HEADINGS.model[0], current: source.models.currentModelId ?? '',
      options: source.models.availableModels.map(m => choice('model', { value: m.modelId, name: m.name, description: m.description })) })
  }
  const order = ['mode', 'model', 'thought_level']
  return selects.sort((a, b) => (order.indexOf(a.category) + 1 || 9) - (order.indexOf(b.category) + 1 || 9))
}

/** Model and reasoning-depth choices, for pickers that only set these two (task queue, agent defaults). */
export function modelAndEffort(source: AgentOptionsSource | { error: string } | null | undefined): { models: SelectOption[]; efforts: SelectOption[] } {
  const selects = source && !('error' in source) ? agentSelects(source) : []
  return {
    models: selects.find(s => s.kind === 'model')?.options ?? [],
    efforts: selects.find(s => s.category === 'thought_level')?.options ?? [],
  }
}

export interface PlanToggle { select: AgentSelect; active: boolean; off: string }

/**
 * Pulls "plan first" out into a toggle: Codex exposes it as its own option (collaboration_mode),
 * Claude as one of its modes. `lastMode` is the mode to return to when plan is switched off.
 */
export function splitPlan(selects: AgentSelect[], lastMode = ''): { selects: AgentSelect[]; plan: PlanToggle | null } {
  const has = (s: AgentSelect, v: string) => s.options.some(o => o.value === v)
  const collab = selects.find(s => s.category === 'collaboration_mode' && has(s, 'plan'))
  if (collab) {
    return { selects: selects.filter(s => s !== collab), plan: { select: collab, active: collab.current === 'plan', off: collab.options.find(o => o.value !== 'plan')?.value ?? 'default' } }
  }
  const mode = selects.find(s => s.kind === 'mode' && has(s, 'plan'))
  if (!mode) return { selects, plan: null }
  const rest = mode.options.filter(o => o.value !== 'plan')
  const off = [lastMode, 'default'].find(v => v && v !== 'plan' && rest.some(o => o.value === v)) ?? rest[0]?.value ?? 'default'
  const shown = { ...mode, options: rest, current: mode.current === 'plan' ? off : mode.current }
  return { selects: selects.map(s => (s === mode ? shown : s)), plan: { select: mode, active: mode.current === 'plan', off } }
}

/** Plangent's own answer to the agent's permission requests — independent of the agent's mode. */
export const POLICY_HEADING = 'Разрешения — как Plangent отвечает, когда агент просит разрешение'
export const POLICIES: SelectOption[] = [
  { value: 'ask', label: 'Спрашивать', description: 'Вы подтверждаете каждую правку и команду' },
  { value: 'allow-edits', label: 'Разрешать правки', description: 'Правки файлов проходят сами, команды — с подтверждением' },
  { value: 'allow-all', label: 'Без вопросов', description: 'Разрешено всё, кроме опасных команд (rm -rf, force push…) — о них спросим' },
  { value: 'read-only', label: 'Только чтение', description: 'Агент может только читать и искать; правки и команды отклоняются' },
]
