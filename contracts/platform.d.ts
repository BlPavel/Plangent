export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'up-to-date' }
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'ready'; version: string }
  // Can't be installed in place: the developer downloads it from the release page.
  | { status: 'manual'; version: string; url: string }
  | { status: 'error'; message: string }

export interface AppUpdates {
  getState(): Promise<UpdateState>
  onState(handler: (state: UpdateState) => void): void
  // Quits the app, installs the downloaded update and starts the new version.
  install(): Promise<void>
  openRelease(): void
}

export interface ElectronAPI<FileType> {
  notify: (title: string, body: string, target?: string) => void
  onNotificationClick: (handler: (target: string) => void) => void
  isElectron: true
  getFilePath: (file: FileType) => string
  getClipboardFilePaths: () => Promise<string[]>
  getClipboardImage: () => Promise<string | null>
  getClipboardText: () => Promise<string>
  setClipboardText: (text: string) => Promise<void>
  pickFolder?: (defaultPath?: string) => Promise<string | null>
  updates?: AppUpdates
}


