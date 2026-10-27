// Transposing tablature by shifting fret numbers.

const MAX_FRET = 24;
const LABEL_RE = /^(\s*[A-Ga-g][#b]?\s*[|:]?|\s*[|:])/;

function splitLabel(line) {
  const m = LABEL_RE.exec(line);
  return m ? [m[0], line.slice(m[0].length)] : ['', line];
}

function fretNumbers(lines) {
  const frets = [];
  for (const line of lines) {
    const [, body] = splitLabel(line);
    for (const m of body.matchAll(/(?<![x×\d])\d+/gi)) frets.push(Number(m[0]));
  }
  return frets;
}

/**
 * Work out how far to shift the frets of a tab block. Frets cannot go below
 * the open string, so when a shift down would need negative frets the block
 * is moved up an octave instead (and the same if it would go past fret 24).
 */
export function tabShift(lines, semitones) {
  const frets = fretNumbers(lines);
  if (!frets.length) return { shift: 0, octave: 0 };
  const min = Math.min(...frets);
  const max = Math.max(...frets);
  let shift = semitones;
  let octave = 0;
  if (min + shift < 0) {
    shift += 12;
    octave = 1;
  } else if (max + shift > MAX_FRET && min + shift - 12 >= 0) {
    shift -= 12;
    octave = -1;
  }
  return { shift, octave };
}

/**
 * Shift every fret number in one tab line. When a number gets wider
 * ("9" to "11") it takes the dash after it, so the columns of the other
 * strings stay lined up; when it gets narrower a dash is added.
 */
export function shiftTabLine(line, shift) {
  if (!shift) return line;
  const [label, body] = splitLabel(line);
  let out = '';
  let i = 0;
  while (i < body.length) {
    const m = /^\d+/.exec(body.slice(i));
    // Repeat counts such as "x4" are not frets.
    if (!m || /[x×]/i.test(body[i - 1] || '')) {
      const skip = m ? m[0].length : 1;
      out += body.slice(i, i + skip);
      i += skip;
      continue;
    }
    const next = String(Number(m[0]) + shift);
    i += m[0].length;
    out += next;
    let diff = next.length - m[0].length;
    while (diff > 0 && /[-–—]/.test(body[i] || '') && /[-–—]/.test(body[i + 1] || '-')) {
      i += 1;
      diff -= 1;
    }
    if (diff < 0) out += '-'.repeat(-diff);
  }
  return label + out;
}

/** Transpose a block of tab lines (one system of strings). */
export function transposeTabBlock(lines, semitones) {
  const { shift, octave } = tabShift(lines, semitones);
  return { lines: lines.map((l) => shiftTabLine(l, shift)), octave };
}
