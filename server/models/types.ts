export interface LayoutSlot {
  dir: string;
  global: string;
  file: string;
  asSkill?: boolean;
  asMerged?: boolean;
}

export interface LayoutProfile {
  skills?: LayoutSlot;
  commands?: LayoutSlot;
  main?: { file: string; global: string };
}

export interface Agent {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  skills_dir: string;
  skills_filename: string;
  layout_profile: LayoutProfile | null;
  active: boolean;
  created_at: string;
}

export interface ProjectConfig {
  extra_env?: Record<string, string>;
}

export interface Project {
  id: string;
  name: string;
  repo_path: string;
  default_agent_id: string | null;
  config: ProjectConfig;
  hide_from_git: boolean;
  created_at: string;
}

export interface Task {
  id: string;
  project_id: string;
  key: string;
  title?: string;
  description?: string;
  jira_url?: string;
  branch_name?: string;
  status: 'open' | 'in_progress' | 'done';
  created_at: string;
}

export interface Plan {
  id: string;
  task_id: string;
  content: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface PlanStep {
  text: string;
  done: boolean;
  index: number;
}

export interface Run {
  id: string;
  task_id: string;
  plan_id?: string;
  agent_id?: string;
  agent_name: string;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  completed_steps: string[];
  notes?: string;
  started_at: string;
  finished_at?: string;
}

export type LibraryItemType = 'skill' | 'command' | 'main';
export type LibraryScope = 'global' | 'project';

export interface LibraryItem {
  id: string;
  type: LibraryItemType;
  slug: string;
  title: string;
  description: string;
  scope: LibraryScope;
  project_id: string | null;
  frontmatter: Record<string, unknown>;
  agent_filter: string[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface LibraryOverride {
  item_id: string;
  agent_type: string;
  file_path: string;
}
