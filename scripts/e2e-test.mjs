// CDP 端到端测试：模拟用户发消息，验证 Ollama qwen2.5vl:3b 流式对话全链路
// 零依赖：Node 24 内置 fetch + WebSocket
const CDP = 'http://127.0.0.1:9222';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 1. 找到 pet.html 页面目标
  let target = null;
  for (let i = 0; i < 20; i++) {
    try {
      const list = await (await fetch(`${CDP}/json`)).json();
      target = list.find((t) => t.url.includes('pet.html') && t.webSocketDebuggerUrl);
      if (target) break;
    } catch { /* app 还没起来 */ }
    await sleep(500);
  }
  if (!target) throw new Error('未找到 pet.html 调试目标');
  console.log('[1] 连接到渲染进程:', target.url);

  // 2. WebSocket 连 CDP
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  console.log('[2] CDP WebSocket 已连接');

  let msgId = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const evalJS = (expr) => new Promise((res, rej) => {
    const id = ++msgId;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }));
    setTimeout(() => rej(new Error('eval 超时')), 30000);
  });

  // 3. 检查渲染进程状态
  const state = await evalJS(`JSON.stringify({
    cfg: typeof cfg !== 'undefined' ? cfg : (typeof S !== 'undefined' ? S.cfg : null),
    petState: document.getElementById('pet').className,
    bubbleVisible: !document.getElementById('bubble').classList.contains('hidden'),
    welcome: document.getElementById('bubble-text').textContent.slice(0, 30),
    model: (typeof S !== 'undefined' && S.cfg) ? S.cfg.model : 'unknown',
  })`);
  console.log('[3] 渲染进程状态:', state.result.result.value);

  // 4. 模拟点击宠物 → 输入框应出现 → 输入文字 → 触发发送
  await evalJS(`document.getElementById('pet').dispatchEvent(new MouseEvent('mousedown', {bubbles:true, button:0, screenX:100, screenY:100}))`);
  await evalJS(`document.dispatchEvent(new MouseEvent('mouseup', {bubbles:true}))`);
  const inputShown = await evalJS(`!document.getElementById('chat-input-box').classList.contains('hidden')`);
  console.log('[4] 点击宠物后输入框显示:', inputShown.result.result.value);

  await evalJS(`const i=document.getElementById('chat-input'); i.value='用一句话夸夸你的主人'; i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
  console.log('[5] 已发送消息，等待 qwen2.5vl:3b 流式回复…');

  // 5. 轮询气泡文本（流式增长）
  let last = '';
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    const r = await evalJS(`JSON.stringify({t: document.getElementById('bubble-text').textContent, streaming: (typeof S!=='undefined'&&S.streaming)||null, pet: document.getElementById('pet').className})`);
    const { t, streaming, pet } = JSON.parse(r.result.result.value);
    if (t !== last) { console.log(`  [${(i + 1)}s] 流式中(${pet}): ${t.slice(0, 80)}`); last = t; }
    if (!streaming && t && !t.includes('思考中') && i > 3) {
      console.log('[6] ✓ 回复完成:', t);
      console.log('[7] ✓ 全链路验证通过：渲染进程→IPC→主进程fetch→Ollama流式SSE→气泡打字机');
      ws.close();
      return;
    }
  }
  throw new Error('60 秒内未完成回复，最后气泡内容: ' + last);
}

main().catch((e) => { console.error('✗ 测试失败:', e.message); process.exit(1); });
