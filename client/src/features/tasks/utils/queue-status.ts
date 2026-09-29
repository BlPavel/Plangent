import type { OrchestratorQueueSession, QueueStatus } from '@core/models'

interface ChatLike { status: string; reason: string }

export interface SessionState {
  label: string
  /** .status-badge tone */
  tone: 'neutral' | 'open' | 'progress' | 'done' | 'danger'
  /** What the developer is asked for or why the session stopped. */
  detail?: string
  /** The developer has to do something for the queue to go on. */
  attention: boolean
  live: boolean
}

/**
 * One place that turns a queue session (plus its live agent chats) into what the UI shows.
 * The chat is the finer signal: a permission request or a question shows there first.
 */
export function sessionState(s: OrchestratorQueueSession, chat?: ChatLike, review?: ChatLike): SessionState {
  const asking = [review, chat].find(c => c?.status === 'waiting')
  switch (s.status) {
    case 'queued': return { label: 'В очереди', tone: 'neutral', attention: false, live: false }
    case 'stopped': return { label: 'Остановлен', tone: 'neutral', detail: 'Запустится снова вместе с очередью', attention: false, live: false }
    case 'complete': return { label: 'Готово', tone: 'done', attention: false, live: false }
    case 'failed': return { label: s.reason?.includes('Пропущен') ? 'Пропущен' : 'Ошибка', tone: 'danger', detail: s.reason, attention: false, live: false }
    case 'ready_for_execution':
      return { label: 'Ждёт команды', tone: 'progress', detail: 'Агент изучил шаги. Обсудите детали в чате или запустите выполнение.', attention: true, live: true }
    case 'waiting_for_developer':
      return { label: 'Нужна помощь', tone: 'progress', detail: asking?.reason || s.reason || 'Агент ждёт вашего ответа', attention: true, live: true }
  }
  if (asking) return { label: 'Нужна помощь', tone: 'progress', detail: asking.reason || 'Агент ждёт вашего ответа', attention: true, live: true }
  if (s.status === 'reviewing' && s.reviewSessionId) return { label: `Ревью · круг ${s.reviewRound ?? 1}`, tone: 'open', attention: false, live: true }
  if (s.status === 'reviewing') return { label: 'Изучает шаги', tone: 'open', attention: false, live: true }
  return { label: 'Выполняется', tone: 'open', attention: false, live: true }
}

/**
 * Each stage has a colour; a plan step queued in that stage is marked with the same colour,
 * so the step list and the queue read as one picture.
 */
const STAGE_COLORS = ['#58a6ff', '#bc8cff', '#3fb950', '#f0883e', '#f778ba', '#39c5cf', '#d29922']
export const stageColor = (index: number) => STAGE_COLORS[index % STAGE_COLORS.length]

export const MODE_OPTIONS = [
  { value: 'execute', label: 'Выполнить', description: 'Агент сразу делает шаги' },
  { value: 'review_first', label: 'Сначала обсудить', description: 'Агент изучает шаги без правок и ждёт вашей команды' },
]
export const POLICY_OPTIONS = [
  { value: 'allow-all', label: 'Автономно', description: 'Правки и команды в папке проекта — без вопросов' },
  { value: 'allow-edits', label: 'Только правки', description: 'Правки файлов — сами, команды — спрашивать' },
  { value: 'ask', label: 'Спрашивать всё', description: 'Каждое действие подтверждаете вы' },
]

export function queueStatusLabel(status: QueueStatus | undefined) {
  return ({ idle: 'Не запущена', running: 'Выполняется', paused: 'На паузе', stopped: 'Остановлена', finished: 'Выполнена', failed: 'Ошибка' } as Record<string, string>)[status ?? 'idle']
}

/** p2, p3, p4, p7 → "p2–p4, p7" */
export function pointsLabel(points: string[]) {
  const nums = points.map(p => Number(p.replace(/^p/i, '')))
  if (nums.some(n => !Number.isInteger(n))) return points.join(', ')
  const parts: string[] = []
  for (let i = 0; i < nums.length; i++) {
    let j = i
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++
    parts.push(j - i >= 2 ? `p${nums[i]}–p${nums[j]}` : nums.slice(i, j + 1).map(n => `p${n}`).join(', '))
    i = j
  }
  return parts.join(', ')
}
