import { contextBridge, webUtils } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  // Returns the real filesystem path for a File object (drag-drop, paste)
  getFilePath: (file: File): string => webUtils.getPathForFile(file),
});
