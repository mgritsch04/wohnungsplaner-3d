// Statischer Server für den PWA-Test (#179): liefert dist-pages/ unter /wohnungsplaner-3d/ aus,
// so wie GitHub Pages (ohne Seitenhülle, mit Manifest-Medientyp).
//   node scripts/serve-pages.mjs [--port 4191] [--dir dist-pages]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};
const port = Number(arg('port', '4191'));
const root = resolve(arg('dir', 'dist-pages'));
const PREFIX = '/wohnungsplaner-3d/';
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
};

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  if (!path.startsWith(PREFIX)) {
    res.writeHead(404).end();
    return;
  }
  let file = normalize(join(root, path.slice(PREFIX.length)));
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(port, () => console.log(`dist-pages unter http://localhost:${port}${PREFIX}`));
