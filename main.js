const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false // Важно для локальных файлов и визуализатора
    },
    icon: path.join(__dirname, 'icon.ico')
  });

  mainWindow.loadFile('index.html');

  // Отправка файлов, если приложение открыто через "Открыть с помощью..."
  mainWindow.webContents.on('did-finish-load', () => {
    // Аргументы запуска (для Windows)
    if (process.platform === 'win32' && process.argv.length > 1) {
      const args = process.argv.slice(1).filter(arg => !arg.startsWith('--'));
      if (args.length > 0) {
        mainWindow.webContents.send('open-file-args', args);
      }
    }
  });
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine) => {
    // Если пытаются открыть второй экземпляр (например, кликнули на новый файл)
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      
      // Парсим файл из аргументов
      const args = commandLine.slice(2).filter(arg => !arg.startsWith('--')); // slice(2) для production build часто нужен
      if(args.length > 0) {
         mainWindow.webContents.send('open-file-args', args);
      }
    }
  });

  app.whenReady().then(createWindow);
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.on('app-close', () => app.quit());
ipcMain.on('app-minimize', () => mainWindow.minimize());
ipcMain.on('app-maximize', () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});