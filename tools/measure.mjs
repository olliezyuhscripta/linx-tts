// Language: JavaScript (ES module). Runtime: Node 18+.
// Boundary: local measurement only.

import { build_utterance } from '../js/prosody.js';
import { render_track } from '../js/dsp.js';

const SR = 24000;

function rms_of(pcm, a = 0, b = 1) {
  let s = 0, n = 0, peak = 0;
  for (let i = Math.floor(a * SR); i < Math.min(pcm.length, Math.floor(b * SR)); i++) {
    const v = pcm[i];
    s += v * v; n++;
    if (Math.abs(v) > peak) peak = Math.abs(v);
  }
  return { rms: Math.sqrt(s / n), peak, n };
}

function one(p, stress = 1) {
  const tok = { type: 'word', text: 'x', sentence: 0, word_index: 0, phones: [{ p, s: stress }] };
  const track = build_utterance([tok], { rate: 1, f0: 115, breathiness: 0 });
  const pcm = render_track(track, SR);
  return rms_of(pcm, 0.10, 0.14);
}

for (const p of ['AA', 'IY', 'UW', 'AH', 'S', 'SH', 'F', 'M', 'L', 'P', 'T']) {
  const r = one(p);
  console.log(`${p.padEnd(3)} rms ${r.rms.toFixed(6)}  peak ${r.peak.toFixed(6)}`);
}
