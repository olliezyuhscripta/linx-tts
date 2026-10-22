// Language: JavaScript (ES module). Runtime: browser / Node 18+.
// Boundary: text in, token stream out. No I/O.

import { DIGIT_WORDS, TENS_WORDS } from './phonemes.js';

const ONES = [
  '', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES = ['', 'thousand', 'million', 'billion', 'trillion'];

const ORDINAL_MAP = {
  one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth',
  nine: 'ninth', twelve: 'twelfth',
};
function ordinalize(word) {
  if (ORDINAL_MAP[word]) return ORDINAL_MAP[word];
  if (word.endsWith('y')) return word.slice(0, -1) + 'ieth';
  return word + 'th';
}

function under_thousand(n) {
  const out = [];
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h > 0) { out.push(ONES[h], 'hundred'); }
  if (r > 0) {
    if (r < 20) out.push(ONES[r]);
    else {
      const t = Math.floor(r / 10);
      const o = r % 10;
      out.push(o ? `${TENS[t]}-${ONES[o]}` : TENS[t]);
    }
  }
  return out;
}

export function cardinal(n) {
  n = Math.trunc(Math.abs(n));
  if (n === 0) return 'zero';
  const groups = [];
  while (n > 0) { groups.push(n % 1000); n = Math.floor(n / 1000); }
  const out = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i] === 0) continue;
    out.push(...under_thousand(groups[i]));
    if (SCALES[i]) out.push(SCALES[i]);
  }
  return out.join(' ');
}

function ordinal(n) {
  const words = cardinal(n).split(' ');
  const last = words.pop();
  const parts = last.split('-');
  const tail = parts.pop();
  parts.push(ordinalize(tail));
  words.push(parts.join('-'));
  return words.join(' ');
}

function digits_of(str) {
  return str.split('').map((c) => DIGIT_WORDS[Number(c)]).join(' ');
}

function ordinal_digits_of(str) {
  return str.split('').map((c) => ordinalize(DIGIT_WORDS[Number(c)])).join(' ');
}

// Year-style reading: 1995 -> nineteen ninety-five, 2010 -> twenty ten,
// 1902 -> nineteen oh two.
function read_year(y) {
  if (y < 1100 || y > 2199) return cardinal(y);
  const hi = Math.floor(y / 100);
  const lo = y % 100;
  if (lo === 0) return `${cardinal(hi)} hundred`;
  if (lo < 10) return `${cardinal(hi)} oh ${cardinal(lo)}`;
  return `${cardinal(hi)} ${cardinal(lo)}`;
}

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december',
];

function expand_date(d, m, y) {
  let month = MONTHS[m - 1];
  let day = d;
  if (!month) { month = MONTHS[d - 1]; day = m; }
  if (!month) return cardinal(Number(d));
  let year = y;
  if (year < 100) year += year < 30 ? 2000 : 1900;
  return `${month} ${ordinal(day)} ${read_year(year)}`;
}

const ABBREVIATIONS = {
  'mr.': 'mister', 'mrs.': 'missus', 'ms.': 'miz', 'dr.': 'doctor',
  'prof.': 'professor', 'sr.': 'senior', 'jr.': 'junior', 'st.': 'saint',
  'vs.': 'versus', 'etc.': 'et cetera', 'e.g.': 'for example',
  'i.e.': 'that is', 'a.m.': 'ay em', 'p.m.': 'pee em',
  'approx.': 'approximately', 'dept.': 'department', 'gov.': 'governor',
  'lt.': 'lieutenant', 'capt.': 'captain', 'sgt.': 'sergeant',
  'mt.': 'mount', 'ft.': 'fort', 'no.': 'number', 'vol.': 'volume',
};

const SYMBOLS = {
  '&': ' and ', '+': ' plus ', '=': ' equals ', '%': ' percent ',
  '#': ' number ', '@': ' at ', '/': ' slash ', '\\': ' backslash ',
  '<': ' less than ', '>': ' greater than ', '~': ' about ',
  '_': ' underscore ', '|': ' pipe ', '^': ' caret ',
  '\u2014': ', ', '\u2013': ', ', '\u2026': '...', '\u00b0': ' degrees ',
  '\u00b5': ' micro ', '\u2103': ' degrees celsius', '\u00a3': ' pounds ',
};

function expand_number_token(tok) {
  const lower = tok.toLowerCase();

  // currency
  let m = lower.match(/^([$\u20ac\u00a3])\s?(\d+(?:\.\d+)?)([kmb])?$/);
  if (m) {
    const unit = m[1] === '$' ? ['dollar', 'cent'] : m[1] === '\u20ac' ? ['euro', 'cent'] : ['pound', 'penny'];
    let num = parseFloat(m[2]);
    if (m[3] === 'k') num *= 1e3;
    if (m[3] === 'm') num *= 1e6;
    if (m[3] === 'b') num *= 1e9;
    return money(num, unit);
  }

  // percent
  m = lower.match(/^(\d+(?:\.\d+)?)%$/);
  if (m) return `${read_decimal(m[1])} percent`;

  // time 3:30
  m = lower.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const h = Number(m[1]);
    const mm = Number(m[2]);
    if (mm === 0) return `${cardinal(h)} o'clock`;
    if (mm < 10) return `${cardinal(h)} oh ${cardinal(mm)}`;
    return `${cardinal(h)} ${cardinal(mm)}`;
  }

  // date 10/22/2026 or 22-10-2026
  m = lower.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) return expand_date(m[1], m[2], Number(m[3]));

  // ordinal digits 3rd, 12th, 21st
  m = lower.match(/^(\d+)(st|nd|rd|th)$/);
  if (m) return ordinal(Number(m[1]));

  // hyphenated / structured digits 555-1234
  m = lower.match(/^\d{3}-\d{4}$/);
  if (m) return `${digits_of(m[0].slice(0, 3))}, ${digits_of(m[0].slice(4))}`;

  // decimals
  m = lower.match(/^(-?)(\d+)\.(\d+)$/);
  if (m) return `${m[1] ? 'minus ' : ''}${read_decimal(lower.replace('-', ''))}`;

  // big integer
  m = lower.match(/^-?\d{1,15}$/);
  if (m) return `${lower.startsWith('-') ? 'minus ' : ''}${cardinal(Number(lower))}`;

  // leading-zero ids: 007 -> digits
  if (/^0\d+$/.test(lower)) return digits_of(lower);

  return null;
}

function read_decimal(str) {
  const [int_part, frac_part] = str.split('.');
  const head = int_part === '0' ? 'zero' : cardinal(Number(int_part));
  return `${head} point ${digits_of(frac_part)}`;
}

function money(num, unit) {
  const whole = Math.floor(num);
  const cents = Math.round((num - whole) * 100);
  const parts = [];
  if (whole > 0) parts.push(`${cardinal(whole)} ${unit[0]}${whole === 1 ? '' : 's'}`);
  if (cents > 0) parts.push(`${cardinal(cents)} ${unit[1]}${cents === 1 ? '' : 's'}`);
  if (!parts.length) parts.push(`zero ${unit[0]}s`);
  return parts.join(' and ');
}

// Turn raw text into a flat token list: {type:'word'|'pause', text, pause_ms, sentence}
export function normalize(text) {
  let s = ' ' + String(text) + ' ';

  // thousands separators and dates must be resolved before punctuation splits
  s = s.replace(/\b\d{1,3}(?:,\d{3})+\b/g, (m) => cardinal(Number(m.replace(/,/g, ''))));
  s = s.replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g, (m, a, b, c) => expand_date(Number(b), Number(a), Number(c)));

  for (const [k, v] of Object.entries(SYMBOLS)) s = s.split(k).join(v);

  // abbreviations (case-insensitive, word boundary)
  for (const [k, v] of Object.entries(ABBREVIATIONS)) {
    const re = new RegExp(`(^|[\\s(])${k.replace(/\./g, '\\.')}(?=\\s|$)`, 'gi');
    s = s.replace(re, (mm, pre) => pre + v);
  }

  // years written as 4 digits after a month or "in"
  s = s.replace(/\b(in|since|during|by)\s+(\d{4})\b/gi, (m0, p, y) => `${p} ${read_year(Number(y))}`);

  // bare 4-digit years 1900-2099
  s = s.replace(/\b(1[5-9]\d{2}|20\d{2})\b/g, (y) => read_year(Number(y)));

  // numbers
  s = s.split(/\s+/).map((tok) => {
    if (!tok) return '';
    const bare = tok.replace(/^[("']+|[)"',.;:!?]+$/g, '');
    const px = tok.slice(0, tok.indexOf(bare));
    const sx = tok.slice(tok.indexOf(bare) + bare.length);
    const ex = expand_number_token(bare);
    return ex === null ? tok : px + ex + sx;
  }).join(' ');

  const tokens = [];
  let sentence = 0;
  let word_index = 0;

  const pieces = s.split(/([.!?;:,]+|\.\.\.)/);
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i];
    if (!piece) continue;
    if (/^([.!?;:,]+|\.\.\.)$/.test(piece)) {
      let pause_ms = 120;
      if (piece.includes('?') || piece.includes('!') || piece.includes('.')) pause_ms = 380;
      if (piece.includes(';') || piece.includes(':')) pause_ms = 260;
      if (piece.includes(',')) pause_ms = 160;
      const last = piece.slice(-1);
      tokens.push({ type: 'pause', pause_ms, sentence, punct: piece, end_of_sentence: /[.!?]/.test(last) });
      if (/[.!?]/.test(last)) sentence++;
      continue;
    }
    for (const raw of piece.split(/[\s]+/)) {
      const chunks = /^\p{L}+(-\p{L}+)+$/u.test(raw) ? raw.split('-') : [raw];
      for (const chunk of chunks) {
        const w = chunk.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}']+$/gu, '');
        if (!w) continue;
        tokens.push({ type: 'word', text: w, sentence, word_index: word_index++ });
      }
    }
  }

  // collapse duplicate pauses, trim edges
  const out = [];
  for (const t of tokens) {
    if (t.type === 'pause') {
      if (!out.length || out[out.length - 1].type === 'pause') {
        if (!out.length) continue;
        out[out.length - 1].pause_ms = Math.max(out[out.length - 1].pause_ms, t.pause_ms);
        continue;
      }
    }
    out.push(t);
  }
  while (out.length && out[out.length - 1].type === 'pause') out.pop();

  return out;
}

export { ordinal, read_year };
