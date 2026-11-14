import type { InjectionKey } from 'vue'
export interface DocumentLinks { exists: (target: string) => boolean; open: (target: string) => void; openLabel?: string; missingLabel?: string }
export const DocumentLinksKey: InjectionKey<DocumentLinks> = Symbol('documentLinks')
