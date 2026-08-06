// 临时 UI 验证驱动：通过 CDP 驱动运行中的桌面端（需 --remote-debugging-port=9222）
const PORT = 9222;

let ws = null;
async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/json/list`);
      const targets = await r.json();
      const page = targets.find((t) => t.type === 'page' && t.url.includes('localhost:5173'));
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
        };
        return;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log('NO_CDP');
  process.exit(1);
}

let msgId = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return 'ERR: ' + JSON.stringify(r.result.exceptionDetails);
  return r.result?.result?.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await connect();
await send('Runtime.enable');
console.log('connected');

// 0. 记录现有会话，用于事后清理
const before = await evalJs(`(async () => (await window.voked.listSessions(await window.voked.homeDir())).map(s => s.id))()`);
console.log('sessions before:', before);

// 1. 点左上角 ＋ 新建会话
await evalJs(`document.querySelector('.sidebar-top .top-btn.primary').click(); true`);
await sleep(1500);

// 2. 用原生 setter 注入文本（绕开 CDP 输入法问题），然后点发送按钮
await evalJs(`(() => { const ta = document.querySelector('.composer textarea'); if (!ta) return 'NO_TA'; const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; setter.call(ta, '请读取 D:\\\\other\\\\voked\\\\package.json 文件内容，然后用中文告诉我里面有哪些 scripts 命令'); ta.dispatchEvent(new Event('input', { bubbles: true })); ta.focus(); return 'OK'; })()`);
await sleep(500);
console.log('send state:', await evalJs(`(() => { const b = document.querySelector('.composer .send'); return JSON.stringify({ disabled: b ? b.disabled : 'NO_BTN', len: (document.querySelector('.composer textarea') || {}).value?.length ?? -1 }) })()`));
await evalJs(`(() => { const b = document.querySelector('.composer .send'); if (b) b.click(); return !!b; })()`);
console.log('message sent');

// 3. 轮询 UI 状态，自动允许权限弹窗
const start = Date.now();
let settled = 0;
while (Date.now() - start < 180000) {
  await sleep(2500);
  const state = await evalJs(`JSON.stringify({ busy: !!document.querySelector('.message.assistant.streaming'), thinking: document.querySelectorAll('.thinking.live').length, tools: document.querySelectorAll('.tool-block').length, msgs: document.querySelectorAll('.message').length, ask: !!document.querySelector('.permissions-modal'), err: (document.querySelector('.err-toast') || {}).textContent ?? '' })`);
  console.log('state', state);
  let st = { ask: false };
  try { st = JSON.parse(state); } catch {}
  if (st.ask) {
    await evalJs(`(() => { const b = document.querySelector('.permissions-modal .actions .primary'); if (b) b.click(); return true; })()`);
    console.log('allowed');
    continue;
  }
  if (!st.busy) { settled++; if (settled >= 3) break; } else settled = 0;
}
await sleep(2000);

// 4. 折叠测试
console.log('--- collapse test ---');
await evalJs(`document.querySelector('.sidebar-top .top-btn').click(); true`);
await sleep(900);
console.log('sidebar-hidden:', await evalJs(`document.querySelector('.layout').classList.contains('sidebar-hidden')`));
console.log('expand btn:', await evalJs(`!!document.querySelector('.sidebar-expand')`));
await evalJs(`(document.querySelector('.sidebar-expand') || { click: () => {} }).click(); true`);
await sleep(900);
console.log('sidebar-hidden after expand:', await evalJs(`document.querySelector('.layout').classList.contains('sidebar-hidden')`));

// 5. 清理测试会话（删除新建的会话）
const after = await evalJs(`(async () => (await window.voked.listSessions(await window.voked.homeDir())).map(s => s.id))()`);
const newIds = after.filter((id) => !before.includes(id));
for (const id of newIds) {
  await evalJs(`(async () => { await window.voked.deleteSession('${id}'); return true; })()`);
}
console.log('deleted test sessions:', newIds.length ? newIds : 'none');

ws.close();
console.log('DONE');
