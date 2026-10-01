import { contextBridge, webUtils, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  notify: (title: string, body: string, target?: string) => ipcRenderer.send('agent:notify', { title, body, target }),
  onNotificationClick: (handler: (target: string) => void) => { ipcRenderer.on('notification:click', (_event, target: string) => handler(target)); },
  isElectron: true,
  // Returns the real filesystem path for a File object (drag-drop, paste)
  getFilePath: (file: File): string => webUtils.getPathForFile(file),
  // Real paths of files copied in Finder, read from the native pasteboard
  getClipboardFilePaths: (): Promise<string[]> => ipcRenderer.invoke('clipboard:file-paths'),
  // PNG data from the native clipboard, used when pasting screenshots.
  getClipboardImage: (): Promise<string | null> => ipcRenderer.invoke('clipboard:image'),
  getClipboardText: (): Promise<string> => ipcRenderer.invoke('clipboard:text'),
  setClipboardText: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:write-text', text),
  pickFolder: (defaultPath?: string): Promise<string | null> => ipcRenderer.invoke('dialog:pick-folder', defaultPath),
  updates: {
    getState: () => ipcRenderer.invoke('update:get-state'),
    onState: (handler: (state: unknown) => void) => { ipcRenderer.on('update:state', (_event, state) => handler(state)); },
    install: () => ipcRenderer.invoke('update:install'),
    openRelease: () => ipcRenderer.send('update:open-release'),
  },
});
