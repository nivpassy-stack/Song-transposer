// Line classification: chord lines, lyrics, tab lines, section headers, metadata.
import { parseChord } from './chords.js';

const HEBREW_RE = /[֐-׿]/g;
const LATIN_RE = /[A-Za-z]/g;

export function countHebrew(text) {
  return (text.match(HEBREW_RE) || []).length;
}

export function countLatin(text) {
  return (text.match(LATIN_RE) || []).length;
}

// Tokens that may appear on a chord line without being chords: bar lines,
// repeat marks, arrows, "N.C." and so on.
const NEUTRAL_RE = /^(?:[|/\\:%.~*>\-–—]+|\(?\s*[x×]\s*\d+\s*\)?|\(?\d+\s*[x×]\)?|n\.?c\.?|\(|\))$/i;

/**
 * Split a token into chord pieces and separators. "(Am)" gives
 * ["(", {Am}, ")"], "Am-G" gives [{Am}, "-", {G}]. Returns null if any
 * piece is neither a chord nor a separator.
 */
function tokenPieces(text) {
  const m = /^([(|[]*)(.*?)([)|\],*.]*)$/.exec(text);
  const [, pre, core, post] = m;
  const whole = parseChord(core);
  if (whole) return [pre, { text: core, chord: whole }, post].filter((p) => p !== '');
  const parts = core.split(/([-–|,])/);
  if (parts.length < 3) return null;
  const pieces = [];
  if (pre) pieces.push(pre);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i % 2 === 1) {
      pieces.push(part);
    } else if (part === '') {
      continue;
    } else {
      const chord = parseChord(part);
      if (!chord) return null;
      pieces.push({ text: part, chord });
    }
  }
  if (post) pieces.push(post);
  return pieces;
}

/**
 * Tokenize a candidate chord line. Each token keeps its column so the
 * chords can be placed over the right syllable of the lyric below.
 */
export function tokenizeChordLine(line) {
  const tokens = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(line))) {
    const text = m[0];
    const pieces = tokenPieces(text);
    if (pieces && pieces.some((p) => typeof p === 'object')) {
      tokens.push({ col: m.index, kind: 'chord', pieces });
    } else if (NEUTRAL_RE.test(text)) {
      tokens.push({ col: m.index, kind: 'neutral', text });
    } else {
      tokens.push({ col: m.index, kind: 'other', text });
    }
  }
  return tokens;
}

/** Returns chord-line tokens if the line is a chord line, else null. */
export function chordLineTokens(line) {
  const tokens = tokenizeChordLine(line);
  // A label such as "Intro:" or "פזמון:" may lead a chord line.
  if (tokens.length && tokens[0].kind === 'other' && /:$/.test(tokens[0].text)) {
    tokens[0].kind = 'label';
  }
  const chords = tokens.filter((t) => t.kind === 'chord').length;
  const others = tokens.filter((t) => t.kind === 'other').length;
  if (chords === 0) return null;
  if (others > Math.floor(chords / 3)) return null;
  return tokens;
}

const TAB_ALLOWED_RE = /^[-–—0-9|hpbrstvx/\\~()<>.^*=:\s'"HPBRSTVX]+$/;

export function isTabLine(line) {
  const m = /^\s*([A-Ga-g][#b]?)?\s*([|:]?)(.*)$/.exec(line);
  const [, label, bar, rest] = m;
  // Notes after the last bar line ("|  repeat twice") don't stop it being a tab line.
  const lastBar = rest.lastIndexOf('|');
  const body = lastBar > 0 && /[A-Za-z]/.test(rest.slice(lastBar + 1)) ? rest.slice(0, lastBar + 1) : rest;
  const trimmed = body.trim();
  if (trimmed.length < 6 || !TAB_ALLOWED_RE.test(trimmed)) return false;
  const dashes = (trimmed.match(/[-–—]/g) || []).length;
  if (dashes < 4 || dashes / trimmed.replace(/\s/g, '').length < 0.3) return false;
  // A bare row of dashes is a separator, not a tab line.
  return Boolean(label || bar || /[0-9|]/.test(trimmed));
}

const SECTION_WORDS = [
  'intro', 'verse', 'chorus', 'pre-chorus', 'prechorus', 'pre chorus', 'bridge', 'outro', 'solo',
  'interlude', 'instrumental', 'refrain', 'coda', 'ending', 'hook', 'tag', 'riff', 'break',
  'פתיחה', 'בית', 'פזמון', 'גשר', 'מעבר', 'סיום', 'סולו', 'קודה', 'אינטרו', 'מעבר נגינה',
  'פרי פזמון', 'קדם פזמון', 'אאוטרו', 'נגינה', 'רפרן',
];
const SECTION_RE = new RegExp(
  String.raw`^\s*[\[(]?\s*(?:${SECTION_WORDS.join('|')})(?![a-z])[^\n]{0,16}?[:\])]?\s*$`,
  'i',
);

export function isSectionHeader(line) {
  if (/^\s*\[[^\]]{1,30}\]\s*$/.test(line)) return true;
  return SECTION_RE.test(line);
}

const META_PATTERNS = [
  ['key', /^\s*(?:key|סולם|טון)\s*[:\-–]?\s*([A-G][#b♯♭]?\s*(?:m(?!aj)|min|minor|major|maj)?)\s*$/i],
  ['capo', /^\s*(?:capo|קאפו|קפו)\s*(?:on\s*)?[:\-–]?\s*(\d{1,2})/i],
  ['credit', /^\s*((?:מילים ולחן|מילים ו?לחן|מילים|לחן|ביצוע|שירה|מבצע|עיבוד|artist|words and music|words|music|lyrics|composer|performed by)\s*[:\-–]\s*.+)$/i],
  ['credit', /^\s*((?:by|מאת)\s+.{1,40})$/i],
];

/** Returns {name, value} for lines like "Key: Am" or "מילים: ...", else null. */
export function parseMeta(line) {
  for (const [name, re] of META_PATTERNS) {
    const m = re.exec(line);
    if (m) return { name, value: m[1].trim() };
  }
  return null;
}

const DIRECTIVE_RE = /^\s*\{\s*([a-z_]+)\s*(?::\s*(.*?))?\s*\}\s*$/i;

export function parseDirective(line) {
  const m = DIRECTIVE_RE.exec(line);
  return m ? { name: m[1].toLowerCase(), value: (m[2] || '').trim() } : null;
}

const INLINE_CHORD_RE = /\[([^\]\s]{1,12})\]/g;

/**
 * Convert a ChordPro line with inline chords ("[Am]Hello [G]world") into a
 * chord line and a lyric line. Returns null if the line has no inline chords.
 */
export function splitInlineChords(line) {
  let lyric = '';
  let last = 0;
  const placed = [];
  let m;
  INLINE_CHORD_RE.lastIndex = 0;
  while ((m = INLINE_CHORD_RE.exec(line))) {
    if (!parseChord(m[1])) return null;
    lyric += line.slice(last, m.index);
    placed.push({ col: lyric.length, text: m[1] });
    last = m.index + m[0].length;
  }
  if (!placed.length) return null;
  lyric += line.slice(last);
  let chordLine = '';
  for (const p of placed) {
    const col = Math.max(p.col, chordLine.length ? chordLine.length + 1 : 0);
    chordLine = chordLine.padEnd(col, ' ') + p.text;
  }
  return { chordLine, lyric: lyric.trim() ? lyric : null };
}

/**
 * Classify one line of plain text. Returns a line object:
 *   {type: 'blank'}
 *   {type: 'chords', text, tokens}
 *   {type: 'tab', text}
 *   {type: 'section', text}
 *   {type: 'meta', text, name, value}
 *   {type: 'lyric', text}
 */
export function classifyLine(text) {
  if (!text.trim()) return { type: 'blank' };
  if (isTabLine(text)) return { type: 'tab', text };
  // Before chords, so "Key: Am" is not read as a chord line with a label.
  const meta = parseMeta(text);
  if (meta) return { type: 'meta', text: text.trim(), ...meta };
  const tokens = chordLineTokens(text);
  if (tokens) return { type: 'chords', text, tokens };
  if (isSectionHeader(text)) return { type: 'section', text: text.trim() };
  return { type: 'lyric', text };
}
