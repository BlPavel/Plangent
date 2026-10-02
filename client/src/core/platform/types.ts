// What the app needs from its host platform, expressed as capabilities —
// NOT as "are we running inside Electron". Feature code depends on this port;
// the only place that knows the actual runtime is ./index.ts, which picks an
// implementation.
export interface PlatformBridge {
  // System notification, shown only while the app window is not focused.
  // `target` is an app route opened when the notification is clicked (see onNotificationClick).
  notify?(title: string, body: string, target?: string): void
  onNotificationClick?(handler: (target: string) => void): void
  // Ask for permission to show notifications; call from a user gesture.
  requestNotifications?(): void
  // Real filesystem path for a File (e.g. drag-dropped from Finder), or null
  // when the platform can't resolve one (plain browser).
  getFilePath(file: File): string | null

  // Real filesystem paths of the files currently on the clipboard.
  getClipboardFilePaths(): Promise<string[]>

  // PNG image from the native clipboard, if one is available.
  getClipboardImage(): Promise<string | null>

  // Plain text currently stored in the clipboard.
  getClipboardText(): Promise<string>

  // Replace the clipboard contents with plain text.
  setClipboardText(text: string): Promise<void>

  // The system folder dialog; absent in a plain browser (FolderPicker browses through the server then).
  pickFolder?(defaultPath?: string): Promise<string | null>

  // True when the platform can resolve real native file paths locally.
  // Use this instead of an `isElectron` check — it asks about a capability,
  // not about the environment.
  readonly canAccessFiles: boolean

  // Self-update of the installed app; absent when the host can't update itself (browser).
  readonly updates?: AppUpdates
}

// Keep in sync with UpdateState in electron/updater.ts.
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
