// Statischer Server für den Artefakt-Test (#129): liefert dist-artifact/ unter einem
// Unterpfad aus (Standard /foo/bar/), damit relative Pfade wirklich geprüft werden.
// Unter /__host liefert er eine Hülle, die das Artefakt in einem iframe einbettet
// (wie bei einem Claude-Artefakt; über 127.0.0.1 aufgerufen ist das iframe cross-origin).
// index.html kommt wie bei claude.ai in die Seitenhülle eingepackt (?raw liefert sie ohne).
//
//   node scripts/serve-artifact.mjs [--port 4190] [--prefix /foo/bar/] [--dir dist-artifact]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};
const port = Number(arg('port', '4190'));
let prefix = arg('prefix', '/foo/bar/');
if (!prefix.startsWith('/')) prefix = `/${prefix}`;
if (!prefix.endsWith('/')) prefix += '/';
const root = resolve(arg('dir', 'dist-artifact'));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.glb': 'model/gltf-binary',
};

// Seitenhülle, in die claude.ai die veröffentlichte Seite beim Veröffentlichen einpackt
// (so liefert der Artefakt-Dienst die Seite aus, abgelesen am veröffentlichten Artefakt):
// das ganze index.html landet im <body> dieser Hülle. Wichtig: body{color:#000;background:#fff}
// – die App muss Text- und Hintergrundfarbe deshalb selbst auf <body> setzen.
const HOST_SKELETON_HEAD =
  '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1">' +
  '<style>:root{color-scheme:light}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#fff;color:#000}' +
  'img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}</style></head><body>\n';
const HOST_SKELETON_TAIL = '\n</body></html>\n';

const escapeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/__host') {
    // iframe host page: ?sandbox=<tokens> (omit for no sandbox attribute)
    const src = `http://localhost:${port}${prefix}?e2e`;
    const sandbox = url.searchParams.get('sandbox');
    const sb = sandbox === null ? '' : ` sandbox="${escapeAttr(sandbox)}"`;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta charset="utf-8"><title>Host</title><style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%}</style><iframe id="artifact" src="${escapeAttr(src)}"${sb}></iframe>`);
    return;
  }
  if (!url.pathname.startsWith(prefix)) {
    res.writeHead(404).end('not found (outside prefix)');
    return;
  }
  let rel = decodeURIComponent(url.pathname.slice(prefix.length));
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  const file = normalize(join(root, rel));
  if (!file.startsWith(root + sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    if (!(await stat(file)).isFile()) throw new Error('no file');
    let body = await readFile(file);
    if (rel === 'index.html' && !url.searchParams.has('raw')) {
      body = Buffer.concat([Buffer.from(HOST_SKELETON_HEAD), body, Buffer.from(HOST_SKELETON_TAIL)]);
    }
    res.writeHead(200, {
      'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-store',
      // Module scripts are CORS requests; a sandboxed iframe without allow-same-origin has origin "null".
      'access-control-allow-origin': '*',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, () => console.log(`Artefakt-Build unter http://localhost:${port}${prefix}`));
