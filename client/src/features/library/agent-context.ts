import type { InjectionKey } from 'vue'

/**
 * Whoever hosts the librarian chat (the project's «Инструкции», the global settings) provides this;
 * editors and lists show «Изменить с агентом» only when it is there.
 */
export interface LibraryAgent {
  /** Opens the chat; `request` pre-fills what the developer wants to change. */
  open: (request: string) => void
}
export const libraryAgentKey: InjectionKey<LibraryAgent> = Symbol('library-agent')

/** Provided as `true` by a page that already shows the title of the text above the editor. */
export const pageTitledKey: InjectionKey<boolean> = Symbol('page-titled')
