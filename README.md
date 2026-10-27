# Chord Transposer

Transpose guitar chords and tabs, keep setlists, and play with auto-scroll.
Works in the browser and installs as an app (phone, tablet, computer); works offline.

- **Studio view**: library of setlists and songs, transpose each song on its own,
  edit, reorder, join or split songs, back up and restore the library.
- **Stage view**: large sheet, transpose and Accidentals controls, auto-scroll set
  by song length, next/previous song, keys for Bluetooth page-turner pedals.
- **Files**: paste, .txt (UTF-8 or Windows-1255 Hebrew), ChordPro, PDF (including
  Word-table layouts and a contents page), .docx, saved web pages.
- **Hebrew**: songs are shown right to left with chords over the right words;
  tabs stay left to right, aligned right.

## Code

- `src/chords.js` parse, transpose and spell chords; detect the key
- `src/lines.js` classify lines: chords, lyrics, tabs, sections, credits, ChordPro
- `src/tabs.js` shift tab frets, keeping strings aligned
- `src/song.js` song model, transposing, chord/lyric pairing for display
- `src/split.js` split a multi-song file into a setlist
- `src/extract.js` read text, PDF, Word and HTML files
- `src/library.js` saved library (local storage), backup and restore
- `src/render.js` draw a song sheet
- `index.html`, `app.js` the app (Studio and Stage)
- `build.mjs` builds the installable app into `docs/` (served by GitHub Pages)
- `icons.mjs` draws the app icons

```
npm install
npm test        # engine tests
npm run build   # writes docs/
```
