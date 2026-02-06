/**
 * SES Desktop - Electron Main Process
 */

const { app, BrowserWindow, ipcMain, globalShortcut, clipboard } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const chokidar = require('chokidar');

// Set proper app name and data path
app.setName('SES Context OS');
const userDataPath = app.getPath('userData');

let mainWindow = null;
let fileWatcher = null;
let clipboardInterval = null;

// ============================================
// Window Management
// ============================================

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1a1a1a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      // Use app-specific partition to avoid conflicts
      partition: 'persist:ses-desktop'
    }
  });

  mainWindow.loadFile('index.html');

  // Open DevTools in development
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  console.log('✅ Window created');
  console.log(`📁 User data: ${userDataPath}`);
}

// ============================================
// App Lifecycle
// ============================================

app.whenReady().then(() => {
  createWindow();
  setupNativeIntegrations();
  registerGlobalShortcuts();
  setupIPC();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    cleanup();
    app.quit();
  }
});

app.on('will-quit', () => {
  cleanup();
});

// ============================================
// Native Integrations
// ============================================

function setupNativeIntegrations() {
  // File watcher
  startFileWatcher();

  // Clipboard monitor
  startClipboardMonitor();

  console.log('✅ Native integrations initialized');
}

function startFileWatcher() {
  const watchPaths = [
    path.join(app.getPath('home'), 'Documents'),
    path.join(app.getPath('home'), 'Desktop')
  ];

  fileWatcher = chokidar.watch(watchPaths, {
    ignored: /(^|[\/\\])\../, // ignore hidden files
    persistent: true,
    ignoreInitial: true,
    depth: 2 // limit depth to avoid too many files
  });

  fileWatcher
    .on('add', filepath => sendToRenderer('file:created', filepath))
    .on('change', filepath => sendToRenderer('file:modified', filepath))
    .on('unlink', filepath => sendToRenderer('file:deleted', filepath));

  console.log('📁 File watcher started');
}

function startClipboardMonitor() {
  let lastClipboard = '';

  clipboardInterval = setInterval(() => {
    const current = clipboard.readText();
    if (current && current !== lastClipboard) {
      lastClipboard = current;
      sendToRenderer('clipboard:changed', {
        text: current,
        timestamp: Date.now()
      });
    }
  }, 1000);

  console.log('📋 Clipboard monitor started');
}

function cleanup() {
  if (fileWatcher) {
    fileWatcher.close();
    fileWatcher = null;
  }

  if (clipboardInterval) {
    clearInterval(clipboardInterval);
    clipboardInterval = null;
  }

  globalShortcut.unregisterAll();
}

// ============================================
// Global Shortcuts
// ============================================

function registerGlobalShortcuts() {
  // Quick capture: Cmd/Ctrl + Shift + S
  globalShortcut.register('CommandOrControl+Shift+S', () => {
    sendToRenderer('shortcut:quickCapture');
  });

  // Switch context: Cmd/Ctrl + Shift + C
  globalShortcut.register('CommandOrControl+Shift+C', () => {
    sendToRenderer('shortcut:switchContext');
  });

  console.log('⌨️ Global shortcuts registered');
}

// ============================================
// IPC Handlers
// ============================================

function setupIPC() {
  // File operations
  ipcMain.handle('fs:readFile', async (event, filepath) => {
    try {
      const content = await fs.readFile(filepath, 'utf8');
      return { success: true, content };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('fs:writeFile', async (event, filepath, content) => {
    try {
      await fs.writeFile(filepath, content, 'utf8');
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('fs:readDir', async (event, dirpath) => {
    try {
      const entries = await fs.readdir(dirpath, { withFileTypes: true });
      const files = entries.map(entry => ({
        name: entry.name,
        path: path.join(dirpath, entry.name),
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile()
      }));
      return { success: true, files };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // System info
  ipcMain.handle('system:getInfo', async () => {
    return {
      platform: process.platform,
      arch: process.arch,
      version: process.version,
      home: app.getPath('home'),
      documents: app.getPath('documents'),
      desktop: app.getPath('desktop'),
      appData: app.getPath('appData'),
      userData: userDataPath
    };
  });

  // Clipboard
  ipcMain.handle('clipboard:read', () => {
    return clipboard.readText();
  });

  ipcMain.handle('clipboard:write', (event, text) => {
    clipboard.writeText(text);
    return true;
  });

  // Window controls
  ipcMain.on('window:minimize', () => {
    if (mainWindow) mainWindow.minimize();
  });

  ipcMain.on('window:maximize', () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    }
  });

  ipcMain.on('window:close', () => {
    if (mainWindow) mainWindow.close();
  });

  console.log('📡 IPC handlers registered');
}

// ============================================
// Helper Functions
// ============================================

function sendToRenderer(channel, data) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send(channel, data);
  }
}
