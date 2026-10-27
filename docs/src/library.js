// The saved library: songs and setlists, kept in the browser's local storage.
//
// A saved song keeps its original text plus how it is transposed (semitones
// and spelling), so the transposed sheet can always be rebuilt exactly and
// moved back to the original key.

const STORAGE_KEY = 'chord-transposer.library.v1';

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function emptyLibrary() {
  return { songs: {}, setlists: [], prefs: { fontSize: 18, stageFontSize: 28, view: 'studio' } };
}

export function loadLibrary(storage = globalThis.localStorage) {
  try {
    const raw = storage && storage.getItem(STORAGE_KEY);
    if (!raw) return emptyLibrary();
    const data = JSON.parse(raw);
    return { ...emptyLibrary(), ...data, prefs: { ...emptyLibrary().prefs, ...data.prefs } };
  } catch {
    return emptyLibrary();
  }
}

/** Returns false when the browser refuses to save (private window, storage full). */
export function saveLibrary(library, storage = globalThis.localStorage) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(library));
    return true;
  } catch {
    return false;
  }
}

/** Add songs (from splitSongs) to the library as a new setlist. Returns the setlist. */
export function addSetlist(library, name, songs) {
  const now = Date.now();
  const songIds = songs.map((song) => {
    const id = newId();
    library.songs[id] = {
      id,
      title: song.title,
      artist: song.artist || '',
      text: song.source,
      semitones: 0,
      spelling: 'auto',
      duration: 210,
      createdAt: now,
      updatedAt: now,
    };
    return id;
  });
  const setlist = { id: newId(), name, songIds, createdAt: now };
  library.setlists.unshift(setlist);
  return setlist;
}

export function updateSong(library, id, changes) {
  const song = library.songs[id];
  if (!song) return null;
  Object.assign(song, changes, { updatedAt: Date.now() });
  return song;
}

/** Delete a song everywhere. */
export function deleteSong(library, id) {
  delete library.songs[id];
  for (const list of library.setlists) list.songIds = list.songIds.filter((s) => s !== id);
}

/** Delete a setlist; its songs are deleted too unless another setlist still uses them. */
export function deleteSetlist(library, setlistId) {
  const list = library.setlists.find((l) => l.id === setlistId);
  if (!list) return;
  library.setlists = library.setlists.filter((l) => l.id !== setlistId);
  const stillUsed = new Set(library.setlists.flatMap((l) => l.songIds));
  for (const id of list.songIds) if (!stillUsed.has(id)) delete library.songs[id];
}

export function moveSong(setlist, songId, delta) {
  const i = setlist.songIds.indexOf(songId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= setlist.songIds.length) return false;
  [setlist.songIds[i], setlist.songIds[j]] = [setlist.songIds[j], setlist.songIds[i]];
  return true;
}

/**
 * Join a song with the next one in its setlist, for when a file was split
 * in the wrong place. The next song's title line goes back into the text.
 */
export function mergeWithNext(library, setlist, songId) {
  const i = setlist.songIds.indexOf(songId);
  const nextId = setlist.songIds[i + 1];
  if (i < 0 || !nextId) return false;
  const a = library.songs[songId];
  const b = library.songs[nextId];
  const heading = [b.title, b.artist].filter(Boolean).join(' - ');
  updateSong(library, songId, { text: `${a.text}\n\n${heading}\n${b.text}` });
  deleteSong(library, nextId);
  return true;
}

/**
 * Split a song in two at a line of its text, for when two songs were read
 * as one. The line at `lineIndex` becomes the new song's title.
 */
export function splitAt(library, setlist, songId, lineIndex) {
  const song = library.songs[songId];
  const lines = song.text.split('\n');
  if (lineIndex <= 0 || lineIndex >= lines.length) return null;
  const now = Date.now();
  const id = newId();
  library.songs[id] = {
    id,
    title: lines[lineIndex].trim() || 'Untitled',
    artist: '',
    text: lines.slice(lineIndex + 1).join('\n').replace(/^\n+/, ''),
    semitones: song.semitones,
    spelling: song.spelling,
    createdAt: now,
    updatedAt: now,
  };
  updateSong(library, songId, { text: lines.slice(0, lineIndex).join('\n').replace(/\s+$/, '') });
  const i = setlist.songIds.indexOf(songId);
  setlist.songIds.splice(i + 1, 0, id);
  return library.songs[id];
}

/** The whole library as text, for a backup file. */
export function exportLibrary(library) {
  return JSON.stringify({ app: 'chord-transposer', version: 1, savedAt: new Date().toISOString(), ...library }, null, 1);
}

/**
 * Add a backup's songs and setlists to the library. Setlists already in the
 * library (same id) are skipped, so restoring the same backup twice is safe.
 * Returns how many setlists and songs were added, or null if the text is not a backup.
 */
export function restoreBackup(library, text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || data.app !== 'chord-transposer' || !Array.isArray(data.setlists) || typeof data.songs !== 'object') return null;
  const known = new Set(library.setlists.map((l) => l.id));
  let setlists = 0;
  let songs = 0;
  for (const list of data.setlists) {
    if (known.has(list.id)) continue;
    const songIds = list.songIds.filter((id) => data.songs[id]);
    for (const id of songIds) {
      if (!library.songs[id]) songs++;
      library.songs[id] = library.songs[id] || data.songs[id];
    }
    library.setlists.push({ ...list, songIds });
    setlists++;
  }
  return { setlists, songs };
}
