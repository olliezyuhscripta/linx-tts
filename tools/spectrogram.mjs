// Language: JavaScript (ES module). Runtime: Node 18+.
// Boundary: local only. Writes a spectrogram PNG so the formant tracks can be
// looked at instead of guessed. No dependencies.

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { normalize } from '../js/normalize.js';
import { g2p } from '../js/g2p.js';
import { build_utterance } from '../js/prosody.js';
import { render_track } from '../js/dsp.js';

const SR = 24000;
const N = 512;
const HOP = 80;
const MAX_HZ = 6000;

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xFF;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(gray, w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    for (let x = 0; x < w; x++) {
      const v = gray[y * w + x];
      raw[o++] = v; raw[o++] = v; raw[o++] = v;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function spectrogram(pcm, out_path) {
  const cols = Math.floor((pcm.length - N) / HOP);
  const bins = Math.floor((MAX_HZ / (SR / 2)) * (N / 2));
  const H = 300;
  const gray = new Uint8Array(cols * H);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));

  for (let c = 0; c < cols; c++) {
    const re = new Float32Array(N);
    const im = new Float32Array(N);
    const off = c * HOP;
    for (let i = 0; i < N; i++) re[i] = (pcm[off + i] || 0) * win[i];
    fft(re, im);
    for (let y = 0; y < H; y++) {
      // log-ish frequency axis so formants are readable
      const t = y / H;
      const bin = Math.floor(Math.pow(bins, 1 - t) * 1.0);
      const mag = Math.hypot(re[bin], im[bin]) / (N / 4);
      const db = 20 * Math.log10(mag + 1e-9);
      const v = Math.max(0, Math.min(255, ((db + 76) / 76) * 255));
      gray[y * cols + c] = v;
    }
  }
  writeFileSync(out_path, png(gray, cols, H));
  return out_path;
}

const text = process.argv[2] || 'The quick brown fox jumps over the lazy dog.';
const tokens = normalize(text);
for (const tk of tokens) if (tk.type === 'word') tk.phones = g2p(tk.text);
const track = build_utterance(tokens, { rate: 1, f0: 112, formant_scale: 0.95, breathiness: 0.02 });
const pcm = render_track(track, SR);
console.log(spectrogram(pcm, '/tmp/opencode/spec.png'));
