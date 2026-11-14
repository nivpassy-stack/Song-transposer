// Reading text out of uploaded files: plain text, ChordPro, PDF, Word, HTML.
import { PAGE_BREAK, HEADING_MARK } from './split.js';

const PDFJS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
const PDFJS_WORKER_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
const MAMMOTH_URL = 'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js';

const HEBREW_RE = /[֐-׿]/;

/**
 * Decode a text file. Tries UTF-8 first, then Windows-1255, the older
 * Hebrew encoding many chord files from Israeli sites still use.
 */
export function decodeText(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1255').decode(bytes);
  }
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Split a PDF text item into pieces with their own x position. Items without
 * Hebrew (chord lines, tabs) are split at spaces, so each chord can be placed
 * on its own; Hebrew items are kept whole.
 */
function itemPieces(item) {
  const x = item.transform[4];
  const str = item.str;
  if (!str.trim()) return [];
  if (HEBREW_RE.test(str) || !/\s/.test(str.trim())) {
    const lead = str.length - str.trimStart().length;
    const charW = item.width / str.length;
    return [{ str: str.trim(), x: x + lead * charW, width: str.trim().length * charW }];
  }
  const charW = item.width / str.length;
  return [...str.matchAll(/\S+/g)].map((m) => ({ str: m[0], x: x + m.index * charW, width: m[0].length * charW }));
}

function placeAll(placements) {
  placements.sort((a, b) => a.col - b.col);
  let text = '';
  for (const p of placements) {
    const col = text.length ? Math.max(p.col, text.length + 1) : p.col;
    text = text.padEnd(col, ' ') + p.str;
  }
  return text;
}

function countMatches(pieces, re) {
  return pieces.reduce((n, p) => n + (p.str.match(re) || []).length, 0);
}

const isRtl = (pieces) => countMatches(pieces, /[\u0590-\u05FF]/g) > countMatches(pieces, /[A-Za-z]/g);

/**
 * Lay out positioned pieces as lines of text, keeping horizontal spacing as
 * columns of spaces so chords stay over their words. In a mostly Hebrew
 * block, columns are counted from the right edge, so the start of each line
 * is on the right, as in the text model for Hebrew songs.
 */
function piecesToText(pieces, charW, bodySize = 0) {
  if (!pieces.length) return '';
  const rtl = isRtl(pieces);
  const left = Math.min(...pieces.map((p) => p.x));
  const right = Math.max(...pieces.map((p) => p.x + p.width));

  // Group into rows by y (top of page first).
  const sorted = [...pieces].sort((a, b) => b.y - a.y);
  const rows = [];
  for (const p of sorted) {
    const row = rows.at(-1);
    if (row && Math.abs(row.y - p.y) < p.size * 0.5) row.pieces.push(p);
    else rows.push({ y: p.y, size: p.size, pieces: [p] });
  }
  const gap = median(rows.slice(1).map((r, i) => rows[i].y - r.y)) || 12;

  const out = [];
  rows.forEach((row, i) => {
    if (i > 0 && rows[i - 1].y - row.y > gap * 1.6) out.push('');
    const placements = mergeTouching(row.pieces, charW).map((p) => ({
      str: p.str,
      col: Math.max(0, Math.round((rtl ? right - (p.x + p.width) : p.x - left) / charW)),
    }));
    const text = placeAll(placements);
    out.push(isHeadingRow(row, text, bodySize) ? HEADING_MARK + text : text);
  });
  return out.join('\n');
}

/**
 * A row set all in bold, at least as large as the page's body text, with
 * words in it and short enough to be a title: how Word and most song books
 * set a song's title. The splitter uses it to tell titles from lyric lines
 * that happen to sit between blank lines.
 */
function isHeadingRow(row, text, bodySize) {
  if (!bodySize || !row.pieces.every((p) => p.bold)) return false;
  if (row.pieces.some((p) => p.size < bodySize - 0.5)) return false;
  const trimmed = text.trim();
  return trimmed.length <= 60 && /\p{L}{2}/u.test(trimmed);
}

/** The font size most of the page's text is set in. */
function bodyFontSize(pieces) {
  const chars = new Map();
  for (const p of pieces) {
    const size = Math.round(p.size * 2) / 2;
    chars.set(size, (chars.get(size) || 0) + p.str.length);
  }
  let best = 0;
  let most = -1;
  for (const [size, n] of chars) if (n > most) [best, most] = [size, n];
  return best;
}

/**
 * Join pieces that touch (a bold fret number inside "|-5-|" comes as its own
 * item), so no space is put between them. Pieces that mix Hebrew and Latin
 * are left apart, as their visual order and reading order differ.
 */
function mergeTouching(pieces, charW) {
  const sorted = [...pieces].sort((a, b) => a.x - b.x);
  const out = [];
  for (const p of sorted) {
    const prev = out.at(-1);
    const touching = prev && p.x - (prev.x + prev.width) < charW * 0.3;
    const hebrew = HEBREW_RE.test(prev?.str) || HEBREW_RE.test(p.str);
    const latin = /[A-Za-z0-9]/.test(prev?.str) || /[A-Za-z0-9]/.test(p.str);
    if (touching && !(hebrew && latin)) {
      // Hebrew reads right to left, so the piece on the right comes first.
      const str = hebrew ? p.str + prev.str : prev.str + p.str;
      out[out.length - 1] = { ...prev, str, width: p.x + p.width - prev.x };
    } else {
      out.push(p);
    }
  }
  return out;
}

function toPieces(items, fonts) {
  return items.flatMap((item) => itemPieces(item).map((p) => ({
    ...p,
    y: item.transform[5],
    size: Math.abs(item.transform[3]) || item.height || 10,
    bold: Boolean(fonts[item.fontName]?.bold),
  })));
}

/**
 * Rebuild the text of one PDF page from its positioned text items.
 *
 * Song sheets made in Word often use a table, two or more cells per page,
 * read like newspaper columns. When the page's table cells are known
 * (`cells`, as [x0, y0, x1, y1] boxes), each cell is read on its own:
 * cells in a row go left to right, or right to left on a Hebrew page, and
 * text outside the table (such as the song title) keeps its place.
 *
 * `fonts` maps each item's fontName to {bold}; rows set as a heading (see
 * isHeadingRow) start with HEADING_MARK.
 */
export function pdfItemsToText(items, cells = [], fonts = {}) {
  const pieces = toPieces(items, fonts);
  if (!pieces.length) return '';
  const charW = median(pieces.filter((p) => p.str.length > 1).map((p) => p.width / p.str.length)) || 5;
  const bodySize = bodyFontSize(pieces);
  if (!cells.length) return piecesToText(pieces, charW, bodySize);

  // A piece belongs to the cell it sits in. A line drawn across a cell's
  // top or bottom border (clipped by it) still belongs to that cell.
  const boxes = cells.map((box) => ({ box, pieces: [] }));
  const loose = [];
  for (const p of pieces) {
    const cx = p.x + p.width / 2;
    const cy = p.y + p.size * 0.3;
    const inside = (slack) => boxes.find(({ box }) => cx >= box[0] && cx <= box[2] && cy >= box[1] - slack && cy <= box[3] + slack);
    const cell = inside(0) || inside(p.size * 0.7);
    if (cell) cell.pieces.push(p);
    else loose.push(p);
  }
  const units = tables(boxes.filter((c) => c.pieces.length));
  units.push(...looseSegments(loose, charW).map((seg) => ({ ...seg, parts: [seg.pieces] })));
  return stacksToText(units, charW, bodySize, isRtl(pieces));
}

/**
 * Cells that touch form a table (a Word table: rows of cells sharing their
 * borders), read row by row, across in the direction of its text. Cells
 * that stand apart (text boxes set as columns) are units of their own.
 */
function tables(cells) {
  const near = (a, b) => a[0] <= b[2] + 3 && b[0] <= a[2] + 3 && a[1] <= b[3] + 3 && b[1] <= a[3] + 3;
  const groups = [];
  for (const cell of cells) {
    const touching = groups.filter((g) => g.some((c) => near(c.box, cell.box)));
    const group = touching[0] || [];
    if (!touching.length) groups.push(group);
    for (const other of touching.slice(1)) {
      group.push(...other);
      groups.splice(groups.indexOf(other), 1);
    }
    group.push(cell);
  }
  return groups.map((group) => {
    const rtl = isRtl(group.flatMap((c) => c.pieces));
    const rows = [];
    for (const cell of [...group].sort((a, b) => b.box[3] - a.box[3])) {
      const row = rows.find((r) => Math.abs(r[0].box[3] - cell.box[3]) < 6);
      if (row) row.push(cell);
      else rows.push([cell]);
    }
    const ordered = rows.flatMap((row) => row.sort((a, b) => (rtl ? b.box[0] - a.box[0] : a.box[0] - b.box[0])));
    return {
      left: Math.min(...group.map((c) => c.box[0])),
      right: Math.max(...group.map((c) => c.box[2])),
      top: Math.max(...group.map((c) => c.box[3])),
      pieces: group.flatMap((c) => c.pieces),
      parts: ordered.map((c) => c.pieces),
      cell: true,
    };
  });
}

/**
 * Text outside the cells (song titles, notes) as segments: rows of pieces,
 * cut where a wide gap shows two things side by side, such as the titles of
 * two songs set next to each other. Rows that follow each other closely and
 * overlap are joined into one segment.
 */
function looseSegments(loose, charW) {
  const rows = [];
  for (const p of [...loose].sort((a, b) => b.y - a.y)) {
    const row = rows.at(-1);
    if (row && Math.abs(row.y - p.y) < p.size * 0.5) row.pieces.push(p);
    else rows.push({ y: p.y, size: p.size, pieces: [p] });
  }
  const segments = [];
  for (const row of rows) {
    const sorted = row.pieces.sort((a, b) => a.x - b.x);
    let seg = null;
    for (const p of sorted) {
      if (seg && p.x - seg.right < charW * 8) {
        seg.pieces.push(p);
        seg.right = Math.max(seg.right, p.x + p.width);
      } else {
        seg = { left: p.x, right: p.x + p.width, top: row.y + row.size, bottom: row.y, pieces: [p] };
        segments.push(seg);
      }
    }
  }
  // Join a segment with the one just above it when they overlap (a title
  // over an artist line, a few lines of notes).
  const joined = [];
  for (const seg of segments) {
    const above = joined.find((u) => u.bottom - seg.top < seg.pieces[0].size * 1.2 && u.bottom > seg.bottom && seg.left < u.right && seg.right > u.left);
    if (above) {
      above.pieces.push(...seg.pieces);
      above.left = Math.min(above.left, seg.left);
      above.right = Math.max(above.right, seg.right);
      above.bottom = seg.bottom;
    } else {
      joined.push({ ...seg });
    }
  }
  return joined;
}

const overlaps = (a, b) => a.left < b.right - 2 && b.left < a.right - 2;

/**
 * Put cells and loose text in reading order. Units that overlap
 * side to side form a stack, read top to bottom: a title and the cells
 * under it. A stack of cells with no title over it continues the song next
 * to it: the one on its left for Latin text, on its right for Hebrew, as a
 * song set in two or three columns does. Songs are then read in rows down
 * the page, across in the page's direction.
 */
function stacksToText(units, charW, bodySize, pageRtl) {
  const stacks = [];
  for (const unit of units) {
    const touching = stacks.filter((s) => s.units.some((u) => overlaps(u, unit)));
    const stack = touching[0] || { units: [] };
    if (!touching.length) stacks.push(stack);
    for (const other of touching.slice(1)) {
      stack.units.push(...other.units);
      stacks.splice(stacks.indexOf(other), 1);
    }
    stack.units.push(unit);
  }
  for (const s of stacks) {
    s.units.sort((a, b) => b.top - a.top);
    s.left = Math.min(...s.units.map((u) => u.left));
    s.right = Math.max(...s.units.map((u) => u.right));
    s.top = s.units[0].top;
    s.titled = !s.units[0].cell;
    s.rtl = isRtl(s.units.flatMap((u) => u.pieces));
    s.next = [];
  }
  const songs = stacks.filter((s) => s.titled);
  if (!songs.length) {
    // No titles at all: the old reading, cells in rows across the page.
    const all = { units: [...units].sort((a, b) => b.top - a.top || (pageRtl ? b.left - a.left : a.left - b.left)), next: [] };
    return unitsText([all], charW, bodySize);
  }
  // Untitled stacks, nearest first, join the song they continue.
  const orphans = stacks.filter((s) => !s.titled);
  const byDistance = (s) => (s.rtl ? s.left : -s.right);
  orphans.sort((a, b) => (a.rtl ? b.left - a.left : a.left - b.left));
  for (const orphan of orphans.sort((a, b) => byDistance(b) - byDistance(a))) {
    const before = stacks.filter((s) => s !== orphan && (s.titled || s.owner) && (orphan.rtl ? s.left >= orphan.right - 2 : s.right <= orphan.left + 2));
    before.sort((a, b) => (orphan.rtl ? a.left - b.left : b.right - a.right));
    const prev = before[0];
    const owner = prev ? (prev.owner || prev) : songs[0];
    orphan.owner = owner;
    owner.next.push(orphan);
  }
  songs.sort((a, b) => (Math.abs(a.top - b.top) > 6 ? b.top - a.top : pageRtl ? b.right - a.right : a.left - b.left));
  return unitsText(songs, charW, bodySize);
}

function unitsText(stacks, charW, bodySize) {
  const texts = [];
  for (const stack of stacks) {
    for (const s of [stack, ...stack.next]) {
      for (const unit of s.units) for (const part of unit.parts) texts.push(piecesToText(part, charW, bodySize));
    }
  }
  return texts.filter((t) => t.trim()).join('\n\n');
}

/**
 * Find table cells on a PDF page from the boxes its drawing commands cover.
 * Keeps boxes big enough to hold text that contain no other such box, which
 * leaves the innermost cells and drops the page frame and the whole table.
 */
export async function pdfPageCells(page, lib) {
  const ops = await page.getOperatorList();
  const { OPS } = lib;
  // Paths are drawn in the current transform, which save/restore/transform
  // change; boxes must be put in page space to compare with text positions.
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const seen = new Map();
  ops.fnArray.forEach((fn, i) => {
    const args = ops.argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform && args) {
      const [a, b, c, d, e, f] = args;
      ctm = [
        a * ctm[0] + b * ctm[2], a * ctm[1] + b * ctm[3],
        c * ctm[0] + d * ctm[2], c * ctm[1] + d * ctm[3],
        e * ctm[0] + f * ctm[2] + ctm[4], e * ctm[1] + f * ctm[3] + ctm[5],
      ];
    }
    if (fn !== OPS.constructPath) return;
    const minMax = args && args[2];
    if (!minMax || minMax.length !== 4) return;
    const [x0, y0] = apply(ctm, minMax[0], minMax[1]);
    const [x1, y1] = apply(ctm, minMax[2], minMax[3]);
    const box = [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)].map(Math.round);
    if (box[2] - box[0] < 80 || box[3] - box[1] < 60) return;
    seen.set(box.join(','), box);
  });
  const boxes = [...seen.values()];
  const contains = (a, b) => a !== b && a[0] <= b[0] + 2 && a[1] <= b[1] + 2 && a[2] >= b[2] - 2 && a[3] >= b[3] - 2;
  return boxes.filter((a) => !boxes.some((b) => contains(a, b)));
}

const BOLD_NAME_RE = /bold|black|heavy|semibold|demibold|extrabold/i;

/**
 * Which of the page's fonts are bold, from the font objects pdf.js loads
 * while reading the page's drawing commands (so after getOperatorList).
 */
export function pageFonts(page, items) {
  const fonts = {};
  for (const { fontName } of items) {
    if (!fontName || fontName in fonts) continue;
    let font = null;
    try {
      font = page.commonObjs.has(fontName) ? page.commonObjs.get(fontName) : null;
    } catch {
      font = null;
    }
    fonts[fontName] = { bold: Boolean(font && (font.bold || font.black || BOLD_NAME_RE.test(font.name || ''))) };
  }
  return fonts;
}

let pdfjsPromise = null;

async function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(/* @vite-ignore */ PDFJS_URL).then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      return lib;
    });
  }
  return pdfjsPromise;
}

export async function pdfToText(data, pdfjs) {
  const lib = pdfjs || (await loadPdfJs());
  const doc = await lib.getDocument({ data }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    let cells = [];
    try {
      cells = await pdfPageCells(page, lib);
    } catch {
      // Reading the drawing commands is a bonus; plain text still works without it.
    }
    const items = content.items.filter((it) => 'str' in it);
    pages.push(pdfItemsToText(items, cells, pageFonts(page, items)));
  }
  return pages.join(`\n${PAGE_BREAK}\n`);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.append(s);
  });
}

/**
 * Word (.docx). Mammoth puts a blank line after every paragraph; chord sheets
 * use one paragraph per line, so those are folded back into single lines.
 */
export async function docxToText(arrayBuffer, mammoth) {
  let lib = mammoth;
  if (!lib) {
    if (!globalThis.mammoth) await loadScript(MAMMOTH_URL);
    lib = globalThis.mammoth;
  }
  const { value } = await lib.extractRawText({ arrayBuffer });
  return value.replace(/\n\n/g, '\n');
}

/** Text from saved web pages: prefer <pre> blocks, where chord sites put the song. */
export function htmlToText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const pres = [...doc.querySelectorAll('pre')];
  if (pres.length) return pres.map((p) => p.textContent).join('\n\n');
  doc.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  doc.querySelectorAll('p, div, li, h1, h2, h3, h4, tr').forEach((el) => el.append('\n'));
  return doc.body.textContent;
}

export class UnsupportedFileError extends Error {}

/** Read text from a File (browser). */
export async function readFileText(file) {
  const name = file.name.toLowerCase();
  const ext = name.includes('.') ? name.split('.').pop() : '';
  const buffer = await file.arrayBuffer();
  if (ext === 'pdf') return pdfToText(new Uint8Array(buffer));
  if (ext === 'docx') return docxToText(buffer);
  if (ext === 'doc' || ext === 'pages' || ext === 'odt') {
    throw new UnsupportedFileError(`.${ext} files can't be read yet. Please save it as .docx, PDF or text.`);
  }
  if (/^(png|jpe?g|gif|webp|heic|bmp|tiff?)$/.test(ext)) {
    throw new UnsupportedFileError('Pictures of chord sheets need text recognition, which is not supported yet.');
  }
  const text = decodeText(new Uint8Array(buffer));
  if (ext === 'html' || ext === 'htm') return htmlToText(text);
  return text;
}
