// Splitting a file with many songs into a setlist.
import { classifyLine, parseDirective } from './lines.js';
import { normalizeText, parseSongLines } from './song.js';

export const PAGE_BREAK = '\f';

const SEPARATOR_RE = /^\s*(?:([=_*#~])\1{3,}|-{5,})\s*$/;
const NUMBERED_RE = /^\s*(\d{1,3})\s*[.)\-–]\s+(\S.*)$/;
const TITLE_ARTIST_RE = /^(.+?)\s+[-–—|]\s+(.+)$/;

/** Turn a title line into {title, artist}: "Title - Artist", "3. Title". */
export function parseTitleLine(line) {
  let text = line.trim();
  const numbered = NUMBERED_RE.exec(text);
  if (numbered) text = numbered[2].trim();
  const m = TITLE_ARTIST_RE.exec(text);
  if (m && m[1].length <= 50 && m[2].length <= 40) return { title: m[1].trim(), artist: m[2].trim() };
  return { title: text, artist: '' };
}

function isChordProTitle(line) {
  const d = parseDirective(line);
  return Boolean(d && (d.name === 'title' || d.name === 't' || d.name === 'new_song' || d.name === 'ns'));
}

/**
 * Score how much a line looks like the title of a new song. Looks at what
 * comes before (blank lines, a page break) and after (credits, key, capo,
 * a blank line) and at the line itself.
 */
function titleScore(lines, types, i, blanksBefore, pageBreakBefore) {
  const line = lines[i];
  const type = types[i];
  if (type.type !== 'lyric') return -Infinity;
  const text = line.trim();
  if (text.length > 60) return -Infinity;
  let score = 0;
  if (pageBreakBefore) score += 2;
  if (blanksBefore >= 2) score += 2;
  else if (blanksBefore === 1) score += 1;
  if (NUMBERED_RE.test(text)) score += 2;
  if (TITLE_ARTIST_RE.test(text)) score += 1;
  if (/[A-Za-z]/.test(text) && text === text.toUpperCase()) score += 1;
  const next = types[i + 1];
  const after = types[i + 2];
  if (next && next.type === 'meta') score += 2;
  else if (next && next.type === 'lyric' && after && after.type === 'meta') score += 2;
  else if (!next || next.type === 'blank') score += 1;
  if (/[,;]$/.test(text)) score -= 2;
  if (/repeat|chorus|פזמון|חזרה|\bx\s*\d|\d\s*x\b/i.test(text)) score -= 3;
  if (text.length > 45) score -= 1;
  return score;
}

const hasMusic = (types, from, to) =>
  types.slice(from, to).some((t) => t.type === 'chords' || t.type === 'tab');

/**
 * Find where each song starts. Returns an array of line indexes.
 *
 * Clear markers win: ChordPro {title}/{new_song} lines and separator rows
 * (=====, *****). Otherwise a line that looks like a title (see titleScore)
 * starts a new song, as long as the song before it had some chords or tabs.
 */
export function findSongStarts(lines) {
  const types = lines.map((l) => (l === PAGE_BREAK ? { type: 'blank' } : classifyLine(l)));

  if (lines.filter(isChordProTitle).length > 1) {
    const starts = [];
    let sawTitle = false;
    lines.forEach((l, i) => {
      const d = parseDirective(l);
      if (!d) return;
      if (d.name === 'new_song' || d.name === 'ns' || ((d.name === 'title' || d.name === 't') && sawTitle)) {
        starts.push(i);
        sawTitle = d.name === 'title' || d.name === 't';
      } else if (d.name === 'title' || d.name === 't') {
        sawTitle = true;
      }
    });
    return [0, ...starts.filter((i) => i > 0)];
  }

  const starts = [0];
  let blanks = 0;
  let pageBreak = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === PAGE_BREAK) {
      pageBreak = true;
      continue;
    }
    if (SEPARATOR_RE.test(line) && types[i].type !== 'tab') {
      if (hasMusic(types, starts.at(-1), i)) starts.push(i + 1);
      blanks = 0;
      continue;
    }
    if (types[i].type === 'blank') {
      blanks++;
      continue;
    }
    const current = starts.at(-1);
    if (i > current && isChordProTitle(line)) {
      starts.push(i);
    } else if (i > current && hasMusic(types, current, i)) {
      if (titleScore(lines, types, i, blanks, pageBreak) >= 3) starts.push(i);
    }
    blanks = 0;
    pageBreak = false;
  }
  return starts;
}

const CONTENTS_LINE_RE = /^\s*(.+?)\s*(?:\.{4,}|…{2,}|_{4,})\s*(\d{1,4})\s*$/;
const CONTENTS_HEADER_RE = /^\s*(contents|table of contents|index|songs|תוכן|תוכן עניינים|תוכן העניינים|רשימת שירים)\s*:?\s*$/i;

/**
 * Find a table of contents ("Song title ........ 12"). Returns the song
 * titles and the range of lines it takes up, or null.
 */
export function findContents(lines) {
  let from = -1;
  let to = -1;
  const titles = [];
  for (let i = 0; i < lines.length; i++) {
    const m = CONTENTS_LINE_RE.exec(lines[i]);
    if (m) {
      if (from < 0) from = i;
      to = i + 1;
      titles.push(m[1].replace(/\s{2,}/g, ' ').trim());
    } else if (from >= 0 && lines[i].trim() && lines[i] !== PAGE_BREAK) {
      break;
    }
  }
  if (titles.length < 2) return null;
  while (from > 0 && (!lines[from - 1].trim() || CONTENTS_HEADER_RE.test(lines[from - 1]))) from--;
  return { from, to, titles };
}

/** Letters and digits only, lower case, so "Blink   - 182" matches "Blink-182". */
function titleKey(text) {
  return text.toLowerCase().replace(/[^a-z0-9\u0590-\u05FF]/g, '');
}

/**
 * Song starts from a table of contents: each title is looked for, in order,
 * on a line of its own. Returns null if fewer than half the titles are found.
 */
export function startsFromContents(lines, titles) {
  const starts = [];
  let i = 0;
  for (const title of titles) {
    const key = titleKey(title);
    if (!key) continue;
    for (let j = i; j < lines.length; j++) {
      const lineKey = titleKey(lines[j]);
      if (lineKey && lineKey.length >= key.length * 0.7 && (key === lineKey || key.startsWith(lineKey) || lineKey.startsWith(key))) {
        starts.push(j);
        i = j + 1;
        break;
      }
    }
  }
  if (starts.length < titles.length / 2) return null;
  // Anything before the first title (a cover page) is not a song.
  return starts;
}

/**
 * Split text into songs. Each song is parsed; the first lyric line of a
 * plain-text song is taken as its title when it looks like one.
 */
export function splitSongs(text) {
  const lines = normalizeText(text)
    .split('\n')
    .flatMap((l) => (l.includes(PAGE_BREAK) ? l.split(PAGE_BREAK).flatMap((p, k) => (k ? [PAGE_BREAK, p] : [p])) : [l]));
  const toc = findContents(lines);
  if (toc) lines.splice(toc.from, toc.to - toc.from);
  const starts = (toc && startsFromContents(lines, toc.titles)) || findSongStarts(lines);
  const songs = [];
  starts.forEach((start, k) => {
    const end = k + 1 < starts.length ? starts[k + 1] : lines.length;
    let chunk = lines.slice(start, end).filter((l) => l !== PAGE_BREAK && !SEPARATOR_RE.test(l));
    while (chunk.length && !chunk[0].trim()) chunk.shift();
    if (!chunk.length) return;
    let info = {};
    const first = classifyLine(chunk[0]);
    const second = chunk.length > 1 ? classifyLine(chunk[1]) : { type: 'blank' };
    const third = chunk.length > 2 ? classifyLine(chunk[2]) : { type: 'blank' };
    // A first line straight into more lyrics is the song's opening, not its title.
    // A short line between the title and a blank line is the artist.
    const artistLine = second.type === 'lyric' && !/\[[^\]]+\]|^\s*\{/.test(chunk[1] || '')
      && (third.type === 'blank' || third.type === 'meta')
      && chunk[1].trim().length <= 40;
    const startsWithLyrics = second.type === 'lyric' && !artistLine;
    const plainTitle = first.type === 'lyric' && !parseDirective(chunk[0]) && !/\[[^\]]+\]/.test(chunk[0]);
    if (plainTitle && !startsWithLyrics && chunk[0].trim().length <= 60) {
      info = parseTitleLine(chunk[0]);
      chunk = chunk.slice(1);
      if (artistLine && !info.artist) {
        info.artist = chunk[0].trim();
        chunk = chunk.slice(1);
      }
    }
    const song = parseSongLines(chunk, info);
    // The song's own text (without its title line), so it can be saved and parsed again later.
    song.source = chunk.join('\n').replace(/^\n+|\s+$/g, '');
    if (!song.artist) {
      const credit = song.lines.find((l) => l.type === 'meta' && l.name === 'credit');
      if (credit && /^(?:ביצוע|מבצע|שירה|artist|performed by|by)(?=[\s:\-–])/i.test(credit.value)) {
        song.artist = credit.value.replace(/^[^:\-–]*[:\-–]\s*|^by\s+/i, '').trim();
      }
    }
    if (!song.title) song.title = `Song ${songs.length + 1}`;
    songs.push(song);
  });
  return songs;
}
