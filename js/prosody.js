// Language: JavaScript (ES module). Runtime: browser / Node 18+.
// Boundary: token+phoneme stream in, control-rate parameter track out. No I/O.

import { PHONEMES, VOWELS } from './phonemes.js';

export const FRAME_RATE = 400;
const VOWEL_DUR = 0.105;
const SCHWA = [520, 1350, 2450];
const F4_DEFAULT = 3400;

const VOICELESS_OBSTRUENT = new Set(['P', 'T', 'K', 'F', 'TH', 'S', 'SH', 'CH']);
const VOICED_CONS = new Set(['B', 'D', 'G', 'V', 'DH', 'Z', 'ZH', 'JH', 'M', 'N', 'NG', 'L', 'R', 'W', 'Y']);
const LOW_VOWEL = new Set(['AA', 'AE', 'AO', 'AY', 'AW']);

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash_str(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function seg(f, b, av, an, nf, nb, f4) {
  return {
    f1: f[0], f2: f[1], f3: f[2],
    b1: b[0], b2: b[1], b3: b[2],
    av, an, nf: nf || 2000, nb: nb || 2000,
    f4: f4 || F4_DEFAULT,
  };
}

function centralize(f, amount) {
  return [
    f[0] + (SCHWA[0] - f[0]) * amount,
    f[1] + (SCHWA[1] - f[1]) * amount,
    f[2] + (SCHWA[2] - f[2]) * amount,
  ];
}

export function build_utterance(tokens, opts = {}) {
  const rate = opts.rate ?? 1;
  const f0_base = opts.f0 ?? 115;
  const fscale = opts.formant_scale ?? 1;
  const breathiness = opts.breathiness ?? 0.03;
  const rng = mulberry32(hash_str(tokens.map((t) => t.text || '').join('|') || 'x'));

  const segments = [];
  const word_times = [];
  let t = 0.07;

  const next_is_pause = tokens.map((tk, i) => {
    const nx = tokens[i + 1];
    return !!nx && nx.type === 'pause';
  });

  // first phone of the next word, for cross-word pre-fortis effects
  const next_word_phone = (i) => {
    for (let k = i + 1; k < tokens.length; k++) {
      if (tokens[k].type === 'word') return (tokens[k].phones || [])[0]?.p || null;
      if (tokens[k].type === 'pause') return null;
    }
    return null;
  };

  // per-sentence prosody, so every sentence is not the same shape
  const sentence_params = new Map();
  const sentence_bounds = new Map();

  function params_for(sentence) {
    if (!sentence_params.has(sentence)) {
      sentence_params.set(sentence, {
        reset: 0.97 + rng() * 0.10,
        slope: 0.09 + rng() * 0.08,
        tempo: 1.03 + rng() * 0.09,
      });
    }
    return sentence_params.get(sentence);
  }

  for (let ti = 0; ti < tokens.length; ti++) {
    const tok = tokens[ti];
    if (tok.type === 'pause') {
      t += (tok.pause_ms / 1000) / Math.max(0.4, rate);
      continue;
    }
    const phones = tok.phones || [];
    if (!phones.length) continue;

    const sp = params_for(tok.sentence);
    if (!sentence_bounds.has(tok.sentence)) {
      sentence_bounds.set(tok.sentence, { start: t, end: t, question: false, params: sp });
    }
    const sb = sentence_bounds.get(tok.sentence);
    const word_start = t;

    for (let i = 0; i < phones.length; i++) {
      const ph = phones[i];
      const def = PHONEMES[ph.p];
      if (!def) continue;
      const last = i === phones.length - 1;
      const next_p = last ? next_word_phone(ti) : phones[i + 1]?.p;
      const stressed = ph.s === 1;

      let dur = (def.dur ?? VOWEL_DUR) / Math.max(0.4, rate) / sp.tempo;

      if (VOWELS.has(ph.p)) {
        dur *= stressed ? 1.0 : 0.74;
        if (LOW_VOWEL.has(ph.p)) dur *= 1.07;
        if (next_p && VOICELESS_OBSTRUENT.has(next_p)) dur *= 0.74;   // pre-fortis clipping
        else if (next_p && VOICED_CONS.has(next_p)) dur *= 1.16;      // voiced coda lengthens
      }
      if (last) dur *= 1.08;
      if (last && next_is_pause[ti]) dur *= 1.34;

      const F0 = def.f ? def.f.map((x) => x * fscale) : [500, 1500, 2500];
      let F = F0;
      if (VOWELS.has(ph.p) && !stressed) F = centralize(F0, def.type === 'diphthong' ? 0.30 : 0.46);
      const B = def.b ? def.b.map((x) => x * Math.sqrt(fscale)) : [80, 110, 160];
      if (VOWELS.has(ph.p) && !stressed) { B[0] *= 1.12; B[1] *= 1.08; }
      const f4 = def.f4 ? def.f4 * fscale : F4_DEFAULT * fscale;
      const breath = breathiness;

      switch (def.type) {
        case 'vowel': {
          const av = (stressed ? 1.0 : 0.84) * (def.gain ?? 1);
          segments.push({ t0: t, t1: t + dur, edge: 0.034, stress: stressed ? 1 : 0, ...seg(F, B, av, breath * 0.6, 2000, 2000, f4) });
          t += dur;
          break;
        }
        case 'diphthong': {
          let G = def.g.map((x) => x * fscale);
          if (!stressed) G = centralize(G, 0.18);
          const half = dur * 0.46;
          const g = def.gain ?? 1;
          const av = (stressed ? 1.0 : 0.84) * g;
          segments.push({ t0: t, t1: t + half, edge: 0.028, stress: stressed ? 1 : 0, ...seg(F, B, av, breath * 0.6, 2000, 2000, f4) });
          segments.push({ t0: t + half, t1: t + dur, edge: 0.026, stress: 0, ...seg(G, B, av * 0.86, breath * 0.6, 2000, 2000, f4) });
          t += dur;
          break;
        }
        case 'stop': {
          const closure = dur * 0.44;
          const burst_d = 0.014;
          const asp_d = def.v ? 0.006 : dur * 0.32;
          segments.push({ t0: t, t1: t + closure, edge: 0.010, ...seg(F, B, def.v ? 0.12 : 0.0, 0, 2000, 2000, f4) });
          t += closure;
          segments.push({
            t0: t, t1: t + burst_d, edge: 0.004,
            ...seg(F, B, def.v ? 0.18 : 0.0, def.burst[0], def.burst[1], def.burst[2], f4),
          });
          t += burst_d;
          if (asp_d > 0.003) {
            segments.push({ t0: t, t1: t + asp_d, edge: 0.010, ...seg(F, B, 0, def.asp, (F[1] + 900) / 2, 2200, f4) });
            t += asp_d;
          }
          break;
        }
        case 'affricate': {
          const closure = 0.036 / Math.max(0.4, rate);
          segments.push({ t0: t, t1: t + closure, edge: 0.008, ...seg([320, 1700, 2500], B, def.v ? 0.10 : 0, 0, 2000, 2000, f4) });
          t += closure;
          segments.push({
            t0: t, t1: t + dur * 0.72, edge: 0.010,
            ...seg([330, 1800, 2500], B, def.v ? 0.34 : 0.0, def.amp, def.nf, def.nb, f4),
          });
          t += dur * 0.72;
          break;
        }
        case 'fricative': {
          const av = def.v ? 0.46 : 0.0;
          segments.push({ t0: t, t1: t + dur, edge: 0.014, ...seg(F, B, av, def.amp, def.nf, def.nb, f4) });
          t += dur;
          break;
        }
        case 'aspirant': {
          const nf = (F[1] + 700) / 2;
          segments.push({ t0: t, t1: t + dur, edge: 0.018, ...seg(F, B, 0.0, def.amp, nf, 2500, f4) });
          t += dur;
          break;
        }
        case 'nasal': {
          segments.push({ t0: t, t1: t + dur, edge: 0.026, ...seg(F, B, def.amp, 0.0, 900, 1600, f4) });
          t += dur;
          break;
        }
        case 'liquid':
        case 'glide': {
          segments.push({ t0: t, t1: t + dur, edge: 0.026, ...seg(F, B, def.amp, breath * 0.4, 2000, 2000, f4) });
          t += dur;
          break;
        }
        case 'flap': {
          segments.push({ t0: t, t1: t + dur, edge: 0.006, ...seg(F, B, def.amp, 0.0, 2000, 2000, f4) });
          t += dur;
          break;
        }
        default:
          break;
      }
    }
    sb.end = t;
    if (next_is_pause[ti]) {
      const nx = tokens[ti + 1];
      if (nx && /[?]$/.test(nx.punct || '')) sb.question = true;
    }
    word_times.push({ start: word_start, end: t, text: tok.text, word_index: tok.word_index });
  }

  const total = t + 0.10;
  const n_frames = Math.max(2, Math.ceil(total * FRAME_RATE) + 1);

  // ---- control points: plateau + transition band per segment ----
  const cps = [];
  for (const s of segments) {
    const d = s.t1 - s.t0;
    const e = Math.min(s.edge, d * 0.45);
    const p = { f1: s.f1, f2: s.f2, f3: s.f3, f4: s.f4, b1: s.b1, b2: s.b2, b3: s.b3, av: s.av, an: s.an, nf: s.nf, nb: s.nb };
    cps.push({ t: s.t0 + e, ...p });
    cps.push({ t: s.t1 - e, ...p });
  }
  cps.sort((a, b) => a.t - b.t);
  if (!cps.length) cps.push({ t: 0, f1: 500, f2: 1500, f3: 2500, f4: 3400, b1: 80, b2: 110, b3: 160, av: 0, an: 0, nf: 2000, nb: 2000 });

  const f1 = new Float32Array(n_frames);
  const f2 = new Float32Array(n_frames);
  const f3 = new Float32Array(n_frames);
  const f4 = new Float32Array(n_frames);
  const b1 = new Float32Array(n_frames);
  const b2 = new Float32Array(n_frames);
  const b3 = new Float32Array(n_frames);
  const av = new Float32Array(n_frames);
  const an = new Float32Array(n_frames);
  const nf = new Float32Array(n_frames);
  const nb = new Float32Array(n_frames);
  const f0 = new Float32Array(n_frames);

  let j = 0;
  for (let k = 0; k < n_frames; k++) {
    const tt = k / FRAME_RATE;
    while (j < cps.length - 1 && cps[j + 1].t <= tt) j++;
    const a = cps[j];
    const b = cps[Math.min(j + 1, cps.length - 1)];
    const span = b.t - a.t;
    let u = span > 1e-6 ? (tt - a.t) / span : 0;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    // formants travel along an S-curve, not a straight line: that is most of
    // the difference between "beeping" and "speaking"
    const s = u * u * (3 - 2 * u);
    f1[k] = a.f1 + (b.f1 - a.f1) * s;
    f2[k] = a.f2 + (b.f2 - a.f2) * s;
    f3[k] = a.f3 + (b.f3 - a.f3) * s;
    f4[k] = a.f4 + (b.f4 - a.f4) * s;
    b1[k] = a.b1 + (b.b1 - a.b1) * u;
    b2[k] = a.b2 + (b.b2 - a.b2) * u;
    b3[k] = a.b3 + (b.b3 - a.b3) * u;
    av[k] = a.av + (b.av - a.av) * u;
    an[k] = a.an + (b.an - a.an) * u;
    nf[k] = a.nf + (b.nf - a.nf) * u;
    nb[k] = a.nb + (b.nb - a.nb) * u;
  }

  // ---- voicing envelope: attack/release per continuous voiced run ----
  envelope_voicing(av, segments, n_frames);
  smooth(an, 1);
  smooth(nf, 1);
  smooth(b1, 1);
  smooth(b2, 1);
  smooth(b3, 1);

  // ---- formant drift: no two utterances of the same word are identical ----
  drift(f1, rng, 0.012);
  drift(f2, rng, 0.010);
  drift(f3, rng, 0.009);

  // ---- F0: declination per sentence, stress accents, question rise ----
  for (let k = 0; k < n_frames; k++) {
    const tt = k / FRAME_RATE;
    let sb = null;
    for (const v of sentence_bounds.values()) {
      if (tt >= v.start - 0.02 && tt <= v.end + 0.25) { sb = v; break; }
    }
    const span = sb ? Math.max(0.2, sb.end - sb.start) : 1;
    const pos = sb ? Math.min(1, Math.max(0, (tt - sb.start) / span)) : 0;
    const pp = sb ? sb.params : { reset: 1.0, slope: 0.12 };
    let factor = (pp.reset - pp.slope * pos);

    if (sb && sb.question && pos > 0.62) {
      const q = (pos - 0.62) / 0.38;
      factor += 0.28 * q * q;
    }
    f0[k] = f0_base * factor;
  }

  for (const s of segments) {
    if (!s.stress) continue;
    const c = (s.t0 + s.t1) / 2;
    const half = Math.max(0.07, (s.t1 - s.t0) * 0.95);
    const k0 = Math.max(0, Math.floor((c - half) * FRAME_RATE));
    const k1 = Math.min(n_frames - 1, Math.ceil((c + half) * FRAME_RATE));
    for (let k = k0; k <= k1; k++) {
      const u = (k / FRAME_RATE - (c - half)) / (2 * half);
      const w = Math.sin(Math.PI * Math.min(1, Math.max(0, u)));
      f0[k] *= 1 + 0.13 * Math.pow(w, 1.5);
    }
  }

  for (let k = 0; k < n_frames; k++) {
    f0[k] *= 1 + (rng() - 0.5) * 0.014;
    if (f0[k] < 55) f0[k] = 55;
  }
  smooth(f0, 3);

  return {
    frame_rate: FRAME_RATE,
    n_frames,
    duration: total,
    f1, f2, f3, f4, b1, b2, b3, av, an, nf, nb, f0,
    word_times,
  };
}

// Raised-cosine rise and fall over each continuous voiced stretch, so words
// start and end like a mouth opening instead of a gate switching on.
function envelope_voicing(av, segments, n_frames) {
  const runs = [];
  for (const s of segments) {
    if (s.av <= 0.02) continue;
    const last = runs[runs.length - 1];
    if (last && s.t0 - last.end < 0.012) {
      last.end = Math.max(last.end, s.t1);
    } else {
      runs.push({ start: s.t0, end: s.t1 });
    }
  }
  for (const r of runs) {
    const len = r.end - r.start;
    const attack = Math.min(0.022, len * 0.3);
    const release = Math.min(0.055, len * 0.45);
    const a0 = Math.floor(r.start * FRAME_RATE);
    const a1 = Math.floor((r.start + attack) * FRAME_RATE);
    const r1 = Math.floor((r.end - release) * FRAME_RATE);
    const r2 = Math.floor(r.end * FRAME_RATE);
    for (let k = Math.max(0, a0); k < Math.min(n_frames, a1); k++) {
      const u = (k - a0) / Math.max(1, a1 - a0);
      av[k] *= 0.5 - 0.5 * Math.cos(Math.PI * u);
    }
    for (let k = Math.max(0, r1); k < Math.min(n_frames, r2); k++) {
      const u = (k - r1) / Math.max(1, r2 - r1);
      av[k] *= 0.5 + 0.5 * Math.cos(Math.PI * u);
    }
  }
  smooth(av, 1);
}

// Slow random walk, not per-frame noise: gives an organic wander.
function drift(arr, rng, amount) {
  let cur = 0;
  let target = 0;
  for (let i = 0; i < arr.length; i++) {
    if (i % 24 === 0) target = (rng() - 0.5) * 2 * amount;
    cur += (target - cur) * 0.06;
    arr[i] *= 1 + cur;
  }
}

function smooth(arr, radius) {
  if (radius < 1) return;
  const n = arr.length;
  const tmp = new Float32Array(n);
  const w = radius * 2 + 1;
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let d = -radius; d <= radius; d++) {
      const idx = Math.min(n - 1, Math.max(0, i + d));
      sum += arr[idx];
    }
    tmp[i] = sum / w;
  }
  arr.set(tmp);
}
