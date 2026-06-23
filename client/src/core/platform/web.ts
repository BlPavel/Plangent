import type { PlatformBridge } from './types'

// Plain-browser implementation: no native file access. Clipboard file paths are
// resolved server-side via the existing API route; drag-dropped files have no
// resolvable local path, so callers fall back to text/uri-list parsing.
export const webBridge: PlatformBridge = {
  getFilePath: () => null,
  async getClipboardFilePaths() {
    const res = await fetch('/api/clipboard/paths')
    const data = (await res.json()) as { paths?: string[] }
    return data.paths ?? []
  },
  canAccessFiles: false,
}
