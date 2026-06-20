import type { PlatformBridge } from './types'
import { electronBridge, isElectron } from './electron'
import { webBridge } from './web'

// The single place in the frontend that knows which runtime we're in.
// After this line, no feature code references Electron or window.electronAPI.
export const platform: PlatformBridge = isElectron ? electronBridge : webBridge

export type { PlatformBridge } from './types'
