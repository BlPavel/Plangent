import { contextBridge, webUtils, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  // Returns the real filesystem path for a File object (drag-drop, paste)
  getFilePath: (file: File): string => webUtils.getPathForFile(file),
  // Real paths of files copied in Finder, read from the native pasteboard
  getClipboardFilePaths: (): Promise<string[]> => ipcRenderer.invoke('clipboard:file-paths'),
  // PNG data from the native clipboard, used when pasting screenshots.
  getClipboardImage: (): Promise<string | null> => ipcRenderer.invoke('clipboard:image'),
  getClipboardText: (): Promise<string> => ipcRenderer.invoke('clipboard:text'),
  setClipboardText: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:write-text', text),
});
