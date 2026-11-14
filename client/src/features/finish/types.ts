import type { FinishOptions as ContractFinishOptions } from '@contracts';
export type { FinishOptions, FinishScenario as Scenario, FinishCommit, CommitMode, FinishMrDraft as MrDraft, FinishRun, FinishContext } from '@contracts';
/** Form values are populated before the user can submit them. */
export type FinishFormOptions = Required<Pick<ContractFinishOptions, 'includeDescription' | 'includeCoauthors' | 'coauthors' | 'targetBranch' | 'commitMode'>> & ContractFinishOptions;
export { finishScenarioLabels as scenarios } from './finish-scenarios'
export const stages: Record<string, string> = { branch: 'Ветка', commits: 'Коммиты', confirmation: 'Подтверждение', push: 'Push', mr: 'МР', done: 'Готово' }
export const statuses: Record<string, string> = { running: 'В работе', waiting: 'Ждёт подтверждения', error: 'Ошибка', complete: 'Выполнено', cancelled: 'Отменено' }
