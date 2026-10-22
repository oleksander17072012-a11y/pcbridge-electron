'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * The renderer gets a narrow, explicit API — no Node, no `require`, no arbitrary IPC.
 * The chat window uses its own web preferences and never receives this bridge.
 */
contextBridge.exposeInMainWorld('bridge', {
  snapshot: () => ipcRenderer.invoke('snapshot'),
  journalTail: (limit) => ipcRenderer.invoke('journalTail', limit),
  setActive: (active) => ipcRenderer.invoke('setActive', active),
  rotateKey: () => ipcRenderer.invoke('rotateKey'),
  pairingBundle: () => ipcRenderer.invoke('pairingBundle'),
  restartTunnel: () => ipcRenderer.invoke('restartTunnel'),
  refreshWindows: () => ipcRenderer.invoke('refreshWindows'),
  activateWindow: (hwnd) => ipcRenderer.invoke('activateWindow', hwnd),
  closeWindow: (hwnd) => ipcRenderer.invoke('closeWindow', hwnd),
  screenshot: () => ipcRenderer.invoke('screenshot'),
  openChat: () => ipcRenderer.invoke('openChat'),
  openChatBrowser: () => ipcRenderer.invoke('openChatBrowser'),
  chatIsOpen: () => ipcRenderer.invoke('chatIsOpen'),
  beginDrag: () => ipcRenderer.invoke('beginDrag'),
  elevate: () => ipcRenderer.invoke('elevate'),
  openDataDir: () => ipcRenderer.invoke('openDataDir'),
  quit: () => ipcRenderer.invoke('quit'),
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),

  onJournal: (callback) => {
    const listener = (_event, entry) => callback(entry);
    ipcRenderer.on('journal', listener);
    return () => ipcRenderer.removeListener('journal', listener);
  },
  onState: (callback) => {
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on('state', listener);
    return () => ipcRenderer.removeListener('state', listener);
  },
  onPulse: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('pulse', listener);
    return () => ipcRenderer.removeListener('pulse', listener);
  },
});
