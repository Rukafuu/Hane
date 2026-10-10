// Which Hane face does Chrome actually pick for each declared weight?
// Usage: node work/font-match.mjs [url]
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2] || 'http://localhost:5173/?noevents';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9335;
const dir = mkdtempSync(join(tmpdir(), 'fontmatch-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`,
  `--user-data-dir=${dir}`, '--window-size=1590,722', '--no-first-run',
  '--disable-gpu', 'about:blank'], { stdio: 'ignore' });

let ws;
for (let i = 0; i < 80; i++) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`);
    const page = (await res.json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); break; }
  } catch {}
  await wait(250);
}
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const call = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const run = async (expression) => {
  const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return r.result?.result?.value;
};

await call('Page.enable'); await call('DOM.enable'); await call('CSS.enable');
await call('Page.navigate', { url });
await wait(4000);
await run(`document.fonts.ready.then(()=>1)`);

const probes = ['.conversation-title strong', '.message-content>p', '.conversation-copy small',
  '.section-head', '.new-chat', '.composer textarea', 'body'];
const doc = (await call('DOM.getDocument')).result;
for (const sel of probes) {
  const { nodeId } = (await call('DOM.querySelector', { nodeId: doc.root.nodeId, selector: sel })).result;
  if (!nodeId) { console.log(sel.padEnd(30), 'não encontrado'); continue; }
  const declared = await run(`getComputedStyle(document.querySelector(${JSON.stringify(sel)})).fontWeight`);
  const { fonts } = (await call('CSS.getPlatformFontsForNode', { nodeId })).result;
  const used = (fonts || []).map((f) => `${f.familyName} w${f.weight}`).join(', ');
  console.log(`${sel.padEnd(30)} declara ${declared}  usa  ${used}`);
}
ws.close(); chrome.kill(); setTimeout(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} }, 1500);
