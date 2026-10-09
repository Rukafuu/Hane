// Measures which elements overflow the mobile viewport via Chrome DevTools Protocol.
// Usage: node work/overflow-probe.mjs <url> <width> <height>
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url = 'http://localhost:3000/', width = '430', height = '932'] = process.argv.slice(2);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9333;
const dir = mkdtempSync(join(tmpdir(), 'probe-'));

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
  `--window-size=${width},${height}`, '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', 'about:blank',
], { stdio: 'ignore' });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return (await res.json()).webSocketDebuggerUrl;
    } catch {}
    await wait(250);
  }
  throw new Error('chrome did not start');
}

const ws = new WebSocket(await connect());
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
const send = (method, params = {}) => new Promise((resolve) => {
  const n = ++id;
  pending.set(n, resolve);
  ws.send(JSON.stringify({ id: n, method, params }));
});

await wait(600);
const list = await fetch(`http://127.0.0.1:${port}/json`);
const page = (await list.json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
ws.close(); await wait(200);

const pw = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => pw.addEventListener('open', r));
const pending2 = new Map();
pw.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending2.has(msg.id)) { pending2.get(msg.id)(msg); pending2.delete(msg.id); }
});
const call = (method, params = {}) => new Promise((resolve) => {
  const n = ++id;
  pending2.set(n, resolve);
  pw.send(JSON.stringify({ id: n, method, params }));
});

await call('Runtime.enable');
await call('Page.enable');
await call('Emulation.setDeviceMetricsOverride', { width: +width, height: +height, deviceScaleFactor: 1, mobile: true });
await call('Page.navigate', { url });
await wait(3500);

const expr = `(() => {
  const vw = document.documentElement.clientWidth;
  const bad = [];
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    if (r.right > vw + 1 || r.left < -1) {
      const cs = getComputedStyle(el);
      bad.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className && el.className.toString ? el.className.toString() : '').slice(0, 60),
        left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width),
        pos: cs.position, of: cs.overflowX
      });
    }
  }
  return JSON.stringify({ vw, scrollWidth: document.documentElement.scrollWidth, bad: bad.slice(0, 40) });
})()`;
const out = await call('Runtime.evaluate', { expression: expr, returnByValue: true });
const data = JSON.parse(out.result.result.value);
console.log('viewport', data.vw, 'scrollWidth', data.scrollWidth);
for (const b of data.bad) console.log(`${b.tag}.${b.cls} left=${b.left} right=${b.right} w=${b.w} pos=${b.pos} overflowX=${b.of}`);

pw.close(); chrome.kill();
await wait(800);
try { rmSync(dir, { recursive: true, force: true }); } catch {}
process.exit(0);
