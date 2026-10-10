// Focused diagnostic: does hash navigation actually scroll? Uses real hrefs.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = 'http://localhost:3000';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9337;
const dir = mkdtempSync(join(tmpdir(), 'anch-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
  '--window-size=1280,900', '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank',
], { stdio: 'ignore' });

async function endpoint() {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (res.ok) {
        const page = (await res.json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (page) return page.webSocketDebuggerUrl;
      }
    } catch {}
    await wait(250);
  }
  throw new Error('no page target');
}

const socket = new WebSocket(await endpoint());
await new Promise((r) => socket.addEventListener('open', r));
let id = 0;
const pending = new Map();
socket.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
const call = (method, params = {}) => new Promise((resolve) => {
  const n = ++id;
  pending.set(n, resolve);
  socket.send(JSON.stringify({ id: n, method, params }));
});
const run = async (expression) => {
  const res = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.result?.exceptionDetails) throw new Error(JSON.stringify(res.result.exceptionDetails).slice(0, 300));
  return res.result?.result?.value;
};
const nav = async (path, settle = 2500) => { await call('Page.navigate', { url: BASE + path }); await wait(settle); };
const click = (sel) => run(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'SEM MATCH'; el.click(); return 'clicou ' + el.getAttribute('href'); })()`);

await call('Page.enable');
await call('Runtime.enable');

await nav('/');
console.log('ids presentes:', await run(`['o-que-e','diferenciais','como-funciona','download'].map(i => i + '=' + !!document.getElementById(i)).join(', ')`));
console.log('scroll-margin-top em #diferenciais:', await run(`getComputedStyle(document.getElementById('diferenciais')).scrollMarginTop`));

const state = () => run(`JSON.stringify({ hash: location.hash, scrollY: Math.round(scrollY), top: Math.round(document.getElementById('diferenciais').getBoundingClientRect().top), href: location.href })`);

await nav('/');
console.log('estado inicial:', await state());
console.log('clicando:', await click('.main-nav a[href="/#diferenciais"]'));
await wait(2000);
console.log('apos clique nav:', await state());

await nav('/');
console.log('clicando rodape:', await click('.footer-col a[href="/#como-funciona"]'));
await wait(2000);
console.log('apos clique footer:', await run(`JSON.stringify({ hash: location.hash, scrollY: Math.round(scrollY), top: Math.round(document.getElementById('como-funciona').getBoundingClientRect().top) })`));

await nav('/#diferenciais');
console.log('deep link direto:', await state());

await nav('/entrar');
console.log('clicando:', await click('.main-nav a[href="/#diferenciais"]'));
await wait(2500);
console.log('a partir de /entrar:', await state());

socket.close(); chrome.kill();
await wait(800);
try { rmSync(dir, { recursive: true, force: true }); } catch {}
