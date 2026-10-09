import type { RepositoryInfo } from './types'
export interface GitTracking extends RepositoryInfo { upstream: string | null; ahead: number; behind: number; origin: string | null; busyReason: string }
export interface GitBranch { name: string; ref: string; remote: boolean }
export interface Coauthor { name: string; email: string }
export interface CommitInput { title: string; body: string; includeDescription: boolean; includeCoauthors: boolean; coauthors: Coauthor[] }
export interface MessageCheck { cleanedCoauthors?: Coauthor[]; message: string; cleaned: string; violations: { kind: 'forbidden' | 'format'; line: number; text: string; pattern: string }[] }
export interface GitPreferences { include_description: boolean; branch_template: string; base_branch: string }
