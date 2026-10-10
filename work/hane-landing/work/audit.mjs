// Accessibility + measured-contrast audit over CDP.
// Usage: node work/audit.mjs <url> [width]
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url, width = '1280'] = process.argv.slice(2);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9335;
const dir = mkdtempSync(join(tmpdir(), 'audit-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
  `--window-size=${width},900`, '--no-first-run', '--no-default-browser-check',
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
await call('Emulation.setDeviceMetricsOverride', { width: +width, height: 900, deviceScaleFactor: 1, mobile: +width <= 768 });
await call('Page.navigate', { url });
await wait(3500);

const report = JSON.parse(await run(`(() => {
  const parse = (c) => {
    const m = c.match(/[\\d.]+/g);
    return m ? { r: +m[0], g: +m[1], b: +m[2], a: m[3] === undefined ? 1 : +m[3] } : null;
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const bgOf = (el) => {
    const stack = [];
    for (let n = el; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) { stack.push(c); if (c.a === 1) break; }
    }
    let acc = { r: 255, g: 255, b: 255, a: 1 };
    for (const c of stack.reverse()) acc = over(c, acc);
    return acc;
  };
  const path = (el) => {
    const parts = [];
    for (let n = el; n && parts.length < 3; n = n.parentElement) {
      const cls = n.className && n.className.toString ? n.className.toString().trim().split(/\\s+/)[0] : '';
      parts.unshift(n.tagName.toLowerCase() + (cls ? '.' + cls : ''));
    }
    return parts.join(' > ');
  };

  const out = { contrast: [], structure: {}, names: [], labels: [], images: [], deadLinks: [], tap: [] };

  // Landmarks and headings
  out.structure.h1 = [...document.querySelectorAll('h1')].map((h) => h.textContent.trim().slice(0, 60));
  const levels = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => +h.tagName[1]);
  const skips = [];
  for (let i = 1; i < levels.length; i++) if (levels[i] > levels[i - 1] + 1) skips.push('h' + levels[i - 1] + '->h' + levels[i]);
  out.structure.headingSkips = skips;
  out.structure.landmarks = ['header', 'nav', 'main', 'footer'].filter((t) => document.querySelector(t));

  // Text contrast
  for (const el of document.querySelectorAll('body *')) {
    const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ');
    if (!text) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
    const fg = parse(cs.color);
    if (!fg) continue;
    const bg = over(fg.a < 1 ? fg : { ...fg, a: 1 }, bgOf(el));
    const size = parseFloat(cs.fontSize);
    const weight = +cs.fontWeight || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    const got = ratio(bg, bgOf(el));
    if (got < need) out.contrast.push({ path: path(el), deco: !!el.closest('[aria-hidden="true"]'), text: text.slice(0, 40), size: +size.toFixed(1), weight, need, got: +got.toFixed(2) });
  }

  // Accessible names on interactive elements
  for (const el of document.querySelectorAll('a,button,[role=button]')) {
    const name = (el.innerText || '').trim() || el.getAttribute('aria-label') || '';
    if (!name && !el.querySelector('img[alt]:not([alt=""])')) out.names.push(path(el));
  }

  // Inputs must be labelled
  for (const el of document.querySelectorAll('input,select,textarea')) {
    if (el.type === 'hidden') continue;
    const labelled = el.labels && el.labels.length
      || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')
      || el.closest('label');
    if (!labelled) out.labels.push(path(el) + ' [' + (el.type || el.tagName.toLowerCase()) + ']');
  }

  // Images
  for (const img of document.querySelectorAll('img')) {
    if (!img.hasAttribute('alt')) out.images.push(path(img) + ' (sem alt)');
  }

  // Dead links
  for (const a of document.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (href === '#' || href === '' || href === 'javascript:void(0)') out.deadLinks.push(path(a) + ' -> "' + (a.innerText || '').trim() + '"');
  }

  // Tap targets (mobile) — WCAG 2.5.8 AA: 24x24 CSS px. Inline links inside running text
  // are exempt by the standard, and a control wrapped in a <label> takes the label's area.
  if (window.innerWidth <= 768) {
    for (const el of document.querySelectorAll('a,button,input,select')) {
      const cs = getComputedStyle(el);
      if (el.tagName === 'A' && cs.display === 'inline' && el.closest('p')) continue;
      const box = el.closest('label') && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) ? el.closest('label') : el;
      const r = box.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.height < 24 || r.width < 24) out.tap.push(path(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    }
  }

  out.contrast.sort((a, b) => a.got - b.got);
  out.viewport = window.innerWidth;
  out.title = document.title;
  out.og = !!document.querySelector('meta[property="og:title"]');
  out.lang = document.documentElement.lang;
  out.canonical = !!document.querySelector('link[rel=canonical]');
  return JSON.stringify(out);
})()`));

const uniq = (a) => [...new Set(a)];
console.log(`\n=== ${url} @ ${report.viewport}px ===`);
console.log(`title: ${report.title}`);
console.log(`lang="${report.lang}"  og:title=${report.og ? 'sim' : 'NAO'}  canonical=${report.canonical ? 'sim' : 'NAO'}`);
console.log(`landmarks: ${report.structure.landmarks.join(', ') || 'nenhum'}   h1: ${report.structure.h1.length} (${report.structure.h1.join(' | ')})`);
if (report.structure.headingSkips.length) console.log(`HEADINGS pulando nível: ${report.structure.headingSkips.join(', ')}`);
const line = (x) => `${x.path} | ${x.size}px/${x.weight} precisa ${x.need} tem ${x.got} | "${x.text}"`;
const real = uniq(report.contrast.filter((x) => !x.deco).map(line));
const deco = uniq(report.contrast.filter((x) => x.deco).map(line));
console.log(`\n-- CONTRASTE medido no DOM: ${real.length} regra(s) de UI real, ${deco.length} no mock decorativo --`);
for (const c of real) console.log('  ' + c);
console.log(`\n-- NOMES ACESSÍVEIS ausentes -- ${uniq(report.names).length}`);
for (const n of uniq(report.names)) console.log('  ' + n);
console.log(`-- inputs sem label -- ${report.labels.length}`);
for (const l of report.labels) console.log('  ' + l);
console.log(`-- img sem alt -- ${report.images.length}`);
for (const i of uniq(report.images)) console.log('  ' + i);
console.log(`-- links mortos -- ${report.deadLinks.length}`);
for (const d of uniq(report.deadLinks)) console.log('  ' + d);
if (report.tap.length) { console.log(`-- alvos de toque < 40px -- ${uniq(report.tap).length}`); for (const t of uniq(report.tap).slice(0, 12)) console.log('  ' + t); }

socket.close(); chrome.kill();
await wait(800);
try { rmSync(dir, { recursive: true, force: true }); } catch {}
process.exit(0);
