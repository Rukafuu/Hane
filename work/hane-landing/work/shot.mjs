// Takes QA screenshots with Chrome headless over CDP, with optional interaction.
// Usage: node work/shot.mjs <url> <width> <height> <out.png> [full] [action]
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url, width = '1280', height = '900', out = 'work/shot.png', mode = 'viewport', action = 'none'] = process.argv.slice(2);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9334;
const dir = mkdtempSync(join(tmpdir(), 'shot-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
  `--window-size=${width},${height}`, '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--hide-scrollbars', 'about:blank',
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
  throw new Error('chrome did not expose a page target');
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
  if (res.result?.exceptionDetails) throw new Error(JSON.stringify(res.result.exceptionDetails));
  return res.result?.result?.value;
};

await call('Page.enable');
await call('Runtime.enable');
await call('Emulation.setDeviceMetricsOverride', { width: +width, height: +height, deviceScaleFactor: 2, mobile: +width <= 768 });
await call('Page.navigate', { url });
await wait(3500);

const scrollToSelector = (sel) => `(() => {
  document.documentElement.style.scrollBehavior = 'auto';
  const el = document.querySelector(${JSON.stringify(sel)});
  el.scrollIntoView({ block: 'start' });
  window.scrollBy(0, -90);
  return window.scrollY;
})()`;

if (action === 'modal') {
  await run(`(() => { const b = [...document.querySelectorAll('button')].find(x => /baixar/i.test(x.textContent)); b.click(); return true; })()`);
  await wait(700);
}
if (action === 'modal-waitlist') {
  await run(`(() => { const b = [...document.querySelectorAll('button')].find(x => /baixar/i.test(x.textContent)); b.click(); return true; })()`);
  await wait(600);
  await run(`(() => { const i = document.querySelector('.modal input[type=email]') || document.querySelector('.modal-body input'); i.value = 'lucas@exemplo.com'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await wait(300);
}
if (action === 'nav-open') {
  await run(`(() => { document.querySelector('.nav-toggle').click(); return true; })()`);
  await wait(400);
}
if (action === 'waitlist-submit') {
  await run(`(() => { [...document.querySelectorAll('button')].find(x => /baixar/i.test(x.textContent)).click(); return true; })()`);
  await wait(600);
  await run(`(() => { const i = document.querySelector('.modal-form input'); const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(i, 'lucas@exemplo.com.br'); i.dispatchEvent(new Event('input', { bubbles: true })); return i.value; })()`);
  await wait(200);
  await run(`(() => { document.querySelector('.modal-submit').click(); return true; })()`);
  await wait(900);
  console.log('joined:', await run(`(() => !!document.querySelector('.modal-joined'))()`));
  console.log('waitlist stored:', await run(`localStorage.getItem('hane-waitlist')`));
}
if (action === 'login-submit') {
  await run(`(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const inputs = [...document.querySelectorAll('.auth-form input')];
    const mail = inputs.find(i => i.type === 'email');
    const pass = inputs.find(i => i.type === 'password');
    set.call(mail, 'lucas@exemplo.com.br'); mail.dispatchEvent(new Event('input', { bubbles: true }));
    set.call(pass, 'senha-de-teste'); pass.dispatchEvent(new Event('input', { bubbles: true }));
    return inputs.length;
  })()`);
  await wait(200);
  await run(`(() => { document.querySelector('.auth-form button[type=submit]').click(); return true; })()`);
  await wait(2200);
  console.log('path after login:', await run('location.pathname'));
  console.log('user stored:', await run(`localStorage.getItem('hane-user')`));
  console.log('chip:', await run(`(() => { const c = document.querySelector('.user-chip'); return c ? c.innerText.replace(/\\s+/g, ' ').trim() : null; })()`));
}
if (action === 'signup-submit') {
  await run(`(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const inputs = [...document.querySelectorAll('.auth-form input')];
    for (const i of inputs) {
      const v = i.type === 'email' ? 'ezequiel@exemplo.com.br' : i.type === 'password' ? 'minha-senha-123' : i.type === 'checkbox' ? null : 'Ezequiel';
      if (v === null) { i.click(); continue; }
      set.call(i, v); i.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return inputs.map(i => i.type).join(',');
  })()`);
  await wait(200);
  await run(`(() => { document.querySelector('.auth-form button[type=submit]').click(); return true; })()`);
  await wait(2200);
  console.log('path after signup:', await run('location.pathname'));
  console.log('user stored:', await run(`localStorage.getItem('hane-user')`));
}
if (action === 'invalid-login') {
  await run(`(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const inputs = [...document.querySelectorAll('.auth-form input')];
    const mail = inputs.find(i => i.type === 'email');
    set.call(mail, 'nao-e-email'); mail.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.auth-form button[type=submit]').click();
    return true;
  })()`);
  await wait(500);
  console.log('errors:', await run(`(() => [...document.querySelectorAll('.field-error')].map(e => e.innerText.trim()).join(' | '))()`));
}
if (action.startsWith('scroll-')) {
  const ids = { features: '#diferenciais', steps: '#como-funciona', download: '#download', about: '#o-que-e' };
  console.log('scrollY', await run(scrollToSelector(ids[action.slice(7)] || '#como-funciona')));
  await wait(500);
}

const shot = (await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: mode === 'full' })).result;
if (!shot.data) {
  console.error('capture failed:', JSON.stringify(shot).slice(0, 400));
  socket.close(); chrome.kill(); await wait(500); process.exit(1);
}
const { writeFileSync } = await import('node:fs');
writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log(out, +width + 'x' + height, action);

socket.close(); chrome.kill();
await wait(800);
try { rmSync(dir, { recursive: true, force: true }); } catch {}
process.exit(0);
