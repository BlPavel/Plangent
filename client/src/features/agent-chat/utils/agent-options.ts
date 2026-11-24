import type { SelectOption } from '@shared/ui/AppSelect.vue'

import type { AgentOptionsSource } from '@contracts'
export type { AgentOptionsSource } from '@contracts'

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
    'workspace-write': ['Правки в проекте', 'Правит файлы проекта без вопросов, остальное — с разрешения'],
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

const PROVIDER_MODEL = /^(?:deepseek-flash|glm-[\w.-]+|kimi-[\w.-]+|k\d[\w.-]*)(?:\[1m\])?$/i

/** Third-party Claude presets expose provider models through Claude role aliases. Keep one wire choice per real model. */
function providerModelSelect(select: AgentSelect): AgentSelect {
  if (select.kind !== 'model') return select
  const entries = select.options.map(option => {
    const role = option.label.match(/^((?:deepseek-flash|glm-[\w.-]+|kimi-[\w.-]+|k\d[\w.-]*)(?:\[1m\])?) \(([^)]+)\)$/i)
    const described = option.description?.trim()
    const model = role?.[1] ?? (described && PROVIDER_MODEL.test(described) ? described : PROVIDER_MODEL.test(option.label) ? option.label : '')
    return { option, model, role: role?.[2].toLowerCase() ?? '' }
  })
  const roles = new Set(entries.filter(e => e.model && e.role).map(e => e.role))
  // Match the explicit role mapping, not merely an agent that also offers one of these providers.
  if (!roles.has('opus') || !roles.has('sonnet')) return select
  const groups = new Map<string, { model: string; entries: typeof entries }>()
  for (const entry of entries.filter(e => e.model)) {
    const key = entry.model.replace(/\[1m\]$/i, '').toLowerCase()
    const group = groups.get(key)
    if (group) {
      group.entries.push(entry)
      if (entry.model.endsWith('[1m]')) group.model = entry.model
    } else groups.set(key, { model: entry.model, entries: [entry] })
  }
  const options = [...groups.values()].map(({ model, entries }) => {
    // A default role alias is not a stable model id: prefer the explicit id, then a concrete role.
    const concrete = entries.filter(e => e.role || PROVIDER_MODEL.test(e.option.value) || PROVIDER_MODEL.test(e.option.label))
    const selected = concrete.find(e => e.option.value === select.current)
      ?? entries.find(e => e.option.value === model)
      ?? entries.find(e => e.option.value === model.replace(/\[1m\]$/i, ''))
      ?? concrete[0] ?? entries[0]
    const base = model.replace(/\[1m\]$/i, '')
    const label = base === 'deepseek-flash' ? 'DeepSeek Flash' : base.replace(/^glm-/i, 'GLM ').replace(/^kimi-k/i, 'Kimi K').replace(/^k(\d)/i, 'Kimi K$1').replace(/-pro$/i, ' Pro')
    return { value: selected.option.value, label, ...(model.endsWith('[1m]') ? { description: 'Контекст до 1 млн токенов' } : {}) }
  })
  const current = options.find(o => o.value === select.current)?.value ?? options[0]?.value ?? select.current
  return { ...select, current, options }
}

export function agentSelects(source: AgentOptionsSource | null | undefined): AgentSelect[] {
  if (!source) return []
  const selects: AgentSelect[] = []
  for (const o of source.configOptions ?? []) {
    const category = o.category ?? o.id
    if (HIDDEN.has(category) || (o.type && o.type !== 'select')) continue
    const flat = (o.options ?? []).flatMap(c => c.options ?? ('value' in c ? [c] : [])).filter(c => category !== 'mode' || !isBypassMode(c.value))
    if (!flat.length) continue
    const [heading, prefix] = HEADINGS[category] ?? [o.name ?? category]
    selects.push({ kind: category === 'mode' ? 'mode' : category === 'model' ? 'model' : 'config', configId: o.id, category, heading, prefix, current: typeof o.currentValue === 'string' ? o.currentValue : '', options: flat.map(c => choice(category, c)) })
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
  return selects.map(providerModelSelect).sort((a, b) => (order.indexOf(a.category) + 1 || 9) - (order.indexOf(b.category) + 1 || 9))
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
