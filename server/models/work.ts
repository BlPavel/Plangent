import type { Task, Workspace } from './index';
export type WorkGroup = 'attention' | 'working' | 'preparation' | 'done';
export type WorkStage = 'plan' | 'execution' | 'check' | 'finish' | 'done';
export interface WorkState {
  stage: WorkStage;
  status: 'draft' | 'preparing' | 'waiting' | 'running' | 'reviewing' | 'ready' | 'fixes' | 'finishing' | 'failed' | 'closed';
  group: WorkGroup;
  icon: '○' | '◌' | '❗' | '✓' | '✎' | '⇪' | '✔' | '🤖';
  text: string;
  action: 'plan' | 'queue' | 'chat' | 'check' | 'finish' | 'recreate' | 'reopen' | 'errand';
  actionLabel: string;
  hasBranch: boolean;
  agentWorking: boolean;
  counts: { steps: number; completed: number; remarks: number; waiting: number; agents: number };
}
export interface WorkEntry { task: Task; workspace: Workspace | null; state: WorkState }
