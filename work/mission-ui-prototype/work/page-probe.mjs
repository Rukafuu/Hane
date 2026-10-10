// One-off: navigate a page over CDP and dump console errors + DOM shape.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2];
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = Number(process.argv[3] || 9337);
const dir = mkdtempSync(join(tmpdir(), 'probe-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`,
  `--user-data-dir=${dir}`, '--window-size=1590,722', '--no-first-run', '--disable-gpu',
  'about:blank'], { stdio: 'ignore' });
let ws;
for (let i = 0; i < 80; i++) {
  try {
    const p = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json())
      .find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); break; }
  } catch {}
  await wait(250);
}
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const events = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m); pending.delete(m.id); }
  else if (m.method === 'Runtime.consoleAPICalled' || m.method === 'Runtime.exceptionThrown') events.push(m);
});
const call = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
await call('Runtime.enable'); await call('Page.enable');
await call('Page.navigate', { url });
await wait(6000);
const info = await call('Runtime.evaluate', { expression: `JSON.stringify({
  title: document.title,
  rootChildren: document.getElementById('root')?.childElementCount ?? -1,
  bodyText: document.body.innerText.slice(0, 160).replace(/\\n/g,' | '),
  faces: [...document.fonts].map(f=>f.family+':'+f.weight+':'+f.status).join(', ')
})`, returnByValue: true });
console.log(info.result?.value ?? info);
for (const e of events) {
  const d = e.params;
  console.log(e.method === 'Runtime.exceptionThrown'
    ? 'EXCEPTION ' + (d.exceptionDetails?.exception?.description || d.exceptionDetails?.text)
    : d.type + ' ' + (d.args || []).map((a) => a.value ?? a.description ?? a.type).join(' '));
}
ws.close(); chrome.kill(); setTimeout(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} }, 1500);
