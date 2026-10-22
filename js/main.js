// Language: JavaScript (ES module). Runtime: browser.
// Boundary: DOM binding for the TTS engine. No network.

import { TtsEngine, VOICES, parse_overrides } from './engine.js';

const $ = (id) => document.getElementById(id);

const el = {
  text: $('text'),
  voice: $('voice'),
  rate: $('rate'),
  pitch: $('pitch'),
  breath: $('breath'),
  volume: $('volume'),
  rateOut: $('rate-out'),
  pitchOut: $('pitch-out'),
  breathOut: $('breath-out'),
  volumeOut: $('volume-out'),
  speak: $('speak'),
  stop: $('stop'),
  save: $('save'),
  wave: $('wave'),
  words: $('words'),
  phones: $('phones'),
  status: $('status'),
  dot: $('dot'),
  duration: $('duration'),
  count: $('count'),
  overrides: $('overrides'),
};

const engine = new TtsEngine();
const STORE_KEY = 'linx.tts.overrides';

let chips = [];
let busy = false;

// ---------- voices ----------
for (const [id, v] of Object.entries(VOICES)) {
  const opt = document.createElement('option');
  opt.value = id;
  opt.textContent = v.label;
  el.voice.appendChild(opt);
}
el.voice.value = 'male';

const saved = localStorage.getItem(STORE_KEY);
if (saved) el.overrides.value = saved;

function voice_opts() {
  const base = VOICES[el.voice.value] || VOICES.male;
  const pitch = Number(el.pitch.value);
  return {
    rate: base.rate / Number(el.rate.value),
    f0: base.f0 * pitch,
    formant_scale: base.formant_scale * (0.86 + pitch * 0.14),
    breathiness: Math.max(0, Math.min(0.4, Number(el.breath.value))),
    overrides: parse_overrides(el.overrides.value),
  };
}

function set_status(text, mode) {
  el.status.textContent = text;
  el.dot.className = 'dot' + (mode ? ' ' + mode : '');
}

// ---------- waveform ----------
function draw_wave(pcm) {
  const c = el.wave;
  const ctx = c.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = c.clientWidth || 640;
  const h = c.clientHeight || 108;
  c.width = Math.floor(w * dpr);
  c.height = Math.floor(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  ctx.strokeStyle = '#1a1f27';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h / 2 + 0.5);
  ctx.lineTo(w, h / 2 + 0.5);
  ctx.stroke();

  if (!pcm || !pcm.length) return;

  const step = pcm.length / w;
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, '#3f8f73');
  grad.addColorStop(0.5, '#7fe3b8');
  grad.addColorStop(1, '#4fb98a');
  ctx.fillStyle = grad;

  for (let x = 0; x < w; x++) {
    const a = Math.floor(x * step);
    const b = Math.min(pcm.length, Math.floor((x + 1) * step));
    let lo = 0, hi = 0;
    for (let i = a; i < b; i++) {
      const v = pcm[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const y0 = h / 2 - hi * (h * 0.46);
    const y1 = h / 2 - lo * (h * 0.46);
    ctx.fillRect(x, y0, 1, Math.max(1, y1 - y0));
  }
}

// ---------- word chips ----------
function build_chips(track) {
  el.words.innerHTML = '';
  chips = [];
  for (let i = 0; i < track.word_times.length; i++) {
    const wt = track.word_times[i];
    const span = document.createElement('span');
    span.className = 'w';
    span.textContent = wt.text;
    span.dataset.index = String(i);
    span.title = `${wt.start.toFixed(2)}s`;
    el.words.appendChild(span);
    chips.push(span);
  }
  el.count.textContent = `${track.word_times.length} word${track.word_times.length === 1 ? '' : 's'}`;
}

function highlight(hit) {
  for (let i = 0; i < chips.length; i++) {
    const on = i === hit;
    chips[i].classList.toggle('on', on);
    chips[i].classList.toggle('done', hit >= 0 && i < hit);
  }
  if (hit >= 0 && chips[hit]) {
    const chip = chips[hit];
    const box = el.words;
    const top = chip.offsetTop - box.offsetTop;
    if (top < box.scrollTop || top + chip.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTop = top - box.clientHeight / 2 + chip.offsetHeight / 2;
    }
  }
}

function show_phones(tokens) {
  const lines = tokens
    .filter((t) => t.type === 'word')
    .map((t) => {
      const ph = (t.phones || []).map((p) => (p.s ? `${p.p}${p.s}` : p.p)).join(' ');
      return `<b>${t.text}</b>  ${ph}`;
    });
  el.phones.innerHTML = lines.join('\n');
}

// ---------- actions ----------
async function render_and_play() {
  const text = el.text.value.trim();
  if (!text) { set_status('nothing to read', ''); return; }
  if (busy) return;
  busy = true;
  el.speak.disabled = true;
  set_status('compiling', 'busy');

  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

  try {
    const opts = voice_opts();
    const { track, pcm, tokens } = await engine.render(text, opts);
    engine.volume = Number(el.volume.value);

    build_chips(track);
    show_phones(tokens);
    draw_wave(pcm);

    el.duration.textContent = `${track.duration.toFixed(2)}s · ${(pcm.length / 1000).toFixed(0)}k samples`;
    set_status('speaking', 'live');

    engine.onword = (hit) => highlight(hit);
    engine.onend = () => set_status('ready', '');
    engine.play(0);
  } catch (err) {
    console.error(err);
    set_status('error: ' + (err && err.message ? err.message : err), '');
  } finally {
    busy = false;
    el.speak.disabled = false;
  }
}

function stop_all() {
  engine.stop();
  set_status('stopped', '');
}

function save_wav() {
  const text = el.text.value.trim();
  if (!text) return;
  set_status('rendering wav', 'busy');
  try {
    const blob = engine.export_wav(text, { ...voice_opts(), sample_rate: 24000 });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `linx-${Date.now()}.wav`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    set_status('wav saved', '');
  } catch (err) {
    set_status('error: ' + err.message, '');
  }
}

// ---------- wiring ----------
el.speak.addEventListener('click', render_and_play);
el.stop.addEventListener('click', stop_all);
el.save.addEventListener('click', save_wav);

el.rate.addEventListener('input', () => {
  el.rateOut.textContent = `${Number(el.rate.value).toFixed(2)}×`;
});
el.pitch.addEventListener('input', () => {
  el.pitchOut.textContent = `${Number(el.pitch.value).toFixed(2)}×`;
});
el.breath.addEventListener('input', () => {
  el.breathOut.textContent = Number(el.breath.value).toFixed(3);
});
el.volume.addEventListener('input', () => {
  const v = Number(el.volume.value);
  el.volumeOut.textContent = `${Math.round(v * 100)}%`;
  engine.set_volume(v);
});

el.overrides.addEventListener('change', () => {
  localStorage.setItem(STORE_KEY, el.overrides.value);
  set_status('dictionary saved', '');
});

el.words.addEventListener('click', (ev) => {
  const chip = ev.target.closest('.w');
  if (!chip) return;
  const idx = Number(chip.dataset.index);
  const wt = engine.words[idx];
  if (!wt) return;
  engine.speak(wt.text, voice_opts()).catch(() => {});
});

window.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') { stop_all(); return; }
  if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
    ev.preventDefault();
    render_and_play();
  }
});

window.addEventListener('resize', () => {
  if (engine.pcm) draw_wave(engine.pcm);
});

set_status('ready', '');
