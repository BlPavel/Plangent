import { inject, provide, type InjectionKey } from 'vue'
import { useCodeStore } from './code'
import { useGitStore } from './git'

type CodeStore = ReturnType<typeof useCodeStore>
type GitStore = ReturnType<typeof useGitStore>
const codeKey: InjectionKey<CodeStore> = Symbol('code-store')
const gitKey: InjectionKey<GitStore> = Symbol('code-git-store')

/** The owner provides its stores; reused children follow that owner. */
export function provideCodeStores(code: CodeStore, git: GitStore) {
  provide(codeKey, code)
  provide(gitKey, git)
}

export const useCodeContext = () => inject(codeKey, null) ?? useCodeStore()
export const useGitContext = () => inject(gitKey, null) ?? useGitStore()
