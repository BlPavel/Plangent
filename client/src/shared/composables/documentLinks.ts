import type { InjectionKey } from 'vue'
export interface DocumentLinks { exists: (target: string) => boolean; open: (target: string) => void }
export const DocumentLinksKey: InjectionKey<DocumentLinks> = Symbol('documentLinks')
