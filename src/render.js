// Draw a (transposed) song as HTML: chords stacked over their lyric pieces,
// right to left for Hebrew songs, tabs always left to right.
import { songBlocks } from './song.js';

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function renderSheet(container, song) {
  container.dir = song.dir;
  container.classList.add('sheet');
  const nodes = songBlocks(song).map((block) => {
    if (block.kind === 'pair' || block.kind === 'chords') {
      const row = el('div', 'pair');
      for (const seg of block.segments) {
        const s = el('span', 'seg');
        const cls = 'c' + (seg.kind && seg.kind !== 'chord' ? ' other' : '');
        if (block.kind === 'chords') {
          // A chord line with no lyric: keep its spacing inside the chord row.
          s.append(el('span', cls, (seg.chord || '').padEnd(seg.text.length)));
        } else {
          // The chord stays joined to the first word under it; the rest of the
          // lyric piece is plain text, so long lines wrap between words.
          const head = /^\s*\S*/.exec(seg.text)[0];
          s.append(el('span', cls, seg.chord || ''), el('span', 'l', head));
          row.append(s);
          const rest = seg.text.slice(head.length);
          if (rest) row.append(el('span', 'rest', rest));
          continue;
        }
        row.append(s);
      }
      return row;
    }
    if (block.kind === 'tab') {
      const wrap = el('div', 'tab');
      // Take off the indent the lines share, not each line's own, so
      // chord names and marks stay over the notes they belong to.
      const rows = block.rows || block.lines.map((text) => ({ type: 'tab', text }));
      const indent = Math.min(...rows.map((r) => r.text.length - r.text.trimStart().length));
      const pre = el('pre');
      rows.forEach((r, n) => {
        const text = r.text.slice(indent).trimEnd() + (n < rows.length - 1 ? '\n' : '');
        pre.append(r.type === 'chords' ? el('span', 'tc', text) : document.createTextNode(text));
      });
      wrap.append(pre);
      return wrap;
    }
    if (block.kind === 'blank') return el('div', 'blank');
    return el('div', block.kind, block.text);
  });
  container.replaceChildren(...nodes);
}
