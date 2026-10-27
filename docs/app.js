// Studio view: library of setlists and songs, transposing, editing.
import {
  splitSongs, parseSong, transposeSong, keyName, songToText, readFileText,
  loadLibrary, saveLibrary, addSetlist, updateSong, deleteSong, deleteSetlist,
  moveSong, mergeWithNext, splitAt, exportLibrary, restoreBackup,
} from './src/index.js';
import { renderSheet } from './src/render.js';

const EXAMPLES = `Let It Be - The Beatles

[Verse 1]
C              G
When I find myself in times of trouble
Am             F
Mother Mary comes to me
C               G         F  C/E Dm C
Speaking words of wisdom, let it be

[Chorus]
Am       G       F      C
Let it be, let it be, let it be, let it be

[Riff]
e|-------0---1---0-------|
B|---1-----------3---1---|


ירושלים של זהב
מילים ולחן: נעמי שמר

Am        Dm
אויר הרים צלול כיין
G    C
וריח אורנים
E         Am
נישא ברוח הערביים
Dm E   Am
עם קול פעמונים

פתיחה:
e|-----0-1-0-----|
B|---1-------3---|`;

const $ = (id) => document.getElementById(id);
const library = loadLibrary();
const ui = { setlistId: null, songId: null, search: '' };
const parsedCache = new Map();

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function persist() {
  const ok = saveLibrary(library);
  $('storage-note').textContent = ok ? '' : 'This browser is not letting the app save, so changes will be lost when you close it.';
}

function toast(message) {
  const t = $('toast');
  t.textContent = message;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.textContent = ''; }, 2500);
}

// Parsing is cached per song version, since the sheet re-renders often.
function parsed(record) {
  const cacheKey = `${record.id}:${record.updatedAt}`;
  if (!parsedCache.has(cacheKey)) {
    parsedCache.set(cacheKey, parseSong(record.text, { title: record.title, artist: record.artist }));
  }
  return parsedCache.get(cacheKey);
}

function shown(record) {
  return transposeSong(parsed(record), record.semitones, record.spelling);
}

const DEFAULT_LENGTH = 210; // 3:30

const songLength = (record) => record.duration || DEFAULT_LENGTH;
const clampLength = (seconds) => Math.min(30 * 60, Math.max(20, Math.round(seconds)));

function formatDuration(seconds) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** "3:45" or "3.45" is minutes and seconds; a plain number is minutes. Returns seconds, or null. */
function parseDuration(text) {
  const m = /^\s*(\d{1,2})\s*[:.]\s*(\d{1,2})\s*$/.exec(text);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const minutes = /^\s*(\d{1,2}(?:\.\d+)?)\s*$/.exec(text);
  return minutes ? Math.round(Number(minutes[1]) * 60) : null;
}

const currentSetlist = () => library.setlists.find((l) => l.id === ui.setlistId) || null;
const currentSong = () => library.songs[ui.songId] || null;

function selectSetlist(id) {
  ui.setlistId = id;
  const list = currentSetlist();
  if (list && !list.songIds.includes(ui.songId)) ui.songId = list.songIds[0] || null;
  render();
}

function importText(text, name) {
  const songs = splitSongs(text);
  if (!songs.length) return null;
  const setlist = addSetlist(library, name, songs);
  persist();
  ui.setlistId = setlist.id;
  ui.songId = setlist.songIds[0];
  return setlist;
}

const today = () => new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const fileBaseName = (name) => name.replace(/\.[^.]+$/, '');

/** Each file becomes its own setlist, named after the file. */
async function importFiles(files, statusEl) {
  const added = [];
  const failed = [];
  for (const file of [...files]) {
    if (statusEl) statusEl.textContent = `Reading ${file.name}…`;
    try {
      const text = await readFileText(file);
      const setlist = importText(text, fileBaseName(file.name));
      if (setlist) added.push(`${setlist.name} (${setlist.songIds.length} songs)`);
      else failed.push(`${file.name}: no songs found`);
    } catch (err) {
      failed.push(`${file.name}: ${err.message || 'could not be read'}`);
    }
  }
  render();
  const message = [added.length ? `Added ${added.join(', ')}.` : '', failed.join('. ')].filter(Boolean).join(' ');
  if (statusEl) statusEl.textContent = message;
  toast(message);
  return added.length > 0;
}

function renderSetlists() {
  const items = library.setlists.map((list) => {
    const li = el('li');
    const b = el('button');
    b.setAttribute('aria-current', String(list.id === ui.setlistId));
    const name = el('span', 't', list.name);
    name.dir = 'auto';
    b.append(name, el('span', 'count', String(list.songIds.length)));
    b.addEventListener('click', () => selectSetlist(list.id));
    li.append(b);
    return li;
  });
  if (!items.length) items.push(el('li', 'list-empty', 'No setlists yet. Choose Add songs, or drag a file here.'));
  $('setlists').replaceChildren(...items);
}

function renderSongs() {
  const list = currentSetlist();
  $('rename-setlist').disabled = !list;
  $('delete-setlist').disabled = !list;
  $('songs-label').textContent = list ? `Songs in ${list.name}` : 'Songs';
  if (!list) {
    $('songs').replaceChildren(el('li', 'list-empty', 'Pick a setlist to see its songs.'));
    return;
  }
  const query = ui.search.trim().toLowerCase();
  const items = [];
  list.songIds.forEach((id, i) => {
    const record = library.songs[id];
    if (!record) return;
    if (query && !`${record.title} ${record.artist}`.toLowerCase().includes(query)) return;
    const song = shown(record);
    const li = el('li');
    const b = el('button');
    b.setAttribute('aria-current', String(id === ui.songId));
    const t = el('span', 't', record.title);
    t.dir = 'auto';
    if (record.artist) {
      const a = el('span', 'a', record.artist);
      a.dir = 'auto';
      t.append(a);
    }
    const k = el('span', 'k', keyName(song.key, song.useFlats));
    if (record.semitones) k.prepend(el('span', 'moved', `${keyName(parsed(record).key)} → `));
    b.append(el('span', 'n', `${i + 1}.`), t, k);
    b.addEventListener('click', () => {
      ui.songId = id;
      render();
      if (window.matchMedia('(max-width: 860px)').matches) $('main').scrollIntoView({ behavior: 'smooth' });
    });
    li.append(b);
    items.push(li);
  });
  if (!items.length) items.push(el('li', 'list-empty', query ? 'No songs match.' : 'This setlist is empty.'));
  $('songs').replaceChildren(...items);
}

function renderSong() {
  const record = currentSong();
  const list = currentSetlist();
  document.documentElement.style.setProperty('--sheet-size', `${library.prefs.fontSize}px`);
  document.documentElement.style.setProperty('--stage-size', `${library.prefs.stageFontSize}px`);
  renderStageBar(record, list);
  const controls = document.querySelectorAll('#song-head button, #song-head select');
  if (!record) {
    $('title').textContent = 'No song open';
    $('artist').textContent = '';
    $('key').textContent = '';
    $('capo').textContent = '';
    $('note').hidden = true;
    controls.forEach((c) => { c.disabled = true; });
    const empty = el('p', 'empty-state', 'Add songs to start: paste them, choose files, or drag a file (text, ChordPro, PDF or Word) onto the page. A file with many songs becomes a setlist, and every song can be moved to a new key on its own.');
    $('sheet').replaceChildren(empty);
    $('stage-song').textContent = '';
    $('stage-artist').textContent = '';
    $('stage-capo').textContent = '';
    $('sheet').dir = 'ltr';
    return;
  }
  controls.forEach((c) => { c.disabled = false; });
  const original = parsed(record);
  const song = shown(record);
  $('title').textContent = record.title;
  $('artist').textContent = record.artist;
  const from = keyName(original.key);
  const to = keyName(song.key, song.useFlats);
  $('key').textContent = record.semitones ? `${from} → ${to}` : `Key ${to || '?'}`;
  $('capo').textContent = original.capo ? `Capo ${original.capo}` : '';
  $('spelling').value = record.spelling;
  $('reset').disabled = !record.semitones;
  const index = list ? list.songIds.indexOf(record.id) : -1;
  $('move-up').disabled = index <= 0;
  $('move-down').disabled = index < 0 || index >= list.songIds.length - 1;
  $('merge').disabled = index < 0 || index >= list.songIds.length - 1;
  const note = $('note');
  note.hidden = !song.notes.length;
  note.textContent = song.notes.length
    ? 'Some tab parts were moved up an octave, because moving them down would need frets below the open string.'
    : '';
  $('stage-heading').dir = song.dir;
  $('stage-song').textContent = record.title;
  $('stage-artist').textContent = record.artist;
  $('stage-capo').textContent = original.capo ? `Capo ${original.capo}` : '';
  renderSheet($('sheet'), song);
}

const STAGE_CONTROLS = ['stage-prev', 'stage-next', 'stage-down', 'stage-up', 'stage-spelling', 'scroll-play', 'scroll-slower', 'scroll-faster', 'scroll-length'];

function renderStageBar(record, list) {
  for (const id of STAGE_CONTROLS) $(id).disabled = !record;
  if (!record) {
    $('stage-key').textContent = '';
    $('stage-pos').textContent = '';
    $('scroll-length').textContent = '';
    return;
  }
  const song = shown(record);
  const from = keyName(parsed(record).key);
  const to = keyName(song.key, song.useFlats);
  $('stage-key').textContent = record.semitones ? `${from} → ${to}` : `Key ${to || '?'}`;
  $('stage-spelling').value = record.spelling;
  const index = list ? list.songIds.indexOf(record.id) : -1;
  $('stage-pos').textContent = index >= 0 ? `${index + 1} / ${list.songIds.length}` : '';
  $('stage-prev').disabled = index <= 0;
  $('stage-next').disabled = index < 0 || index >= list.songIds.length - 1;
  $('scroll-length').textContent = formatDuration(songLength(record));
}

function render() {
  if (!currentSetlist() && library.setlists.length) {
    ui.setlistId = library.setlists[0].id;
    ui.songId = library.setlists[0].songIds[0] || null;
  }
  renderSetlists();
  renderSongs();
  renderSong();
}

function changeSong(changes) {
  const record = currentSong();
  if (!record) return;
  // Transposing and spelling don't change the text, so keep the parse cache.
  Object.assign(record, changes);
  persist();
  render();
}

function shift(n) {
  const record = currentSong();
  if (!record) return;
  changeSong({ semitones: (((record.semitones + n) % 12) + 12) % 12 });
}

/** Buttons that need a second press to delete, since there is no undo. */
function armed(button, label, action) {
  button.addEventListener('click', () => {
    if (button.classList.contains('armed')) {
      clearTimeout(button.timer);
      button.classList.remove('armed');
      button.textContent = label;
      action();
      return;
    }
    button.classList.add('armed');
    button.textContent = 'Press again to delete';
    button.timer = setTimeout(() => {
      button.classList.remove('armed');
      button.textContent = label;
    }, 3000);
  });
}

// Song controls
$('up').addEventListener('click', () => shift(1));
$('down').addEventListener('click', () => shift(-1));
$('reset').addEventListener('click', () => changeSong({ semitones: 0 }));
$('spelling').addEventListener('change', (e) => changeSong({ spelling: e.target.value }));
$('smaller').addEventListener('click', () => {
  library.prefs.fontSize = Math.max(12, library.prefs.fontSize - 2);
  persist();
  renderSong();
});
$('bigger').addEventListener('click', () => {
  library.prefs.fontSize = Math.min(40, library.prefs.fontSize + 2);
  persist();
  renderSong();
});
$('copy').addEventListener('click', async () => {
  const record = currentSong();
  if (!record) return;
  const text = songToText(shown(record));
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied the song in its current key.');
  } catch {
    toast('Copying was blocked by the browser.');
  }
});
$('move-up').addEventListener('click', () => {
  if (moveSong(currentSetlist(), ui.songId, -1)) { persist(); render(); }
});
$('move-down').addEventListener('click', () => {
  if (moveSong(currentSetlist(), ui.songId, 1)) { persist(); render(); }
});
$('merge').addEventListener('click', () => {
  if (mergeWithNext(library, currentSetlist(), ui.songId)) {
    persist();
    render();
    toast('Joined with the next song.');
  }
});
armed($('delete-song'), 'Delete song', () => {
  const list = currentSetlist();
  const index = list ? list.songIds.indexOf(ui.songId) : -1;
  deleteSong(library, ui.songId);
  ui.songId = list ? list.songIds[Math.min(index, list.songIds.length - 1)] || null : null;
  persist();
  render();
});

// Setlist controls
$('rename-setlist').addEventListener('click', () => {
  const list = currentSetlist();
  if (!list) return;
  const label = $('songs-label');
  const input = document.createElement('input');
  input.type = 'text';
  input.value = list.name;
  input.setAttribute('aria-label', 'Setlist name');
  input.dir = 'auto';
  label.replaceChildren(input);
  input.focus();
  input.select();
  const done = (save) => {
    if (save && input.value.trim()) {
      list.name = input.value.trim();
      persist();
    }
    render();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') done(true);
    if (e.key === 'Escape') done(false);
  });
  input.addEventListener('blur', () => done(true));
});
armed($('delete-setlist'), 'Delete', () => {
  deleteSetlist(library, ui.setlistId);
  ui.setlistId = null;
  ui.songId = null;
  persist();
  render();
});
$('search').addEventListener('input', (e) => {
  ui.search = e.target.value;
  renderSongs();
});

// Add songs dialog
const importDialog = $('import-dialog');
$('add-songs').addEventListener('click', () => {
  $('import-name').value = '';
  $('import-text').value = '';
  $('import-status').textContent = '';
  importDialog.showModal();
  $('import-text').focus();
});
$('import-cancel').addEventListener('click', () => importDialog.close());
$('import-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('import-text').value;
  if (!text.trim()) {
    $('import-status').textContent = 'Paste some songs first, or choose files.';
    return;
  }
  const setlist = importText(text, $('import-name').value.trim() || `Pasted ${today()}`);
  if (!setlist) {
    $('import-status').textContent = 'No songs were found in that text.';
    return;
  }
  importDialog.close();
  render();
  toast(`Added ${setlist.songIds.length} song${setlist.songIds.length === 1 ? '' : 's'}.`);
});
$('import-files').addEventListener('change', async (e) => {
  const ok = await importFiles(e.target.files, $('import-status'));
  e.target.value = '';
  if (ok) importDialog.close();
});

// Edit dialog
const editDialog = $('edit-dialog');
$('edit').addEventListener('click', () => {
  const record = currentSong();
  if (!record) return;
  $('edit-song-title').value = record.title;
  $('edit-artist').value = record.artist;
  $('edit-length').value = formatDuration(songLength(record));
  $('edit-text').value = record.text;
  editDialog.showModal();
});
$('edit-cancel').addEventListener('click', () => editDialog.close());
$('edit-form').addEventListener('submit', (e) => {
  e.preventDefault();
  updateSong(library, ui.songId, {
    title: $('edit-song-title').value.trim() || 'Untitled',
    artist: $('edit-artist').value.trim(),
    text: $('edit-text').value,
    duration: clampLength(parseDuration($('edit-length').value) || songLength(currentSong())),
  });
  persist();
  editDialog.close();
  render();
  toast('Saved.');
});
$('edit-split').addEventListener('click', () => {
  const area = $('edit-text');
  const lineIndex = area.value.slice(0, area.selectionStart).split('\n').length - 1;
  // Save any edits first, then split at the cursor's line.
  updateSong(library, ui.songId, {
    title: $('edit-song-title').value.trim() || 'Untitled',
    artist: $('edit-artist').value.trim(),
    text: area.value,
  });
  const created = splitAt(library, currentSetlist(), ui.songId, lineIndex);
  persist();
  if (!created) {
    toast('Put the cursor on the line with the second song’s title, then choose Split here.');
    return;
  }
  editDialog.close();
  render();
  toast(`Split into two songs. The second is “${created.title}”.`);
});

// Drag and drop anywhere: each file becomes a setlist.
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
document.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  dragDepth++;
  document.body.classList.add('dragging');
});
document.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) document.body.classList.remove('dragging');
});
document.addEventListener('dragover', (e) => {
  if (hasFiles(e)) e.preventDefault();
});
document.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  if (importDialog.open) importDialog.close();
  importFiles(e.dataTransfer.files);
});

// Backup and restore
const backupDialog = $('backup-dialog');
const restoreDialog = $('restore-dialog');
$('backup').addEventListener('click', () => {
  $('backup-text').value = exportLibrary(library);
  $('backup-status').textContent = '';
  backupDialog.showModal();
});
$('backup-close').addEventListener('click', () => backupDialog.close());
$('backup-copy').addEventListener('click', async () => {
  const area = $('backup-text');
  try {
    await navigator.clipboard.writeText(area.value);
    $('backup-status').textContent = 'Copied. Paste it into Restore a backup on the other device.';
  } catch {
    area.select();
    $('backup-status').textContent = 'The text is selected. Copy it with your device’s copy command.';
  }
});
$('backup-download').addEventListener('click', () => {
  const blob = new Blob([$('backup-text').value], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `chord-transposer-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  $('backup-status').textContent = 'If no file was saved, use Copy instead.';
});
$('restore').addEventListener('click', () => {
  $('restore-text').value = '';
  $('restore-status').textContent = '';
  restoreDialog.showModal();
});
$('restore-cancel').addEventListener('click', () => restoreDialog.close());
$('restore-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (file) $('restore-text').value = await file.text();
  e.target.value = '';
});
$('restore-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const result = restoreBackup(library, $('restore-text').value);
  if (!result) {
    $('restore-status').textContent = 'That is not a backup from this app. Choose the file you saved, or paste the copied text.';
    return;
  }
  persist();
  restoreDialog.close();
  render();
  toast(result.setlists
    ? `Restored ${result.setlists} setlist${result.setlists === 1 ? '' : 's'} with ${result.songs} new song${result.songs === 1 ? '' : 's'}.`
    : 'Everything in that backup is already in your library.');
});

// Install: browsers that support it offer an install prompt; show a button for it.
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  $('install').hidden = false;
});
$('install').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => {});
  installPrompt = null;
  $('install').hidden = true;
});
window.addEventListener('appinstalled', () => { $('install').hidden = true; });

// Stage view
const fullscreenSupported = Boolean(document.documentElement.requestFullscreen);
let wakeLock = null;

async function keepAwake() {
  try {
    if (navigator.wakeLock && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch {
    wakeLock = null; // The browser said no; the screen may dim as usual.
  }
}

function setView(view) {
  const stage = view === 'stage';
  document.body.classList.toggle('stage', stage);
  $('view-studio').setAttribute('aria-pressed', String(!stage));
  $('view-stage').setAttribute('aria-pressed', String(stage));
  library.prefs.view = view;
  persist();
  if (stage) {
    keepAwake();
    window.scrollTo(0, 0);
  } else {
    stopScroll();
    if (wakeLock) wakeLock.release().catch(() => {});
    wakeLock = null;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.body.classList.contains('stage') && document.visibilityState === 'visible') keepAwake();
});

// Auto-scroll is set by the song's length: the whole sheet passes in that
// time, whatever the text size or screen. A shorter length scrolls faster.
const scroller = { running: false, last: 0, carry: 0 };

function scrollSpeed(record) {
  // From the top of the sheet until its last lines sit in the upper half of the screen.
  const distance = Math.max(1, $('sheet').offsetHeight - window.innerHeight * 0.5);
  return distance / songLength(record);
}

function scrollFrame(time) {
  if (!scroller.running) return;
  const record = currentSong();
  const dt = scroller.last ? (time - scroller.last) / 1000 : 0;
  scroller.last = time;
  if (record) scroller.carry += dt * scrollSpeed(record);
  const step = Math.floor(scroller.carry);
  if (step >= 1) {
    scroller.carry -= step;
    window.scrollBy(0, step);
  }
  const atEnd = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
  if (atEnd) {
    stopScroll();
    return;
  }
  requestAnimationFrame(scrollFrame);
}

function startScroll() {
  if (!currentSong()) return;
  scroller.running = true;
  scroller.last = 0;
  scroller.carry = 0;
  $('scroll-play').setAttribute('aria-pressed', 'true');
  $('scroll-play').textContent = '❚❚ Pause';
  requestAnimationFrame(scrollFrame);
}

function stopScroll() {
  scroller.running = false;
  $('scroll-play').setAttribute('aria-pressed', 'false');
  $('scroll-play').textContent = '▶ Scroll';
}

const toggleScroll = () => (scroller.running ? stopScroll() : startScroll());

/** Change the song's length by some seconds; a shorter song scrolls faster. */
function changeLength(delta) {
  const record = currentSong();
  if (!record) return;
  changeSong({ duration: clampLength(songLength(record) + delta) });
}

function goToSong(delta) {
  const list = currentSetlist();
  if (!list) return;
  const index = list.songIds.indexOf(ui.songId) + delta;
  if (index < 0 || index >= list.songIds.length) return;
  stopScroll();
  ui.songId = list.songIds[index];
  render();
  window.scrollTo(0, 0);
}

$('view-stage').addEventListener('click', () => setView('stage'));
$('view-studio').addEventListener('click', () => setView('studio'));
$('stage-exit').addEventListener('click', () => setView('studio'));
$('stage-prev').addEventListener('click', () => goToSong(-1));
$('stage-next').addEventListener('click', () => goToSong(1));
$('stage-up').addEventListener('click', () => shift(1));
$('stage-down').addEventListener('click', () => shift(-1));
$('stage-spelling').addEventListener('change', (e) => changeSong({ spelling: e.target.value }));
$('scroll-play').addEventListener('click', toggleScroll);
$('scroll-slower').addEventListener('click', () => changeLength(10));
$('scroll-faster').addEventListener('click', () => changeLength(-10));
// Tap the length to type an exact one, like 3:45.
$('scroll-length').addEventListener('click', () => {
  const record = currentSong();
  if (!record) return;
  const button = $('scroll-length');
  const input = document.createElement('input');
  input.type = 'text';
  input.inputMode = 'numeric';
  input.className = 'length-input';
  input.value = formatDuration(songLength(record));
  input.setAttribute('aria-label', 'Song length, minutes:seconds');
  button.hidden = true;
  button.after(input);
  input.focus();
  input.select();
  let finished = false;
  const done = (save) => {
    if (finished) return;
    finished = true;
    const seconds = parseDuration(input.value);
    input.remove();
    button.hidden = false;
    if (save && seconds) changeSong({ duration: clampLength(seconds) });
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') done(true);
    if (e.key === 'Escape') done(false);
  });
  input.addEventListener('blur', () => done(true));
});
$('stage-smaller').addEventListener('click', () => {
  library.prefs.stageFontSize = Math.max(16, library.prefs.stageFontSize - 2);
  persist();
  renderSong();
});
$('stage-bigger').addEventListener('click', () => {
  library.prefs.stageFontSize = Math.min(56, library.prefs.stageFontSize + 2);
  persist();
  renderSong();
});
$('stage-full').hidden = !fullscreenSupported;
$('stage-full').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => { $('stage-full').hidden = true; });
});
document.addEventListener('fullscreenchange', () => {
  $('stage-full').textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen';
});

// Keys for Stage, including Bluetooth page-turner pedals (most send arrows or Page Up/Down).
document.addEventListener('keydown', (e) => {
  if (!document.body.classList.contains('stage')) return;
  if (e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  const actions = {
    ' ': toggleScroll,
    ArrowRight: () => goToSong(1),
    ArrowLeft: () => goToSong(-1),
    ArrowUp: () => changeLength(-10),
    ArrowDown: () => changeLength(10),
    PageDown: () => window.scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' }),
    PageUp: () => window.scrollBy({ top: -window.innerHeight * 0.8, behavior: 'smooth' }),
    '+': () => shift(1),
    '=': () => shift(1),
    '-': () => shift(-1),
    Escape: () => setView('studio'),
  };
  const action = actions[e.key];
  if (action) {
    e.preventDefault();
    action();
  }
});

// First visit: start with a marked example setlist so the Studio isn't empty.
if (!library.setlists.length && !library.prefs.seeded) {
  importText(EXAMPLES, 'Examples (you can delete these)');
  library.prefs.seeded = true;
  persist();
}
render();
setView(library.prefs.view === 'stage' ? 'stage' : 'studio');
