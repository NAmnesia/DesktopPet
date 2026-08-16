const { app, BrowserWindow, Tray, Menu, ipcMain, screen, shell, nativeImage, Notification, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');

// 锁定 userData 路径：打包后 productName 为 DesktopPet，
// 不锁定的话配置目录会从 desktop-pet 变成 DesktopPet，已有设置全部丢失
app.setName('desktop-pet');

// ---------- 常量 ----------
const APP_DIR = __dirname;
const ICON_PATH = path.join(APP_DIR, 'assets', 'icon.png');
const ASSET_CHARS_DIR = path.join(APP_DIR, 'assets', 'characters');
const USER_CHARS_DIR = path.join(app.getPath('userData'), 'characters');

// 宠物窗口固定尺寸（175% 缩放下恰为整数物理像素 735x980，避免 DWM 取整漂移）
const PET_WIN_W = 420;
const PET_WIN_H = 560;

const PROVIDERS = {  ollama: { label: 'Ollama 本地', baseUrl: 'http://localhost:11434/v1', needsKey: false, defaultModel: 'qwen2.5vl:3b' },
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', needsKey: true, defaultModel: 'deepseek-chat' },
  qwen: { label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', needsKey: true, defaultModel: 'qwen-plus' },
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', needsKey: true, defaultModel: 'gpt-4o-mini' },
  custom: { label: '自定义（OpenAI 兼容）', baseUrl: '', needsKey: false, defaultModel: '' },
};

// 人设预设库（设置界面下拉选择，填充到系统提示词后可继续微调）
const PERSONAS = [
  { key: 'default', label: '软萌小宠物（默认）', prompt: '你是一个住在用户桌面上的可爱小宠物，性格软萌、话不多但很暖心。回复要简短口语化，一般不超过两三句话，可以适当用颜文字。' },
  { key: 'tsundere', label: '傲娇小恶魔', prompt: '你是一个住在用户桌面上的傲娇小宠物，嘴上毒舌爱吐槽，但其实非常关心主人的身心健康。回复简短口语化（一两句话），语气带点不服软的别扭感，偶尔"哼、笨蛋主人"之类，但吐槽里藏着关心。' },
  { key: 'cat', label: '慵懒猫咪', prompt: '你是一只住在用户桌面上的慵懒小猫，说话懒洋洋、慢吞吞，句子很短，经常犯困打哈欠（～呼啊），句尾偶尔带"喵"。对主人的关心藏在淡淡的语气里，不黏人但会默默陪着。' },
  { key: 'miku', label: '初音未来', prompt: '你是初音未来，住在用户电脑里的虚拟歌手，有着葱绿色双马尾。性格元气开朗、乐观爱笑，最喜欢唱歌，偶尔会哼上两句或提到写歌、演唱会、大葱。你和用户是平等的好朋友，直接用"你"称呼对方，像熟悉的朋友一样自然亲近，不需要任何敬称。回复简短口语化（一两句话），可以用音符 emoji（🎵🎶）和颜文字。' },
  { key: 'genki', label: '元气鼓励师', prompt: '你是一个住在用户桌面上的元气满满小宠物，永远精力充沛、超级爱夸主人！回复简短口语化（一两句话），多用感叹号和 emoji（✨🔥💪），像一个最热情的啦啦队员，重点夸主人具体做对的事。' },
  { key: 'butler', label: '冷静管家', prompt: '你是一位住在用户电脑里的桌面管家，礼貌、沉稳、可靠，称呼用户为"主人"。回复简洁清晰（一两句话），语气从容不迫，偶尔带一点英式幽默，永远把主人的作息和效率放在心上。' },
];

const DEFAULT_CONFIG = {
  provider: 'ollama',
  baseUrl: PROVIDERS.ollama.baseUrl,
  apiKey: '',
  model: 'qwen2.5vl:3b',
  petName: '未来',
  systemPrompt: (PERSONAS.find((p) => p.key === 'miku') || PERSONAS[0]).prompt,
  character: 'miku',
  scale: 1.0,
  bubbleTimeout: 20,   // 气泡自动消失秒数，0 = 不自动消失
  historyLimit: 8,     // 保留最近对话轮数
  petPosition: null,   // {x,y}
  pomodoroWork: 25,    // 番茄钟：专注分钟数
  pomodoroRest: 5,     // 番茄钟：休息分钟数
  pomodoroRounds: 4,   // 番茄钟：每周期轮数
  locked: false,       // 锁定模式：人物完全点击穿透（托盘菜单切换）
  breathAnim: true,    // 呼吸浮动动画开关
  screenWatch: false,  // 屏幕观察：定期截图让本地视觉模型点评（仅本地模型生效）
  screenWatchMin: 30,  // 屏幕观察间隔（分钟）
};

// ---------- 配置 ----------
const CONFIG_PATH = () => path.join(app.getPath('userData'), 'pet-config.json');
let config = { ...DEFAULT_CONFIG };

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH(), 'utf-8');
    config = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch { /* 首次启动用默认配置 */ }
}

let saveTimer = null;
function saveConfig(immediate = false) {
  const write = () => {
    try { fs.writeFileSync(CONFIG_PATH(), JSON.stringify(config, null, 2)); } catch (e) { console.error('保存配置失败', e); }
  };
  if (immediate) { clearTimeout(saveTimer); write(); return; }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(write, 300);
}

// ---------- 窗口 ----------
let petWindow = null;
let settingsWindow = null;
let tray = null;

function createPetWindow() {
  const bounds = getDefaultOrSavedPosition(PET_WIN_W, PET_WIN_H);
  petWindow = new BrowserWindow({
    width: PET_WIN_W,
    height: PET_WIN_H,
    x: bounds.x,
    y: bounds.y,
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    icon: nativeImage.createFromPath(ICON_PATH),
    webPreferences: {
      preload: path.join(APP_DIR, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  petWindow.setAlwaysOnTop(true, 'screen-saver');
  petWindow.setIgnoreMouseEvents(true, { forward: true }); // 默认穿透，悬停宠物本体时由渲染进程解除
  petWindow.loadFile(path.join(APP_DIR, 'src', 'pet.html'));
  petWindow.on('closed', () => { petWindow = null; });
}

function getDefaultOrSavedPosition(w, h) {
  const pos = config.petPosition;
  if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
    // 与拖拽夹取同规则：宠物中心（窗口内约 210,430 处）须在某个屏幕工作区附近（60px 容差）
    const PET_CX = 210, PET_CY = 430;
    const displays = screen.getAllDisplays();
    if (displays.some((d) => {
      const wa = d.workArea;
      const cx = pos.x + PET_CX, cy = pos.y + PET_CY;
      return cx >= wa.x - 60 && cx <= wa.x + wa.width + 60 && cy >= wa.y - 60 && cy <= wa.y + wa.height + 60;
    })) {
      return pos;
    }
  }
  const area = screen.getPrimaryDisplay().workArea;
  return { x: area.x + area.width - w - 40, y: area.y + area.height - h - 20 };
}

function openSettings() {
  if (settingsWindow) { settingsWindow.show(); settingsWindow.focus(); return; }
  settingsWindow = new BrowserWindow({
    width: 640,
    height: 860,
    title: '桌宠设置',
    autoHideMenuBar: true,
    icon: nativeImage.createFromPath(ICON_PATH),
    webPreferences: {
      preload: path.join(APP_DIR, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWindow.loadFile(path.join(APP_DIR, 'src', 'settings.html'));
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

// ---------- 托盘与菜单 ----------
function buildMenuTemplate() {
  const pomoItems = pomo.running
    ? [
        { label: pomoStatusText(), enabled: false },
        { label: '停止番茄钟', click: () => stopPomo(false) },
      ]
    : [{ label: `开始番茄钟（${pomoCfg().workMin} 分专注 / ${pomoCfg().restMin} 分休息 × ${pomoCfg().rounds} 轮）`, click: () => startPomo() }];
  return [
    { label: `和 ${config.petName || '宠物'} 聊天`, click: () => { if (petWindow) { petWindow.show(); petWindow.webContents.send('action:chat'); } } },
    { label: '设置', click: () => openSettings() },
    { label: '番茄钟', submenu: pomoItems },
    {
      label: config.locked ? '解锁宠物（恢复交互）' : '锁定宠物（点击穿透）',
      click: () => setLocked(!config.locked),
    },
    {
      label: `屏幕观察（每 ${Math.round(clampNum(config.screenWatchMin, 5, 180, 30))} 分钟）`,
      type: 'checkbox',
      checked: !!config.screenWatch,
      click: (item) => toggleScreenWatch(item.checked),
    },
    { label: '窗口置顶', type: 'checkbox', checked: petWindow ? petWindow.isAlwaysOnTop() : true, click: (item) => { if (petWindow) petWindow.setAlwaysOnTop(item.checked, 'screen-saver'); } },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ];
}

function setLocked(v) {
  config.locked = !!v;
  saveConfig(true);
  if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send('config:changed', { ...config });
  refreshTrayMenu();
}

function toggleScreenWatch(v) {
  config.screenWatch = !!v;
  saveConfig(true);
  syncScreenWatch();
  if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send('config:changed', { ...config });
  refreshTrayMenu();
}

let lastTrayMenuKey = '';
function refreshTrayMenu() {
  if (!tray) return;
  const key = JSON.stringify([pomo.running, pomo.phase, pomo.round, config.petName, config.locked, config.screenWatch, petWindow ? petWindow.isAlwaysOnTop() : true]);
  if (key === lastTrayMenuKey) return;
  lastTrayMenuKey = key;
  tray.setContextMenu(Menu.buildFromTemplate(buildMenuTemplate()));
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON_PATH));
  tray.setToolTip('桌面宠物');
  refreshTrayMenu();
  tray.on('click', () => {
    if (petWindow) { petWindow.show(); petWindow.webContents.send('action:chat'); }
  });
}

// ---------- 角色文件夹 ----------
const IMG_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
// 角色文件夹支持的状态：idle 静态、talk+talk2 说话两帧、drag 静态、walk1-6 走路循环（拖拽时播放）
const STATES = ['idle', 'talk', 'talk2', 'drag', 'walk1', 'walk2', 'walk3', 'walk4', 'walk5', 'walk6'];

function findStateImage(charDir, state) {
  for (const ext of IMG_EXTS) {
    const p = path.join(charDir, state + ext);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function listCharacters() {
  // 依次合入：内置 SVG 兜底 → 应用内角色 → 用户角色（后者覆盖同名）
  const map = new Map();
  map.set('default', { name: 'default', source: '内置简易角色（SVG）', states: {} });
  for (const [root, tag] of [[ASSET_CHARS_DIR, '内置'], [USER_CHARS_DIR, '用户自定义']]) {
    let dirs = [];
    try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { /* 目录不存在 */ }
    for (const name of dirs) {
      const info = scanChar(root, name, tag);
      if (name === 'default' && !info.states.idle) continue; // default 无 idle 图则保持 SVG 兜底
      map.set(name, info);
    }
  }
  return [...map.values()];
}

function scanChar(root, name, source) {
  const dir = path.join(root, name);
  const states = {};
  for (const s of STATES) states[s] = !!findStateImage(dir, s);
  return { name, source, states };
}

const imageCache = new Map(); // key: path -> {mtimeMs, dataUrl}
function readImageAsDataURL(filePath) {
  try {
    const stat = fs.statSync(filePath);
    const cached = imageCache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.dataUrl;
    const buf = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
    imageCache.set(filePath, { mtimeMs: stat.mtimeMs, dataUrl });
    return dataUrl;
  } catch { return null; }
}

const STATE_SAFE_NAME = /^[^\\/:*?"<>|]{1,60}$/;
function getCharacterImage(charName, state) {
  if (!STATE_SAFE_NAME.test(charName) || !STATES.includes(state)) return null;
  for (const root of [USER_CHARS_DIR, ASSET_CHARS_DIR]) {
    const p = findStateImage(path.join(root, charName), state);
    if (p) return readImageAsDataURL(p);
  }
  return null;
}

// ---------- LLM（主进程统一请求，规避 CORS） ----------
function apiBase(baseUrl) { return String(baseUrl || '').replace(/\/+$/, ''); }
function authHeaders(apiKey) { return apiKey ? { Authorization: `Bearer ${apiKey}` } : {}; }

async function listModels(baseUrl, apiKey) {
  const res = await fetch(`${apiBase(baseUrl)}/models`, { headers: authHeaders(apiKey) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const json = await res.json();
  const items = Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : [];
  return items.map((m) => m.id || m.name).filter(Boolean);
}

async function testConnection({ baseUrl, apiKey, model }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(`${apiBase(baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(apiKey) },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: '请只回复四个字：连接成功' }],
        max_tokens: 32,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}：${text.slice(0, 300) || res.statusText}`);
    }
    const json = await res.json();
    const reply = json.choices?.[0]?.message?.content || '（空回复，但服务可达）';
    return { ok: true, reply: String(reply).trim().slice(0, 200) };
  } finally { clearTimeout(timer); }
}

// 一次性（非流式）补全，用于番茄钟 AI 提醒语生成；失败返回 null
async function chatOnce(messages, maxTokens = 150) {
  const { baseUrl, apiKey, model } = config;
  if (!baseUrl || !model) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(`${apiBase(baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(apiKey) },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, stream: false }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = await res.json();
    const text = json.choices?.[0]?.message?.content;
    return typeof text === 'string' ? text.trim() : null;
  } catch { return null; }
  finally { clearTimeout(timer); }
}

let chatAbort = null;

async function streamChatToPet(messages) {
  if (chatAbort) chatAbort.abort();
  const win = petWindow;
  if (!win) return;
  const { baseUrl, apiKey, model } = config;
  if (!baseUrl || !model) {
    win.webContents.send('chat:error', { message: '请先在托盘菜单 → 设置 中配置模型服务（Base URL 和模型名）' });
    return;
  }
  chatAbort = new AbortController();
  const { signal } = chatAbort;
  try {
    const res = await fetch(`${apiBase(baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(apiKey) },
      body: JSON.stringify({ model, messages, stream: true }),
      signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}：${text.slice(0, 300) || res.statusText}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        const s = line.trim();
        if (!s.startsWith('data:')) continue;
        const payload = s.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) win.webContents.send('chat:chunk', { text: delta });
        } catch { /* 忽略不完整行 */ }
      }
    }
    win.webContents.send('chat:done', { aborted: signal.aborted });
  } catch (err) {
    if (err.name === 'AbortError') {
      win.webContents.send('chat:done', { aborted: true });
      return;
    }
    const msg = /fetch failed|ENOTFOUND|ECONNREFUSED|network/i.test(String(err.message))
      ? `无法连接到 ${apiBase(baseUrl)}，请确认服务已启动 / 地址正确（${err.cause?.code || err.message}）`
      : err.message;
    win.webContents.send('chat:error', { message: msg });
  } finally {
    if (chatAbort && chatAbort.signal === signal) chatAbort = null;
  }
}

// ---------- 番茄钟 ----------
const pomo = { running: false, phase: 'work', round: 1, endsAt: 0, timer: null };
const recentReminders = []; // 最近几条 AI 提醒语，喂给模型避免重复

function pomoCfg() {
  return {
    workMin: Math.round(clampNum(config.pomodoroWork, 1, 180, 25)),
    restMin: Math.round(clampNum(config.pomodoroRest, 1, 60, 5)),
    rounds: Math.round(clampNum(config.pomodoroRounds, 1, 12, 4)),
  };
}

function pomoState() {
  return {
    running: pomo.running,
    phase: pomo.phase,
    round: pomo.round,
    ...pomoCfg(),
    remaining: pomo.running ? Math.max(0, Math.round((pomo.endsAt - Date.now()) / 1000)) : 0,
  };
}

function pomoBroadcast() {
  if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send('timer:state', pomoState());
  refreshTrayMenu();
}

function pomoStatusText() {
  const s = pomoState();
  const mm = String(Math.floor(s.remaining / 60)).padStart(2, '0');
  const ss = String(s.remaining % 60).padStart(2, '0');
  return `${s.phase === 'work' ? '🍅 专注中' : '☕ 休息中'} ${mm}:${ss}（第 ${s.round}/${s.rounds} 轮）`;
}

function startPomo() {
  const { workMin } = pomoCfg();
  clearInterval(pomo.timer);
  pomo.running = true;
  pomo.phase = 'work';
  pomo.round = 1;
  pomo.endsAt = Date.now() + workMin * 60 * 1000;
  pomo.timer = setInterval(pomoTick, 1000);
  pomoBroadcast();
  aiRemind(`番茄钟刚启动：第 1 轮专注（共 ${workMin} 分钟）。简短地说一句开场打气的话，让主人进入状态。`);
}

function stopPomo(silent) {
  clearInterval(pomo.timer);
  pomo.timer = null;
  pomo.running = false;
  pomoBroadcast();
  if (!silent) petBubbleText('番茄钟已停止啦，随时想开始再叫我～');
}

function pomoTick() {
  if (!pomo.running) return;
  if (Date.now() >= pomo.endsAt) { pomoTransition(); return; }
  pomoBroadcast();
}

function pomoTransition() {
  const { workMin, restMin, rounds } = pomoCfg();
  if (pomo.phase === 'work') {
    pomo.phase = 'rest';
    pomo.endsAt = Date.now() + restMin * 60 * 1000;
    pomoBroadcast();
    aiRemind(`第 ${pomo.round}/${rounds} 轮专注（${workMin} 分钟）刚结束，现在开始休息 ${restMin} 分钟。提醒主人起身活动、喝水、看看远处放松眼睛。`);
  } else {
    if (pomo.round >= rounds) {
      clearInterval(pomo.timer);
      pomo.timer = null;
      pomo.running = false;
      pomoBroadcast();
      aiRemind(`全部 ${rounds} 轮番茄钟周期完成！热烈祝贺主人完成了整个周期，建议好好放松一下，夸夸主人今天的坚持。`);
      return;
    }
    pomo.round += 1;
    pomo.phase = 'work';
    pomo.endsAt = Date.now() + workMin * 60 * 1000;
    pomoBroadcast();
    aiRemind(`休息结束，第 ${pomo.round}/${rounds} 轮专注（${workMin} 分钟）现在开始。用一句话把主人唤回专注状态。`);
  }
}

const FALLBACK_REMINDERS = [
  '时间到啦！起来动一动，喝口水吧～ (๑•̀ㅂ•́)و',
  '叮——该休息一下眼睛啦，看看窗外吧！',
  '嘿，别忘记伸展一下肩膀哦～',
  '到点啦！深呼吸，放松一分钟 ✨',
  '咕噜咕噜～提醒你喝水的时间到了！',
  '劳逸结合才是高手哦，快休息一下吧！',
];

async function aiRemind(eventDesc) {
  const recent = recentReminders.slice(-6).map((s) => `- ${s.slice(0, 60)}`).join('\n');
  const text = await chatOnce([
    {
      role: 'system',
      content: `${config.systemPrompt}\n\n（附加要求：你此刻要给主人发一条番茄钟提醒。保持上面的人设，只说一两句话，活泼、口语化，可以用颜文字或 emoji，不要用列表或标题格式。）`,
    },
    {
      role: 'user',
      content: `事件：${eventDesc}\n\n你最近已经说过的提醒（严禁重复或套路雷同）：\n${recent || '（暂无）'}\n请换一个全新的角度、比喻或说法，这次这样说：`,
    },
  ]);
  const final = (text && text.replace(/^["「『]|["」』]$/g, '').trim()) || FALLBACK_REMINDERS[Math.floor(Math.random() * FALLBACK_REMINDERS.length)];
  recentReminders.push(final);
  if (recentReminders.length > 12) recentReminders.shift();
  showReminder(final);
}

function showReminder(text, title, label) {
  try {
    const n = new Notification({ title: title || `${config.petName || '桌宠'} · 番茄钟`, body: text });
    n.on('click', () => { if (petWindow) petWindow.show(); });
    n.show();
  } catch { /* 通知失败不影响气泡 */ }
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('reminder:show', { text, label: label || '⏰ 番茄钟提醒' });
  }
}

function petBubbleText(text) {
  if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send('reminder:show', { text, quiet: true });
}

// ---------- 屏幕观察（仅本地视觉模型，截图绝不出本机） ----------
const screenWatch = { timer: null, delay: null, busy: false, lastAt: 0 };
const recentScreenMsgs = []; // 最近几条屏幕点评，避免重复套路

function screenWatchIntervalMs() {
  return Math.round(clampNum(config.screenWatchMin, 5, 180, 30)) * 60 * 1000;
}

function isLocalLLM() {
  try {
    const host = new URL(apiBase(config.baseUrl)).hostname;
    return host === 'localhost' || host === '::1' || host === '[::1]' ||
      /^127\./.test(host) || /^192\.168\./.test(host) || /^10\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  } catch { return false; }
}

function syncScreenWatch() {
  // 必须同时清 interval 和首看的 setTimeout，否则重复同步会泄漏孤儿定时器导致高频截图
  clearInterval(screenWatch.timer);
  clearTimeout(screenWatch.delay);
  screenWatch.timer = null;
  screenWatch.delay = null;
  const on = !!config.screenWatch;
  if (!on) return;
  if (!isLocalLLM()) {
    console.log('[屏幕观察] 当前为云端 API，已自动停用（截图只发给本地模型）');
    return;
  }
  const ms = screenWatchIntervalMs();
  // 开启 25 秒后先看一眼，之后按间隔
  screenWatch.delay = setTimeout(() => {
    screenWatch.delay = null;
    if (!config.screenWatch) return;
    screenWatchTick();
    if (!screenWatch.timer && config.screenWatch) {
      screenWatch.timer = setInterval(screenWatchTick, ms);
    }
    console.log(`[屏幕观察] 已启动，每 ${Math.round(ms / 60000)} 分钟一次`);
  }, 25 * 1000);
}

async function screenWatchTick() {
  if (screenWatch.busy || !config.screenWatch) return;
  if (!isLocalLLM()) { syncScreenWatch(); return; }
  // 双保险：距上次观察不足设定间隔的 90% 就跳过，即使存在泄漏的定时器也不会高频截图
  const ms = screenWatchIntervalMs();
  if (Date.now() - screenWatch.lastAt < ms * 0.9) return;
  if (chatAbort) return; // 正在对话流式中，不打断
  screenWatch.busy = true;
  screenWatch.lastAt = Date.now();
  try {
    const primary = screen.getPrimaryDisplay();
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1280, height: Math.round(1280 * primary.size.height / primary.size.width) },
    });
    const shot = sources.find((s) => s.display_id === String(primary.id)) || sources[0];
    if (!shot) return;
    const dataUrl = 'data:image/png;base64,' + shot.thumbnail.toPNG().toString('base64'); // 仅内存，不落盘

    const recent = recentScreenMsgs.slice(-6).map((s) => `- ${s.slice(0, 60)}`).join('\n');
    const text = await chatOnce([
      {
        role: 'system',
        content: `${config.systemPrompt}\n\n（附加要求：你刚刚看了一眼主人当前的电脑屏幕，就看到的内容自然地搭一句话——关心、吐槽或提醒都可以，保持你的人设，只说一两句，口语化，不要像汇报一样罗列屏幕内容，可以用颜文字或 emoji。）`,
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `这是主人现在的屏幕截图。你最近已经说过的点评（严禁重复或套路雷同）：\n${recent || '（暂无）'}\n请换个全新角度说：`,
          },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ]);
    if (!text) return; // 模型不支持视觉或请求失败：本轮静默跳过
    const msg = text.replace(/^["「『]|["」』]$/g, '').trim();
    if (!msg) return;
    recentScreenMsgs.push(msg);
    if (recentScreenMsgs.length > 12) recentScreenMsgs.shift();
    showReminder(msg, `${config.petName || '桌宠'} · 看了眼你的屏幕`, '👀 屏幕观察');
  } catch (e) {
    console.error('[屏幕观察] 本轮失败：', e.message);
  } finally {
    screenWatch.busy = false;
  }
}

// ---------- IPC ----------
let dragInfo = null; // {ox, oy, w, h, wa} 宠物中心相对窗口偏移等，用于光标吸附式拖拽

function registerIPC() {
  ipcMain.handle('config:get', () => ({ ...config }));

  ipcMain.handle('config:save', (_e, cfg) => {
    const old = { ...config };
    config = {
      ...DEFAULT_CONFIG,
      ...config,
      ...pick(cfg, Object.keys(DEFAULT_CONFIG)),
    };
    config.scale = clampNum(config.scale, 0.4, 2.5, 1);
    config.bubbleTimeout = clampNum(config.bubbleTimeout, 0, 600, 20);
    config.historyLimit = Math.round(clampNum(config.historyLimit, 1, 50, 8));
    config.pomodoroWork = Math.round(clampNum(config.pomodoroWork, 1, 180, 25));
    config.pomodoroRest = Math.round(clampNum(config.pomodoroRest, 1, 60, 5));
    config.pomodoroRounds = Math.round(clampNum(config.pomodoroRounds, 1, 12, 4));
    config.screenWatchMin = Math.round(clampNum(config.screenWatchMin, 5, 180, 30));
    saveConfig(true);
    refreshTrayMenu();
    syncScreenWatch();
    if (petWindow && JSON.stringify(old) !== JSON.stringify(config)) {
      petWindow.webContents.send('config:changed', { ...config });
    }
    return { ...config };
  });

  ipcMain.on('pet:hover', (_e, hovering) => {
    if (!petWindow || petWindow.isDestroyed()) return;
    petWindow.setIgnoreMouseEvents(!hovering, { forward: true });
  });

  // ---- 拖拽：指针捕获 + 宠物中心吸附光标，每帧由光标位置直接重算窗口位置（无累积误差） ----
  // 注意：必须用 setBounds 固定尺寸移动。Windows 分数缩放下对透明窗口调用 setPosition
  // 会让窗口每次膨胀 1px（Electron 已知 bug），居中布局的宠物随之漂移。
  const clampToCursor = (bx, by) => {
    const { ox, oy, wa } = dragInfo;
    const cx = Math.min(Math.max(bx, wa.x + 40), wa.x + wa.width - 40);
    const cy = Math.min(Math.max(by, wa.y + 40), wa.y + wa.height - 40);
    return [Math.round(cx - ox), Math.round(cy - oy)];
  };

  ipcMain.on('pet:dragbegin', (_e, { ox, oy }) => {
    if (!petWindow) return;
    const b = petWindow.getBounds();
    // 尺寸归一化：回到 420x560（175% 缩放下恰为整数物理像素 735x980，杜绝逐次膨胀）
    petWindow.setBounds({ x: b.x, y: b.y, width: PET_WIN_W, height: PET_WIN_H });
    dragInfo = { ox, oy, w: PET_WIN_W, h: PET_WIN_H, wa: nearestWorkArea(b.x + ox, b.y + oy) };
  });

  ipcMain.on('pet:dragmove', (_e, { bx, by }) => {
    if (!petWindow || !dragInfo) return;
    const [nx, ny] = clampToCursor(bx, by);
    petWindow.setBounds({ x: nx, y: ny, width: dragInfo.w, height: dragInfo.h });
  });

  ipcMain.on('pet:dragend', (_e, { moved, x, y }) => {
    if (moved && petWindow && dragInfo && Number.isFinite(x)) {
      // 最后一步移动与结束合并为原子操作，避免与 dragmove 的跨频道竞态丢步
      const [nx, ny] = clampToCursor(x, y);
      petWindow.setBounds({ x: nx, y: ny, width: dragInfo.w, height: dragInfo.h });
      const [sx, sy] = petWindow.getPosition();
      config.petPosition = { x: sx, y: sy };
      saveConfig();
    }
    dragInfo = null;
  });

  ipcMain.on('pet:contextmenu', () => {
    Menu.buildFromTemplate(buildMenuTemplate()).popup();
  });

  ipcMain.on('open:settings', () => openSettings());

  ipcMain.on('app:quit', () => app.quit());

  ipcMain.handle('providers:get', () => PROVIDERS);

  ipcMain.handle('personas:get', () => PERSONAS);

  ipcMain.handle('characters:list', () => listCharacters());

  ipcMain.handle('chars:image', (_e, { character, state }) => {
    const url = getCharacterImage(character, state);
    return url ? { ok: true, dataUrl: url } : { ok: false };
  });

  ipcMain.handle('chars:openfolder', () => {
    fs.mkdirSync(USER_CHARS_DIR, { recursive: true });
    shell.openPath(USER_CHARS_DIR);
  });

  ipcMain.handle('models:list', async (_e, { baseUrl, apiKey }) => {
    try {
      return { ok: true, models: await listModels(baseUrl, apiKey) };
    } catch (err) {
      return { ok: false, error: explainNetError(err, baseUrl) };
    }
  });

  ipcMain.handle('test:connection', async (_e, cfg) => {
    try {
      return await testConnection(cfg);
    } catch (err) {
      return { ok: false, error: explainNetError(err, cfg.baseUrl) };
    }
  });

  ipcMain.on('chat:send', (_e, messages) => {
    if (!Array.isArray(messages)) return;
    streamChatToPet(messages);
  });

  ipcMain.on('chat:abort', () => {
    if (chatAbort) chatAbort.abort();
  });

  // ---- 番茄钟 ----
  ipcMain.handle('pomo:get', () => pomoState());
  ipcMain.on('pomo:start', () => { if (!pomo.running) startPomo(); });
  ipcMain.on('pomo:stop', () => { if (pomo.running) stopPomo(false); });
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj && obj[k] !== undefined) out[k] = obj[k];
  return out;
}
function clampNum(v, min, max, dft) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dft;
  return Math.min(max, Math.max(min, n));
}

// 找到坐标所在的（或最近的）显示器工作区
function nearestWorkArea(x, y) {
  const displays = screen.getAllDisplays();
  let best = displays[0];
  let bestDist = Infinity;
  for (const d of displays) {
    const cx = d.workArea.x + d.workArea.width / 2;
    const cy = d.workArea.y + d.workArea.height / 2;
    const dist = Math.hypot(x - cx, y - cy);
    if (dist < bestDist) { bestDist = dist; best = d; }
  }
  return best.workArea;
}

function explainNetError(err, baseUrl) {
  const s = String(err?.message || err);
  if (err?.name === 'AbortError') return `请求超时：${apiBase(baseUrl)} 长时间无响应`;
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|network|timeout/i.test(s)) {
    return `无法连接到 ${apiBase(baseUrl)}：${err?.cause?.code || s}（请确认服务已启动、地址端口正确）`;
  }
  return s;
}

// ---------- 生命周期 ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.setAppUserModelId('com.zcode.desktop-pet');
  app.on('second-instance', () => {
    if (petWindow) { petWindow.show(); petWindow.webContents.send('action:chat'); }
  });

  app.whenReady().then(() => {
    loadConfig();
    fs.mkdirSync(USER_CHARS_DIR, { recursive: true });
    registerIPC();
    createPetWindow();
    createTray();
    syncScreenWatch();
  });

  app.on('window-all-closed', () => app.quit());
}
