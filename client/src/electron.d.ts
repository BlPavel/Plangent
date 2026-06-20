interface ElectronAPI {
  isElectron: true
  getFilePath: (file: File) => string
}

interface Window {
  electronAPI?: ElectronAPI
}
