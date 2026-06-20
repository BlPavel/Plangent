import { app, BrowserWindow, shell } from 'electron';
import path from 'path';
import http from 'http';

const isDev = !app.isPackaged;
const PORT = 3000;
let mainWindow: BrowserWindow | null = null;

function waitForServer(): Promise<void> {
  return new Promise((resolve) => {
    const attempt = () => {
      const req = http.get(`http://localhost:${PORT}/api/health`, () => resolve());
      req.on('error', () => setTimeout(attempt, 200));
      req.setTimeout(500, () => { req.destroy(); setTimeout(attempt, 200); });
    };
    attempt();
  });
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    // Dev: server + vite already running via `npm run electron:dev`
    await waitForServer();
    mainWindow.loadURL('http://localhost:5173');
  } else {
    // Prod: start compiled server, wait for it, load
    require(path.join(app.getAppPath(), 'dist', 'index.js'));
    await waitForServer();
    mainWindow.loadURL(`http://localhost:${PORT}`);
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
