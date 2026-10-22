// Language: JavaScript (ES module). Runtime: Node 22+ (global WebSocket).
// Boundary: local chromium over CDP, localhost page only. Verifies the browser
// path end to end and writes a screenshot.

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = process.env.CHROME_BIN ||
  `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`;
const PORT = 9333;
const URL_APP = 'http://localhost:8123/';
const OUT = '/tmp/opencode/ui.png';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--autoplay-policy=no-user-gesture-required',
  '--window-size=1280,900',
  '--hide-scrollbars',
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

let chrome_err = '';
chrome.stderr.on('data', (d) => { chrome_err += d.toString(); });

async function wait_for_devtools() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return await r.json();
    } catch (_) { /* not up yet */ }
    await sleep(150);
  }
  throw new Error('devtools never came up\n' + chrome_err.slice(-2000));
}

const version = await wait_for_devtools();

const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${URL_APP}`, { method: 'PUT' })).json();

const ws = new WebSocket(target.webSocketDebuggerUrl);
let msg_id = 0;
const pending = new Map();
const events = [];

ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
    return;
  }
  if (m.method) events.push(m);
});

await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', rej, { once: true });
});

function send(method, params = {}) {
  const id = ++msg_id;
  return new Promise((res) => {
    const timer = setTimeout(() => { pending.delete(id); res({ timeout: true }); }, 12000);
    pending.set(id, (m) => { clearTimeout(timer); res(m); });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expr) {
  const r = await send('Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.result && r.result.exceptionDetails) {
    return { error: r.result.exceptionDetails.text + ' ' + (r.result.exceptionDetails.exception?.description || '') };
  }
  return r.result?.result?.value;
}

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');

// wait for the module graph to finish booting
for (let i = 0; i < 60; i++) {
  const ok = await evaluate("!!(document.getElementById('voice') && document.getElementById('voice').options.length > 0)");
  if (ok === true) break;
  await sleep(120);
}

const boot = await evaluate(`(() => {
  const sel = document.getElementById('voice');
  return {
    title: document.title,
    voices: sel ? sel.options.length : -1,
    status: document.getElementById('status').textContent,
    hasEngine: typeof window.__linx === 'undefined' ? 'n/a' : 'yes',
  };
})()`);

console.log('boot:', JSON.stringify(boot));

console.log('audio policy:', await evaluate(`(async () => {
  try {
    const c = new AudioContext();
    const before = c.state;
    await c.resume();
    return JSON.stringify({ before, after: c.state, sampleRate: c.sampleRate });
  } catch (e) { return 'ERR ' + String(e); }
})()`));

await evaluate(`(() => {
  const t = document.getElementById('text');
  t.value = 'Hello there. This engine speaks from rules, filters and phonemes. Every word is built from scratch.';
  t.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);

// a real gesture so the AudioContext is allowed to start
const box = await evaluate("(() => { const r = document.getElementById('speak').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()");
for (const type of ['mousePressed', 'mouseReleased']) {
  await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
}

await sleep(400);
console.log('after 0.4s status:', await evaluate(`document.getElementById('status').textContent`));

await sleep(2600);
const state = await evaluate(`(() => ({
  status: document.getElementById('status').textContent,
  duration: document.getElementById('duration').textContent,
  chips: document.querySelectorAll('.w').length,
  active: document.querySelectorAll('.w.on').length,
  phones_len: document.getElementById('phones').textContent.length,
  count: document.getElementById('count').textContent,
}))()`);
console.log('after speak:', JSON.stringify(state));

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
if (shot.result?.data) {
  writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
  console.log('screenshot:', OUT);
}

const errors = events
  .filter((e) => e.method === 'Runtime.exceptionThrown' || e.method === 'Log.entryAdded')
  .map((e) => e.method === 'Runtime.exceptionThrown'
    ? 'EXC ' + (e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text)
    : 'LOG ' + e.params.entry.level + ' ' + e.params.entry.text);
console.log('console/log events:', errors.length ? '\n' + errors.join('\n') : 'none');

ws.close();
chrome.kill('SIGTERM');
await sleep(300);
process.exit(0);
