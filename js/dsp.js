// Language: JavaScript (ES module). Runtime: browser / Node 18+.
// Boundary: control-rate parameter track in, PCM Float32Array out. No I/O.
//
// Source-filter formant synthesizer:
//   Rosenberg glottal flow with per-period jitter, shimmer and open-quotient
//   drift -> differentiated (flow derivative) -> spectral tilt
//   + white noise through a tunable band resonator (frication / aspiration)
//   -> 4-pole cascade (F1..F4) with per-block coefficient updates
//   -> DC/rumble high-pass -> soft-knee compressor -> loudness normalise.
//
// master() is a separate pass so the export path and the live path sound alike.

const TWO_PI = Math.PI * 2;

// Tuned by tools/calibrate.mjs — target voiced RMS ~0.11 before master().
const OUT_GAIN = 74;
const NOISE_GAIN = 0.9;
const TILT_HZ = 3400;
const PAR_GAIN = 1.3;   // parallel branch level, set by tools/calibrate.mjs
const PAR_HP_HZ = 1300;
const HP_HZ = 75;

class Res {
  constructor() {
    this.a1 = 0; this.a2 = 0; this.g = 1; this.y1 = 0; this.y2 = 0;
  }
  set(freq, bw, fs) {
    const f = Math.max(30, Math.min(freq, fs * 0.45));
    const r = Math.exp(-Math.PI * Math.max(bw, 25) / fs);
    const th = TWO_PI * f / fs;
    this.a1 = 2 * r * Math.cos(th);
    this.a2 = -r * r;
    this.g = (1 - r) * Math.sqrt(Math.max(1e-9, 1 - 2 * r * Math.cos(2 * th) + r * r));
  }
  run(x) {
    const y = this.g * x + this.a1 * this.y1 + this.a2 * this.y2;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

// Rosenberg glottal flow, normalised phase [0,1). tp = open phase, tn = closing.
function glottal(ph, tp, tn) {
  if (ph < tp) {
    const u = ph / tp;
    return u * u * (3 - 2 * u);
  }
  if (ph < tp + tn) {
    const u = (ph - tp) / tn;
    return 1 - u * u;
  }
  return 0;
}

const MAX_SLOPE = 2.42;
const TP0 = 0.62;
const TN0 = 0.22;

function gauss() {
  // sum of two uniforms: cheap, bounded, close enough to gaussian
  return (Math.random() + Math.random() - 1);
}

export function render_track(track, sample_rate, opts = {}) {
  const n = Math.max(1, Math.ceil(track.duration * sample_rate));
  const out = new Float32Array(n);
  const fr = track.frame_rate;
  const nf = track.n_frame || track.n_frames;
  const last = Math.max(0, nf - 2);
  const f4 = track.f4 || null;

  const r1 = new Res();
  const r2 = new Res();
  const r3 = new Res();
  const r4 = new Res();
  const r5 = new Res();
  const rn = new Res();

  let phase = 0.13;
  let prev_flow = 0;
  let tilt = 0;
  const tilt_k = 1 - Math.exp(-TWO_PI * TILT_HZ / sample_rate);

  // high-pass state
  const hp_a = Math.exp(-TWO_PI * HP_HZ / sample_rate);
  let hp_x1 = 0;
  let hp_y1 = 0;

  // the parallel high-formant branch is fed through a 2-pole high-pass so it
  // only fills 1.3 kHz upward instead of leaking into the vowel body
  const pa = Math.exp(-TWO_PI * PAR_HP_HZ / sample_rate);
  let pa_in0 = 0, pa_h1a = 0, pa_h1b = 0, pa_out0 = 0;
  // and a 2-pole low-pass above it, so the branch fills the presence region
  // without hissing up to Nyquist
  const pl = 1 - Math.exp(-TWO_PI * 4200 / sample_rate);
  let pl1 = 0, pl2 = 0;

  // per-period voice quality
  let tp = TP0;
  let tn = TN0;
  let f0_pert = 1;
  let amp_pert = 1;

  // the noise band resonator's output power scales as bw/fs, so keep the
  // consonant/vowel balance identical at 24 kHz and 48 kHz
  const noise_gain = NOISE_GAIN * Math.sqrt(sample_rate / 24000);

  const BLOCK = 32;
  let i = 0;

  while (i < n) {
    const pos = (i / sample_rate) * fr;
    const idx = Math.min(last, Math.floor(pos));
    const frac = Math.min(1, Math.max(0, pos - idx));

    const bx1 = track.b1[idx] + (track.b1[idx + 1] - track.b1[idx]) * frac;
    const bx2 = track.b2[idx] + (track.b2[idx + 1] - track.b2[idx]) * frac;
    const bx3 = track.b3[idx] + (track.b3[idx + 1] - track.b3[idx]) * frac;
    r1.set(track.f1[idx] + (track.f1[idx + 1] - track.f1[idx]) * frac, bx1, sample_rate);
    r2.set(track.f2[idx] + (track.f2[idx + 1] - track.f2[idx]) * frac, bx2, sample_rate);
    r3.set(track.f3[idx] + (track.f3[idx + 1] - track.f3[idx]) * frac, bx3, sample_rate);
    if (f4) r4.set(f4[idx] + (f4[idx + 1] - f4[idx]) * frac, 500, sample_rate);
    else r4.set(3400, 500, sample_rate);
    // wide fixed F5: fills the 3-6 kHz region that a 4-pole cascade leaves empty
    r5.set(4600, 1100, sample_rate);
    rn.set(track.nf[idx] + (track.nf[idx + 1] - track.nf[idx]) * frac,
      track.nb[idx] + (track.nb[idx + 1] - track.nb[idx]) * frac, sample_rate);

    const block = Math.min(BLOCK, n - i);
    for (let k = 0; k < block; k++) {
      const p = ((i + k) / sample_rate) * fr;
      const fi = Math.min(last, Math.floor(p));
      const ff = Math.min(1, Math.max(0, p - fi));

      const av = track.av[fi] + (track.av[fi + 1] - track.av[fi]) * ff;
      const an = track.an[fi] + (track.an[fi + 1] - track.an[fi]) * ff;
      const f0 = track.f0[fi] + (track.f0[fi + 1] - track.f0[fi]) * ff;

      const dph = Math.max(1e-7, (f0 / sample_rate) * f0_pert);
      phase += dph;
      if (phase >= 1) {
        phase -= 1;
        // one draw per glottal period: this is what stops it sounding synthetic
        tp = TP0 + gauss() * 0.035;
        tn = TN0 + gauss() * 0.020;
        f0_pert = 1 + gauss() * 0.006;
        amp_pert = 1 + gauss() * 0.05;
      }

      const flow = glottal(phase, tp, tn);
      const exc = ((flow - prev_flow) / (dph * MAX_SLOPE)) * amp_pert;
      prev_flow = flow;

      tilt += tilt_k * (exc - tilt);

      const src = tilt * av;
      // two cascaded one-pole high-passes -> ~12 dB/oct below PAR_HP_HZ
      pa_h1a = pa * (pa_h1a + src - pa_in0);
      pa_in0 = src;
      pa_h1b = pa * (pa_h1b + pa_h1a - pa_out0);
      pa_out0 = pa_h1a;
      pl1 += pl * (pa_h1b - pl1);
      pl2 += pl * (pl1 - pl2);
      const src_hi = pl2;

      let x = r1.run(src);
      x = r2.run(x);
      x = r3.run(x);

      // F4/F5 are summed in parallel, not cascaded. Cascading five resonators
      // multiplies every upstream stopband and leaves the 2-6 kHz region empty,
      // which reads as "muffled" and buries consonant cues.
      const par = (r4.run(src_hi) + r5.run(src_hi) * 0.7) * PAR_GAIN;
      let y = opts.path === 'parallel' ? par : opts.path === 'cascade' ? x * OUT_GAIN : x * OUT_GAIN + par;

      // frication / aspiration runs in parallel: the front cavity shapes it,
      // not the vowel formants, so it stays sibilant instead of going muddy.
      if (an > 1e-4) {
        y += rn.run(Math.random() * 2 - 1) * an * noise_gain;
      }

      // one-pole high-pass: kills sub-audio drift and rumble
      const hp = hp_a * (hp_y1 + y - hp_x1);
      hp_x1 = y;
      hp_y1 = hp;

      out[i + k] = hp;
    }
    i += block;
  }

  if (opts.raw) return out;
  return master(out, sample_rate, opts);
}

// Loudness stage: compressor -> RMS normalise -> soft clip.
// Without this the engine sits ~12 dB below normal speech and mumbles.
export function master(pcm, sample_rate, opts = {}) {
  const n = pcm.length;
  if (!n) return pcm;

  const target_rms = opts.rms ?? 0.19;
  const thr_db = opts.threshold_db ?? -27;
  const ratio = opts.ratio ?? 3.2;

  const win = Math.max(16, Math.round(sample_rate * 0.01));
  const nb = Math.ceil(n / win);
  const env = new Float32Array(nb);

  for (let b = 0; b < nb; b++) {
    let s = 0, c = 0;
    const a = b * win;
    const z = Math.min(n, a + win);
    for (let i = a; i < z; i++) { s += pcm[i] * pcm[i]; c++; }
    env[b] = Math.sqrt(s / Math.max(1, c));
  }

  // gain reduction per block, then smoothed with fast attack / slow release
  const gdb = new Float32Array(nb);
  for (let b = 0; b < nb; b++) {
    const level = 20 * Math.log10(env[b] + 1e-7);
    const over = Math.max(0, level - thr_db);
    gdb[b] = -over * (1 - 1 / ratio);
  }
  const smooth = new Float32Array(nb);
  let cur = gdb[0];
  for (let b = 0; b < nb; b++) {
    const coeff = gdb[b] < cur ? 0.6 : 0.12;
    cur += (gdb[b] - cur) * coeff;
    smooth[b] = cur;
  }

  // apply with per-sample interpolation of the block gain
  let sum = 0;
  for (let b = 0; b < nb; b++) {
    const a = b * win;
    const z = Math.min(n, a + win);
    const g0 = Math.pow(10, smooth[b] / 20);
    const g1 = Math.pow(10, smooth[Math.min(nb - 1, b + 1)] / 20);
    const step = (g1 - g0) / Math.max(1, z - a);
    for (let i = a; i < z; i++) {
      const g = g0 + step * (i - a);
      pcm[i] *= g;
      sum += pcm[i] * pcm[i];
    }
  }

  // normalise on the whole utterance
  const rms = Math.sqrt(sum / n);
  const gain = rms > 1e-6 ? Math.min(6, target_rms / rms) : 1;
  for (let i = 0; i < n; i++) pcm[i] *= gain;

  // peak limiter: 20 ms lookahead gain ride, so transients never clip and the
  // clip stage below stays a no-op
  const LIM = 0.89;
  const pw = Math.max(8, Math.round(sample_rate * 0.005));
  const pn = Math.ceil(n / pw);
  const pk = new Float32Array(pn);
  for (let b = 0; b < pn; b++) {
    let m = 0;
    const a = b * pw;
    const z = Math.min(n, a + pw);
    for (let i = a; i < z; i++) { const v = pcm[i] < 0 ? -pcm[i] : pcm[i]; if (v > m) m = v; }
    pk[b] = m;
  }
  const g2 = new Float32Array(pn);
  for (let b = 0; b < pn; b++) g2[b] = pk[b] > LIM ? LIM / pk[b] : 1;
  const held = new Float32Array(pn);
  for (let b = 0; b < pn; b++) {
    let m = 1;
    for (let d = 0; d <= 4; d++) {
      const v = g2[Math.min(pn - 1, b + d)];
      if (v < m) m = v;
    }
    held[b] = m;
  }
  const sm = new Float32Array(pn);
  for (let b = 0; b < pn; b++) {
    let s = 0, c = 0;
    for (let d = -3; d <= 3; d++) {
      const v = held[Math.min(pn - 1, Math.max(0, b + d))];
      s += v; c++;
    }
    // smoothing may only ever reduce gain at the peak, never restore it
    sm[b] = Math.min(s / c, held[b]);
  }
  for (let b = 0; b < pn; b++) {
    const a = b * pw;
    const z = Math.min(n, a + pw);
    const g0 = sm[b];
    const g1 = sm[Math.min(pn - 1, b + 1)];
    const step = (g1 - g0) / Math.max(1, z - a);
    // never let interpolation restore gain above what this window's own peak allows
    const safe = g2[b];
    for (let i = a; i < z; i++) {
      const g = g0 + step * (i - a);
      pcm[i] *= g < safe ? g : safe;
    }
  }

  // final safety knee
  for (let i = 0; i < n; i++) {
    const x = pcm[i];
    const a = x < 0 ? -x : x;
    if (a > 0.92) {
      const y = 0.92 + 0.08 * Math.tanh((a - 0.92) / 0.08);
      pcm[i] = x < 0 ? -y : y;
    }
  }

  return pcm;
}

export function encode_wav(samples, sample_rate) {
  const n = samples.length;
  const buffer = new ArrayBuffer(44 + n * 2);
  const view = new DataView(buffer);
  const write_str = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };

  write_str(0, 'RIFF');
  view.setUint32(4, 36 + n * 2, true);
  write_str(8, 'WAVE');
  write_str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sample_rate, true);
  view.setUint32(28, sample_rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write_str(36, 'data');
  view.setUint32(40, n * 2, true);

  let off = 44;
  for (let i = 0; i < n; i++) {
    let s = samples[i];
    if (s > 1) s = 1; else if (s < -1) s = -1;
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    off += 2;
  }
  return new Uint8Array(buffer);
}
