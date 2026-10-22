// Language: JavaScript (ES module). Runtime: Node 18+.
// Boundary: local measurement only. Probes each consonant at a low amplitude
// with the limiter disabled, then prints the amplitude that hits a target
// loudness relative to a 0.112 RMS vowel.

import { PHONEMES } from '../js/phonemes.js';
import { build_utterance } from '../js/prosody.js';
import { render_track } from '../js/dsp.js';

const SR = 24000;
const T0 = 0.07;
const PROBE = 0.1;

function render(p) {
  const tok = { type: 'word', text: 'x', sentence: 0, word_index: 0, phones: [{ p, s: 0 }] };
  const track = build_utterance([tok], { rate: 1, f0: 115, breathiness: 0 });
  return render_track(track, SR, { raw: true });
}

function stats(pcm, a, b, mode) {
  let s = 0, n = 0, peak = 0;
  for (let i = Math.floor(a * SR); i < Math.min(pcm.length, Math.floor(b * SR)); i++) {
    const v = pcm[i];
    s += v * v; n++;
    if (Math.abs(v) > peak) peak = Math.abs(v);
  }
  return mode === 'peak' ? peak : Math.sqrt(s / Math.max(1, n));
}

function dur_of(p) { return PHONEMES[p].dur * 1.1; }

console.log('// fricatives: rms target 0.085');
for (const p of ['F', 'TH', 'S', 'SH', 'V', 'DH', 'Z', 'ZH']) {
  const def = PHONEMES[p];
  const backup = def.amp;
  def.amp = PROBE;
  const pcm = render(p);
  const d = dur_of(p);
  const unit = stats(pcm, T0 + 0.012, T0 + d - 0.012) / PROBE;
  def.amp = backup;
  const target = def.v ? 0.052 : 0.085;
  console.log(`  ${p}: amp ${(target / unit).toFixed(3)}`);
}

console.log('// affricates: rms target 0.070');
for (const p of ['CH', 'JH']) {
  const def = PHONEMES[p];
  const backup = def.amp;
  def.amp = PROBE;
  const pcm = render(p);
  const start = T0 + 0.036 + 0.02;
  const end = T0 + 0.036 + dur_of(p) * 0.7 - 0.015;
  const unit = stats(pcm, start, end) / PROBE;
  def.amp = backup;
  console.log(`  ${p}: amp ${(0.070 / unit).toFixed(3)}`);
}

console.log('// stops: burst peak target 0.30');
for (const p of ['P', 'T', 'K', 'B', 'D', 'G']) {
  const def = PHONEMES[p];
  const backup = def.burst[0];
  def.burst[0] = PROBE;
  const pcm = render(p);
  const b0 = T0 + dur_of(p) * 0.46;
  const unit = stats(pcm, b0 + 0.001, b0 + 0.012, 'peak') / PROBE;
  def.burst[0] = backup;
  console.log(`  ${p}: burst ${(0.30 / unit).toFixed(3)}`);
  if (!def.v) {
    const asp_backup = def.asp;
    const burst_backup2 = def.burst[0];
    def.asp = PROBE;
    def.burst[0] = 0;
    const pcm2 = render(p);
    const a0 = b0 + 0.013;
    const a1 = a0 + dur_of(p) * 0.34;
    const asp_unit = stats(pcm2, a0 + 0.004, a1, 'rms') / PROBE;
    def.asp = asp_backup;
    def.burst[0] = burst_backup2;
    console.log(`  ${p}: asp   ${(0.045 / Math.max(1e-6, asp_unit)).toFixed(3)}`);
  }
}

console.log('// HH: rms target 0.045');
{
  const def = PHONEMES.HH;
  const backup = def.amp;
  def.amp = PROBE;
  const pcm = render('HH');
  const unit = stats(pcm, T0 + 0.014, T0 + dur_of('HH') - 0.01) / PROBE;
  def.amp = backup;
  console.log(`  HH: amp ${(0.045 / unit).toFixed(3)}`);
}

console.log('// vowels: gain for a 0.105 rms target (av stretched to 1.0)');
for (const p of ['IY', 'IH', 'EH', 'AE', 'AA', 'AO', 'UH', 'UW', 'AH', 'AX', 'ER',
                  'EY', 'AY', 'OY', 'AW', 'OW']) {
  const def = PHONEMES[p];
  const backup = def.gain;
  def.gain = 1;
  const tok = { type: 'word', text: 'x', sentence: 0, word_index: 0, phones: [{ p, s: 1 }] };
  const track = build_utterance([tok], { rate: 1, f0: 115, breathiness: 0 });
  for (let i = 0; i < track.av.length; i++) track.av[i] = Math.min(1, track.av[i]);
  def.gain = backup;
  const pcm = render_track(track, SR, { raw: true });
  const r = stats(pcm, T0 + 0.03, T0 + 0.10);
  const g = Math.max(0.5, Math.min(2.0, 0.105 / Math.max(1e-5, r)));
  console.log(`  ${p}: rms ${r.toFixed(4)} gain ${g.toFixed(2)}`);
}
