#!/usr/bin/env node
'use strict';

const path = require('path');
const fs   = require('fs');
const { pathToFileURL } = require('url');

const DIST      = path.join(__dirname, 'dist');
const FONTS_DIR = path.join(__dirname, 'wasm', 'fonts');
const INPUT     = path.join(__dirname, 'multi_bg_aspect.html');
const OUTPUT    = path.join(__dirname, 'images', 'multi_bg_aspect_wasm.pdf');

const A4_W   = 210 * 72 / 25.4;
const A4_H   = 297 * 72 / 25.4;
const MARGIN = 36; // 0.5 inch — give content more room

async function main() {
  const [{ default: factory }, { createPlutoBook }] = await Promise.all([
    import(pathToFileURL(path.join(DIST, 'plutobook.js')).href),
    import(pathToFileURL(path.join(__dirname, 'wasm', 'plutobook.js')).href),
  ]);

  const fontFiles = fs.readdirSync(FONTS_DIR).filter(f => /\.(ttf|otf|woff2?)$/i.test(f));
  if (fontFiles.length === 0) {
    console.error(`No fonts in ${FONTS_DIR}`);
    process.exit(1);
  }
  const fonts = fontFiles.map(name => ({ name, data: fs.readFileSync(path.join(FONTS_DIR, name)) }));

  console.log(`Fonts: ${fonts.map(f => f.name).join(', ')}`);
  console.log('Initialising WASM…');
  const pb = await createPlutoBook(factory, { fonts, locateFile: f => path.join(DIST, f) });

  const html = fs.readFileSync(INPUT, 'utf8');
  const opts = { pageSize: [A4_W, A4_H], margins: [MARGIN, MARGIN, MARGIN, MARGIN] };

  console.log('Rendering PDF…');
  const pdfBytes = await pb.htmlToPdf(html, opts);
  fs.writeFileSync(OUTPUT, pdfBytes);
  console.log(`PDF: ${OUTPUT}  (${pdfBytes.length.toLocaleString()} bytes)`);
}

main().catch(err => { console.error(err); process.exit(1); });
