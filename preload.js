/**
 * SES Desktop - Electron Preload Script
 * 
 * Exposes safe APIs to renderer process via contextBridge
 */

const { contextBridge, ipcRenderer } = require('electron');

// ============================================
// Exposed APIs
// ============================================

contextBridge.exposeInMainWorld('electronAPI', {
  // File System
  fs: {
    readFile: (filepath) => ipcRenderer.invoke('fs:readFile', filepath),
    writeFile: (filepath, content) => ipcRenderer.invoke('fs:writeFile', filepath, content),
    readDir: (dirpath) => ipcRenderer.invoke('fs:readDir', dirpath)
  },

  // System Info
  system: {
    getInfo: () => ipcRenderer.invoke('system:getInfo')
  },

  // Clipboard
  clipboard: {
    read: () => ipcRenderer.invoke('clipboard:read'),
    write: (text) => ipcRenderer.invoke('clipboard:write', text),
    onChange: (callback) => {
      ipcRenderer.on('clipboard:changed', (event, data) => callback(data));
    }
  },

  // Window Controls
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close')
  },

  // Event Listeners
  on: {
    fileCreated: (callback) => {
      ipcRenderer.on('file:created', (event, filepath) => callback(filepath));
    },
    fileModified: (callback) => {
      ipcRenderer.on('file:modified', (event, filepath) => callback(filepath));
    },
    fileDeleted: (callback) => {
      ipcRenderer.on('file:deleted', (event, filepath) => callback(filepath));
    },
    shortcutQuickCapture: (callback) => {
      ipcRenderer.on('shortcut:quickCapture', () => callback());
    },
    shortcutSwitchContext: (callback) => {
      ipcRenderer.on('shortcut:switchContext', () => callback());
    }
  }
});

console.log('✅ Electron preload script loaded');
