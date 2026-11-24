import type { AgentCliStatus } from '@contracts'
import { useAppStore } from '@core/stores/app'
import { settingsEndpoints } from '@features/settings'
import { agentsEndpoints } from './api'

export type AgentInstallMode = 'ask' | 'auto' | 'never'
export const DEFAULT_AGENT_INSTALL_MODE: AgentInstallMode = 'ask'

let cachedMode: AgentInstallMode | null = null

export async function getAgentInstallMode(force = false): Promise<AgentInstallMode> {
  if (cachedMode && !force) return cachedMode
  try {
    const saved = await settingsEndpoints.getSettingsByKey({ params: { key: 'agent_cli_install' } })
    const value = saved.value.trim()
    cachedMode = value === 'auto' || value === 'never' ? value : 'ask'
  } catch { cachedMode = 'ask' }
  return cachedMode
}

export async function saveAgentInstallMode(mode: AgentInstallMode): Promise<void> {
  await settingsEndpoints.putSettingsByKey({ params: { key: 'agent_cli_install' }, body: { value: mode } })
  cachedMode = mode
}

const HINTS: [RegExp, string][] = [
  [/opencode/i, 'opencode auth login'],
  [/claude/i, 'claude'],
  [/codex/i, 'codex login'],
  [/gemini/i, 'gemini'],
  [/qwen/i, 'qwen'],
  [/kimi/i, 'kimi'],
]

/** The interactive login command for agents that keep their own credentials. */
export function agentAuthHint(agent: { id?: string; name?: string; command?: string }): string {
  const text = [agent.id, agent.name, agent.command].filter(Boolean).join(' ')
  return HINTS.find(([pattern]) => pattern.test(text))?.[1] ?? ''
}

export function installCommand(status: AgentCliStatus): string {
  return status.package ? `npm install -g ${status.package}` : ''
}

function wait(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)) }

export interface EnsureAgentCliOptions {
  /** Ask the developer first (the "ask" policy). An explicit "Установить" click passes false. */
  confirm?: boolean
  onState?: (status: AgentCliStatus) => void
}

let app: ReturnType<typeof useAppStore> | null = null
const appStore = () => (app ??= useAppStore())

/**
 * Make sure the agent's CLI exists, installing it into Plangent's data folder when the saved policy allows.
 * Returns the final status; throws a user-facing error when it cannot be installed.
 */
export async function ensureAgentCli(agentId: string, options: EnsureAgentCliOptions = {}): Promise<AgentCliStatus> {
  let status = await agentsEndpoints.getAgentsByIdCli({ params: { id: agentId } })
  options.onState?.(status)
  if (status.installed) return status
  if (!status.installable || !status.package) {
    throw new Error(status.command === 'npx'
      ? 'Для запуска агента нужен Node.js/npm (npx). Установите Node.js и повторите.'
      : status.command
        ? `CLI «${status.command}» не установлен. Для него нет автоматической установки — установите вручную.`
        : 'У агента не задана команда запуска.')
  }

  // Another flow may already be installing; wait for it instead of asking or starting a second job.
  if (status.state !== 'installing') {
    const mode = await getAgentInstallMode()
    if (mode === 'never') throw new Error(`Автоустановка отключена. Установите вручную: ${installCommand(status)}`)
    if (mode === 'ask' && options.confirm !== false) {
      const ok = await appStore().confirm(
        `CLI «${status.command}» не установлен. Установить ${status.package} в данные Plangent?`,
        { confirmLabel: 'Установить' },
      )
      if (!ok) throw new Error('Установка отменена.')
    }
    status = await agentsEndpoints.postAgentsByIdCliInstall({ params: { id: agentId } })
    options.onState?.(status)
  }
  // The install runs in the server; poll until it finishes, fails or the CLI appears.
  for (let i = 0; i < 900; i++) {
    if (status.installed) return status
    if (status.state === 'error') throw new Error(status.error || 'Не удалось установить CLI агента.')
    if (status.state === 'done' && i > 0) throw new Error(`CLI установлен, но команда «${status.command}» не найдена. Проверьте PATH или укажите полный путь.`)
    await wait(1000)
    status = await agentsEndpoints.getAgentsByIdCli({ params: { id: agentId } })
    options.onState?.(status)
  }
  throw new Error('Установка CLI занимает слишком много времени.')
}
