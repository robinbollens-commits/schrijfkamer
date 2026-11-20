#!/usr/bin/env node
// Bouwt renderer/ (desktopapp) of, met --web, web/ (de app voor gsm en browser) uit src/schrijfkamer.html:
// lokale lettertypes, CSP, de brug naar opslag en account, en AI-neutrale teksten.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const WEB = process.argv.includes('--web');
const out = path.join(root, WEB ? 'web' : 'renderer');
const srcFile = path.join(root, 'src', 'schrijfkamer.html');

// Firebase-configuratie (niet geheim): firebase-config.json in de repository, of een ander bestand via SK_FIREBASE_CONFIG (tests).
const cfgFile = process.env.SK_FIREBASE_CONFIG || path.join(root, 'firebase-config.json');
const FB = fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, 'utf8')) : null;

// `npm run sync -- <pad>` kopieert eerst een nieuwe versie van de webapp naar src/.
const syncFrom = process.argv.slice(2).find(a => !a.startsWith('--'));
if (syncFrom) { fs.copyFileSync(path.resolve(syncFrom), srcFile); console.log('src/schrijfkamer.html bijgewerkt'); }

// Windows-checkouts geven CRLF; de HTML-parser maakt daar LF van, dus de CSP-hash moet over LF gaan.
let html = fs.readFileSync(srcFile, 'utf8').replace(/\r\n?/g, '\n');

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
const connect = ["'self'"];
if (FB) connect.push('https://*.googleapis.com');
if (FB && FB.emulator) connect.push(FB.emulator.auth, `http://${FB.emulator.firestoreHost}:${FB.emulator.firestorePort}`);
const csp = [
  "default-src 'self'", `script-src 'self' ${hashes.join(' ')}`, "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:", "font-src 'self'", `connect-src ${connect.join(' ')}`, "object-src 'none'", "base-uri 'none'", "form-action 'none'",
].join('; ');
const FB_FILES = ['firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-firestore-compat.js'];
const scripts = [...(FB ? [...FB_FILES, 'config.js', 'cloud.js'] : WEB ? ['config.js'] : []), WEB ? 'web-shim.js' : 'desktop-shim.js'];

const head = `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="fonts.css">
${WEB ? '<link rel="manifest" href="manifest.webmanifest">\n<meta name="theme-color" content="#14110E">\n<link rel="icon" href="icon-192.png">\n<link rel="apple-touch-icon" href="apple-touch-icon.png">\n<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-title" content="Schrijfkamer">\n<meta name="apple-mobile-web-app-status-bar-style" content="black">\n' : ''}${scripts.map(f => `<script src="${f}"></script>`).join('\n')}
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
fs.copyFileSync(path.join(root, 'src', WEB ? 'web-shim.js' : 'desktop-shim.js'), path.join(out, WEB ? 'web-shim.js' : 'desktop-shim.js'));
if (FB || WEB) {
  // Op het web staan afbeeldingen onder een relatief pad, omdat de app in een submap draait (GitHub Pages).
  fs.writeFileSync(path.join(out, 'config.js'), `window.SK_FIREBASE=${FB ? JSON.stringify(FB) : 'null'};${WEB ? "window.SK_BLOB_PREFIX='_blob/';" : ''}\n`);
}
if (FB) {
  for (const f of FB_FILES) fs.copyFileSync(path.join(root, 'node_modules', 'firebase', f), path.join(out, f));
  fs.copyFileSync(path.join(root, 'src', 'cloud.js'), path.join(out, 'cloud.js'));
}
if (WEB) {
  const ver = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  fs.writeFileSync(path.join(out, 'manifest.webmanifest'), JSON.stringify({
    name: 'Schrijfkamer', short_name: 'Schrijfkamer', lang: 'nl', start_url: './', scope: './', display: 'standalone',
    background_color: '#14110E', theme_color: '#14110E',
    icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }],
  }, null, 1));
  for (const n of ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png']) fs.copyFileSync(path.join(root, 'build', n), path.join(out, n));
  const files = fs.readdirSync(out, { recursive: true }).filter(f => fs.statSync(path.join(out, f)).isFile()).map(f => f.split(path.sep).join('/'));
  fs.writeFileSync(path.join(out, 'sw.js'), fs.readFileSync(path.join(root, 'src', 'sw.js'), 'utf8')
    .replace('__VERSION__', ver + '-' + crypto.createHash('sha1').update(html).digest('hex').slice(0, 8))
    .replace('__FILES__', JSON.stringify(['./', ...files])));
  fs.writeFileSync(path.join(out, '.nojekyll'), '');
}
console.log(`${WEB ? 'web' : 'renderer'}/ gebouwd${FB ? ' (met account-sync' + (FB.emulator ? ', testomgeving' : '') + ')' : ''} (${Math.round(html.length / 1024)} kB, ${fs.readdirSync(path.join(out, 'fonts')).length} lettertypebestanden)`);
