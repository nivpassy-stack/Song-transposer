import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import mammoth from 'mammoth';
import {
  parseChord, transposeChord, detectKey, classifyLine, shiftTabLine, transposeTabBlock,
  parseSong, transposeSong, songKeyName, songToText, songBlocks, splitSongs,
  pdfToText, docxToText, decodeText, normalizeText,
} from '../src/index.js';

const sample = (name) => fs.readFileSync(new URL(`./samples/${name}`, import.meta.url));

test('parses and transposes chord symbols', () => {
  assert.equal(transposeChord('Am', 2), 'Bm');
  assert.equal(transposeChord('F#m7/C#', 1), 'Gm7/D');
  assert.equal(transposeChord('Bb', 2, true), 'C');
  assert.equal(transposeChord('C', 1, true), 'Db');
  assert.equal(transposeChord('Cmaj7', -1), 'Bmaj7');
  assert.equal(transposeChord('Dsus4', 3, true), 'Fsus4');
  assert.equal(transposeChord('E7(b9)', 1, true), 'F7(b9)');
  assert.equal(transposeChord('C6/9', 2), 'D6/9');
  assert.equal(parseChord('Go').minor, false);
  assert.equal(parseChord('Hello'), null);
  assert.equal(parseChord('Am').minor, true);
  assert.equal(parseChord('Amaj7').minor, false);
});

test('detects the key', () => {
  const chords = ['Am', 'Dm', 'G', 'C', 'E', 'Am'].map(parseChord);
  assert.deepEqual(detectKey(chords), { root: 9, minor: true });
  assert.deepEqual(detectKey(['G', 'C', 'D', 'Em', 'G'].map(parseChord)), { root: 7, minor: false });
});

test('classifies lines', () => {
  assert.equal(classifyLine('Am      G   C/E').type, 'chords');
  assert.equal(classifyLine('Intro: Em7  G  Dsus4 (x2)').type, 'chords');
  assert.equal(classifyLine('| Am | G | F | E |').type, 'chords');
  assert.equal(classifyLine('A man walks down the street').type, 'lyric');
  assert.equal(classifyLine('Am I blue').type, 'lyric');
  assert.equal(classifyLine('e|---0---1---|').type, 'tab');
  assert.equal(classifyLine('[Chorus]').type, 'section');
  assert.equal(classifyLine('פזמון:').type, 'section');
  assert.equal(classifyLine('בית שני').type, 'section');
  assert.equal(classifyLine('Capo 3').name, 'capo');
  assert.equal(classifyLine('סולם: Am').name, 'key');
  assert.equal(classifyLine('מילים ולחן: נעמי שמר').name, 'credit');
  assert.equal(classifyLine('---------').type, 'lyric');
});

test('keeps chords over the same syllable when transposing', () => {
  const song = parseSong('G        C    D\nHello there my friend');
  const up = transposeSong(song, 1, 'sharp');
  assert.equal(up.lines[0].text, 'G#       C#   D#');
  const flat = transposeSong(song, 1, 'flat');
  assert.equal(flat.lines[0].text, 'Ab       Db   Eb');
  // A chord that grows into the next one pushes it just far enough.
  const tight = parseSong('C D\nla la');
  assert.equal(transposeSong(tight, 1, 'sharp').lines[0].text, 'C# D#');
});

test('auto spelling follows the new key', () => {
  const song = parseSong('C  F  G  C\nla la la la');
  assert.equal(songKeyName(transposeSong(song, 3)), 'Eb');
  assert.equal(transposeSong(song, 3).lines[0].text, 'Eb Ab Bb Eb');
  assert.equal(songKeyName(transposeSong(song, 2)), 'D');
  assert.equal(songKeyName(transposeSong(song, 0)), 'C');
});

test('transposes tab frets and keeps strings aligned', () => {
  assert.equal(shiftTabLine('e|---9---10--|', 2), 'e|---11--12--|');
  assert.equal(shiftTabLine('e|---10--|', -2), 'e|---8---|');
  assert.equal(shiftTabLine('G|---2---|  x2', 1), 'G|---3---|  x2');
  // Going below the open string moves the block up an octave instead.
  const block = transposeTabBlock(['e|---0---1---|', 'B|---1---3---|'], -2);
  assert.equal(block.octave, 1);
  assert.deepEqual(block.lines, ['e|---10--11--|', 'B|---11--13--|']);
});

test('reads ChordPro with inline chords', () => {
  const song = parseSong('{title: Amazing Grace}\n{key: G}\n[G]Amazing [G7]grace how [C]sweet');
  assert.equal(song.title, 'Amazing Grace');
  assert.equal(songKeyName(song), 'G');
  assert.equal(song.lines[0].type, 'chords');
  assert.equal(song.lines[0].text, 'G       G7        C');
  assert.equal(song.lines[1].text, 'Amazing grace how sweet');
});

test('splits a multi-song text file into a setlist', () => {
  const songs = splitSongs(sample('english.txt').toString());
  assert.deepEqual(songs.map((s) => [s.title, s.artist]), [['Let It Be', 'The Beatles'], ['Wonderwall', 'Oasis']]);
  assert.equal(songKeyName(songs[0]), 'C');
  assert.equal(songKeyName(songs[1]), 'Em');
});

test('splits ChordPro files by title', () => {
  const songs = splitSongs(sample('songs.cho').toString());
  assert.deepEqual(songs.map((s) => s.title), ['Amazing Grace', 'Hallelujah']);
  assert.equal(songs[1].artist, 'Leonard Cohen');
});

test('handles Hebrew songs: direction, credits, sections', () => {
  const songs = splitSongs(sample('hebrew.txt').toString());
  assert.deepEqual(songs.map((s) => s.title), ['ירושלים של זהב', 'הבה נגילה']);
  assert.ok(songs.every((s) => s.dir === 'rtl'));
  assert.equal(songs[1].artist, 'עממי');
  assert.equal(songKeyName(songs[0]), 'Am');
  const up = transposeSong(songs[0], 2);
  assert.equal(songKeyName(up), 'Bm');
  const tab = up.lines.filter((l) => l.type === 'tab').map((l) => l.text);
  assert.deepEqual(tab, ['e|-----2-3-2-----|', 'B|---3-------5---|']);
});

test('pairs chords with lyric segments for display', () => {
  const song = parseSong('Am       Dm\nאויר הרים צלול כיין');
  const [block] = songBlocks(song);
  assert.equal(block.kind, 'pair');
  assert.deepEqual(block.segments.map((s) => [s.chord, s.text]), [['Am', 'אויר הרים'], ['Dm', ' צלול כיין']]);
  const lead = songBlocks(parseSong('   G\nla la la'))[0];
  assert.deepEqual(lead.segments.map((s) => [s.chord, s.text]), [[null, 'la '], ['G', 'la la']]);
});

test('normalizes direction marks and tab characters', () => {
  assert.equal(normalizeText('‏Am\tG\r\n'), 'Am      G\n');
});

test('decodes Windows-1255 Hebrew text files', () => {
  const bytes = new Uint8Array([0xF9, 0xEC, 0xE5, 0xED]); // שלום
  assert.equal(decodeText(bytes), 'שלום');
});

test('reads a Hebrew PDF with chords over lyrics', async () => {
  const text = await pdfToText(new Uint8Array(sample('hebrew.pdf')), pdfjs);
  const songs = splitSongs(text);
  assert.deepEqual(songs.map((s) => s.title), ['ירושלים של זהב', 'הבה נגילה']);
  assert.equal(songs[0].dir, 'rtl');
  const [pair] = songBlocks(songs[0]).filter((b) => b.kind === 'pair');
  assert.equal(pair.segments[0].chord, 'Am');
  assert.ok(pair.segments[0].text.startsWith('אויר'));
});

test('reads a Word file', async () => {
  const node = { extractRawText: ({ arrayBuffer }) => mammoth.extractRawText({ buffer: Buffer.from(arrayBuffer) }) };
  const buf = sample('english.docx');
  const text = await docxToText(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length), node);
  const [song] = splitSongs(text);
  assert.equal(song.title, 'Let It Be');
  assert.equal(songToText(transposeSong(song, 2)).split('\n')[2], 'D              A');
});

test('splits ChordPro songs that follow plain-text songs', () => {
  const text = `${sample('hebrew.txt')}\n\n{title: Amazing Grace}\n[G]Amazing [C]grace`;
  assert.deepEqual(splitSongs(text).map((s) => s.title), ['ירושלים של זהב', 'הבה נגילה', 'Amazing Grace']);
});

// Avital's own song file is kept out of the public repository; the test runs where it exists.
const hasRealPdf = fs.existsSync(new URL('./samples/songs-for-playing.pdf', import.meta.url));

test("reads Avital's multi-song PDF: table cells, contents page, Hebrew song", { skip: !hasRealPdf }, async () => {
  const text = await pdfToText(new Uint8Array(sample('songs-for-playing.pdf')), pdfjs);
  const songs = splitSongs(text);
  assert.equal(songs.length, 14);
  assert.equal(songs[0].title, 'Blink-182');
  assert.equal(songs[4].capo, 2);
  const hebrew = songs.at(-1);
  assert.equal(hebrew.title, 'עוד ארון אחד');
  assert.equal(hebrew.dir, 'rtl');
  // Two-column table cells are read one after the other, not line by line across.
  const blink = songToText(songs[0]);
  assert.ok(blink.includes('All the small things\n          G             C\nTrue care, truth brings'));
  assert.ok(blink.includes('|---|   |-6-|  |---|'));
  assert.ok(songToText(hebrew).includes('סולו:'));
});

test('backs up and restores the library', async () => {
  const { addSetlist, exportLibrary, restoreBackup } = await import('../src/library.js');
  const a = { songs: {}, setlists: [], prefs: {} };
  addSetlist(a, 'Gig', splitSongs(sample('english.txt').toString()));
  const b = { songs: {}, setlists: [], prefs: {} };
  assert.deepEqual(restoreBackup(b, exportLibrary(a)), { setlists: 1, songs: 2 });
  assert.deepEqual(restoreBackup(b, exportLibrary(a)), { setlists: 0, songs: 0 });
  assert.equal(restoreBackup(b, 'not a backup'), null);
});

test('recognises tunings written in songs', async () => {
  const { tuningFromText, splitNotes, tuningFromTabLabels } = await import('../src/tuning.js');
  assert.deepEqual(splitNotes('CGCGGe'), ['C', 'G', 'C', 'G', 'G', 'e']);
  assert.deepEqual(splitNotes('EADGbe'), ['E', 'A', 'D', 'G', 'b', 'e']);
  assert.deepEqual(splitNotes('Eb Ab Db Gb Bb Eb'), ['Eb', 'Ab', 'Db', 'Gb', 'Bb', 'Eb']);
  assert.deepEqual(tuningFromText(['"Open C" tuning:', 'tuning low to high CGCGGe']).pitches, [36, 43, 48, 55, 55, 64]);
  assert.equal(tuningFromText(['Tuning: Drop D']).id, 'drop-d');
  assert.equal(tuningFromText(['Tuning: D A D G B E']).id, 'drop-d');
  assert.equal(tuningFromText(['Tuned half step down']).id, 'half-down');
  assert.equal(tuningFromText(['Open G tuning (D G D G B D)']).id, 'open-g');
  assert.equal(tuningFromText(['Am  G  C']), null);
  assert.equal(tuningFromTabLabels(['D|--', 'A|--', 'F#|--', 'D|--', 'A|--', 'D|--']).id, 'open-d');
});

test('moves tabs from another tuning to standard at the same pitch', async () => {
  const { namedTuning, retuneTabBlock } = await import('../src/tuning.js');
  const std = namedTuning('standard');
  // Drop D: the low string's open D is doubled an octave up on the D string, so it is played there once.
  const dropD = retuneTabBlock(['e|-----|', 'B|-----|', 'G|-----|', 'D|--0--|', 'A|--0--|', 'D|--0--|'], namedTuning('drop-d'), std);
  assert.deepEqual(dropD.lines, ['e|-----|', 'B|-----|', 'G|-----|', 'D|--0--|', 'A|--0--|', 'E|-----|']);
  assert.equal(dropD.merged, 1);
  // Drop D fret 5 (G2) is fret 3 in standard; widths change are kept aligned.
  const riff = retuneTabBlock(['e|---|', 'B|---|', 'G|---|', 'D|---|', 'A|---|', 'D|-5-|'], namedTuning('drop-d'), std);
  assert.equal(riff.lines[5], 'E|-3-|');
  // Open C: the low C is below a standard guitar, so it is played an octave up.
  const openC = retuneTabBlock(['e|-0-|', 'C|---|', 'G|---|', 'C|---|', 'G|---|', 'C|-0-|'], namedTuning('open-c'), std);
  assert.deepEqual(openC.lines.map((l) => l.slice(0, 5)), ['e|-0-', 'B|---', 'G|---', 'D|---', 'A|---', 'E|-8-']);
  assert.equal(openC.octave, 1);
  // Open C: the C on the 4th string goes to the A string, at fret 3.
  const fourth = retuneTabBlock(['e|---|', 'C|---|', 'G|---|', 'C|-0-|', 'G|---|', 'C|---|'], namedTuning('open-c'), std);
  assert.equal(fourth.lines[4], 'A|-3-|');
  assert.equal(fourth.moved, 1);
  // A note getting wider widens every string at that point.
  const wide = retuneTabBlock(['e|-9-|', 'B|---|', 'G|---|', 'D|---|', 'A|---|', 'D|-9-|'], namedTuning('drop-d'), std);
  assert.deepEqual(wide.lines.map((l) => l.length), [6, 6, 6, 6, 6, 6].map((n) => n));
});

test('converts a whole song, with chord shapes for songs tuned down', async () => {
  const { namedTuning } = await import('../src/tuning.js');
  const song = parseSong('Tuning: half step down\n\nE        A\nla la la la');
  assert.equal(song.tuning.id, 'half-down');
  const asShapes = transposeSong(song, 0, 'auto', { from: song.tuning, to: namedTuning('standard'), shapes: true });
  assert.equal(asShapes.lines.find((l) => l.type === 'chords').text, 'Eb       Ab');
  const asNotes = transposeSong(song, 0, 'auto', { from: song.tuning, to: namedTuning('standard'), shapes: false });
  assert.equal(asNotes.lines.find((l) => l.type === 'chords').text, 'E        A');
});

test('keeps tab lines that end with a comment', () => {
  assert.equal(classifyLine('G|--------------3-3-3/5-5-5---| repeat twice').type, 'tab');
});

test('recognises bass tabs and bass tunings', async () => {
  const { tuningFromText, splitNotes, tuningFromTabLabels, tabSystemSize, instrumentFor } = await import('../src/tuning.js');
  assert.deepEqual(splitNotes('E A D G'), ['E', 'A', 'D', 'G']);
  assert.deepEqual(splitNotes('Eb Ab Db Gb'), ['Eb', 'Ab', 'Db', 'Gb']);
  assert.deepEqual(splitNotes('BEADG'), ['B', 'E', 'A', 'D', 'G']);
  // Six notes are still read as a guitar first.
  assert.deepEqual(splitNotes('EADGbe'), ['E', 'A', 'D', 'G', 'b', 'e']);
  assert.equal(instrumentFor(['E', 'A', 'D', 'G', 'B', 'E']), 'guitar');
  assert.equal(instrumentFor(['B', 'E', 'A', 'D', 'G', 'C']), 'bass');
  // A guitar tab that leaves out the low strings is not a bass tuning.
  assert.equal(instrumentFor(['D', 'G', 'B', 'E']), null);
  assert.equal(tuningFromTabLabels(['e|--------|', 'B|--------|', 'G|--------|', 'D|--------|']), null);

  const bass4 = tuningFromTabLabels(['G|-----|', 'D|-----|', 'A|-----|', 'E|-----|']);
  assert.equal(bass4.id, 'bass-standard');
  assert.deepEqual(bass4.pitches, [28, 33, 38, 43]);
  assert.equal(tuningFromTabLabels(['G|-----|', 'D|-----|', 'A|-----|', 'D|-----|']).id, 'bass-drop-d');
  assert.equal(tuningFromTabLabels(['G|-----|', 'D|-----|', 'A|-----|', 'E|-----|', 'B|-----|']).id, 'bass-5');
  assert.equal(tuningFromTabLabels(['C|-----|', 'G|-----|', 'D|-----|', 'A|-----|', 'E|-----|', 'B|-----|']).id, 'bass-6');
  // Two 4-string systems in one block are not read as a 6-string tab.
  const two = ['G|--|', 'D|--|', 'A|--|', 'E|--|', 'G|--|', 'D|--|', 'A|--|', 'E|--|'];
  assert.equal(tabSystemSize(two), 4);
  assert.equal(tuningFromTabLabels(two).id, 'bass-standard');
  assert.equal(tabSystemSize(['e|--|', 'B|--|', 'G|--|', 'D|--|', 'A|--|', 'E|--|']), 6);

  assert.equal(tuningFromText(['Tuning: E A D G']).id, 'bass-standard');
  assert.equal(tuningFromText(['Tuning: B E A D G']).id, 'bass-5');
  assert.equal(tuningFromText(['Tuning: Drop D'], { instrument: 'bass', strings: 4 }).id, 'bass-drop-d');
  assert.equal(tuningFromText(['Tuning: standard'], { instrument: 'bass', strings: 5 }).id, 'bass-5');
  // Guitar songs keep reading names as guitar tunings.
  assert.equal(tuningFromText(['Tuning: Drop D']).id, 'drop-d');
});

test('parses bass songs and transposes bass tabs down onto lower strings', async () => {
  const bassLine = 'Riff (bass)\n\nG|-----------------|\nD|-----------------|\nA|-7--7-10-7-5-3-2-|\nE|-----------------|\n\nAm  G\nla la';
  const song = parseSong(bassLine);
  assert.equal(song.tuning.id, 'bass-standard');
  // Down 3: the last note (A string fret 2) moves to the E string, not the whole riff up an octave.
  const down = transposeSong(song, -3);
  assert.deepEqual(down.lines.filter((l) => l.type === 'tab').map((l) => l.text), [
    'G|-----------------|',
    'D|-----------------|',
    'A|-4--4-7--4-2-0---|',
    'E|---------------4-|',
  ]);
  assert.equal(down.bassMoves, 1);
  assert.equal(down.notes.length, 0);
  // Up is a plain fret shift.
  const up = transposeSong(song, 2);
  assert.equal(up.lines.filter((l) => l.type === 'tab')[2].text, 'A|-9--9-12-9-7-5-4-|');
  // Unlabelled 4-line tabs are bass tabs too.
  assert.equal(parseSong('|-----------|\n|-----------|\n|--2--------|\n|--------3--|').tuning.id, 'bass-standard');
  // Notes below the low string of a bass still go up an octave.
  const low = transposeSong(parseSong('G|-------|\nD|-------|\nA|-------|\nE|--0--3-|'), -1);
  assert.equal(low.lines[3].text, 'E|--11-2-|');
  assert.equal(low.notes.length, 1);
});

test('moves bass tabs to bass standard tuning, and leaves bass parts of guitar songs to their own tuning', async () => {
  const { namedTuning, standardTuning, isStandardTuning, retuneTabBlock, uniformOffset } = await import('../src/tuning.js');
  const dropD = namedTuning('bass-drop-d');
  assert.equal(standardTuning(dropD).id, 'bass-standard');
  assert.equal(standardTuning(namedTuning('bass-5')).id, 'bass-5');
  assert.ok(isStandardTuning(namedTuning('bass-6')));
  assert.equal(uniformOffset(namedTuning('bass-half-down')), -1);
  // Drop D fret 5 (G1) is fret 3 on the E string; the open low D is below a 4-string bass, so it goes up an octave.
  const riff = retuneTabBlock(['G|-------|', 'D|-------|', 'A|-------|', 'D|--0-5--|'], dropD, standardTuning(dropD));
  assert.deepEqual(riff.lines, ['G|--------|', 'D|--------|', 'A|--------|', 'E|--10-3--|']);
  assert.equal(riff.octave, 1);
  // A guitar tuning is not applied to a bass tab, nor a bass tuning to a guitar tab.
  assert.ok(retuneTabBlock(['G|---|', 'D|---|', 'A|---|', 'D|-5-|'], namedTuning('drop-d'), namedTuning('standard')).skipped);

  const song = parseSong('Tuning: Drop D\n\ne|-----|\nB|-----|\nG|-----|\nD|-----|\nA|-----|\nD|--5--|\n\nBass:\nG|-----|\nD|-----|\nA|-----|\nD|--5--|');
  assert.equal(song.tuning.id, 'drop-d');
  const moved = transposeSong(song, 0, 'auto', { from: song.tuning, to: standardTuning(song.tuning) });
  const tabs = moved.lines.filter((l) => l.type === 'tab').map((l) => l.text);
  assert.equal(tabs[5], 'E|--3--|');
  assert.equal(tabs[9], 'E|--3--|');
  assert.equal(moved.retuned.skipped, 0);
  // A bass song that names its tuning.
  assert.equal(parseSong('Tuning: Drop D\nG|-------|\nD|-------|\nA|-------|\nD|--0----|').tuning.id, 'bass-drop-d');
});

test('plays songs in any tuning, such as a bass kept in drop D', async () => {
  const { namedTuning, tuningFromNotes } = await import('../src/tuning.js');
  const dropD = namedTuning('bass-drop-d');
  // A bass song in standard, played on a drop D bass: low E notes are fret 2 on the D string.
  const song = parseSong('G|---------|\nD|---------|\nA|-------0-|\nE|--0--3---|');
  assert.equal(song.tuning.id, 'bass-standard');
  const played = transposeSong(song, 0, 'auto', { from: song.tuning, to: dropD });
  assert.deepEqual(played.lines.map((l) => l.text), ['G|---------|', 'D|---------|', 'A|-------0-|', 'D|--2--5---|']);
  assert.equal(played.retuned.to.id, 'bass-drop-d');
  // A guitar song in standard, played in a custom tuning.
  const guitar = parseSong('e|-----|\nB|-----|\nG|-----|\nD|-----|\nA|-----|\nE|--3--|');
  const openD = tuningFromNotes(['D', 'A', 'D', 'F#', 'A', 'D']);
  assert.equal(transposeSong(guitar, 0, 'auto', { from: guitar.tuning || namedTuning('standard'), to: openD }).lines[5].text, 'D|--5--|');
});

test('restores the player\'s own tunings from a backup', async () => {
  const { exportLibrary, restoreBackup } = await import('../src/library.js');
  const a = { songs: {}, setlists: [], prefs: { myTunings: { 'bass-4': 'D A D G' } } };
  const b = { songs: {}, setlists: [], prefs: { myTunings: { 'guitar-6': 'D A D G B E' } } };
  restoreBackup(b, exportLibrary(a));
  assert.deepEqual(b.prefs.myTunings, { 'bass-4': 'D A D G', 'guitar-6': 'D A D G B E' });
});
