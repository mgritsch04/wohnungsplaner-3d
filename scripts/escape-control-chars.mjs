// Artifact build only (#129): Claude artifacts refuse text files that contain raw control characters,
// and the bundled pdf.js worker has some inside string literals. A raw control character (other than
// tab, LF, CR) can only appear inside string/template/regex literals or comments, where the escape
// \xNN means exactly the same character – so the rewrite does not change the program.
// A control character that is itself escaped by a backslash ("\<ctrl>" = the character) is rewritten
// together with that backslash.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2] ?? 'dist-artifact';
const TEXT = /\.(js|css|html|svg|json)$/i;

function escapeControls(src) {
  let out = '';
  let count = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i);
    if (c < 32 && c !== 9 && c !== 10 && c !== 13) {
      let backslashes = 0;
      while (out[out.length - 1 - backslashes] === '\\') backslashes++;
      if (backslashes % 2 === 1) out = out.slice(0, -1);
      out += '\\x' + c.toString(16).padStart(2, '0');
      count++;
    } else out += src[i];
  }
  return { out, count };
}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (TEXT.test(name)) {
      // latin1 keeps every byte as one character, so multi-byte UTF-8 sequences pass through unchanged
      const { out, count } = escapeControls(readFileSync(p, 'latin1'));
      if (count) {
        writeFileSync(p, out, 'latin1');
        console.log(`escape-control-chars: ${p} – ${count} escaped`);
      }
    }
  }
}

walk(root);
