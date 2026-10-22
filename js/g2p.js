// Language: JavaScript (ES module). Runtime: browser / Node 18+.
// Boundary: word in, phoneme sequence out. No I/O.

import { LEXICON } from './lexicon.js';
import { LETTER_NAMES, VOWELS } from './phonemes.js';

const VOWEL_SET = VOWELS;

function parse_arpabet(str) {
  if (!str) return [];
  const out = [];
  for (const tok of str.trim().split(/\s+/)) {
    if (!tok) continue;
    const m = /^([A-Z]+)([0-2])?$/.exec(tok);
    if (!m) continue;
    out.push({ p: m[1], s: m[2] === undefined ? null : Number(m[2]) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Letter-to-sound rules.
//
// g  = grapheme cluster to consume at the current position
// p  = ARPAbet output
// pre  = regex source that must match the text to the LEFT, anchored at end
// post = regex source that must match the text to the RIGHT, anchored at start
//
// Rules are stably sorted by grapheme length, so longer clusters always win;
// authoring order breaks ties.
// ---------------------------------------------------------------------------
const C = 'bcdfghjklmnpqrstvwxz';
const V = 'aeiouy';

const RULE_DATA = [
  // ---------------- 6 ----------------
  { g: 'aughter', p: 'AE F T ER' },

  // ---------------- 5 ----------------
  { g: 'ought', p: 'AO T' },
  { g: 'ation', p: 'EY SH AH N' },
  { g: 'ough', p: 'AO', post: 't' },

  // ---------------- 4 ----------------
  { g: 'ough', p: 'AH F' },                       // rough, tough
  { g: 'ough', p: 'OW', post: '$' },              // though, although
  { g: 'ough', p: 'OW' },
  { g: 'augh', p: 'AO' },
  { g: 'eigh', p: 'EY' },
  { g: 'tion', p: 'SH AH N' },
  { g: 'sion', p: 'ZH AH N' },
  { g: 'cian', p: 'SH AH N' },
  { g: 'tial', p: 'SH AH L' },
  { g: 'cial', p: 'SH AH L' },
  { g: 'cious', p: 'SH AH S' },
  { g: 'tious', p: 'SH AH S' },
  { g: 'geous', p: 'JH AH S' },
  { g: 'ture', p: 'CH ER' },
  { g: 'sure', p: 'ZH ER' },
  { g: 'ight', p: 'AY T' },
  { g: 'ligh', p: 'L AY' },

  // ---------------- 3 ----------------
  { g: 'igh', p: 'AY' },
  { g: 'eau', p: 'UW' },
  { g: 'ych', p: 'AY K' },
  { g: 'arr', p: 'AE R', post: '[aeiouy]' },
  { g: 'arr', p: 'AH R' },
  { g: 'err', p: 'EH R' },
  { g: 'irr', p: 'IH R' },
  { g: 'air', p: 'EH R' },
  { g: 'eer', p: 'IH R' },
  { g: 'ear', p: 'IH R' },
  { g: 'our', p: 'AW ER' },
  { g: 'oor', p: 'AO R' },
  { g: 'ild', p: 'AY L D' },
  { g: 'ind', p: 'AY N D' },
  { g: 'old', p: 'OW L D' },
  { g: 'ost', p: 'OW S T' },
  { g: 'alk', p: 'AO K' },
  { g: 'all', p: 'AO L' },
  { g: 'alm', p: 'AA M' },
  { g: 'ing', p: 'IH NG' },
  { g: 'ies', p: 'IY Z' },
  { g: 'ied', p: 'IY D' },
  { g: 'ier', p: 'IY ER' },
  { g: 'sch', p: 'S K' },
  { g: 'kn', p: 'N', pre: '^' },
  { g: 'wr', p: 'R', pre: '^' },
  { g: 'ps', p: 'S', pre: '^' },
  { g: 'gn', p: 'N', pre: '^' },
  { g: 'qu', p: 'K W' },
  { g: 'wh', p: 'W' },
  { g: 'ph', p: 'F' },
  { g: 'sh', p: 'SH' },
  { g: 'ch', p: 'CH' },
  { g: 'th', p: 'TH' },
  { g: 'ck', p: 'K' },
  { g: 'ng', p: 'NG' },
  { g: 'gh', p: '' },
  { g: 'dg', p: 'JH' },
  { g: 'ee', p: 'IY' },
  { g: 'ea', p: 'IY' },
  { g: 'ai', p: 'EY' },
  { g: 'ay', p: 'EY' },
  { g: 'au', p: 'AO' },
  { g: 'aw', p: 'AO' },
  { g: 'oa', p: 'OW' },
  { g: 'oi', p: 'OY' },
  { g: 'oy', p: 'OY' },
  { g: 'oo', p: 'UW' },
  { g: 'ou', p: 'AW' },
  { g: 'ow', p: 'OW' },
  { g: 'ew', p: 'UW' },
  { g: 'eu', p: 'UW' },
  { g: 'ei', p: 'EY' },
  { g: 'ey', p: 'EY' },
  { g: 'ie', p: 'IY', post: '[^$]' },
  { g: 'ie', p: 'AY', post: '$' },
  { g: 'ue', p: 'UW' },
  { g: 'ui', p: 'UW' },
  { g: 'ar', p: 'AA R' },
  { g: 'er', p: 'EH R', post: '[aeiouy]' },
  { g: 'er', p: 'ER' },
  { g: 'ir', p: 'ER' },
  { g: 'ur', p: 'ER' },
  { g: 'or', p: 'AO R' },
  { g: 'les', p: 'AH L Z', post: '$', pre: `[${C}]` },
  { g: 'le', p: 'AH L', post: '$', pre: `[${C}]` },
  { g: 'es', p: 'IH Z', post: '$', pre: '[sxz]$|[sc]h' },
  { g: 'es', p: 'S', post: '$', pre: '[pkfth]' },
  { g: 'es', p: 'Z', post: '$' },
  { g: 'ed', p: 'IH D', post: '$', pre: '[td]' },
  { g: 'ed', p: 'T', post: '$', pre: '[pkfsxh]' },
  { g: 'ed', p: 'D', post: '$' },
  { g: 'ss', p: 'S' },
  { g: 'll', p: 'L' },
  { g: 'tt', p: 'T' },
  { g: 'pp', p: 'P' },
  { g: 'bb', p: 'B' },
  { g: 'dd', p: 'D' },
  { g: 'ff', p: 'F' },
  { g: 'gg', p: 'G' },
  { g: 'mm', p: 'M' },
  { g: 'nn', p: 'N' },
  { g: 'rr', p: 'R' },
  { g: 'zz', p: 'Z' },
  { g: 'cc', p: 'K' },
  { g: 'mb', p: 'M', post: '$' },

  // ---------------- 1 ----------------
  // a
  { g: 'a', p: 'EY', post: `[${C}]e(s|d|r|ly|st)?$` },
  { g: 'a', p: 'AH', post: '$' },
  { g: 'a', p: 'AE' },
  // e
  { g: 'e', p: 'IY', post: '$', pre: '^[bhmw]$' },
  { g: 'e', p: 'IY', post: '$', pre: '^th$' },
  { g: 'e', p: '', post: '$' },
  { g: 'e', p: 'EH' },
  // i
  { g: 'i', p: 'AY', post: `[${C}]e(s|d|r|ly|st)?$` },
  { g: 'i', p: 'AY', post: 'nd' },
  { g: 'i', p: 'AY', post: 'gn' },
  { g: 'i', p: 'IY', post: '$' },
  { g: 'i', p: 'IH' },
  // o
  { g: 'o', p: 'OW', post: `[${C}]e(s|d|r|ly|st)?$` },
  { g: 'o', p: 'OW', post: '$' },
  { g: 'o', p: 'AH', post: 'n' , pre: '^[lc]$' },
  { g: 'o', p: 'AA' },
  // u
  { g: 'u', p: 'UW', post: `[${C}]e(s|d|r|ly|st)?$` },
  { g: 'u', p: 'UH', post: 'll' },
  { g: 'u', p: 'UH', post: 'sh' },
  { g: 'u', p: 'UW', post: '$' },
  { g: 'u', p: 'AH' },
  // y
  { g: 'y', p: 'Y', pre: '^' },
  { g: 'y', p: 'AY', post: 'c[lrt]' },
  { g: 'y', p: 'AY', post: '$', pre: `^[${C}]*$` },
  { g: 'y', p: 'IY', post: '$' },
  { g: 'y', p: 'IH' },
  // consonants
  { g: 'c', p: 'S', post: '[eiy]' },
  { g: 'c', p: 'K' },
  { g: 'g', p: 'JH', post: '[eiy]' },
  { g: 'g', p: 'G' },
  { g: 's', p: 'Z', post: '$', pre: `[${V}bdgmnlrvwz]$` },
  { g: 's', p: 'Z', pre: `[${V}]`, post: `[${V}]` },
  { g: 's', p: 'S' },
  { g: 'x', p: 'G Z', pre: '^e' },
  { g: 'x', p: 'K S' },
  { g: 'h', p: 'HH' },
  { g: 'j', p: 'JH' },
  { g: 'q', p: 'K' },
  { g: 'v', p: 'V' },
  { g: 'w', p: 'W' },
  { g: 'z', p: 'Z' },
  { g: 'b', p: 'B' },
  { g: 'd', p: 'D' },
  { g: 'f', p: 'F' },
  { g: 'k', p: 'K' },
  { g: 'l', p: 'L' },
  { g: 'm', p: 'M' },
  { g: 'n', p: 'N' },
  { g: 'p', p: 'P' },
  { g: 'r', p: 'R' },
  { g: 't', p: 'T' },
];

const RULES = RULE_DATA
  .map((r) => ({
    g: r.g,
    out: parse_arpabet(r.p),
    pre_re: r.pre ? new RegExp(`(?:${r.pre})$`) : null,
    post_re: r.post ? new RegExp(`^(?:${r.post})`) : null,
  }))
  .sort((a, b) => b.g.length - a.g.length);

function phonemize_letters(word) {
  const phones = [];
  let i = 0;
  let guard = 0;
  while (i < word.length && guard++ < 256) {
    let hit = null;
    for (const r of RULES) {
      if (!word.startsWith(r.g, i)) continue;
      if (r.pre_re && !r.pre_re.test(word.slice(0, i))) continue;
      if (r.post_re && !r.post_re.test(word.slice(i + r.g.length))) continue;
      hit = r;
      break;
    }
    if (!hit) { i += 1; continue; }
    for (const ph of hit.out) phones.push({ p: ph.p, s: ph.s });
    i += hit.g.length;
  }
  return phones;
}

const REDUCE = {
  // only the cases where the phoneme identity itself changes; everything else
  // keeps its target and is centralised in prosody by an explicit amount
  IY: 'IH',
};

const TWO_SYL_PREFIX = /^(?:be|de|re|pre|un|in|con|com|ex|ob|ac|ad|sup|sur|per|pro|trans|mis|dis)|^a[bcdfghjklmnpqrstvwxz][aeiouy]/;

export function assign_stress(phones, word) {
  const vowel_idx = [];
  for (let i = 0; i < phones.length; i++) if (VOWEL_SET.has(phones[i].p)) vowel_idx.push(i);
  const n = vowel_idx.length;
  if (n === 0) return phones;

  const tail = phones.map((x) => x.p).join(' ');
  let k;

  if (n === 1) {
    k = 0;
  } else if (/SH AH N$|ZH AH N$/.test(tail)) {
    k = n - 2;
  } else if (/IH K$/.test(tail)) {
    k = n - 2;
  } else if (/IH T IY$/.test(tail)) {
    k = Math.max(0, n - 3);
  } else if (/IY$/.test(tail) && n >= 3) {
    k = Math.max(0, n - 3);
  } else if (/AH N$|AH M$/.test(tail) && n >= 3) {
    k = n - 3;
  } else if (/[A-Z] L$/.test(tail) && n >= 3 && !/[EI][A-Z]$/.test(tail)) {
    k = Math.max(0, n - 3);
  } else if (n === 2) {
    k = TWO_SYL_PREFIX.test(word) ? 1 : 0;
  } else if (n === 3) {
    k = 1;
  } else {
    k = Math.max(0, n - 3);
  }

  for (let i = 0; i < phones.length; i++) phones[i].s = 0;
  phones[vowel_idx[k]].s = 1;

  if (n === 1) return phones;
  for (let j = 0; j < n; j++) {
    if (j === k) continue;
    const idx = vowel_idx[j];
    const ph = phones[idx].p;
    if (ph === 'IY' && idx === phones.length - 1) continue;
    if (ph === 'IY' && idx === phones.length - 2 && phones[phones.length - 1].p === 'Z') continue;
    if (REDUCE[ph]) phones[idx].p = REDUCE[ph];
  }
  return phones;
}

function spell_out(word) {
  const out = [];
  for (const ch of word) {
    const name = LETTER_NAMES[ch];
    if (!name) continue;
    out.push(...parse_arpabet(name));
  }
  return out;
}

const cache = new Map();

export function g2p(raw_word, opts = {}) {
  const overrides = opts.overrides || null;
  const raw = String(raw_word);

  if (overrides && Object.prototype.hasOwnProperty.call(overrides, raw.toLowerCase())) {
    const ph = parse_arpabet(overrides[raw.toLowerCase()].toUpperCase());
    if (ph.length) return ph.length ? assign_if_unset(ph) : ph;
  }

  const key = raw;
  if (cache.has(key)) return cache.get(key).map((x) => ({ ...x }));

  const lower = raw.toLowerCase();
  let phones;

  if (LEXICON[lower]) {
    phones = parse_arpabet(LEXICON[lower]);
  } else if (/^[A-Z0-9]{2,5}$/.test(raw) && !/^[A-Z][a-z]/.test(raw)) {
    phones = spell_out(lower.replace(/[^a-z]/g, ''));
  } else if (lower.includes("'")) {
    phones = phonemize_contraction(lower, opts);
  } else {
    phones = assign_stress(phonemize_letters(lower.replace(/[^a-z]/g, '')), lower);
  }

  if (!phones.length) phones = spell_out(lower.replace(/[^a-z]/g, ''));
  cache.set(key, phones.map((x) => ({ ...x })));
  return phones;
}

function assign_if_unset(phones) {
  const has = phones.some((x) => x.s !== null && VOWEL_SET.has(x.p));
  return has ? finish(phones) : assign_stress(phones, '');
}

function finish(phones) {
  for (const ph of phones) {
    if (!VOWEL_SET.has(ph.p)) ph.s = 0;
    else if (ph.s === null) ph.s = 0;
  }
  return phones;
}

function phonemize_contraction(word, opts) {
  if (word.endsWith("n't")) {
    const base = word.slice(0, -3);
    const head = base.length ? g2p(base, opts) : [];
    const tail = parse_arpabet('AH N T');
    return finish([...head, ...tail]);
  }
  const idx = word.indexOf("'");
  const base = word.slice(0, idx);
  const suf = word.slice(idx + 1);
  const SUFFIX = { s: 'Z', t: 'T', re: 'R', ll: 'L', ve: 'V', m: 'M', d: 'D' };
  const head = base.length ? g2p(base, opts).map((x) => ({ ...x })) : [];
  const sp = SUFFIX[suf];
  if (!sp) return head;
  return finish([...head, ...parse_arpabet(sp)]);
}

export function clear_cache() {
  cache.clear();
}

export { phonemize_letters, parse_arpabet };
