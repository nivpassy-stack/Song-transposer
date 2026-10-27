// Chord parsing, transposing and key detection.

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const LETTER_VALUES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11, H: 11 };

// Major keys (by root value) that are normally written with flats.
const FLAT_MAJOR_KEYS = new Set([5, 10, 3, 8, 1]); // F Bb Eb Ab Db
// Minor keys (by root value) that are normally written with flats.
const FLAT_MINOR_KEYS = new Set([2, 7, 0, 5, 10, 3]); // Dm Gm Cm Fm Bbm Ebm

const QUALITY = String.raw`(?:maj|Maj|MAJ|min|dim|aug|sus|add|alt|no|omit|m|M|°|ø|o|\+|-|Δ|\d{1,2}|[#b♯♭](?=\d)|\(|\)|,|\/(?=\d))*`;
const CHORD_RE = new RegExp(String.raw`^([A-G])([#b♯♭]?)(${QUALITY})(?:\/([A-G])([#b♯♭]?))?$`);

function accidentalValue(acc) {
  if (acc === '#' || acc === '♯') return 1;
  if (acc === 'b' || acc === '♭') return -1;
  return 0;
}

function mod12(n) {
  return ((n % 12) + 12) % 12;
}

/** Parse a chord symbol such as "F#m7/C#". Returns null when the text is not a chord. */
export function parseChord(text) {
  const m = CHORD_RE.exec(text);
  if (!m) return null;
  const [, letter, acc, quality, bassLetter, bassAcc] = m;
  // Balanced parentheses only, so "A)" or "(C" are not chords.
  const opens = (quality.match(/\(/g) || []).length;
  const closes = (quality.match(/\)/g) || []).length;
  if (opens !== closes) return null;
  return {
    root: mod12(LETTER_VALUES[letter] + accidentalValue(acc)),
    rootText: letter + acc,
    quality,
    bass: bassLetter ? mod12(LETTER_VALUES[bassLetter] + accidentalValue(bassAcc)) : null,
    bassText: bassLetter ? bassLetter + (bassAcc || '') : null,
    minor: /^(m(?!aj)|min|-(?!\d))/.test(quality),
  };
}

export function isChord(text) {
  return parseChord(text) !== null;
}

/** Name of a note value (0-11) using sharps or flats. */
export function noteName(value, useFlats) {
  return (useFlats ? FLAT_NAMES : SHARP_NAMES)[mod12(value)];
}

/** Whether a key is conventionally written with flats. */
export function keyUsesFlats(key) {
  if (!key) return false;
  return key.minor ? FLAT_MINOR_KEYS.has(key.root) : FLAT_MAJOR_KEYS.has(key.root);
}

export function keyName(key, useFlats = keyUsesFlats(key)) {
  if (!key) return '';
  return noteName(key.root, useFlats) + (key.minor ? 'm' : '');
}

export function transposeKey(key, semitones) {
  if (!key) return null;
  return { root: mod12(key.root + semitones), minor: key.minor };
}

/**
 * Decide whether to spell transposed chords with flats.
 * spelling: 'auto' (follow the target key), 'sharp' or 'flat'.
 */
export function chooseFlats(spelling, targetKey) {
  if (spelling === 'flat') return true;
  if (spelling === 'sharp') return false;
  return keyUsesFlats(targetKey);
}

/** Transpose a parsed chord and return its new text. */
export function transposeParsed(chord, semitones, useFlats) {
  let text = noteName(chord.root + semitones, useFlats) + chord.quality;
  if (chord.bass !== null) text += '/' + noteName(chord.bass + semitones, useFlats);
  return text;
}

export function transposeChord(text, semitones, useFlats = false) {
  const chord = parseChord(text);
  return chord ? transposeParsed(chord, semitones, useFlats) : text;
}

// Diatonic triads: [interval from tonic, minor?]
const MAJOR_SCALE_CHORDS = [[0, false], [2, true], [4, true], [5, false], [7, false], [9, true]];
const MINOR_SCALE_CHORDS = [[0, true], [3, false], [5, true], [7, true], [7, false], [8, false], [10, false]];

/**
 * Guess a song's key from its chords (parsed chord objects, in order).
 * Scores each of the 24 keys by how many chords fit it, with extra weight
 * on the first and last chords, which usually are the tonic.
 */
export function detectKey(chords) {
  if (!chords.length) return null;
  let best = null;
  for (let root = 0; root < 12; root++) {
    for (const minor of [false, true]) {
      const scale = minor ? MINOR_SCALE_CHORDS : MAJOR_SCALE_CHORDS;
      let score = 0;
      chords.forEach((c, i) => {
        const interval = mod12(c.root - root);
        const fits = scale.some(([iv, m]) => iv === interval && m === c.minor);
        if (fits) score += 1;
        const isTonic = interval === 0 && c.minor === minor;
        if (isTonic && i === 0) score += 3;
        if (isTonic && i === chords.length - 1) score += 2;
      });
      if (!best || score > best.score) best = { root, minor, score };
    }
  }
  return { root: best.root, minor: best.minor };
}

/** Parse a key written like "Am", "F#" or "Bb minor". */
export function parseKey(text) {
  const m = /^\s*([A-G])([#b♯♭]?)\s*(m(?!aj)|min|minor|-)?/i.exec(text || '');
  if (!m) return null;
  const letter = m[1].toUpperCase();
  return { root: mod12(LETTER_VALUES[letter] + accidentalValue(m[2])), minor: Boolean(m[3]) };
}
