#!/usr/bin/env node
/**
 * Node.js example: convert HTML to PDF using PlutoBook WASM.
 *
 * Fonts are loaded from disk and passed to createPlutoBook — nothing
 * is embedded in the .wasm binary.
 *
 * Usage:
 *   node html2pdf.js
 */
'use strict';

const path   = require('path');
const fs     = require('fs');
const { pathToFileURL } = require('url');

const DIST      = path.join(__dirname, 'dist');
const FONTS_DIR = path.join(__dirname, 'wasm', 'fonts');

// A4 in points (1 pt = 1/72 inch).
const A4_W   = 210 * 72 / 25.4;
const A4_H   = 297 * 72 / 25.4;
const MARGIN = 72; // 1 inch

const html = `<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: sans-serif; margin: 0; padding: 2em; color: #222; }
  h1   { color: #2c5f8a; border-bottom: 2px solid #2c5f8a; padding-bottom: .25em; }
  p    { line-height: 1.7; }
  ul   { line-height: 1.9; }
</style>
</head>
<body>
  <h1>Hello from PlutoBook WASM</h1>
  <p>This PDF was rendered entirely by <strong>PlutoBook</strong> running as
     WebAssembly in Node.js — no headless browser required.</p>
  <p>Features:</p>
  <p>ក្នុងឱកាសទិវាអន្តរជាតិហ្វ្រង់កូហ្វូនី(ប្រទេសនិយាយភាសាបារាំង,LaFrancophonie)ដែលបានប្រារព្ធឡើងនៅថ្ងៃទី២០ខែមីនាក្រុមហ៊ុនវិនិយោគទុនអាណិកជនកម្ពុជា(OCIC)និងសម្ព័ន្ធភាពបារាំងខេត្តសៀមរាបបានចុះហត្ថលេខាលើកិច្ចព្រមព្រៀងភាពជាដៃគូមួយដែលមានគោលបំណងគាំទ្រកម្មវិធីអប់រំនិងវប្បធម៌ដែលគាំទ្រដល់ការលើកកម្ពស់ភាសាបារាំងនៅតាមសាលារៀនសាធារណៈក្នុងខេត្តសៀមរាប។</p>
  <ul>
    <li>Full HTML5 / CSS3 layout engine</li>
    <li>Paged media support (@page rules, page breaks)</li>
    <li>SVG rendering</li>
    <li>Cairo-backed PDF output</li>
  </ul>
</body>
</html>`;

async function main() {
  // Load the Emscripten factory (ESM) and the ESM wrapper in parallel.
  const [{ default: factory }, { createPlutoBook }] = await Promise.all([
    import(pathToFileURL(path.join(DIST, 'plutobook.js')).href),
    import(pathToFileURL(path.join(__dirname, 'wasm', 'plutobook.js')).href),
  ]);

  // Read font files from disk and pass as pre-loaded binary data.
  const fontFiles = fs.readdirSync(FONTS_DIR)
    .filter(f => /\.(ttf|otf|woff2?)$/i.test(f));

  if (fontFiles.length === 0) {
    console.error(`No fonts found in ${FONTS_DIR}.`);
    console.error('Add .ttf/.otf files (e.g. DejaVu fonts) to wasm/fonts/.');
    process.exit(1);
  }

  const fonts = fontFiles.map(name => ({
    name,
    data: fs.readFileSync(path.join(FONTS_DIR, name)),
  }));

  console.log(`Fonts: ${fonts.map(f => f.name).join(', ')}`);
  console.log('Initialising WASM module…');

  const pb = await createPlutoBook(factory, {
    fonts,
    locateFile: (f) => path.join(DIST, f),
  });

  const opts = { pageSize: [A4_W, A4_H], margins: [MARGIN, MARGIN, MARGIN, MARGIN] };

  console.log('Converting HTML → PDF…');
  const pdfBytes = pb.htmlToPdf(html, opts);
  const pdfFile = path.join(__dirname, 'output.pdf');
  fs.writeFileSync(pdfFile, pdfBytes);
  console.log(`PDF:  ${pdfFile}  (${pdfBytes.length.toLocaleString()} bytes)`);

  console.log('Converting HTML → PNG…');
  const pngBytes = pb.htmlToImage(html, { ...opts, format: 'png' });
  const pngFile = path.join(__dirname, 'output.png');
  fs.writeFileSync(pngFile, pngBytes);
  console.log(`PNG:  ${pngFile}  (${pngBytes.length.toLocaleString()} bytes)`);

  console.log('Converting HTML → JPEG…');
  const jpgBytes = pb.htmlToImage(html, { ...opts, format: 'jpeg', quality: 90 });
  const jpgFile = path.join(__dirname, 'output.jpg');
  fs.writeFileSync(jpgFile, jpgBytes);
  console.log(`JPEG: ${jpgFile}  (${jpgBytes.length.toLocaleString()} bytes)`);
}

main().catch(err => { console.error(err); process.exit(1); });
