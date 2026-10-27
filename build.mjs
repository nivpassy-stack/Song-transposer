// Build the installable web app into docs/ (served by GitHub Pages or any static host).
//
// The source page (index.html) is written as an Artifact body; here it gets a
// full document head, local fonts instead of Google Fonts, the PDF and Word
// readers bundled in vendor/, an app manifest, icons and a service worker so
// the app installs and works offline.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const OUT = 'docs';
const root = path.dirname(new URL(import.meta.url).pathname);
const r = (...p) => path.join(root, ...p);
const out = (...p) => path.join(root, OUT, ...p);

fs.rmSync(out(), { recursive: true, force: true });
for (const dir of ['src', 'vendor', 'fonts', 'icons']) fs.mkdirSync(out(dir), { recursive: true });

// App code. The readers load from vendor/ instead of a CDN.
fs.copyFileSync(r('app.js'), out('app.js'));
for (const file of fs.readdirSync(r('src'))) {
  let code = fs.readFileSync(r('src', file), 'utf8');
  if (file === 'extract.js') {
    code = code
      .replace(/const PDFJS_URL = '[^']+';/, "const PDFJS_URL = new URL('../vendor/pdf.min.mjs', import.meta.url).href;")
      .replace(/const PDFJS_WORKER_URL = '[^']+';/, "const PDFJS_WORKER_URL = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;")
      .replace(/const MAMMOTH_URL = '[^']+';/, "const MAMMOTH_URL = new URL('../vendor/mammoth.browser.min.js', import.meta.url).href;");
    if (code.includes('cdn.jsdelivr')) throw new Error('extract.js still points at the CDN');
  }
  fs.writeFileSync(out('src', file), code);
}
fs.copyFileSync(r('node_modules/pdfjs-dist/build/pdf.min.mjs'), out('vendor/pdf.min.mjs'));
fs.copyFileSync(r('node_modules/pdfjs-dist/build/pdf.worker.min.mjs'), out('vendor/pdf.worker.min.mjs'));
fs.copyFileSync(r('node_modules/mammoth/mammoth.browser.min.js'), out('vendor/mammoth.browser.min.js'));

// Fonts: Rubik (Latin and Hebrew) for text, IBM Plex Mono for chords and tabs.
const HEBREW_RANGE = 'U+0590-05FF, U+200C-2010, U+20AA, U+25CC, U+FB1D-FB4F';
const LATIN_RANGE = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD, U+266D-266F';
const faces = [];
for (const weight of [400, 500, 700]) {
  for (const [subset, range] of [['latin', LATIN_RANGE], ['hebrew', HEBREW_RANGE]]) {
    const name = `rubik-${subset}-${weight}-normal.woff2`;
    fs.copyFileSync(r('node_modules/@fontsource/rubik/files', name), out('fonts', name));
    faces.push(`@font-face{font-family:'Rubik';font-style:normal;font-weight:${weight};font-display:swap;src:url(${name}) format('woff2');unicode-range:${range}}`);
  }
}
for (const weight of [500, 600]) {
  const name = `ibm-plex-mono-latin-${weight}-normal.woff2`;
  fs.copyFileSync(r('node_modules/@fontsource/ibm-plex-mono/files', name), out('fonts', name));
  faces.push(`@font-face{font-family:'IBM Plex Mono';font-style:normal;font-weight:${weight};font-display:swap;src:url(${name}) format('woff2');unicode-range:${LATIN_RANGE}}`);
}
fs.writeFileSync(out('fonts', 'fonts.css'), faces.join('\n') + '\n');

// Icons are drawn by icons.mjs into icons/ in the source folder.
for (const file of fs.readdirSync(r('icons'))) fs.copyFileSync(r('icons', file), out('icons', file));

fs.writeFileSync(out('manifest.webmanifest'), JSON.stringify({
  name: 'Chord Transposer',
  short_name: 'Transposer',
  description: 'Transpose guitar chords and tabs, keep setlists, and play with auto-scroll.',
  start_url: './',
  scope: './',
  display: 'standalone',
  background_color: '#12161c',
  theme_color: '#0b6e72',
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}, null, 2));

// The page: full head around the Artifact body.
let body = fs.readFileSync(r('index.html'), 'utf8');
body = body
  .replace(/<title>.*?<\/title>\n/, '')
  .replace(/<meta name="claude:viewport-fit-sides"[^>]*>\n/, '')
  .replace(/<link rel="preconnect"[^>]*>\n/, '')
  .replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>\n/, '');
const [style, ...rest] = body.split('</style>');
const head = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Chord Transposer</title>
<meta name="description" content="Transpose guitar chords and tabs, keep setlists, and play with auto-scroll.">
<meta name="theme-color" content="#0b6e72">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icons/icon-192.png" type="image/png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Transposer">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="stylesheet" href="fonts/fonts.css">
<style>
  :root { padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }
  body { margin: 0; font: 14px system-ui, sans-serif; }
  img { max-width: 100%; }
  [hidden] { display: none !important; }
</style>
`;
const register = `
<script>
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
</script>
`;
fs.writeFileSync(out('index.html'), head + style + '</style>\n</head>\n<body>\n' + rest.join('</style>') + register + '</body>\n</html>\n');

// Service worker: cache every file, so the app opens without a connection.
const files = [];
(function walk(dir) {
  for (const name of fs.readdirSync(out(dir))) {
    const rel = path.posix.join(dir, name);
    if (fs.statSync(out(rel)).isDirectory()) walk(rel);
    else files.push(rel);
  }
})('');
const hash = crypto.createHash('sha256');
for (const f of files.sort()) hash.update(f).update(fs.readFileSync(out(f)));
const version = hash.digest('hex').slice(0, 12);
const precache = ['./', ...files.filter((f) => f !== 'index.html')];
fs.writeFileSync(out('sw.js'), `// Generated by build.mjs. A new version is installed whenever any file changes.
const CACHE = 'chord-transposer-${version}';
const FILES = ${JSON.stringify(precache, null, 1)};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(request).catch(() => (request.mode === 'navigate' ? caches.match('./') : Response.error()));
    }),
  );
});
`);
fs.writeFileSync(out('.nojekyll'), '');
console.log(`Built ${OUT}/ (${files.length + 2} files, version ${version})`);
