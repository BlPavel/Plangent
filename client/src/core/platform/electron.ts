import type { PlatformBridge } from './types'

// Shape of the bridge exposed by electron/preload.ts. Declared locally (not as a
// global Window augmentation) so the Electron contract never leaks into the rest
// of the app's types.
interface ElectronAPI {
  isElectron: true
  getFilePath: (file: File) => string
  getClipboardFilePaths: () => Promise<string[]>
}

// The ONLY place in the frontend that reaches for window.electronAPI.
const electronAPI =
  typeof window !== 'undefined'
    ? (window as unknown as { electronAPI?: ElectronAPI }).electronAPI
    : undefined

// Whether we're running inside the Electron shell. Used once, in ./index.ts.
export const isElectron = !!electronAPI

export const electronBridge: PlatformBridge = {
  getFilePath: (file) => electronAPI!.getFilePath(file) || null,
  getClipboardFilePaths: () => electronAPI!.getClipboardFilePaths(),
  canAccessFiles: true,
}
