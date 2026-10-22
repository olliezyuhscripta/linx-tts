// Language: JavaScript (ES module). Runtime: browser (AudioContext).
// Boundary: text in, audible PCM + timing events out. No network, no storage
// beyond the caller's own overrides object.

import { normalize } from './normalize.js';
import { g2p, clear_cache } from './g2p.js';
import { build_utterance } from './prosody.js';
import { render_track, encode_wav } from './dsp.js';

export const VOICES = {
  male: {
    label: 'Atlas (male)',
    f0: 112,
    formant_scale: 0.95,
    breathiness: 0.02,
    rate: 1.0,
  },
  female: {
    label: 'Lyra (female)',
    f0: 196,
    formant_scale: 1.14,
    breathiness: 0.03,
    rate: 1.0,
  },
  deep: {
    label: 'Basalt (deep)',
    f0: 86,
    formant_scale: 0.88,
    breathiness: 0.05,
    rate: 0.95,
  },
  bright: {
    label: 'Sable (bright)',
    f0: 238,
    formant_scale: 1.26,
    breathiness: 0.02,
    rate: 1.04,
  },
  machine: {
    label: 'Unit-7 (machine)',
    f0: 128,
    formant_scale: 0.98,
    breathiness: 0.0,
    rate: 1.0,
  },
};

export class TtsEngine {
  constructor() {
    this.ctx = null;
    this.buffer = null;
    this.source = null;
    this.gain = null;
    this.track = null;
    this.playing = false;
    this.start_at = 0;
    this.raf = 0;
    this.onword = null;
    this.onend = null;
    this.words = [];
    this.last_hit = -1;
    this.volume = 1;
    this.pcm = null;
  }

  set_volume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.gain) this.gain.gain.value = this.volume;
  }

  ensure_context() {
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) throw new Error('This browser has no AudioContext.');
      this.ctx = new Ctor();
    }
    return this.ctx;
  }

  // text -> tokens -> phonemes -> parameter track
  compile(text, opts = {}) {
    const overrides = opts.overrides || null;
    if (opts.clear_cache) clear_cache();

    const tokens = normalize(text);
    for (const tk of tokens) {
      if (tk.type === 'word') tk.phones = g2p(tk.text, { overrides });
    }
    const track = build_utterance(tokens, {
      rate: opts.rate ?? 1,
      f0: opts.f0 ?? 112,
      formant_scale: opts.formant_scale ?? 1,
      breathiness: opts.breathiness ?? 0.02,
    });
    return { tokens, track };
  }

  async render(text, opts = {}) {
    const ctx = this.ensure_context();
    // Never await resume(): it stays pending until the page has a gesture, and
    // rendering does not need a running clock. Playback resolves it on its own.
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const { tokens, track } = this.compile(text, opts);
    const pcm = render_track(track, ctx.sampleRate);

    const buffer = ctx.createBuffer(1, pcm.length, ctx.sampleRate);
    buffer.copyToChannel(pcm, 0);

    this.track = track;
    this.buffer = buffer;
    this.pcm = pcm;
    this.words = track.word_times;
    return { buffer, track, pcm, tokens };
  }

  play(from_seconds = 0) {
    const ctx = this.ensure_context();
    if (!this.buffer) return;

    this.stop_source();

    const src = ctx.createBufferSource();
    src.buffer = this.buffer;

    const g = ctx.createGain();
    g.gain.value = this.volume;
    src.connect(g).connect(ctx.destination);

    const offset = Math.max(0, Math.min(this.buffer.duration - 0.001, from_seconds));
    src.start(0, offset);

    this.source = src;
    this.gain = g;
    this.playing = true;
    this.start_at = ctx.currentTime - offset;
    this.last_hit = -1;

    src.onended = () => {
      if (this.source !== src) return;
      this.playing = false;
      cancelAnimationFrame(this.raf);
      if (this.onend) this.onend();
    };

    const tick = () => {
      if (!this.playing) return;
      const t = ctx.currentTime - this.start_at;
      let hit = -1;
      for (let i = 0; i < this.words.length; i++) {
        if (this.words[i].start <= t) hit = i; else break;
      }
      if (hit !== this.last_hit) {
        this.last_hit = hit;
        if (this.onword) this.onword(hit, this.words);
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop_source() {
    if (this.source) {
      try {
        this.source.onended = null;
        this.source.stop();
        this.source.disconnect();
      } catch (_) { /* already stopped */ }
      this.source = null;
    }
    if (this.gain) {
      try { this.gain.disconnect(); } catch (_) { /* detached */ }
      this.gain = null;
    }
  }

  stop() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.stop_source();
    if (this.onword) this.onword(-1, this.words);
  }

  async speak(text, opts = {}) {
    this.stop();
    const { buffer } = await this.render(text, opts);
    this.play(0);
    return buffer.duration;
  }

  export_wav(text, opts = {}) {
    const { track } = this.compile(text, opts);
    const sr = opts.sample_rate ?? 24000;
    const pcm = render_track(track, sr);
    return new Blob([encode_wav(pcm, sr)], { type: 'audio/wav' });
  }
}

export function parse_overrides(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const clean = line.split('#')[0].trim();
    if (!clean) continue;
    const m = /^(.+?)\s*[=:]\s*(.+)$/.exec(clean);
    if (!m) continue;
    const word = m[1].trim().toLowerCase();
    const phones = m[2].trim().toUpperCase().replace(/[^A-Z0-9 ]/g, ' ');
    if (word && phones) out[word] = phones.replace(/\s+/g, ' ');
  }
  return out;
}
