interface ElectronAPI {
  isElectron: true
  getFilePath: (file: File) => string
  getClipboardFilePaths: () => Promise<string[]>
}

interface Window {
  electronAPI?: ElectronAPI
}
