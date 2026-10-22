// Language: JavaScript (ES module). Runtime: browser / Node 18+.
// Boundary: pure data. No I/O, no side effects.

// Formant targets are adult-male reference values (Hz) on a three-formant
// cascade model, plus a parallel frication band per consonant.
// b = [B1,B2,B3] bandwidths.

export const DEFAULT_BANDWIDTHS = [70, 100, 150];

export const PHONEMES = {
  // ---- monophthong vowels ----
  IY: { type: 'vowel', f: [280, 2250, 2900], b: [55, 90, 150], gain: 1.700 },
  IH: { type: 'vowel', f: [400, 1920, 2560], b: [60, 95, 150], gain: 1.530 },
  EH: { type: 'vowel', f: [530, 1840, 2480], b: [70, 100, 150], gain: 1.620 },
  AE: { type: 'vowel', f: [660, 1720, 2410], b: [80, 110, 160], gain: 1.450 },
  AA: { type: 'vowel', f: [730, 1090, 2440], b: [85, 110, 170], gain: 0.790 },
  AO: { type: 'vowel', f: [570, 840, 2410], b: [80, 100, 160], gain: 0.590 },
  UH: { type: 'vowel', f: [440, 1020, 2240], b: [70, 95, 150], gain: 0.860 },
  UW: { type: 'vowel', f: [300, 870, 2240], b: [55, 85, 150], gain: 0.780 },
  AH: { type: 'vowel', f: [640, 1190, 2390], b: [85, 110, 160], gain: 0.910 },
  AX: { type: 'vowel', f: [520, 1350, 2450], b: [80, 110, 160], gain: 0.970 }, // schwa
  ER: { type: 'vowel', f: [490, 1350, 1690], b: [75, 110, 160], gain: 0.710 },

  // ---- diphthongs: f = onset target, g = offglide target ----
  EY: { type: 'diphthong', f: [500, 1900, 2550], g: [320, 2320, 2900], b: [65, 95, 150], dur: 0.145, gain: 1.590 },
  AY: { type: 'diphthong', f: [720, 1100, 2450], g: [370, 2050, 2700], b: [80, 110, 165], dur: 0.170, gain: 0.850 },
  OY: { type: 'diphthong', f: [560, 860, 2400], g: [390, 1900, 2600], b: [80, 105, 160], dur: 0.170, gain: 0.630 },
  AW: { type: 'diphthong', f: [720, 1150, 2450], g: [350, 900, 2250], b: [85, 110, 165], dur: 0.170, gain: 0.700 },
  OW: { type: 'diphthong', f: [560, 900, 2400], g: [350, 800, 2250], b: [75, 100, 155], dur: 0.155, gain: 0.570 },

  // ---- stops: closure, burst, aspiration ----
  P: { type: 'stop', v: false, f: [300, 900, 2200], burst: [0.045, 0.581, 1400], asp: 0.243, dur: 0.078 },
  B: { type: 'stop', v: true, f: [250, 900, 2100], burst: [0.073, 0.717, 1200], asp: 0.00, dur: 0.070 },
  T: { type: 'stop', v: false, f: [300, 1750, 2600], burst: [0.319, 0.807, 2600], asp: 0.218, dur: 0.078 },
  D: { type: 'stop', v: true, f: [280, 1700, 2550], burst: [0.324, 0.849, 2300], asp: 0.00, dur: 0.070 },
  K: { type: 'stop', v: false, f: [300, 1900, 2300], burst: [0.218, 0.690, 2000], asp: 0.217, dur: 0.082 },
  G: { type: 'stop', v: true, f: [280, 1850, 2250], burst: [0.184, 0.976, 1800], asp: 0.00, dur: 0.072 },

  // ---- fricatives: nf/nb noise band, amp noise level ----
  F: { type: 'fricative', v: false, f: [320, 1100, 2200], nf: 4200, nb: 3400, amp: 0.259, dur: 0.095 },
  V: { type: 'fricative', v: true, f: [300, 1050, 2150], nf: 3900, nb: 3000, amp: 0.055, dur: 0.075 },
  TH: { type: 'fricative', v: false, f: [320, 1300, 2400], nf: 5400, nb: 3200, amp: 0.262, dur: 0.092 },
  DH: { type: 'fricative', v: true, f: [300, 1350, 2400], nf: 5000, nb: 3000, amp: 0.075, dur: 0.070 },
  S: { type: 'fricative', v: false, f: [320, 1600, 2500], nf: 6000, nb: 1700, amp: 0.353, dur: 0.100 },
  Z: { type: 'fricative', v: true, f: [300, 1600, 2450], nf: 5800, nb: 1600, amp: 0.092, dur: 0.080 },
  SH: { type: 'fricative', v: false, f: [330, 1800, 2500], nf: 2900, nb: 1500, amp: 0.375, dur: 0.100 },
  ZH: { type: 'fricative', v: true, f: [320, 1800, 2450], nf: 2800, nb: 1400, amp: 0.102, dur: 0.080 },
  HH: { type: 'aspirant', v: false, f: [500, 1500, 2500], amp: 0.223, dur: 0.065 },

  // ---- nasals: low F1, nasal pole ----
  M: { type: 'nasal', v: true, f: [250, 1000, 2100], amp: 0.50, dur: 0.076 , f4: 3300},
  N: { type: 'nasal', v: true, f: [250, 1500, 2400], amp: 0.50, dur: 0.072 , f4: 3300},
  NG: { type: 'nasal', v: true, f: [250, 2000, 2500], amp: 0.48, dur: 0.076 , f4: 3300},

  // ---- liquids / glides ----
  L: { type: 'liquid', v: true, f: [360, 1300, 2700], amp: 0.78, dur: 0.070 , f4: 3200},
  R: { type: 'liquid', v: true, f: [420, 1200, 1600], amp: 0.78, dur: 0.072 , f4: 3300},
  W: { type: 'glide', v: true, f: [300, 700, 2100], amp: 0.72, dur: 0.062 },
  Y: { type: 'glide', v: true, f: [280, 2100, 2900], amp: 0.70, dur: 0.060 },

  // ---- affricates: closure + fricative release ----
  CH: { type: 'affricate', v: false, nf: 2900, nb: 1500, amp: 0.322, dur: 0.108 },
  JH: { type: 'affricate', v: true, nf: 2800, nb: 1400, amp: 0.188, dur: 0.096 },

  // ---- flap ----
  DX: { type: 'flap', v: true, f: [320, 1700, 2550], amp: 0.45, dur: 0.032 },
};

export const VOWELS = new Set([
  'IY', 'IH', 'EH', 'AE', 'AA', 'AO', 'UH', 'UW', 'AH', 'AX', 'ER',
  'EY', 'AY', 'OY', 'AW', 'OW',
]);

export const LETTER_NAMES = {
  a: 'EY', b: 'B IY', c: 'S IY', d: 'D IY', e: 'IY', f: 'EH F', g: 'JH IY',
  h: 'EY CH', i: 'AY', j: 'JH EY', k: 'K EY', l: 'EH L', m: 'EH M', n: 'EH N',
  o: 'OW', p: 'P IY', q: 'K Y UW', r: 'AA R', s: 'EH S', t: 'T IY', u: 'Y UW',
  v: 'V IY', w: 'D AH B AH L Y UW', x: 'EH K S', y: 'W AY', z: 'Z IY',
};

export const DIGIT_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];

export const TENS_WORDS = [
  '', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
];
