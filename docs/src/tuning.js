// Guitar tunings: recognising them, and moving tabs from one tuning to another
// so every note keeps its pitch.
const LETTER_VALUES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
// Standard tuning as MIDI note numbers, low string to high: E2 A2 D3 G3 B3 E4.
export const STANDARD = [40, 45, 50, 55, 59, 64];

// Named tunings, low string to high.
export const NAMED_TUNINGS = [
  { id: 'standard', name: 'Standard', notes: 'E A D G B E', aliases: ['standard', 'e standard'] },
  { id: 'half-down', name: 'Half step down', notes: 'Eb Ab Db Gb Bb Eb', aliases: ['half step down', 'half-step down', 'eb tuning', 'eb standard', 'e flat'] },
  { id: 'whole-down', name: 'Whole step down (D standard)', notes: 'D G C F A D', aliases: ['whole step down', 'd standard', 'full step down'] },
  { id: 'c-standard', name: 'C standard', notes: 'C F Bb Eb G C', aliases: ['c standard'] },
  { id: 'drop-d', name: 'Drop D', notes: 'D A D G B E', aliases: ['drop d'] },
  { id: 'drop-c-sharp', name: 'Drop C#', notes: 'C# G# C# F# A# D#', aliases: ['drop c#', 'drop db'] },
  { id: 'drop-c', name: 'Drop C', notes: 'C G C F A D', aliases: ['drop c'] },
  { id: 'drop-b', name: 'Drop B', notes: 'B F# B E G# C#', aliases: ['drop b'] },
  { id: 'double-drop-d', name: 'Double drop D', notes: 'D A D G B D', aliases: ['double drop d'] },
  { id: 'dadgad', name: 'DADGAD', notes: 'D A D G A D', aliases: ['dadgad'] },
  { id: 'open-c', name: 'Open C', notes: 'C G C G C E', aliases: ['open c'] },
  { id: 'open-d', name: 'Open D', notes: 'D A D F# A D', aliases: ['open d'] },
  { id: 'open-e', name: 'Open E', notes: 'E B E G# B E', aliases: ['open e'] },
  { id: 'open-g', name: 'Open G', notes: 'D G D G B D', aliases: ['open g'] },
  { id: 'open-a', name: 'Open A', notes: 'E A E A C# E', aliases: ['open a'] },
  { id: 'open-d-minor', name: 'Open D minor', notes: 'D A D F A D', aliases: ['open d minor', 'open dm'] },
];

function noteValue(name) {
  const m = /^([A-Ga-g])([#b♯♭]?)$/.exec(name);
  if (!m) return null;
  const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0;
  return (LETTER_VALUES[m[1].toUpperCase()] + acc + 12) % 12;
}

/**
 * Turn six note names (low to high) into pitches. Each string is taken as
 * the pitch nearest to its standard-tuning note, which is how retuning works
 * in practice: C on the 6th string is the C below E, not the one above.
 */
export function tuningPitches(names) {
  if (!names || names.length !== 6) return null;
  const pitches = [];
  for (let i = 0; i < 6; i++) {
    const value = noteValue(names[i]);
    if (value === null) return null;
    let diff = (value - (STANDARD[i] % 12) + 12) % 12;
    if (diff > 6) diff -= 12; // a tie (6) goes down, as strings are more often slackened
    pitches.push(STANDARD[i] + diff);
  }
  return pitches;
}

/**
 * Split "CGCGGe", "C G C G G E", "Eb Ab Db Gb Bb Eb" or "EADGbe" into six
 * note names. A "b" after a note is read as a flat first; if that does not
 * give six notes, it is read as the note B (as in "EADGbe").
 */
export function splitNotes(text) {
  const compact = text.replace(/[\s\-–,/|]+/g, '');
  for (const re of [/([A-Ga-g])([#♯♭b]?)/g, /([A-Ga-g])([#♯♭]?)/g]) {
    const notes = [...compact.matchAll(re)].map((m) => m[1] + m[2]);
    if (notes.length === 6 && notes.join('') === compact) return notes;
  }
  return null;
}

export function tuningFromNotes(names, name) {
  const pitches = tuningPitches(names);
  if (!pitches) return null;
  const known = NAMED_TUNINGS.find((t) => {
    const p = tuningPitches(t.notes.split(' '));
    return p && p.every((v, i) => v === pitches[i]);
  });
  return {
    id: known ? known.id : names.join('').toLowerCase(),
    name: known ? known.name : name || names.map((n, i) => (i === 5 ? n.toLowerCase() : n.toUpperCase())).join(' '),
    notes: names.map((n) => n[0].toUpperCase() + n.slice(1)),
    pitches,
  };
}

export function namedTuning(id) {
  const t = NAMED_TUNINGS.find((x) => x.id === id);
  return t ? tuningFromNotes(t.notes.split(' '), t.name) : null;
}

const TUNING_WORD_RE = /tuning|tuned|tune|כיוון|טיונינג|כוונון/i;

/**
 * Find a song's tuning from its text: a line that mentions the tuning, with
 * six notes ("Tuning: C G C G C E") or a name ("Open G", "Drop D", "half step
 * down"). Six written notes win over a name, since names are often loose.
 */
export function tuningFromText(lines) {
  // Only the top of a song describes its tuning; look a few lines past the tuning word too.
  const head = lines.slice(0, 15);
  const mentions = head.map((l, i) => (TUNING_WORD_RE.test(l) ? i : -1)).filter((i) => i >= 0);
  for (const i of mentions) {
    for (let j = i; j < Math.min(i + 3, head.length); j++) {
      const text = j === i ? head[j].slice(head[j].search(TUNING_WORD_RE)) : head[j];
      for (const candidate of text.match(/[A-Ga-g#b♯♭\s\-–,/|]{6,}/g) || []) {
        const notes = splitNotes(candidate.trim());
        const t = notes && tuningFromNotes(notes);
        if (t) return t;
      }
    }
  }
  for (const i of mentions) {
    const lower = head[i].toLowerCase();
    for (const t of [...NAMED_TUNINGS].sort((a, b) => Math.max(...b.aliases.map((x) => x.length)) - Math.max(...a.aliases.map((x) => x.length)))) {
      if (t.aliases.some((alias) => lower.includes(alias))) return namedTuning(t.id);
    }
  }
  return null;
}

const STRING_LABEL_RE = /^\s*([A-Ga-g][#b]?)\s*[|:]/;

/** Tuning from the string names at the start of a 6-line tab block (high string on top). */
export function tuningFromTabLabels(tabLines) {
  if (tabLines.length < 6) return null;
  const labels = tabLines.slice(0, 6).map((l) => (STRING_LABEL_RE.exec(l) || [])[1]);
  if (labels.some((l) => !l)) return null;
  return tuningFromNotes(labels.reverse());
}

// ---- Moving tab notes between tunings ----

const NOTE_RE = /\d+/g;
const CONNECTOR_RE = /^[hpbrs/\\~^]$/i;

/** Split a tab body into note groups: numbers joined by h, p, / and similar. */
function noteGroups(body) {
  const groups = [];
  let m;
  NOTE_RE.lastIndex = 0;
  while ((m = NOTE_RE.exec(body))) {
    if (/[x×]/i.test(body[m.index - 1] || '')) continue; // "x2" repeat marks
    const note = { col: m.index, text: m[0], fret: Number(m[0]) };
    const prev = groups.at(-1);
    const between = prev ? body.slice(prev.end, m.index) : '';
    if (prev && between.length === 1 && CONNECTOR_RE.test(between)) {
      prev.notes.push(note);
      prev.connectors.push(between);
      prev.end = m.index + m[0].length;
    } else {
      groups.push({ start: m.index, end: m.index + m[0].length, notes: [note], connectors: [] });
    }
  }
  return groups;
}

const groupText = (frets, connectors) => frets.map((f, i) => (i ? connectors[i - 1] : '') + f).join('');

const STANDARD_LABELS = ['E', 'A', 'D', 'G', 'B', 'e'];

/**
 * Move one 6-string tab system (high string first, as tabs are written) from
 * one tuning to another, keeping every note's pitch. A note that would need a
 * fret below the open string goes to a thicker string where it fits (at the
 * same spot in the bar); if no string has room, it goes up an octave.
 * Returns the new lines and how many notes changed string or octave.
 */
export function retuneTabSystem(lines, from, to) {
  // Row 0 is the high string; tuning arrays go low to high.
  const stringOf = (row) => 5 - row;
  const rows = lines.map((line) => {
    const m = /^(\s*(?:[A-Ga-g][#b]?\s*)?[|:]?)(.*)$/.exec(line);
    const body = m[2];
    // Text after the last bar line ("| repeat twice") is not part of the tab.
    const lastBar = body.lastIndexOf('|');
    const tabEnd = lastBar >= 0 && /[A-Za-z]/.test(body.slice(lastBar + 1)) ? lastBar + 1 : body.length;
    return { label: m[1], body: body.split(''), tabEnd };
  });
  const isDash = (ch) => /[-–—]/.test(ch || '');
  // The tab as written, to tell free spots from notes.
  const original = rows.map((row) => [...row.body]);

  const all = rows.flatMap((row, r) => noteGroups(row.body.join('').slice(0, row.tabEnd)).map((g) => ({
    r, g, pitches: g.notes.map((n) => from.pitches[stringOf(r)] + n.fret),
  })));
  const samePitches = (a, b) => a.length === b.length && a.every((p, k) => p === b[k]);
  const placements = [];
  const taken = rows.map(() => []); // [start, end) spans placed on each row
  const isFree = (row, start, end) => {
    for (let c = start; c < end; c++) if (!isDash(original[row][c])) return false;
    return !taken[row].some(([a, b]) => a < end && start < b);
  };
  const counts = { moved: 0, octave: 0, merged: 0 };

  for (const item of all) {
    const { r, g, pitches } = item;
    const s = stringOf(r);
    let row = r;
    let frets = pitches.map((p) => p - to.pitches[s]);
    if (Math.min(...frets) < 0) {
      // Tunings with two strings on one note (like C G C G G E) play some
      // notes twice; if another string already plays this one here, drop it.
      if (all.some((o) => o !== item && o.g.start === g.start && samePitches(o.pitches, pitches))) {
        item.dropped = true;
        counts.merged++;
        continue;
      }
      // Otherwise a thicker string, nearest first, with room at that spot.
      let found = false;
      for (let other = s - 1; other >= 0 && !found; other--) {
        const f = pitches.map((p) => p - to.pitches[other]);
        if (Math.min(...f) < 0 || Math.max(...f) > 15) continue;
        const otherRow = 5 - other;
        if (isFree(otherRow, g.start, g.start + groupText(f, g.connectors).length)) {
          row = otherRow;
          frets = f;
          found = true;
        }
      }
      if (found) counts.moved++;
      else {
        // Too low for any string. If another string already plays it an
        // octave up here, that is enough; otherwise play it an octave up.
        const up = pitches.map((p) => p + 12);
        if (all.some((o) => o !== item && o.g.start === g.start && samePitches(o.pitches, up))) {
          item.dropped = true;
          counts.merged++;
          continue;
        }
        frets = frets.map((f) => f + 12);
        counts.octave++;
      }
    }
    const text = groupText(frets, g.connectors);
    placements.push({ row, start: g.start, oldLen: g.end - g.start, text, from: r });
    taken[row].push([g.start, g.start + Math.max(text.length, g.end - g.start)]);
  }

  // Clear every note as written; they are all put back from the placements.
  for (const { r, g } of all) for (let i = g.start; i < g.end; i++) rows[r].body[i] = '-';

  // A note that got wider takes the free dashes after it; if there are not
  // enough, every string is widened at that point so the columns stay lined up.
  const inserts = new Map();
  for (const p of placements) {
    const startsAfter = (c) => placements.some((o) => o !== p && o.row === p.row && o.start === c);
    let room = p.oldLen;
    while (room < p.text.length) {
      const c = p.start + room;
      const free = isDash(original[p.row][c]) || all.some((o) => o.r === p.row && o.g.start <= c && c < o.g.end && o.dropped);
      if (!free || startsAfter(c) || startsAfter(c + 1) || c + 1 >= rows[p.row].tabEnd) break;
      room++;
    }
    if (room < p.text.length) {
      const at = p.start + p.oldLen;
      inserts.set(at, Math.max(inserts.get(at) || 0, p.text.length - room));
    }
  }
  const points = [...inserts.entries()].sort((a, b) => b[0] - a[0]);
  for (const row of rows) {
    for (const [at, n] of points) {
      if (at <= row.tabEnd && at <= row.body.length) row.body.splice(at, 0, ...'-'.repeat(n));
    }
  }
  for (const p of placements) {
    const shift = points.reduce((sum, [at, n]) => (at <= p.start ? sum + n : sum), 0);
    const body = rows[p.row].body;
    for (let i = 0; i < p.text.length; i++) body[p.start + shift + i] = p.text[i];
  }

  return {
    lines: rows.map((row, r) => {
      const name = to.notes[stringOf(r)];
      const label = row.label.replace(/[A-Ga-g][#b]?/, r === 0 ? name.toLowerCase() : name);
      return label + row.body.join('');
    }),
    ...counts,
  };
}

/**
 * Move a whole tab block, made of one or more 6-line systems, to another
 * tuning. Blocks that are not made of 6-line systems are left as they are.
 */
export function retuneTabBlock(lines, from, to) {
  if (!lines.length || lines.length % 6 !== 0) return { lines, moved: 0, octave: 0, merged: 0, skipped: true };
  const out = [];
  const totals = { moved: 0, octave: 0, merged: 0 };
  for (let i = 0; i < lines.length; i += 6) {
    const sys = retuneTabSystem(lines.slice(i, i + 6), from, to);
    out.push(...sys.lines);
    for (const k of Object.keys(totals)) totals[k] += sys[k];
  }
  return { lines: out, ...totals, skipped: false };
}

/**
 * When every string is moved by the same amount (half step down, D standard),
 * chord names in songs are usually the shapes you hold, not the notes that
 * sound. Returns that amount in semitones, or 0 for other tunings.
 */
export function uniformOffset(tuning) {
  const diffs = tuning.pitches.map((p, i) => p - STANDARD[i]);
  return diffs.every((d) => d === diffs[0]) ? diffs[0] : 0;
}

