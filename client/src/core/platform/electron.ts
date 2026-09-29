import type { PlatformBridge } from './types'

// Shape of the bridge exposed by electron/preload.ts. Declared locally (not as a
// global Window augmentation) so the Electron contract never leaks into the rest
// of the app's types.
interface ElectronAPI {
  notify: (title: string, body: string, target?: string) => void
  onNotificationClick: (handler: (target: string) => void) => void
  isElectron: true
  getFilePath: (file: File) => string
  getClipboardFilePaths: () => Promise<string[]>
  getClipboardImage: () => Promise<string | null>
  getClipboardText: () => Promise<string>
  setClipboardText: (text: string) => Promise<void>
}

// The ONLY place in the frontend that reaches for window.electronAPI.
const electronAPI =
  typeof window !== 'undefined'
    ? (window as unknown as { electronAPI?: ElectronAPI }).electronAPI
    : undefined

// Whether we're running inside the Electron shell. Used once, in ./index.ts.
export const isElectron = !!electronAPI

export const electronBridge: PlatformBridge = {
  notify: (title, body, target) => electronAPI!.notify(title, body, target),
  // Older shells (preload without the click channel) just focus the window.
  onNotificationClick: (handler) => electronAPI!.onNotificationClick?.(handler),
  getFilePath: (file) => electronAPI!.getFilePath(file) || null,
  getClipboardFilePaths: () => electronAPI!.getClipboardFilePaths(),
  getClipboardImage: () => electronAPI!.getClipboardImage(),
  getClipboardText: () => electronAPI!.getClipboardText(),
  setClipboardText: (text) => electronAPI!.setClipboardText(text),
  canAccessFiles: true,
}
