// Interaction tests over CDP: modal keyboard behaviour, mobile nav, logout, redirects, anchors.
// Usage: node work/interact.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = 'http://localhost:3000';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9336;
const dir = mkdtempSync(join(tmpdir(), 'inter-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

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
  if (res.result?.exceptionDetails) throw new Error(JSON.stringify(res.result.exceptionDetails).slice(0, 300));
  return res.result?.result?.value;
};
const nav = async (path, settle = 2500) => {
  await call('Page.navigate', { url: BASE + path });
  await wait(settle);
};
const key = async (k) => {
  const code = { Escape: 'Escape', Tab: 'Tab', Enter: 'Enter' }[k];
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: k === 'Tab' ? 9 : k === 'Escape' ? 27 : 13 });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: k === 'Tab' ? 9 : k === 'Escape' ? 27 : 13 });
  await wait(250);
};
const click = (sel) => run(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`);
// Real pointer events: synthetic el.click() never moves focus in Chrome, which hides
// focus-restoration bugs, so anything focus-related must use this.
const mouseClick = async (sel) => {
  const box = await run(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }); })()`);
  if (!box) return false;
  const { x, y } = JSON.parse(box);
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  return true;
};
const mousePoint = async (x, y) => {
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
};
const active = () => run(`(() => { const a = document.activeElement; if (!a || a === document.body) return 'body'; return a.tagName.toLowerCase() + '.' + (a.className && a.className.toString ? a.className.toString().trim().split(/\\s+/).join('.') : '') + (a.getAttribute('aria-label') ? '[' + a.getAttribute('aria-label') + ']' : ''); })()`);
const inModal = () => run(`!!(document.activeElement && document.activeElement.closest && document.activeElement.closest('.modal-overlay'))`);
const setMobile = (on) => call('Emulation.setDeviceMetricsOverride', { width: on ? 390 : 1280, height: 900, deviceScaleFactor: 1, mobile: on });

await call('Page.enable');
await call('Runtime.enable');

// ---------- Modal: teclado ----------
await setMobile(false);
await nav('/');
await mouseClick('.header-actions .btn-primary');
await wait(600);
check('modal abre pelo botão do cabeçalho', await run(`!!document.querySelector('.modal-overlay')`));
check('foco entra no diálogo ao abrir', /modal-overlay/.test(await active()), await active());
await key('Tab');
const first = await active();
check('Tab move para o primeiro controle do diálogo', await inModal() && !/modal-overlay/.test(first), first);
for (let i = 0; i < 8; i++) await key('Tab');
const afterWrap = await active();
check('Tab fica preso dentro do diálogo (wrap)', await inModal(), afterWrap);
await key('Escape');
await wait(800);
check('ESC fecha o diálogo', await run(`!document.querySelector('.modal-overlay')`));
const restored = await active();
check('foco volta ao botão que abriu', /btn-primary/.test(restored), restored);

// ---------- Modal: clique no fundo fecha ----------
await mouseClick('.header-actions .btn-primary');
await wait(500);
await mousePoint(12, 12);
await wait(600);
check('clique fora do cartão fecha', await run(`!document.querySelector('.modal-overlay')`));

// ---------- Sessão: login -> chip -> logout ----------
await nav('/entrar');
await run(`(() => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const inputs = [...document.querySelectorAll('.auth-form input')];
  const mail = inputs.find(i => i.type === 'email'), pass = inputs.find(i => i.type === 'password');
  set.call(mail, 'lucas@exemplo.com.br'); mail.dispatchEvent(new Event('input', { bubbles: true }));
  set.call(pass, 'senha-de-teste'); pass.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('.auth-form button[type=submit]').click();
  return true;
})()`);
await wait(2500);
check('login redireciona para a home', (await run('location.pathname')) === '/', await run('location.pathname'));
check('chip do usuário aparece', await run(`!!document.querySelector('.user-chip')`));
await click('.user-chip button');
await wait(900);
check('Sair limpa a sessão', await run(`localStorage.getItem('hane-user') === null`));
check('Sair remove o chip', await run(`!document.querySelector('.user-chip')`));

// ---------- Redirect quando já autenticado ----------
await run(`localStorage.setItem('hane-user', JSON.stringify({ name: 'Lucas', email: 'lucas@exemplo.com.br' }))`);
await nav('/entrar');
check('logado não consegue abrir /entrar', (await run('location.pathname')) === '/', await run('location.pathname'));
await nav('/cadastro');
check('logado não consegue abrir /cadastro', (await run('location.pathname')) === '/', await run('location.pathname'));
await run(`localStorage.removeItem('hane-user')`);

// ---------- Rodapé ----------
await nav('/');
const footerHref = await run(`(() => { const a = [...document.querySelectorAll('.footer-col a')].find(x => (x.getAttribute('href') || '').startsWith('/#')); return a ? a.getAttribute('href') : null; })()`);
check('link do rodapé aponta para uma âncora real', !!footerHref, String(footerHref));
if (footerHref) {
  await click('.footer-col a[href="' + footerHref + '"]');
  await wait(1800);
  const where = await run(`location.pathname + location.hash`);
  check('navegação pelo rodapé chega no destino', where === footerHref, where);
  check('rodapé rola até a seção', await run(`Math.abs(document.querySelector(${JSON.stringify(footerHref.slice(1))}).getBoundingClientRect().top) < 200`));
}
const deadButtons = await run(`(() => [...document.querySelectorAll('.footer-col button')].map(b => b.textContent.trim()))()`);
console.log(`      (botões do rodapé: ${JSON.stringify(deadButtons)})`);

// ---------- Âncoras ----------
await nav('/');
await click('.main-nav a[href="/#diferenciais"]');
await wait(1500);
const scrolled = await run(`(() => { const s = document.querySelector('#diferenciais'); const r = s.getBoundingClientRect(); return Math.abs(r.top) < 200; })()`);
check('âncora da navegação rola até a seção', scrolled);

// ---------- Menu mobile ----------
await setMobile(true);
await nav('/');
const hidden = await run(`getComputedStyle(document.querySelector('.main-nav')).display`);
check('menu fechado no mobile', hidden === 'none', hidden);
await click('.nav-toggle');
await wait(500);
const shown = await run(`getComputedStyle(document.querySelector('.main-nav')).display`);
check('hambúrguer abre o menu', shown !== 'none', shown);
check('aria-expanded reflete o estado', (await run(`document.querySelector('.nav-toggle').getAttribute('aria-expanded')`)) === 'true');
check('aria-label do hambúrguer muda para fechar', (await run(`document.querySelector('.nav-toggle').getAttribute('aria-label')`)) === 'Fechar menu');
await click('.main-nav a[href="/#download"]');
await wait(1500);
check('link do menu mobile navega/rola', await run(`Math.abs(document.querySelector('#download').getBoundingClientRect().top) < 260`));
check('menu fecha após escolher um link', (await run(`getComputedStyle(document.querySelector('.main-nav')).display`)) === 'none');
const toggleName = await run(`(() => { const b = document.querySelector('.header-actions .btn-primary'); return b.getAttribute('aria-label'); })()`);
check('botão só-ícone tem nome acessível no mobile', toggleName === 'Baixar o app', String(toggleName));

console.log(`\n${results.filter((r) => r.pass).length}/${results.length} verificações passaram`);
socket.close(); chrome.kill();
await wait(800);
try { rmSync(dir, { recursive: true, force: true }); } catch {}
process.exit(results.every((r) => r.pass) ? 0 : 1);
