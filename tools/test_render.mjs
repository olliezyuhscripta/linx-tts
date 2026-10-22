// Language: JavaScript (ES module). Runtime: Node 18+.
// Boundary: local only — renders phrases to /tmp/opencode and asserts DSP +
// G2P behaviour. No network.

import { writeFileSync, mkdirSync } from 'node:fs';
import { normalize } from '../js/normalize.js';
import { g2p } from '../js/g2p.js';
import { build_utterance } from '../js/prosody.js';
import { render_track, encode_wav } from '../js/dsp.js';

const SR = 24000;

function phonemize_text(text) {
  const tokens = normalize(text);
  for (const tk of tokens) {
    if (tk.type === 'word') tk.phones = g2p(tk.text);
  }
  return tokens;
}

function show(text) {
  const tokens = phonemize_text(text);
  const line = tokens
    .map((tk) => (tk.type === 'word' ? tk.phones.map((p) => p.p + (p.s ? '1' : '')).join(' ') : `[${tk.pause_ms}ms]`))
    .join('  ');
  console.log(`  "${text}"\n    -> ${line}`);
}

console.log('== G2P ==');
for (const w of [
  'hello', 'world', 'computer', 'banana', 'nation', 'music', 'ability',
  'understand', 'beautiful', 'strength', 'thought', 'laughter', 'knight',
  'psychology', 'schedule', 'running', 'jumped', 'cats', 'dogs', 'table',
  'little', 'information', 'encyclopedia', 'extraordinary',
]) {
  const ph = g2p(w).map((p) => p.p + (p.s ? '1' : '')).join(' ');
  console.log(`  ${w.padEnd(16)} ${ph}`);
}

console.log('\n== Normalization ==');
show('Dr. Smith arrived at 3:30 on 10/22/2026 with $4.50 and 21% more.');
show('I have 1,234 apples and 1995 was a good year!');
show("Don't you think it's easier?");

console.log('\n== Render ==');
mkdirSync('/tmp/opencode', { recursive: true });

const phrase = 'Hello. This is the engine speaking with a natural voice. ' +
  'It pronounces every word from a written pronunciation model.';
const tokens = phonemize_text(phrase);
const track = build_utterance(tokens, { rate: 1, f0: 115, formant_scale: 1 });
const pcm = render_track(track, SR);

let peak = 0, sum = 0, nan = 0, dc = 0;
for (let i = 0; i < pcm.length; i++) {
  const v = pcm[i];
  if (!Number.isFinite(v)) nan++;
  const a = Math.abs(v);
  if (a > peak) peak = a;
  sum += v * v;
  dc += v;
}
const rms = Math.sqrt(sum / pcm.length);
console.log(`  samples ${pcm.length} (${(pcm.length / SR).toFixed(2)}s)`);
console.log(`  peak ${peak.toFixed(4)}  rms ${rms.toFixed(4)}  dc ${(dc / pcm.length).toFixed(5)}  nan ${nan}`);
console.log(`  words timed: ${track.word_times.length}`);

writeFileSync('/tmp/opencode/tts_phrase.wav', encode_wav(pcm, SR));

// ---- formant accuracy: render a sustained /ɑ/ and locate spectral peaks ----
function goertzel(sig, freq, sr) {
  const k = (2 * Math.PI * freq) / sr;
  const c = 2 * Math.cos(k);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < sig.length; i++) {
    const s0 = sig[i] + c * s1 - s2;
    s2 = s1; s1 = s0;
  }
  return Math.sqrt(s1 * s1 + s2 * s2 - c * s1 * s2) / sig.length;
}

const vowel_token = { type: 'word', text: 'ah', sentence: 0, word_index: 0, phones: [{ p: 'AA', s: 1 }] };
const vt = build_utterance([vowel_token], { rate: 1, f0: 115 });
const vpcm = render_track(vt, SR);
const from = Math.floor(0.06 * SR);
const slice = vpcm.slice(from, from + Math.floor(0.08 * SR));

const spectrum = [];
for (let f = 150; f <= 3200; f += 2) spectrum.push([f, goertzel(slice, f, SR)]);
const peaks = [];
for (let i = 3; i < spectrum.length - 3; i++) {
  const [f, m] = spectrum[i];
  if (m > spectrum[i - 1][1] && m > spectrum[i + 1][1] &&
      m > spectrum[i - 3][1] && m > spectrum[i + 3][1]) peaks.push([Math.round(f), m]);
}
peaks.sort((a, b) => b[1] - a[1]);
console.log('\n== Formant check (/AA/ expected F1~730 F2~1090 F3~2440, f0=115) ==');
for (const [target, label] of [[730, 'F1'], [1090, 'F2'], [2440, 'F3']]) {
  let best = null;
  for (const [f, m] of peaks) {
    if (Math.abs(f - target) <= 130 && (!best || m > best[1])) best = [f, m];
  }
  const dev = best ? best[0] - target : NaN;
  const pct = Math.abs(dev / target) * 100;
  console.log(`  ${label} target ${target}  nearest peak ${best ? best[0] + 'Hz' : 'none'}  dev ${dev}Hz (${pct.toFixed(1)}%)  ${pct <= 6 ? 'OK' : 'CHECK'}`);
}
console.log('  top peaks:', peaks.slice(0, 6).map(([f, m]) => `${f}Hz`).join('  '));

// ---- fricative energy check ----
const s_token = { type: 'word', text: 's', sentence: 0, word_index: 0, phones: [{ p: 'S', s: 0 }] };
const st = build_utterance([s_token], { rate: 1, f0: 115 });
const spcm = render_track(st, SR);
const ss = spcm.slice(Math.floor(0.09 * SR), Math.floor(0.15 * SR));
let ssum = 0;
for (const v of ss) ssum += v * v;
console.log(`\n  /S/ rms ${Math.sqrt(ssum / ss.length).toFixed(4)}  centroid-ish 6000Hz ${goertzel(ss, 6000, SR).toFixed(6)}`);

// ---- pitch: autocorrelation on a sustained vowel ----
function f0_estimate(sig, sr, min = 60, max = 420) {
  const lo = Math.floor(sr / max);
  const hi = Math.min(Math.floor(sr / min), sig.length - 8);
  const nc = new Float32Array(hi + 1);
  let best = -1;
  for (let lag = lo; lag < hi; lag++) {
    let s = 0, e1 = 0, e2 = 0;
    for (let i = 0; i < sig.length - lag; i++) {
      s += sig[i] * sig[i + lag];
      e1 += sig[i] * sig[i];
      e2 += sig[i + lag] * sig[i + lag];
    }
    nc[lag] = s / Math.sqrt(Math.max(1e-12, e1 * e2));
    if (nc[lag] > best) best = nc[lag];
  }
  // shortest lag within 92% of the global peak: avoids octave-down errors
  for (let lag = lo + 1; lag < hi - 1; lag++) {
    if (nc[lag] >= best * 0.92 && nc[lag] >= nc[lag - 1] && nc[lag] >= nc[lag + 1]) {
      return sr / lag;
    }
  }
  return 0;
}

const mid = Math.floor(0.10 * SR);
const win = vpcm.slice(mid, mid + 2048);
const measured = f0_estimate(win, SR);
const frame_at = Math.round((mid / SR) * track.frame_rate);
const expected = vt.f0[Math.min(vt.n_frames - 1, frame_at)];
console.log(`\n== Pitch check == expected ${expected.toFixed(1)}Hz  measured ${measured.toFixed(1)}Hz  ` +
  `${Math.abs(measured - expected) / expected < 0.08 ? 'OK' : 'CHECK'}`);

// ---- spectral character per phoneme ----
function band_ratio(sig, sr, a, b) {
  return goertzel(sig, a, sr) / Math.max(1e-9, goertzel(sig, b, sr));
}
const s_window = spcm.slice(Math.floor(0.10 * SR), Math.floor(0.10 * SR) + 1024);
console.log(`  /S/ 6k:1k ratio ${band_ratio(s_window, SR, 6000, 1000).toFixed(2)} (expect > 1)`);
console.log(`  /AA/ 6k:1k ratio ${band_ratio(win, SR, 6000, 1000).toFixed(2)} (expect < 1)`);

writeFileSync('/tmp/opencode/tts_vowel.wav', encode_wav(vpcm, SR));

// ---- full pipeline through the engine module ----
import { TtsEngine } from '../js/engine.js';

console.log('\n== Engine pipeline ==');
const eng = new TtsEngine();
const cases = [
  '',
  'hello, world!',
  'The quick brown fox jumps over the lazy dog.',
  'Pi is 3.14159 and the year is 2026.',
  'She said, "I will not do that." Then she left.',
  'supercalifragilisticexpialidocious',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'MiXeD CaSe 12%% -- and dashes --- here.',
];
for (const c of cases) {
  try {
    const { track } = eng.compile(c, { rate: 1, f0: 112, formant_scale: 0.95, breathiness: 0.02, overrides: {} });
    const pcm = render_track(track, SR);
    let bad = 0, peak = 0;
    for (const v of pcm) { if (!Number.isFinite(v)) bad++; if (Math.abs(v) > peak) peak = Math.abs(v); }
    const words = track.word_times.length;
    console.log(`  ${JSON.stringify(c).slice(0, 42).padEnd(44)} words ${String(words).padStart(2)}  ${(pcm.length / SR).toFixed(2)}s  peak ${peak.toFixed(3)}  bad ${bad}`);
  } catch (err) {
    console.log(`  FAIL ${JSON.stringify(c)}: ${err.message}`);
  }
}

// ---- timing sanity ----
const wt = track.word_times;
let monotonic = true;
for (let i = 1; i < wt.length; i++) if (wt[i].start < wt[i - 1].start) monotonic = false;
console.log(`\n  word times monotonic: ${monotonic}  last end ${wt[wt.length - 1].end.toFixed(2)}s of ${track.duration.toFixed(2)}s`);

console.log('\nwrote /tmp/opencode/tts_phrase.wav and /tmp/opencode/tts_vowel.wav');
