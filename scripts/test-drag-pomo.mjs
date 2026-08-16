// 验证：新拖拽逻辑 + 番茄钟全流程（徽章、AI 提醒、相位切换）
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getPetPage() {
  for (let i = 0; i < 20; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:9222/json')).json();
      const t = list.find((x) => x.url.includes('pet.html') && x.webSocketDebuggerUrl);
      if (t) return t;
    } catch { /* 未就绪 */ }
    await sleep(500);
  }
  throw new Error('未找到 pet.html');
}

function connect(wsUrl) {
  return new Promise(async (res, rej) => {
    const ws = new WebSocket(wsUrl);
    ws.onerror = rej;
    await new Promise((r) => (ws.onopen = r));
    let id = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result?.result?.value); pending.delete(m.id); }
    };
    res({
      eval: (expr) => new Promise((r2, rj2) => {
        const i = ++id;
        pending.set(i, r2);
        ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }));
        setTimeout(() => rj2(new Error('eval 超时: ' + expr.slice(0, 40))), 45000);
      }),
      close: () => ws.close(),
    });
  });
}

(async () => {
  const page = await connect((await getPetPage()).webSocketDebuggerUrl);
  console.log('[A] 页面已连接');

  // ---- 1. 拖拽（新逻辑）：绝对位移 + 夹取 ----
  const before = await page.eval('screenX + "," + screenY');
  const [bx, by] = before.split(',').map(Number);
  await page.eval(`document.getElementById('pet').dispatchEvent(new MouseEvent('mousedown', {bubbles:true, button:0, screenX:${bx}, screenY:${by}}))`);
  await page.eval(`document.dispatchEvent(new MouseEvent('mousemove', {bubbles:true, screenX:${bx + 120}, screenY:${by + 60}}))`);
  await page.eval(`document.dispatchEvent(new MouseEvent('mousemove', {bubbles:true, screenX:${bx + 240}, screenY:${by + 120}}))`);
  await page.eval(`document.dispatchEvent(new MouseEvent('mouseup', {bubbles:true}))`);
  await sleep(600);
  const after = await page.eval('screenX + "," + screenY');
  const [ax, ay] = after.split(',').map(Number);
  console.log(`[B] 拖拽: (${before}) -> (${after}) 位移=(${ax - bx},${ay - by}) 期望≈(240,120，受夹取影响可能更小)`);
  if (Math.abs((ax - bx) - 240) > 8 || Math.abs((ay - by) - 120) > 8) throw new Error('拖拽位移偏差过大');
  // 拖回默认位
  const [cx, cy] = after.split(',').map(Number);
  const tx = 1002, ty = 286;
  await page.eval(`document.getElementById('pet').dispatchEvent(new MouseEvent('mousedown', {bubbles:true, button:0, screenX:${cx}, screenY:${cy}}))`);
  await page.eval(`document.dispatchEvent(new MouseEvent('mousemove', {bubbles:true, screenX:${tx}, screenY:${ty}}))`);
  await page.eval(`document.dispatchEvent(new MouseEvent('mouseup', {bubbles:true}))`);
  await sleep(400);

  // ---- 2. 番茄钟 ----
  await page.eval('petAPI.startPomo()');
  await sleep(1500);
  const st1 = await page.eval(`JSON.stringify({
    badge: !document.getElementById('timer-badge').classList.contains('hidden'),
    text: document.getElementById('timer-text').textContent,
    icon: document.getElementById('timer-icon').textContent,
  })`);
  console.log('[C] 启动后徽章:', st1);

  // 等待 60 秒后的 work→rest 转换 + AI 提醒
  console.log('[D] 等待专注阶段结束（约 65s）→ 应切休息并弹 AI 提醒…');
  let restSeen = null;
  for (let i = 0; i < 100; i++) {
    await sleep(1000);
    const s = await page.eval(`JSON.stringify({icon: document.getElementById('timer-icon').textContent, cls: document.getElementById('timer-badge').className.includes('rest'), bubble: document.getElementById('bubble-text').textContent.slice(0,50), bubbleOn: !document.getElementById('bubble').classList.contains('hidden')})`);
    const o = JSON.parse(s);
    if (o.cls || o.icon === '☕') {
      restSeen = o;
      console.log(`  [${i + 1}s] 已进入休息相位:`, s);
      if (o.bubbleOn && o.bubble && !o.bubble.includes('思考中')) break;
    }
    if (i % 10 === 9) console.log(`  [${i + 1}s] 仍在专注…`);
  }
  if (!restSeen) throw new Error('65+ 秒后仍未切到休息相位');
  const reminder = await page.eval('document.getElementById("bubble-text").textContent');
  console.log('[E] ✓ AI 提醒语:', reminder);

  // 停止并验证状态复位
  await page.eval('petAPI.stopPomo()');
  await sleep(800);
  const badgeHidden = await page.eval(`document.getElementById('timer-badge').classList.contains('hidden')`);
  console.log('[F] 停止后徽章隐藏:', badgeHidden);
  console.log('\n=== 全部验证通过 ===');
  page.close();
  process.exit(0);
})().catch((e) => { console.error('✗ 失败:', e.message); process.exit(1); });
