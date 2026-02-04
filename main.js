const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');

let mainWindow;

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      const openFile = getFileFromArgs(commandLine);
      if (openFile) {
        mainWindow.webContents.send('open-file', openFile);
      }
    }
  });

  app.whenReady().then(() => {
    createWindow();
    const openFile = getFileFromArgs(process.argv);
    if (openFile) {
      mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.webContents.send('open-file', openFile);
      });
    }
  });
}

function getFileFromArgs(args) {
    const file = args.find((arg, index) => {
        if (index === 0) return false;
        if (arg === '.') return false;
        if (arg.endsWith('main.js')) return false;
        if (arg.startsWith('-')) return false;
        return true;
    });
    return file || null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000', 
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false
    },
    icon: path.join(__dirname, 'icon.ico')
  });

  mainWindow.loadFile('index.html');
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.on('app-close', () => app.quit());
ipcMain.on('app-minimize', () => mainWindow.minimize());

ipcMain.on('app-maximize', () => {
    if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
    } else {
        mainWindow.maximize();
    }
});

// Обработчик диалога сохранения
ipcMain.handle('show-save-dialog', async (event, options) => {
    // Возвращает объект { canceled: boolean, filePath: string }
    return await dialog.showSaveDialog(mainWindow, options);
});