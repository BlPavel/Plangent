export type Scenario = 'nothing' | 'commits' | 'push' | 'full'
export interface FinishCommit { files: string[]; title: string; body?: string; sha?: string }
export type CommitMode = 'single' | 'split'
export interface FinishOptions { scenario: Scenario; task_id?: string; includeDescription: boolean; includeCoauthors: boolean; coauthors: { name: string; email: string }[]; targetBranch: string; branchName?: string; commitMode: CommitMode }
export interface FinishRun { id: string; project_id: string; task_id: string | null; scenario: Scenario; base_head: string; options: FinishOptions; stage: string; status: string; commits: FinishCommit[]; session_id: string | null; error: string; output: string; pushed: boolean; mr_url: string | null }
export interface FinishContext { diffs: Record<string, string>; changes: { path: string; originalPath?: string; status: string }[] }
export { finishScenarioLabels as scenarios } from '@shared/utils/finish-scenarios'
export const stages: Record<string, string> = { branch: 'Ветка', commits: 'Коммиты', confirmation: 'Подтверждение', push: 'Push', mr: 'МР', done: 'Готово' }
export const statuses: Record<string, string> = { running: 'В работе', waiting: 'Ждёт подтверждения', error: 'Ошибка', complete: 'Выполнено', cancelled: 'Отменено' }
