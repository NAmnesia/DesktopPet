const { contextBridge, ipcRenderer } = require('electron');

// 渲染进程 <-> 主进程 的受限桥接（contextIsolation 开启）
contextBridge.exposeInMainWorld('petAPI', {
  // 配置
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (cfg) => ipcRenderer.invoke('config:save', cfg),
  onConfigChanged: (cb) => ipcRenderer.on('config:changed', (_e, cfg) => cb(cfg)),
  getProviders: () => ipcRenderer.invoke('providers:get'),
  getPersonas: () => ipcRenderer.invoke('personas:get'),

  // 窗口控制
  setHover: (hovering) => ipcRenderer.send('pet:hover', hovering),
  dragBegin: (ox, oy) => ipcRenderer.send('pet:dragbegin', { ox, oy }),
  dragMove: (x, y) => ipcRenderer.send('pet:dragmove', { bx: x, by: y }),
  dragEnd: (moved, x, y) => ipcRenderer.send('pet:dragend', { moved, x, y }),
  showContextMenu: () => ipcRenderer.send('pet:contextmenu'),
  openSettings: () => ipcRenderer.send('open:settings'),
  quit: () => ipcRenderer.send('app:quit'),
  onActionChat: (cb) => ipcRenderer.on('action:chat', () => cb()),

  // 角色
  listCharacters: () => ipcRenderer.invoke('characters:list'),
  getCharacterImage: (character, state) => ipcRenderer.invoke('chars:image', { character, state }),
  openCharactersFolder: () => ipcRenderer.invoke('chars:openfolder'),

  // 模型服务
  listModels: (baseUrl, apiKey) => ipcRenderer.invoke('models:list', { baseUrl, apiKey }),
  testConnection: (cfg) => ipcRenderer.invoke('test:connection', cfg),

  // 聊天
  sendChat: (messages) => ipcRenderer.send('chat:send', messages),
  abortChat: () => ipcRenderer.send('chat:abort'),
  onChatChunk: (cb) => ipcRenderer.on('chat:chunk', (_e, d) => cb(d)),
  onChatDone: (cb) => ipcRenderer.on('chat:done', (_e, d) => cb(d)),
  onChatError: (cb) => ipcRenderer.on('chat:error', (_e, d) => cb(d)),

  // 番茄钟
  getPomo: () => ipcRenderer.invoke('pomo:get'),
  startPomo: () => ipcRenderer.send('pomo:start'),
  stopPomo: () => ipcRenderer.send('pomo:stop'),
  onTimerState: (cb) => ipcRenderer.on('timer:state', (_e, s) => cb(s)),
  onReminderShow: (cb) => ipcRenderer.on('reminder:show', (_e, d) => cb(d)),
});
