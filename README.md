# Linx TTS

A text-to-speech engine for the browser built from nothing but rules, tables and
filters. No model files, no samples, no cloud call, no `speechSynthesis`. Every
sound you hear is generated sample by sample in JavaScript.

```
text
 └─ normalize.js   numbers, dates, money, abbreviations, sentence splitting
     └─ g2p.js     letters → ARPAbet phonemes + stress
         └─ prosody.js  phonemes → a control track at 400 Hz (formants, F0, noise)
             └─ dsp.js  control track → PCM → compressor → limiter
                 └─ engine.js  AudioBuffer, playback, word timing, WAV export
```

## Run it

```bash
python3 serve.py          # http://localhost:8123/
```

`file://` will not work — ES modules need an http origin. Any static server is
fine; `serve.py` just sets no-store so edits show up immediately.

No build step, no dependencies.

## What it does

- **Pronounces words.** 600+ entry lexicon for the irregular core of English,
  plus ~170 contextual letter-to-sound rules for everything else, magic-e
  handling, `-ed`/`-es`/`-tion`/`-sion` allomorphy, syllabification, stress
  assignment.
- **Reads real text.** `$4.50`, `21%`, `3:30`, `10/22/2026`, `1,234`, `1995`,
  `Dr.`, `e.g.`, ordinals, decimals, phone numbers.
- **Prosody.** Per-sentence pitch reset and declination slope, pitch accents on
  stressed syllables, question rise, pre-fortis vowel shortening, voiced-coda
  lengthening, phrase-final lengthening, voice jitter.
- **Five voices** from one engine: F0, vocal-tract length (formant scaling) and
  breathiness are the only differences.
- **Save WAV.** Renders the same path offline to a 24 kHz 16-bit file.
- **Pronunciation dictionary.** `word = ARPABET` per line, persisted locally, and
  it wins over both the lexicon and the rules. Click any word in the output to
  hear it alone.

## Architecture notes

**`dsp.js`** is the whole synthesizer:

```
source:  Rosenberg glottal flow, re-drawn every period with jitter, shimmer and
         open-quotient drift → differentiated (flow derivative) → spectral tilt
filter:  F1..F3 cascaded, each two-pole and normalised to unity gain at its own
         resonance peak. F4 and F5 are summed in PARALLEL off a high-passed copy
         of the source — cascading all five multiplies every upstream stopband
         and leaves 2–6 kHz empty, which reads as muffled and buries consonants.
noise:   white noise → one tunable band resonator → summed in parallel
         (the front cavity shapes fricatives, not the vowel formants)
master:  compressor (−27 dBFS, 3.2:1) → RMS normalise to 0.19 → 20 ms
         look-ahead peak limiter at 0.89
```

Resonator coefficients update every 32 samples; everything else interpolates per
sample between 2.5 ms control frames.

**`prosody.js`** turns each phoneme into timed parameter segments, samples two
control points per segment (plateau + transition band), then interpolates.
Formants travel along an S-curve, not a straight line — that single change is
most of the difference between "beeping" and "speaking". Formant transitions
fall out of the geometry for free: a /b/ carries a low F2 locus, the following
vowel carries its own target, and the interpolation between them *is* the
transition.

Two more passes matter:

- **Voicing envelope** — a raised-cosine attack (22 ms) and release (55 ms) over
  each continuous voiced stretch, so words open and close like a mouth instead
  of a gate.
- **Formant drift** — a slow seeded random walk of ±1 % on F1–F3, so the same
  sentence is never bit-identical twice.

**Calibration.** Consonant amplitudes and per-vowel gains are not guesses.
`tools/calibrate.mjs` renders each phoneme in isolation at a probe amplitude
with the master stage off, measures RMS (or burst peak), and prints the
amplitude that matches the target loudness. The values in `phonemes.js` are the
output of that tool. Re-run it and paste if you change a band, a bandwidth or a
gain constant.

## Verification

```bash
node tools/test_render.mjs    # G2P, normalization, DSP, formants, pitch, robustness
node tools/calibrate.mjs      # amplitude calibration table
node tools/spectrogram.mjs "text you want to look at"   # writes /tmp/opencode/spec.png
node tools/browser_check.mjs  # headless chromium over CDP, writes /tmp/opencode/ui.png
```

`test_render.mjs` checks real signal properties, not just that the code ran:

- formant peaks of a sustained /ɑ/ land within 1 % of 730 / 1090 / 2440 Hz
- autocorrelation pitch of a rendered vowel matches the parameter track
- /s/ has ~9× more energy at 6 kHz than at 1 kHz; a vowel has ~100× less
- output RMS is pinned at 0.19 with peaks held at 0.89 — no clipping, no NaN,
  no DC offset, monotonic word timings, and empty/pathological inputs survive

## Tuning knobs, in order of impact

| knob | file | effect |
|---|---|---|
| `target_rms`, `threshold_db`, `ratio` | `dsp.js` `master()` | loudness and density |
| `G`/`PAR_GAIN`, `PAR_HP_HZ`, 4200 Hz low-pass | `dsp.js` | brightness: how much 2–6 kHz presence |
| `TILT_HZ` | `dsp.js` | overall spectral tilt of the voice |
| `edge` per phoneme type | `prosody.js` | transition length = coarticulation |
| `centralize(...)` amount | `prosody.js` | how much unstressed vowels reduce |
| `f0_pert`, `amp_pert`, `tp`/`tn` jitter | `dsp.js` | how "alive" the voice is |
| `gain` per vowel | `phonemes.js` | vowel-to-vowel loudness balance |

## Extending it

- **New word**: add to `LEXICON` in `js/lexicon.js`. Stress digits optional.
- **New rule**: add to `RULE_DATA` in `js/g2p.js` as
  `{ g: 'grapheme', p: 'ARPABET', pre: 'regex$', post: '^regex' }`. Rules are
  stably sorted by grapheme length, so longer clusters always win; order breaks
  ties inside a length.
- **New voice**: add an entry to `VOICES` in `js/engine.js`. `f0` and
  `formant_scale` are the two knobs that matter (formant_scale ≈ 1/vocal-tract
  length).
- **New phoneme**: add to `PHONEMES` in `js/phonemes.js`, then re-run
  `calibrate.mjs`.

## Known limits

- English only. The rule engine is English orthography; nothing else was written.
- No formant amplitude modulation. Real speech modulates F1–F3 amplitude with the
  glottal cycle; that is the next step for realism, and it needs a parallel
  formant design rather than the current cascade.
- Rule-derived words get a heuristic stress. Common words are in the lexicon
  precisely because heuristics get them wrong.
- Plosive releases are spectral bursts, not modelled release transients.
- No SSML. Prosody responds to punctuation and word structure only.
