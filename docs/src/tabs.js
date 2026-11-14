// Transposing tablature by shifting fret numbers.

const MAX_FRET = 24;
const LABEL_RE = /^(\s*[A-Ga-g][#b]?\s*[|:]?|\s*[|:])/;

function splitLabel(line) {
  const m = LABEL_RE.exec(line);
  return m ? [m[0], line.slice(m[0].length)] : ['', line];
}

/**
 * The notes in the bodies of one tab system (string names taken off), as
 * {start, end, text, fret, packed} for each line. Repeat counts ("x4") are
 * not notes. Digits written with no dash between them are usually notes
 * played one after another ("-666-" is fret 6 three times), so a run of
 * three or more digits, or a number above the highest fret, is split into
 * single notes; a two-digit run such as "22" is split too when another
 * string has split notes at the same spot, and otherwise read as one fret.
 */
export function tabNotes(bodies) {
  const runs = bodies.map((body) => [...body.matchAll(/(?<![x×\d])\d+/gi)].map((m) => ({
    start: m.index, text: m[0], split: m[0].length > 2 || Number(m[0]) > MAX_FRET,
  })));
  const splitAt = new Set(runs.flat().filter((r) => r.split).map((r) => r.start));
  for (const r of runs.flat()) if (r.text.length === 2 && splitAt.has(r.start)) r.split = true;
  return runs.map((line) => line.flatMap((r) => (r.split
    ? [...r.text].map((d, k) => ({ start: r.start + k, end: r.start + k + 1, text: d, fret: Number(d), packed: true }))
    : [{ start: r.start, end: r.start + r.text.length, text: r.text, fret: Number(r.text), packed: false }])));
}

const bodiesOf = (lines) => lines.map((line) => splitLabel(line)[1]);

function fretNumbers(lines) {
  return tabNotes(bodiesOf(lines)).flat().map((n) => n.fret);
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
 * strings stay lined up; when it gets narrower a dash is added. Notes packed
 * together ("666") get a dash between them when they get wider. `notes` is
 * the line's notes from tabNotes, read with the rest of its system.
 */
export function shiftTabLine(line, shift, notes = null) {
  if (!shift) return line;
  const [label, body] = splitLabel(line);
  const found = notes || tabNotes([body])[0];
  let out = '';
  let i = 0;
  for (const note of found) {
    out += body.slice(i, note.start);
    const next = String(note.fret + shift);
    i = note.end;
    out += next;
    let diff = next.length - note.text.length;
    while (diff > 0 && /[-–—]/.test(body[i] || '') && /[-–—]/.test(body[i + 1] || '-')) {
      i += 1;
      diff -= 1;
    }
    if (diff < 0) out += '-'.repeat(-diff);
    else if (diff > 0 && note.packed && /\d/.test(body[i] || '')) out += '-';
  }
  return label + out + body.slice(i);
}

const isDash = (ch) => /[-–—]/.test(ch || '');

/**
 * Transpose a block of tab lines (one system of strings). A note that gets
 * wider takes the free dashes after it; when there are not enough, every
 * string is widened at that point so the columns stay lined up.
 */
export function transposeTabBlock(lines, semitones) {
  const { shift, octave } = tabShift(lines, semitones);
  if (!shift) return { lines: [...lines], octave };
  const parts = lines.map(splitLabel);
  const bodies = parts.map(([, body]) => body);
  const found = tabNotes(bodies);
  const inserts = new Map();
  const edits = found.map((notes, r) => notes.map((note) => {
    const next = String(note.fret + shift);
    const body = bodies[r];
    // Notes packed together ("666") keep a dash between them once wider.
    const text = next + (note.packed && next.length > note.text.length && /\d/.test(body[note.end] || '') ? '-' : '');
    const extra = text.length - note.text.length;
    let room = 0;
    // Leave one dash before whatever comes next.
    while (room < extra && isDash(body[note.end + room]) && isDash(body[note.end + room + 1] ?? '-')) room++;
    if (room < extra) inserts.set(note.end, Math.max(inserts.get(note.end) || 0, extra - room));
    return { note, text };
  }));
  const points = [...inserts.entries()].sort((x, y) => y[0] - x[0]);
  return {
    lines: parts.map(([label, body], r) => {
      const chars = body.split('');
      for (const [at, n] of points) if (at <= chars.length) chars.splice(at, 0, ...'-'.repeat(n));
      for (const { note, text } of edits[r]) {
        const start = note.start + points.reduce((sum, [at, n]) => (at <= note.start ? sum + n : sum), 0);
        const written = text.padEnd(note.text.length, '-');
        for (let k = 0; k < written.length; k++) chars[start + k] = written[k];
      }
      return label + chars.join('');
    }),
    octave,
  };
}
