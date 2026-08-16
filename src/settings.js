// ===== 设置窗口逻辑 =====
const $ = (id) => document.getElementById(id);

let PROVIDERS = {};
let PERSONAS = [];
let CFG = null;

// 无图片角色时预览用的简易 SVG
const SVG_PREVIEW =
  'data:image/svg+xml,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
      <ellipse cx="58" cy="52" rx="15" ry="21" fill="#FFE9C4" stroke="#E8B36B" stroke-width="4"/>
      <ellipse cx="142" cy="52" rx="15" ry="21" fill="#FFE9C4" stroke="#E8B36B" stroke-width="4"/>
      <ellipse cx="100" cy="112" rx="68" ry="64" fill="#FFF3DA" stroke="#E8B36B" stroke-width="5"/>
      <ellipse cx="76" cy="103" rx="7" ry="9" fill="#3B342E"/>
      <ellipse cx="124" cy="103" rx="7" ry="9" fill="#3B342E"/>
      <ellipse cx="57" cy="124" rx="10" ry="6" fill="#FFABAB" opacity="0.75"/>
      <ellipse cx="143" cy="124" rx="10" ry="6" fill="#FFABAB" opacity="0.75"/>
      <path d="M 90 124 Q 100 132 110 124" stroke="#3B342E" stroke-width="4" fill="none" stroke-linecap="round"/>
    </svg>`);

async function init() {
  PROVIDERS = await petAPI.getProviders();
  PERSONAS = await petAPI.getPersonas();
  CFG = await petAPI.getConfig();

  // 服务商下拉
  const sel = $('provider');
  for (const [key, p] of Object.entries(PROVIDERS)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = p.label + (p.needsKey ? '（需 API Key）' : '');
    sel.appendChild(opt);
  }
  sel.value = CFG.provider in PROVIDERS ? CFG.provider : 'custom';

  $('base-url').value = CFG.baseUrl || '';
  $('api-key').value = CFG.apiKey || '';
  $('model').value = CFG.model || '';
  $('pet-name').value = CFG.petName || '';
  $('system-prompt').value = CFG.systemPrompt || '';
  $('scale').value = CFG.scale;
  updateScaleLabel();
  $('bubble-timeout').value = CFG.bubbleTimeout;
  $('history-limit').value = CFG.historyLimit;
  $('breath-anim').checked = CFG.breathAnim !== false;
  $('screen-watch').checked = !!CFG.screenWatch;
  $('screen-watch-min').value = CFG.screenWatchMin ?? 30;
  $('pomo-work').value = CFG.pomodoroWork ?? 25;
  $('pomo-rest').value = CFG.pomodoroRest ?? 5;
  $('pomo-rounds').value = CFG.pomodoroRounds ?? 4;

  // 人设预设下拉：按当前提示词匹配；匹配不上则显示"自定义"
  const presetSel = $('persona-preset');
  const matched = PERSONAS.find((p) => p.prompt === (CFG.systemPrompt || '').trim());
  for (const p of PERSONAS) {
    const opt = document.createElement('option');
    opt.value = p.key;
    opt.textContent = p.label;
    presetSel.appendChild(opt);
  }
  const customOpt = document.createElement('option');
  customOpt.value = 'custom';
  customOpt.textContent = '自定义（保留当前提示词）';
  presetSel.appendChild(customOpt);
  presetSel.value = matched ? matched.key : 'custom';

  // 角色下拉
  const chars = await petAPI.listCharacters();
  const charSel = $('character');
  for (const c of chars) {
    const opt = document.createElement('option');
    opt.value = c.name;
    const states = Object.values(c.states || {}).filter(Boolean).length;
    opt.textContent = c.name === 'default' && !c.states?.idle
      ? `${c.name}（${c.source}）`
      : `${c.name}（${c.source} · ${states} 张状态图）`;
    charSel.appendChild(opt);
  }
  charSel.value = chars.some((c) => c.name === CFG.character) ? CFG.character : 'default';
  updateCharPreview();
}

function currentForm() {
  return {
    provider: $('provider').value,
    baseUrl: $('base-url').value.trim(),
    apiKey: $('api-key').value.trim(),
    model: $('model').value.trim(),
    petName: $('pet-name').value.trim() || '宠物',
    systemPrompt: $('system-prompt').value,
    character: $('character').value,
    scale: Number($('scale').value),
    bubbleTimeout: Number($('bubble-timeout').value) || 0,
    historyLimit: Number($('history-limit').value) || 8,
    breathAnim: $('breath-anim').checked,
    screenWatch: $('screen-watch').checked,
    screenWatchMin: Number($('screen-watch-min').value) || 30,
    pomodoroWork: Number($('pomo-work').value) || 25,
    pomodoroRest: Number($('pomo-rest').value) || 5,
    pomodoroRounds: Number($('pomo-rounds').value) || 4,
  };
}

// ---------- 事件 ----------
$('persona-preset').addEventListener('change', () => {
  const p = PERSONAS.find((x) => x.key === $('persona-preset').value);
  if (p) $('system-prompt').value = p.prompt; // 选"自定义"则不动
});

$('provider').addEventListener('change', () => {
  const p = PROVIDERS[$('provider').value];
  if (!p) return;
  if (p.baseUrl) $('base-url').value = p.baseUrl;
  $('model').value = p.defaultModel || '';
  $('api-key').placeholder = p.needsKey ? '必填：sk-…' : '本地服务无需填写';
});

$('toggle-key').addEventListener('click', () => {
  const el = $('api-key');
  const show = el.type === 'password';
  el.type = show ? 'text' : 'password';
  $('toggle-key').textContent = show ? '隐藏' : '显示';
});

$('fetch-models').addEventListener('click', async () => {
  const tip = $('models-tip');
  const btn = $('fetch-models');
  btn.disabled = true;
  tip.textContent = '正在获取模型列表…';
  const r = await petAPI.listModels($('base-url').value.trim(), $('api-key').value.trim());
  btn.disabled = false;
  if (!r.ok) {
    tip.textContent = `❌ ${r.error}`;
    return;
  }
  const list = $('model-list');
  list.innerHTML = '';
  for (const m of r.models) {
    const opt = document.createElement('option');
    opt.value = m;
    list.appendChild(opt);
  }
  tip.textContent = `✅ 获取到 ${r.models.length} 个模型，可在下拉中选择`;
  if (!r.models.includes($('model').value) && r.models.length) {
    $('model').value = r.models.find((m) => /qwen/i.test(m)) || r.models[0];
  }
});

$('test-conn').addEventListener('click', async () => {
  const btn = $('test-conn');
  const res = $('test-result');
  btn.disabled = true;
  res.className = 'result';
  res.textContent = '测试中…';
  const r = await petAPI.testConnection(currentForm());
  btn.disabled = false;
  if (r.ok) {
    res.className = 'result ok';
    res.textContent = `✅ 连接成功，回复：${r.reply}`;
  } else {
    res.className = 'result fail';
    res.textContent = `❌ ${r.error}`;
  }
});

$('character').addEventListener('change', updateCharPreview);

async function updateCharPreview() {
  const name = $('character').value;
  const r = await petAPI.getCharacterImage(name, 'idle');
  $('char-preview').src = r.ok ? r.dataUrl : SVG_PREVIEW;
}

$('scale').addEventListener('input', updateScaleLabel);
function updateScaleLabel() {
  $('scale-val').textContent = `${Math.round($('scale').value * 100)}%`;
}

$('open-chars').addEventListener('click', () => petAPI.openCharactersFolder());

$('save').addEventListener('click', async () => {
  CFG = await petAPI.saveConfig(currentForm());
  const toast = $('saved-toast');
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 1800);
});

init();
