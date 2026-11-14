import type { InjectionKey, Ref } from 'vue'
import type { AnalysisSection } from '@contracts'
export const AnalysisNavigationKey: InjectionKey<{ sections: Ref<AnalysisSection[]>; open: (target: string) => void }> = Symbol('analysisNavigation')
