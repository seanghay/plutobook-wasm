/**
 * PlutoBook WebAssembly JavaScript wrapper.
 *
 * Works in both Node.js (≥18) and modern browsers.
 *
 * Usage (Node.js ESM or browser):
 *
 *   import factory from './dist/plutobook.js';      // Emscripten output
 *   import { createPlutoBook, PageSize, Margins } from './plutobook.js';
 *
 *   const pb = await createPlutoBook(factory, {
 *     // Each font is { name: string, url: string } — fetched automatically.
 *     // Or { name: string, data: Uint8Array } — pre-loaded binary.
 *     fonts: [
 *       { name: 'MyFont-Regular.ttf', url: '/fonts/MyFont-Regular.ttf' },
 *     ],
 *     // Optional: tell Emscripten where to find plutobook.wasm
 *     locateFile: (f) => `/dist/${f}`,
 *   });
 *
 *   const pdfBytes = await pb.htmlToPdf('<h1>Hello</h1>');
 */

// Minimal fonts.conf written into /fonts/ so FontConfig finds the fonts.
const FONTS_CONF = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>/fonts</dir>
</fontconfig>`;

// ── Page sizes (points, 1 pt = 1/72 inch) ────────────────────────────────────

export const PageSize = {
  A3:     [297 * 72 / 25.4, 420 * 72 / 25.4],
  A4:     [210 * 72 / 25.4, 297 * 72 / 25.4],
  A5:     [148 * 72 / 25.4, 210 * 72 / 25.4],
  B4:     [250 * 72 / 25.4, 353 * 72 / 25.4],
  B5:     [176 * 72 / 25.4, 250 * 72 / 25.4],
  Letter: [8.5 * 72, 11 * 72],
  Legal:  [8.5 * 72, 14 * 72],
  Ledger: [11  * 72, 17 * 72],
};

// ── Margin presets (points) ───────────────────────────────────────────────────

export const Margins = {
  None:     [0,   0,   0,   0  ],
  Narrow:   [36,  36,  36,  36 ],
  Normal:   [72,  72,  72,  72 ],
  Moderate: [72,  54,  72,  54 ],
  Wide:     [72,  144, 72,  144],
};

// ── Font loading helper ───────────────────────────────────────────────────────

/**
 * Load a font entry.  Accepts either:
 *   { name, data }  — Uint8Array / ArrayBuffer / Buffer already in memory
 *   { name, url }   — string URL; fetched via the global `fetch` (Node ≥18, browser)
 */
async function resolveFont({ name, url, data }) {
  if (data != null) {
    return { name, bytes: new Uint8Array(data) };
  }
  if (url != null) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch font "${name}" from ${url}: ${res.status}`);
    return { name, bytes: new Uint8Array(await res.arrayBuffer()) };
  }
  throw new Error(`Font entry for "${name}" has neither 'data' nor 'url'`);
}

// ── Main factory ──────────────────────────────────────────────────────────────

/**
 * Initialise and return a PlutoBook instance.
 *
 * @param {Function}  emscriptenFactory  The factory exported by the Emscripten
 *                                       output (plutobook.js in dist/).
 * @param {object}    [options]
 * @param {Array}     [options.fonts]      Font descriptors ({ name, url } or
 *                                         { name, data }).  At least one font
 *                                         must be supplied or rendered text will
 *                                         be invisible.
 * @param {Function}  [options.locateFile] Passed to Emscripten to resolve the
 *                                         .wasm file path (optional).
 * @returns {Promise<object>}
 */
export async function createPlutoBook(emscriptenFactory, { fonts = [], locateFile } = {}) {
  if (typeof emscriptenFactory !== 'function') {
    throw new TypeError(
      'createPlutoBook: first argument must be the Emscripten factory function ' +
      '(the default export of dist/plutobook.js).'
    );
  }

  // ── 1. Initialise the Emscripten module ────────────────────────────────────
  const Module = await emscriptenFactory({
    locateFile,
    print:    () => {},
    printErr: () => {},
  });

  // ── 2. Load fonts concurrently, then write into MEMFS ─────────────────────
  const resolved = await Promise.all(fonts.map(resolveFont));

  try { Module.FS.mkdir('/fonts'); } catch (_) { /* exists */ }

  // Write fonts.conf so FontConfig discovers /fonts/.
  Module.FS.writeFile('/fonts/fonts.conf', FONTS_CONF);

  for (const { name, bytes } of resolved) {
    Module.FS.writeFile(`/fonts/${name}`, bytes);
  }

  // ── 3. Init FontConfig + ICU data dir ─────────────────────────────────────
  Module.ccall('plutobook_wasm_init', null, [], []);

  // ── 4. Return user-facing API ─────────────────────────────────────────────
  return {
    PageSize,
    Margins,

    /**
     * Render HTML to PDF and return the bytes.
     *
     * @param {string}  html
     * @param {object}  [options]
     * @param {number[]} [options.pageSize]  [width, height] in points.
     * @param {number[]} [options.margins]   [top, right, bottom, left] in points.
     * @param {object}  [options.resources]  { [url]: Uint8Array } pre-loaded blobs.
     * @param {string}  [options.userStyle]  Extra CSS applied as user stylesheet.
     * @param {string}  [options.baseUrl]    Base URL for resolving relative URLs.
     * @returns {Promise<Uint8Array>}
     */
    async htmlToPdf(html, {
      pageSize  = PageSize.A4,
      margins   = Margins.Normal,
      resources = {},
      userStyle = '',
      baseUrl   = '',
    } = {}) {
      const fetched = await _autoFetchResources(html, baseUrl);
      _loadResources(Module, { ...fetched, ...resources });

      const [pageW, pageH]   = pageSize;
      const [mT, mR, mB, mL] = margins;

      const outLenPtr = Module._malloc(4);
      Module.HEAPU32[outLenPtr >> 2] = 0;

      const pdfPtr = Module.ccall(
        'plutobook_wasm_html_to_pdf', 'number',
        ['string', 'number', 'number', 'number',
         'number', 'number', 'number', 'number',
         'string', 'string', 'number'],
        [html, -1, pageW, pageH, mT, mR, mB, mL, baseUrl, userStyle, outLenPtr]
      );

      const pdfLen = Module.HEAPU32[outLenPtr >> 2];
      Module._free(outLenPtr);
      Module.ccall('plutobook_wasm_clear_resources', null, [], []);

      if (!pdfPtr || pdfLen === 0) {
        throw new Error('plutobook: PDF rendering failed');
      }

      const pdfBytes = new Uint8Array(Module.HEAPU8.buffer, pdfPtr, pdfLen).slice();
      Module.ccall('plutobook_wasm_free_buffer', null, ['number'], [pdfPtr]);
      return pdfBytes;
    },

    /**
     * Render HTML to an image and return the encoded bytes.
     *
     * @param {string}  html
     * @param {object}  [options]
     * @param {string}  [options.format]     'png' (default) or 'jpeg'.
     * @param {number}  [options.width]      Output width in pixels  (-1 = auto).
     * @param {number}  [options.height]     Output height in pixels (-1 = auto).
     * @param {number}  [options.quality]    JPEG quality 1–100 (default 90).
     * @param {number[]} [options.pageSize]  [width, height] in points.
     * @param {number[]} [options.margins]   [top, right, bottom, left] in points.
     * @param {object}  [options.resources]  { [url]: Uint8Array } pre-loaded blobs.
     * @param {string}  [options.userStyle]  Extra CSS applied as user stylesheet.
     * @param {string}  [options.baseUrl]    Base URL for resolving relative URLs.
     * @returns {Promise<Uint8Array>}
     */
    async htmlToImage(html, {
      format    = 'png',
      width     = -1,
      height    = -1,
      quality   = 90,
      pageSize  = PageSize.A4,
      margins   = Margins.Normal,
      resources = {},
      userStyle = '',
      baseUrl   = '',
    } = {}) {
      const fetched = await _autoFetchResources(html, baseUrl);
      _loadResources(Module, { ...fetched, ...resources });

      const [pageW, pageH]   = pageSize;
      const [mT, mR, mB, mL] = margins;

      const outLenPtr = Module._malloc(4);
      Module.HEAPU32[outLenPtr >> 2] = 0;

      const imgPtr = Module.ccall(
        'plutobook_wasm_html_to_image', 'number',
        ['string', 'number', 'number', 'number',
         'number', 'number', 'number', 'number',
         'string', 'string',
         'number', 'number', 'number', 'string', 'number'],
        [html, -1, pageW, pageH, mT, mR, mB, mL, baseUrl, userStyle,
         width, height, quality, format, outLenPtr]
      );

      const imgLen = Module.HEAPU32[outLenPtr >> 2];
      Module._free(outLenPtr);
      Module.ccall('plutobook_wasm_clear_resources', null, [], []);

      if (!imgPtr || imgLen === 0) {
        throw new Error(`plutobook: image rendering failed (format: ${format})`);
      }

      const imgBytes = new Uint8Array(Module.HEAPU8.buffer, imgPtr, imgLen).slice();
      Module.ccall('plutobook_wasm_free_buffer', null, ['number'], [imgPtr]);
      return imgBytes;
    },
  };
}

// ── Auto resource fetcher ─────────────────────────────────────────────────────

/**
 * Extract all external resource URLs referenced in the HTML.
 * Handles src="...", href="..." on <link> tags, and CSS url(...).
 * Returns a Set of resolved absolute URL strings.
 */
function _extractResourceUrls(html, baseUrl) {
  const urls = new Set();
  const base = baseUrl || undefined;

  function add(raw) {
    if (!raw) return;
    raw = raw.trim();
    if (!raw || raw.startsWith('data:') || raw.startsWith('blob:') ||
        raw.startsWith('javascript:') || raw.startsWith('#')) return;
    try {
      const resolved = base ? new URL(raw, base).href : new URL(raw).href;
      urls.add(resolved);
    } catch (_) { /* relative URL with no base — skip */ }
  }

  // src="..." or src='...'
  for (const m of html.matchAll(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/gi))
    add(m[1] ?? m[2]);

  // <link href="..."> (stylesheets, fonts)
  for (const m of html.matchAll(/<link[^>]+href\s*=\s*(?:"([^"]*)"|'([^']*)')/gi))
    add(m[1] ?? m[2]);

  // url(...) inside <style> blocks and style="" attributes
  for (const m of html.matchAll(/url\(\s*(?:"([^")]+)"|'([^')]+)'|([^)'"]+))\s*\)/gi))
    add(m[1] ?? m[2] ?? m[3]);

  return urls;
}

/**
 * Fetch all external resources referenced in the HTML string.
 * Returns a plain object { [resolvedUrl]: Uint8Array }.
 * Failures are silently ignored (best-effort).
 */
async function _autoFetchResources(html, baseUrl) {
  const urls = _extractResourceUrls(html, baseUrl);
  if (urls.size === 0) return {};
  const results = await Promise.allSettled(
    [...urls].map(async url => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status}`);
      return [url, new Uint8Array(await res.arrayBuffer())];
    })
  );
  const map = {};
  for (const r of results) {
    if (r.status === 'fulfilled') {
      const [url, bytes] = r.value;
      map[url] = bytes;
    }
  }
  return map;
}

// ── Resource loader ───────────────────────────────────────────────────────────

function _loadResources(Module, resources) {
  for (const [url, data] of Object.entries(resources)) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const mime  = detectMime(url);
    const ptr   = Module._malloc(bytes.length);
    Module.HEAPU8.set(bytes, ptr);
    Module.ccall(
      'plutobook_wasm_register_resource', null,
      ['string', 'number', 'number', 'string'],
      [url, ptr, bytes.length, mime]
    );
    Module._free(ptr);
  }
}

// ── MIME helper ───────────────────────────────────────────────────────────────

function detectMime(url) {
  const ext = url.split('.').pop().split('?')[0].toLowerCase();
  return {
    css: 'text/css', html: 'text/html', htm: 'text/html',
    xml: 'application/xml', svg: 'image/svg+xml',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp',
    ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
    js:  'text/javascript',
  }[ext] || 'application/octet-stream';
}
