// What the app needs from its host platform, expressed as capabilities —
// NOT as "are we running inside Electron". Feature code depends on this port;
// the only place that knows the actual runtime is ./index.ts, which picks an
// implementation.
export interface PlatformBridge {
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

  // True when the platform can resolve real native file paths locally.
  // Use this instead of an `isElectron` check — it asks about a capability,
  // not about the environment.
  readonly canAccessFiles: boolean
}
