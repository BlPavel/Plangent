import type { ElectronAPI } from '@contracts'
import type { PlatformBridge } from './types'

// The ONLY place in the frontend that reaches for window.electronAPI.
const electronAPI =
  typeof window !== 'undefined'
    ? (window as unknown as { electronAPI?: ElectronAPI<File> }).electronAPI
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
  // Shells older than the folder dialog fall back to the in-app browser.
  pickFolder: electronAPI?.pickFolder ? (defaultPath) => electronAPI!.pickFolder!(defaultPath) : undefined,
  // Shells older than the updater don't expose it.
  updates: electronAPI?.updates,
}

