// Song model: parse text into typed lines, transpose, and lay out chords over lyrics.
import {
  detectKey, parseKey, transposeKey, chooseFlats, transposeParsed, keyName,
} from './chords.js';
import {
  classifyLine, chordLineTokens, parseDirective, splitInlineChords, countHebrew, countLatin,
} from './lines.js';
import { transposeTabBlock, tabShift } from './tabs.js';
import {
  tuningFromText, tuningFromTabLabels, tabSystemSize, retuneTabBlock, uniformOffset,
  standardTuning, BASS_WORD_RE,
} from './tuning.js';

/**
 * Clean up text before parsing: unify line endings, expand tab characters so
 * columns line up, and drop invisible direction marks that Hebrew sites add
 * (they would shift chord columns).
 */
export function normalizeText(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[​-‏‪-‮⁦-⁩﻿]/g, '')
    .replace(/ /g, ' ')
    .split('\n')
    .map((line) => {
      let out = '';
      for (const ch of line) out += ch === '\t' ? ' '.repeat(8 - (out.length % 8)) : ch;
      return out.replace(/ +$/, '');
    })
    .join('\n');
}

const CHORUS_DIRECTIVES = new Set(['soc', 'start_of_chorus']);
const COMMENT_DIRECTIVES = new Set(['c', 'comment', 'ci', 'comment_italic', 'cb', 'comment_box']);

/**
 * Parse the lines of one song. ChordPro directives and inline [chords] are
 * understood as well as plain chords-over-lyrics text.
 */
export function parseSongLines(rawLines, info = {}) {
  const song = {
    title: info.title || '',
    artist: info.artist || '',
    capo: null,
    statedKey: null,
    lines: [],
  };
  let inTab = false;
  for (const raw of rawLines) {
    const directive = parseDirective(raw);
    if (directive) {
      const { name, value } = directive;
      if (name === 'title' || name === 't') song.title = song.title || value;
      else if (name === 'subtitle' || name === 'st' || name === 'artist') song.artist = song.artist || value;
      else if (name === 'key') song.statedKey = parseKey(value);
      else if (name === 'capo') song.capo = Number(value) || null;
      else if (name === 'sot' || name === 'start_of_tab') inTab = true;
      else if (name === 'eot' || name === 'end_of_tab') inTab = false;
      else if (CHORUS_DIRECTIVES.has(name)) song.lines.push({ type: 'section', text: value || 'Chorus' });
      else if (COMMENT_DIRECTIVES.has(name) && value) song.lines.push({ type: 'section', text: value });
      continue;
    }
    if (inTab) {
      song.lines.push(raw.trim() ? { type: 'tab', text: raw } : { type: 'blank' });
      continue;
    }
    const inline = splitInlineChords(raw);
    if (inline) {
      song.lines.push(classifyLine(inline.chordLine));
      if (inline.lyric) song.lines.push({ type: 'lyric', text: inline.lyric });
      continue;
    }
    const line = classifyLine(raw);
    if (line.type === 'meta' && line.name === 'key' && !song.statedKey) song.statedKey = parseKey(line.value);
    if (line.type === 'meta' && line.name === 'capo' && song.capo === null) song.capo = Number(line.value);
    song.lines.push(line);
  }
  // Trim blank lines at both ends.
  while (song.lines.length && song.lines[0].type === 'blank') song.lines.shift();
  while (song.lines.length && song.lines.at(-1).type === 'blank') song.lines.pop();

  // "Song (capo 2)" in a title.
  const titleCapo = /(?:capo|קאפו)\s*(\d{1,2})/i.exec(song.title);
  if (titleCapo && song.capo === null) song.capo = Number(titleCapo[1]);
  song.dir = detectDirection(song);
  song.tuning = detectTuning(rawLines, song.lines);
  song.key = song.statedKey || detectKey(songChords(song));
  return song;
}

/**
 * The tuning a song is written for: from a line that names it, or else from
 * the string names of its first tab. A song whose first tab has four or five
 * strings (or bass string names) is a bass song, and with no tabs a song
 * that says "bass" is too; a tuning name such as "Drop D" is then read as a
 * bass tuning. Null means it gives no tuning (usually guitar standard).
 */
function detectTuning(rawLines, lines) {
  const firstTab = [];
  for (const line of lines) {
    if (line.type === 'tab') firstTab.push(line.text);
    else if (firstTab.length) break;
  }
  const fromTabs = tuningFromTabLabels(firstTab);
  const size = tabSystemSize(firstTab);
  const bass = firstTab.length
    ? (fromTabs ? fromTabs.instrument === 'bass' : Boolean(size) && size < 6)
    : rawLines.slice(0, 15).some((l) => BASS_WORD_RE.test(l));
  const strings = fromTabs ? fromTabs.strings : size;
  const fromText = tuningFromText(rawLines, bass ? { instrument: 'bass', strings } : {});
  if (fromText) return fromText;
  if (fromTabs) return fromTabs;
  return bass && size && size < 6 ? standardTuning({ instrument: 'bass', strings: size }) : null;
}

/**
 * The tuning to move one tab block from and to. A block with another number
 * of strings than the song's tuning (a bass part in a guitar song) uses its
 * own string names, and goes to standard tuning for its instrument.
 */
function blockRetune(tabLines, retuning) {
  const size = tabSystemSize(tabLines);
  if (!size || size === retuning.from.pitches.length) return retuning;
  const own = tuningFromTabLabels(tabLines);
  return own ? { from: own, to: standardTuning(own) } : retuning;
}

/** The bass tuning a tab block is played in, or null if it is not a bass tab. */
function bassBlockTuning(tabLines, songTuning) {
  const size = tabSystemSize(tabLines);
  const own = tuningFromTabLabels(tabLines);
  if (own) return own.instrument === 'bass' ? own : null;
  if (songTuning && songTuning.instrument === 'bass' && songTuning.strings === size) return songTuning;
  return size && size < 6 ? standardTuning({ instrument: 'bass', strings: size }) : null;
}

/**
 * Transpose a bass tab down past the open strings. Rather than moving the
 * whole bass line up an octave, each note that would need a fret below the
 * open string moves to a lower string (the line stays in the same octave);
 * only notes below the lowest string go up an octave. This is the same as
 * moving the tab from a tuning `semitones` higher to the one it is in.
 */
function transposeBassBlock(tabLines, semitones, tuning) {
  const shifted = { ...tuning, pitches: tuning.pitches.map((p) => p + semitones) };
  const moved = retuneTabBlock(tabLines, shifted, tuning);
  return moved.skipped ? null : moved;
}

export function parseSong(text, info) {
  return parseSongLines(normalizeText(text).split('\n'), info);
}

/** All chords of a song in order, as parsed chord objects. */
export function songChords(song) {
  const chords = [];
  for (const line of song.lines) {
    if (line.type !== 'chords') continue;
    for (const token of line.tokens) {
      if (token.kind !== 'chord') continue;
      for (const piece of token.pieces) if (typeof piece === 'object') chords.push(piece.chord);
    }
  }
  return chords;
}

/** 'rtl' when the words of the song are mostly Hebrew. */
export function detectDirection(song) {
  let hebrew = countHebrew(song.title);
  let latin = countLatin(song.title);
  for (const line of song.lines) {
    if (line.type === 'lyric' || line.type === 'section' || line.type === 'meta') {
      hebrew += countHebrew(line.text);
      latin += countLatin(line.text);
    }
  }
  return hebrew > latin ? 'rtl' : 'ltr';
}

function tokenText(token, mapChord) {
  if (token.kind !== 'chord') return token.text;
  return token.pieces.map((p) => (typeof p === 'object' ? mapChord(p) : p)).join('');
}

/**
 * Rebuild a chord line with new chord names. Every chord keeps its column
 * (so it stays over the same syllable) unless the chord before it grew
 * into it, in which case it moves just far enough to leave one space.
 */
export function rebuildChordLine(tokens, mapChord) {
  let text = '';
  for (const token of tokens) {
    const t = tokenText(token, mapChord);
    const col = text.length ? Math.max(token.col, text.length + 1) : token.col;
    text = text.padEnd(col, ' ') + t;
  }
  return text;
}

/**
 * Transpose a song by a number of semitones.
 * spelling: 'auto' (sharps or flats to suit the new key), 'sharp' or 'flat'.
 * retune: optionally {from, to, shapes} to move the song to another tuning.
 *   Tab notes keep their pitch on the new tuning. Chord names stay the same
 *   (they name the notes that sound), unless `shapes` says they name the
 *   shapes held in the old tuning, as is usual for songs tuned down a half
 *   or whole step; then they move by the difference between the tunings.
 * Bass tabs moved down past the open strings put notes on a lower string
 * where they can (counted in `bassMoves`) instead of going up an octave.
 * Returns a new song; the original is not changed.
 */
export function transposeSong(song, semitones, spelling = 'auto', retune = null) {
  const retuning = retune && retune.from && retune.to && retune.from.id !== retune.to.id ? retune : null;
  const shapeShift = retuning && retuning.shapes ? uniformOffset(retuning.from) - uniformOffset(retuning.to) : 0;
  const tabN = ((semitones % 12) + 12) % 12;
  const n = (((semitones + shapeShift) % 12) + 12) % 12;
  const key = transposeKey(song.key, n);
  const useFlats = chooseFlats(spelling, key);
  // With no shift and automatic spelling, keep the chords exactly as written.
  const keepAsWritten = n === 0 && spelling === 'auto';
  const mapChord = (piece) => (keepAsWritten ? piece.text : transposeParsed(piece.chord, n, useFlats));
  const lines = [];
  const notes = [];
  const tuningReport = { moved: 0, octave: 0, merged: 0, skipped: 0 };
  let bassMoves = 0;
  for (let i = 0; i < song.lines.length; i++) {
    const line = song.lines[i];
    if (line.type === 'chords') {
      const text = rebuildChordLine(line.tokens, mapChord);
      lines.push({ type: 'chords', text, tokens: chordLineTokens(text) || line.tokens });
    } else if (line.type === 'tab') {
      let j = i;
      while (j < song.lines.length && song.lines[j].type === 'tab') j++;
      let tabLines = song.lines.slice(i, j).map((l) => l.text);
      const blockTuning = retuning && blockRetune(tabLines, retuning);
      if (blockTuning && blockTuning.from.id !== blockTuning.to.id) {
        const moved = retuneTabBlock(tabLines, blockTuning.from, blockTuning.to);
        tabLines = moved.lines;
        tuningReport.moved += moved.moved;
        tuningReport.octave += moved.octave;
        tuningReport.merged += moved.merged;
        if (moved.skipped) tuningReport.skipped++;
      }
      // Tabs shift by the smallest move, up or down, unless that needs negative frets.
      const tabSemitones = tabN > 6 ? tabN - 12 : tabN;
      const bassTuning = tabSemitones && bassBlockTuning(tabLines, blockTuning ? blockTuning.to : song.tuning);
      const bass = bassTuning && tabShift(tabLines, tabSemitones).octave === 1
        ? transposeBassBlock(tabLines, tabSemitones, bassTuning) : null;
      if (bass) {
        if (bass.octave) notes.push({ line: i, octave: 1, notes: bass.octave });
        if (bass.moved) bassMoves += bass.moved;
        for (const text of bass.lines) lines.push({ type: 'tab', text });
      } else {
        const block = transposeTabBlock(tabLines, tabSemitones);
        if (block.octave) notes.push({ line: i, octave: block.octave });
        for (const text of block.lines) lines.push({ type: 'tab', text });
      }
      i = j - 1;
    } else {
      lines.push(line);
    }
  }
  return {
    ...song, lines, key, semitones: n, useFlats, notes, bassMoves,
    retuned: retuning ? { from: retuning.from, to: retuning.to, shapeShift, ...tuningReport } : null,
  };
}

/** Key name for display, spelled to suit the key. */
export function songKeyName(song) {
  return keyName(song.key, song.useFlats);
}

/**
 * Split a lyric under a chord line into segments, one per chord, so a
 * renderer can stack each chord above its piece of lyric. This works the
 * same for right-to-left songs: columns count from the start of the line,
 * which is the right edge in Hebrew.
 */
export function pairChordsWithLyric(tokens, lyric) {
  const sorted = [...tokens].sort((a, b) => a.col - b.col);
  const last = sorted.at(-1);
  const width = Math.max(lyric.length, last ? last.col + 1 : 0);
  const padded = lyric.padEnd(width, ' ');
  const segments = [];
  if (!sorted.length || sorted[0].col > 0) {
    segments.push({ chord: null, text: padded.slice(0, sorted.length ? sorted[0].col : width) });
  }
  sorted.forEach((token, i) => {
    const end = i + 1 < sorted.length ? sorted[i + 1].col : width;
    segments.push({
      chord: tokenText(token, (p) => p.text),
      kind: token.kind,
      text: padded.slice(token.col, end),
    });
  });
  // Mark segments that end in the middle of a word, so a renderer can add a hyphen
  // if it needs to widen the gap for a long chord name.
  for (let i = 0; i < segments.length - 1; i++) {
    const a = segments[i].text;
    const b = segments[i + 1].text;
    segments[i].midWord = /\S$/.test(a) && /^\S/.test(b);
  }
  return segments;
}

/**
 * Group a song's lines into display blocks: chord+lyric pairs, tab blocks,
 * sections, plain lines.
 */
export function songBlocks(song) {
  const blocks = [];
  const lines = song.lines;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1];
    if (line.type === 'chords' && next && next.type === 'lyric') {
      blocks.push({ kind: 'pair', segments: pairChordsWithLyric(line.tokens, next.text) });
      i++;
    } else if (line.type === 'chords') {
      blocks.push({ kind: 'chords', segments: pairChordsWithLyric(line.tokens, '') });
    } else if (line.type === 'tab') {
      const tab = [];
      while (i < lines.length && lines[i].type === 'tab') tab.push(lines[i++].text);
      i--;
      blocks.push({ kind: 'tab', lines: tab });
    } else {
      blocks.push({ kind: line.type, text: line.text || '' });
    }
  }
  return blocks;
}

/** Plain text of a song, for export or copying. */
export function songToText(song) {
  const out = [];
  if (song.title) out.push(song.artist ? `${song.title} - ${song.artist}` : song.title);
  if (song.title) out.push('');
  for (const line of song.lines) out.push(line.type === 'blank' ? '' : line.text);
  return out.join('\n');
}
