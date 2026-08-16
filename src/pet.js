// ===== 宠物窗口交互逻辑 =====
const petEl = document.getElementById('pet');
const petImg = document.getElementById('pet-img');
const builtinSvg = document.getElementById('builtin-pet');
const bubbleEl = document.getElementById('bubble');
const bubbleUserEl = document.getElementById('bubble-user');
const bubbleTextEl = document.getElementById('bubble-text');
const bubbleStopEl = document.getElementById('bubble-stop');
const inputBoxEl = document.getElementById('chat-input-box');
const inputEl = document.getElementById('chat-input');
const badgeEl = document.getElementById('timer-badge');
const badgeIconEl = document.getElementById('timer-icon');
const badgeTextEl = document.getElementById('timer-text');

const S = {
  cfg: null,
  history: [],        // {role, content}
  streaming: false,
  bubbleTimer: null,
  charImages: {},     // state -> dataUrl（图片角色模式）
  walkR: [],          // 向右走路循环帧
  walkL: [],          // 向左走路循环帧
  useImage: false,    // 角色文件夹有 idle 图时为 true
  locked: false,      // 锁定模式：完全点击穿透
  bubbleExpanded: false,
  timer: null,        // 当前番茄钟状态
};

// ---------- 角色外观 ----------
const ALL_STATES = ['idle', 'talk', 'talk2', 'drag', 'walk1', 'walk2', 'walk3', 'walk4', 'walk5', 'walk6'];

async function loadCharacter(name) {
  S.charImages = {};
  S.useImage = false;
  for (const state of ALL_STATES) {
    const r = await petAPI.getCharacterImage(name, state);
    if (r.ok) S.charImages[state] = r.dataUrl;
  }
  S.walkR = ['walk1', 'walk2', 'walk3'].map((k) => S.charImages[k]).filter(Boolean);
  S.walkL = ['walk4', 'walk5', 'walk6'].map((k) => S.charImages[k]).filter(Boolean);
  if (S.charImages.idle) {
    S.useImage = true;
    petImg.classList.remove('hidden');
    builtinSvg.classList.add('hidden');
    petImg.src = S.charImages.idle;
    petImg.decode ? petImg.decode().then(applyPetSize).catch(() => applyPetSize()) : (petImg.onload = applyPetSize);
  } else {
    // 美术占位：无图片时回退内置 SVG 简易角色
    S.useImage = false;
    petImg.classList.add('hidden');
    builtinSvg.classList.remove('hidden');
    applyPetSize();
  }
  setPetState('idle');
}

// 元素尺寸贴合图片实际宽高比（右键/悬停/拖拽的交互区 = 图片实际显示大小）
function applyPetSize() {
  const base = Math.round(240 * (S.cfg?.scale || 1));
  let w = base, h = base;
  if (S.useImage && petImg.naturalWidth > 0) {
    const ar = petImg.naturalWidth / petImg.naturalHeight;
    if (ar >= 1) { w = base; h = Math.round(base / ar); }
    else { h = base; w = Math.round(base * ar); }
  }
  petEl.style.width = `${w}px`;
  petEl.style.height = `${h}px`;
  document.documentElement.style.setProperty('--pet-w', `${w}px`);
  document.documentElement.style.setProperty('--pet-h', `${h}px`);
}

// ---------- 帧动画循环器（说话两帧 / 走路六帧） ----------
let animTimer = null;
function stopAnim() {
  if (animTimer) { clearInterval(animTimer); animTimer = null; }
}
function playFrames(frames, interval) {
  stopAnim();
  if (!frames.length) return;
  petImg.src = frames[0];
  if (frames.length < 2) return;
  let i = 0;
  animTimer = setInterval(() => {
    i = (i + 1) % frames.length;
    petImg.src = frames[i];
  }, interval);
}

let walkDir = 1; // 1=向右走 -1=向左走（拖拽水平方向决定）
// 呼吸浮动开关：图片角色用上下浮动（拖拽时暂停），SVG 角色关掉自带呼吸/眨眼
function applyBreath() {
  const on = S.cfg?.breathAnim !== false;
  const dragging = petEl.classList.contains('drag');
  petEl.classList.toggle('bob', on && S.useImage && !dragging);
  petEl.classList.toggle('anim-off', !on);
}

function setPetState(state) {
  petEl.classList.remove('idle', 'talk', 'drag');
  petEl.classList.add(state);
  applyBreath();
  if (!S.useImage) return;
  stopAnim();
  if (state === 'talk' && S.charImages.talk) {
    // 说话：张嘴/闭嘴两帧交替
    playFrames([S.charImages.talk, S.charImages.talk2].filter(Boolean), 380);
  } else if (state === 'drag' && (S.walkR.length || S.walkL.length)) {
    // 拖拽：按移动方向播放走路循环
    playFrames(walkDir > 0 ? S.walkR : S.walkL, 150);
  } else {
    petImg.src = S.charImages[state] || S.charImages.idle || '';
  }
}

function applyConfig(cfg) {
  const prev = S.cfg;
  S.cfg = cfg;
  applyLock(!!cfg.locked);
  if (!prev || prev.character !== cfg.character) {
    loadCharacter(cfg.character);
  } else {
    applyPetSize(); // 缩放比例可能变化
    setPetState(S.streaming ? 'talk' : 'idle');
  }
  applyBreath();
}

// ---------- 锁定模式：人物完全点击穿透，不影响桌面操作（托盘菜单解锁） ----------
function applyLock(v) {
  if (S.locked === v) return;
  S.locked = v;
  document.body.classList.toggle('locked', v);
  if (v) {
    // 收起输入框、中断拖拽
    inputEl.value = '';
    inputBoxEl.classList.add('hidden');
    inputEl.blur();
    if (drag) { petAPI.dragEnd(false, 0, 0); drag = null; }
  }
}

// ---------- 气泡 ----------
function showBubble() {
  clearTimeout(S.bubbleTimer);
  bubbleEl.classList.remove('hidden');
}
function hideBubble() {
  bubbleEl.classList.add('hidden');
  bubbleUserEl.classList.add('hidden');
  bubbleTextEl.textContent = '';
  bubbleStopEl.classList.add('hidden');
  bubbleEl.classList.remove('error');
  bubbleEl.classList.remove('expand');
  S.bubbleExpanded = false;
}
function scheduleHideBubble() {
  clearTimeout(S.bubbleTimer);
  const sec = Number(S.cfg?.bubbleTimeout ?? 20);
  if (sec > 0) S.bubbleTimer = setTimeout(hideBubble, sec * 1000);
}
function showUserMsg(text) {
  bubbleUserEl.textContent = `你：${text}`;
  bubbleUserEl.classList.remove('hidden');
}
function showThinking() {
  bubbleTextEl.innerHTML = '<span class="thinking">（思考中…）</span>';
  bubbleStopEl.classList.remove('hidden');
}
function appendStreamText(text) {
  if (bubbleTextEl.querySelector('.thinking')) bubbleTextEl.textContent = '';
  bubbleTextEl.textContent += text;
}

// ---------- 聊天 ----------
function buildMessages() {
  const limit = Math.max(1, Number(S.cfg?.historyLimit ?? 8)) * 2;
  const recent = S.history.slice(-limit);
  return [
    { role: 'system', content: S.cfg?.systemPrompt || '你是一个可爱的桌面宠物。' },
    ...recent,
  ];
}

function sendMessage(text) {
  if (S.streaming) { petAPI.abortChat(); return; } // 生成中再按 Enter = 先停止
  S.history.push({ role: 'user', content: text });
  showBubble();
  showUserMsg(text);
  showThinking();
  S.streaming = true;
  setPetState('talk');
  petAPI.sendChat(buildMessages());
}

function finishStream(aborted) {
  const reply = bubbleTextEl.textContent;
  if (reply && !bubbleTextEl.querySelector('.thinking')) {
    S.history.push({ role: 'assistant', content: reply });
  }
  S.streaming = false;
  bubbleStopEl.classList.add('hidden');
  setPetState('idle');
  scheduleHideBubble();
  if (aborted && !reply) hideBubble();
}

petAPI.onChatChunk((d) => {
  showBubble();
  appendStreamText(d.text);
});
petAPI.onChatDone((d) => finishStream(!!d.aborted));
petAPI.onChatError((d) => {
  bubbleTextEl.textContent = `⚠ ${d.message}`;
  bubbleTextEl.classList.add('error');
  S.streaming = false;
  bubbleStopEl.classList.add('hidden');
  setPetState('idle');
  scheduleHideBubble();
});

bubbleStopEl.addEventListener('click', () => petAPI.abortChat());

// 点击气泡展开/收起长文本
bubbleEl.addEventListener('click', (e) => {
  if (e.target === bubbleStopEl) return;
  S.bubbleExpanded = !S.bubbleExpanded;
  bubbleEl.classList.toggle('expand', S.bubbleExpanded);
});

// ---------- 聊天输入框 ----------
function openChatInput() {
  inputBoxEl.classList.remove('hidden');
  inputEl.focus();
}
function toggleChatInput() {
  if (inputBoxEl.classList.contains('hidden')) openChatInput();
  else if (!inputEl.value) inputBoxEl.classList.add('hidden');
  else inputEl.focus();
}

inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing) {
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = '';
    sendMessage(text);
  } else if (e.key === 'Escape') {
    inputEl.value = '';
    inputBoxEl.classList.add('hidden');
    inputEl.blur();
  }
});

petAPI.onActionChat(() => openChatInput());

// ---------- 拖拽（指针捕获 + 宠物中心吸附光标，杜绝事件丢失与漂移） ----------
let drag = null;
petEl.addEventListener('pointerdown', (e) => {
  if (S.locked || e.button !== 0) return;
  drag = { id: e.pointerId, sx: e.screenX, sy: e.screenY, lx: e.screenX, ly: e.screenY, px: e.screenX, moved: false };
  try { petEl.setPointerCapture(e.pointerId); } catch { /* 捕获失败则退化为普通事件流 */ }
  // 吸附：报告宠物中心相对窗口左上角的偏移，此后宠物中心锁定在光标上
  const rect = petEl.getBoundingClientRect();
  petAPI.dragBegin(rect.left + rect.width / 2, rect.top + rect.height / 2);
});
document.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  drag.lx = e.screenX;
  drag.ly = e.screenY;
  // 走路方向跟随水平移动方向
  const hdx = e.screenX - drag.px;
  if (Math.abs(hdx) > 2) {
    const dir = hdx > 0 ? 1 : -1;
    if (dir !== walkDir) {
      walkDir = dir;
      if (drag.moved && petEl.classList.contains('drag')) playFrames(walkDir > 0 ? S.walkR : S.walkL, 150);
    }
    drag.px = e.screenX;
  }
  if (!drag.moved && Math.hypot(drag.lx - drag.sx, drag.ly - drag.sy) > 4) {
    drag.moved = true;
    setPetState('drag');
  }
  if (drag.moved) petAPI.dragMove(drag.lx, drag.ly); // 逐事件直发，末步由 dragEnd 原子覆盖
});
function endDrag(e) {
  if (!drag || e.pointerId !== drag.id) return;
  if (drag.moved) {
    // 最后位置随 dragEnd 原子送达（含夹取与保存），不单独补发 dragMove
    petAPI.dragEnd(true, drag.lx, drag.ly);
    setPetState(S.streaming ? 'talk' : 'idle');
  } else {
    petAPI.dragEnd(false, 0, 0);
    toggleChatInput();
  }
  drag = null;
}
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);
petEl.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (!S.locked) petAPI.showContextMenu();
});

// ---------- 鼠标穿透：悬停在可交互元素上时才接收鼠标 ----------
let lastHover = null;
function computeHover(target) {
  if (S.locked) return false; // 锁定模式：一律穿透，人物下方的点击直达桌面
  const onElement = !!(target && target.closest && target.closest('.interactive'));
  const inputFocused = document.activeElement === inputEl;
  return onElement || inputFocused || !!drag;
}
document.addEventListener('mousemove', (e) => {
  const on = computeHover(e.target);
  if (on !== lastHover) {
    lastHover = on;
    petAPI.setHover(on);
  }
});
document.addEventListener('mouseleave', () => {
  lastHover = false;
  petAPI.setHover(false);
});
window.addEventListener('blur', () => {
  lastHover = false;
  petAPI.setHover(false);
});

// ---------- 番茄钟徽章与提醒 ----------
function renderTimer(t) {
  S.timer = t;
  if (!t || !t.running) {
    badgeEl.classList.add('hidden');
    return;
  }
  badgeEl.classList.remove('hidden');
  badgeEl.classList.toggle('rest', t.phase === 'rest');
  badgeIconEl.textContent = t.phase === 'work' ? '🍅' : '☕';
  const mm = String(Math.floor(t.remaining / 60)).padStart(2, '0');
  const ss = String(t.remaining % 60).padStart(2, '0');
  badgeTextEl.textContent = `${mm}:${ss}`;
}
petAPI.onTimerState(renderTimer);

badgeEl.addEventListener('click', () => {
  const t = S.timer;
  if (!t || !t.running) return;
  const mm = Math.floor(t.remaining / 60);
  const ss = t.remaining % 60;
  showBubble();
  bubbleUserEl.classList.add('hidden');
  bubbleTextEl.classList.remove('error');
  bubbleTextEl.textContent = `${t.phase === 'work' ? '🍅 专注中' : '☕ 休息中'}：还剩 ${mm} 分 ${ss} 秒（第 ${t.round}/${t.rounds} 轮）`;
  scheduleHideBubble();
});

// 主进程推送的番茄钟/屏幕观察提醒：系统通知已在主进程弹出，这里负责气泡展示
petAPI.onReminderShow(({ text, quiet, label }) => {
  if (S.streaming) return; // 正在对话流式中不打断，通知已经覆盖
  showBubble();
  if (quiet) bubbleUserEl.classList.add('hidden');
  else {
    bubbleUserEl.textContent = label || '⏰ 番茄钟提醒';
    bubbleUserEl.classList.remove('hidden');
  }
  bubbleTextEl.classList.remove('error');
  bubbleTextEl.textContent = text;
  setPetState('talk');
  setTimeout(() => { if (!S.streaming) setPetState('idle'); }, 2600);
  scheduleHideBubble();
});

// ---------- 配置热更新 ----------
petAPI.onConfigChanged((cfg) => applyConfig(cfg));

// ---------- 启动 ----------
(async () => {
  const cfg = await petAPI.getConfig();
  applyConfig(cfg);
  renderTimer(await petAPI.getPomo());
  // 欢迎语
  showBubble();
  bubbleTextEl.textContent = `嗨～我是${cfg.petName || '你的小宠物'}！点我可以聊天，右键有菜单哦 (◍•ᴗ•◍)`;
  setPetState('talk');
  setTimeout(() => { if (!S.streaming) setPetState('idle'); }, 2500);
  scheduleHideBubble();
})();
