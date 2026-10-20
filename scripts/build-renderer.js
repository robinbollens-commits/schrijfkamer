#!/usr/bin/env node
// Bouwt renderer/ uit src/schrijfkamer.html: lokale lettertypes, CSP, desktopbrug en AI-neutrale teksten.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const out = path.join(root, 'renderer');
const srcFile = path.join(root, 'src', 'schrijfkamer.html');

// `npm run sync -- <pad>` kopieert eerst een nieuwe versie van de webapp naar src/.
const syncFrom = process.argv[2];
if (syncFrom) { fs.copyFileSync(path.resolve(syncFrom), srcFile); console.log('src/schrijfkamer.html bijgewerkt'); }

let html = fs.readFileSync(srcFile, 'utf8');

/* ---------- kop ---------- */
html = html
  .replace(/<link rel="preconnect"[^>]*>\s*/g, '')
  .replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>\s*/g, '')
  .replace(/<meta name="claude:[^>]*>\s*/g, '');
if (/fonts\.googleapis|fonts\.gstatic/.test(html)) throw new Error('Er staat nog een externe lettertypelink in de bron.');

/* ---------- teksten: de AI is hier niet altijd Claude ---------- */
// Verwijzingen naar je Claude-chat blijven staan; die gaan over werken buiten de app.
const TEXT = [
  [/Even te veel vragen, of je gebruikslimiet van Claude is bereikt\./g, 'Even te veel vragen, of je tegoed of limiet bij je AI is bereikt.'],
  [/Je sessie bij Claude is verlopen\. Log opnieuw in op claude\.ai\./g, 'De AI weigert de verbinding. Controleer je instellingen.'],
  [/Claude-functies/g, 'AI-functies'],
  [/Laat Claude meedenken/g, 'Laat de AI meedenken'],
  [/(Feedback|Voorstel|Voorstellen|Idee|feedback) van Claude/g, '$1 van de AI'],
  [/\bClaude (denkt|leest|schrijft|zet|kan|vergelijkt|kijkt|vond|wilde|is niet beschikbaar)/g, 'De AI $1'],
];
for (const [re, rep] of TEXT) html = html.replace(re, rep);
// Wat er nog overblijft moet een bewuste verwijzing zijn (of tekst die alleen op claude.ai verschijnt).
const KEEP = /gebruik van Claude|om Claude te gebruiken|Claude-chat|context voor Claude|met Claude in je chat|Claude-account|Claude-abonnement|claude\.ai|CLAUDE_MODELS|Claude (Opus|Sonnet|Haiku)|Claude via een API-sleutel|window\.claude|claude\.use|claude-(opus|sonnet|haiku)/;
const left = html.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /Claude/.test(l.replace(new RegExp(KEEP.source, 'g'), '')));
if (left.length) console.warn('Let op, nog "Claude" in de tekst:\n' + left.map(([n, l]) => `  ${n}: ${l.trim().slice(0, 140)}`).join('\n'));

/* ---------- CSP met hashes voor de inline scripts ---------- */
const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => `'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`);
const csp = [
  "default-src 'self'", `script-src 'self' ${hashes.join(' ')}`, "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:", "font-src 'self'", "connect-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'",
].join('; ');

const head = `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="fonts.css">
<script src="desktop-shim.js"></script>
`;
html = head + html + (/<\/html>\s*$/i.test(html) ? '' : '\n</html>\n');

/* ---------- lettertypes ---------- */
const FONTS = [
  ['cormorant-garamond', ['latin-500', 'latin-600', 'latin-700']],
  ['pinyon-script', ['latin-400']],
  ['ibm-plex-mono', ['latin-400', 'latin-500']],
  ['newsreader', ['latin-400', 'latin-500', 'latin-600', 'latin-400-italic']],
  ['schibsted-grotesk', ['latin-400', 'latin-500', 'latin-600', 'latin-700']],
];
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });
let css = '';
for (const [pkg, files] of FONTS) {
  const dir = path.join(root, 'node_modules', '@fontsource', pkg);
  for (const f of files) {
    let block = fs.readFileSync(path.join(dir, f + '.css'), 'utf8');
    block = block.replace(/url\(\.\/files\/([^)]+)\)\s*format\('woff'\),?\s*/g, '').replace(/,\s*;/g, ';');
    block = block.replace(/url\(\.\/files\/([^)]+\.woff2)\)/g, (_m, file) => {
      fs.copyFileSync(path.join(dir, 'files', file), path.join(out, 'fonts', file));
      return `url(fonts/${file})`;
    });
    css += block.replace(/\/\*[\s\S]*?\*\//g, '').trim() + '\n';
  }
}
fs.writeFileSync(path.join(out, 'fonts.css'), css);
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.copyFileSync(path.join(root, 'src', 'desktop-shim.js'), path.join(out, 'desktop-shim.js'));
console.log(`renderer/ gebouwd (${Math.round(html.length / 1024)} kB, ${fs.readdirSync(path.join(out, 'fonts')).length} lettertypebestanden)`);
