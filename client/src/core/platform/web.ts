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
  async getClipboardImage() {
    if (!navigator.clipboard?.read) return null
    try {
      const items = await navigator.clipboard.read()
      for (const item of items) {
        const type = item.types.find(t => t.startsWith('image/'))
        if (!type) continue
        const blob = await item.getType(type)
        return await blobToDataUrl(blob)
      }
    } catch {
      // Clipboard access may be denied outside a user gesture.
    }
    return null
  },
  async getClipboardText() {
    if (!navigator.clipboard?.readText) return ''
    try {
      return await navigator.clipboard.readText()
    } catch {
      return ''
    }
  },
  async setClipboardText(text: string) {
    if (!navigator.clipboard?.writeText) return
    await navigator.clipboard.writeText(text)
  },
  canAccessFiles: false,
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}
