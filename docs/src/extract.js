// Reading text out of uploaded files: plain text, ChordPro, PDF, Word, HTML.
import { PAGE_BREAK } from './split.js';

const PDFJS_URL = new URL('../vendor/pdf.min.mjs', import.meta.url).href;
const PDFJS_WORKER_URL = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
const MAMMOTH_URL = new URL('../vendor/mammoth.browser.min.js', import.meta.url).href;

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
function piecesToText(pieces, charW) {
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
    out.push(placeAll(placements));
  });
  return out.join('\n');
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

function toPieces(items) {
  return items.flatMap((item) => itemPieces(item).map((p) => ({
    ...p,
    y: item.transform[5],
    size: Math.abs(item.transform[3]) || item.height || 10,
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
 */
export function pdfItemsToText(items, cells = []) {
  const pieces = toPieces(items);
  if (!pieces.length) return '';
  const charW = median(pieces.filter((p) => p.str.length > 1).map((p) => p.width / p.str.length)) || 5;
  if (!cells.length) return piecesToText(pieces, charW);

  const rtl = isRtl(pieces);
  const units = cells.map((box) => ({ box, top: box[3], pieces: [] }));
  const loose = [];
  for (const p of pieces) {
    const cx = p.x + p.width / 2;
    const cy = p.y + p.size * 0.3;
    const unit = units.find(({ box }) => cx >= box[0] && cx <= box[2] && cy >= box[1] && cy <= box[3]);
    if (unit) unit.pieces.push(p);
    else loose.push(p);
  }
  // Text outside cells: one unit per run of rows between cells.
  for (const p of loose) units.push({ top: p.y + p.size, pieces: [p], loose: true });

  units.sort((a, b) => b.top - a.top);
  // Merge loose pieces that sit together into one block, and order cells in a row.
  const blocks = [];
  for (const unit of units) {
    if (!unit.pieces.length) continue;
    const prev = blocks.at(-1);
    if (unit.loose && prev && prev.loose) {
      prev.pieces.push(...unit.pieces);
    } else if (!unit.loose && prev && !prev.loose && Math.abs(prev.top - unit.top) < 6) {
      prev.row.push(unit);
    } else {
      blocks.push(unit.loose ? { loose: true, pieces: [...unit.pieces] } : { top: unit.top, row: [unit] });
    }
  }
  const texts = [];
  for (const block of blocks) {
    if (block.loose) {
      texts.push(piecesToText(block.pieces, charW));
      continue;
    }
    block.row.sort((a, b) => (rtl ? b.box[0] - a.box[0] : a.box[0] - b.box[0]));
    for (const cell of block.row) texts.push(piecesToText(cell.pieces, charW));
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
  const seen = new Map();
  ops.fnArray.forEach((fn, i) => {
    if (fn !== lib.OPS.constructPath) return;
    const minMax = ops.argsArray[i] && ops.argsArray[i][2];
    if (!minMax || minMax.length !== 4) return;
    const box = Array.from(minMax, (v) => Math.round(v));
    if (box[2] - box[0] < 80 || box[3] - box[1] < 60) return;
    seen.set(box.join(','), box);
  });
  const boxes = [...seen.values()];
  const contains = (a, b) => a !== b && a[0] <= b[0] + 2 && a[1] <= b[1] + 2 && a[2] >= b[2] - 2 && a[3] >= b[3] - 2;
  return boxes.filter((a) => !boxes.some((b) => contains(a, b)));
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
    pages.push(pdfItemsToText(content.items.filter((it) => 'str' in it), cells));
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
