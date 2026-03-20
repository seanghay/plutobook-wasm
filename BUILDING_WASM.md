# Building PlutoBook for WebAssembly

## Prerequisites

### Emscripten

```bash
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install latest
./emsdk activate latest
source emsdk_env.sh
```

### Meson and Ninja

```bash
pip install meson ninja
# or on macOS:
brew install meson ninja
```

### ICU filtering tool (macOS, one-time setup)

The `wasm/filter_icu_data.py` script requires the `icupkg` and `pkgdata` tools from ICU4C:

```bash
brew install icu4c
```

---

## Steps

### 1. Filter ICU data

Strips the 32 MB ICU data file down to the ~4 MB subset that PlutoBook actually needs (break iterator rules, root locale, normalization data). Only needs to be run once, or after updating the ICU subproject.

```bash
python3 wasm/filter_icu_data.py
```

Output: `subprojects/icu/source/data/in/icudt78l-min.dat`

### 2. Configure

```bash
meson setup builddir-wasm \
  --cross-file cross/emscripten.ini \
  --native-file cross/native.ini \
  --buildtype=release \
  --default-library=static \
  -Dcurl=disabled \
  -Dturbojpeg=disabled \
  -Dwebp=disabled \
  -Dtools=disabled
```

`--buildtype=release` enables `-O3`, LTO, `-Oz` (wasm size optimisation), and Closure Compiler on the JS glue. Omit it (or use `--buildtype=debugoptimized`) for faster iteration builds.

### 3. Build

```bash
meson compile -C builddir-wasm
```

### 4. Copy output

```bash
mkdir -p dist
cp builddir-wasm/wasm/plutobook.{js,wasm} dist/
```

Or use the provided script which runs steps 2–4 in one go (defaults to release mode):

```bash
bash wasm/build.sh          # release (optimised)
bash wasm/build.sh --debug  # faster compile, larger output
```

---

## Testing

### Node.js

Place font files (`.ttf` or `.otf`) in `wasm/fonts/`, then:

```bash
node html2pdf.js
# → output.pdf
```

### Browser

```html
<script src="dist/plutobook.js"></script>
<script type="module">
  import { createPlutoBook } from './wasm/plutobook.js';

  const pb = await createPlutoBook(PlutoBook, {
    fonts: [
      { name: 'DejaVuSans.ttf', url: '/fonts/DejaVuSans.ttf' },
    ],
  });

  const pdf = pb.htmlToPdf('<h1>Hello</h1>');
  const url = URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }));
  window.open(url);
</script>
```

---

## Key files

| File | Purpose |
|---|---|
| `cross/emscripten.ini` | Meson cross-file: routes compilation through `emcc`/`em++` |
| `cross/native.ini` | Sets C++17 for build-machine tools (ICU data generators) |
| `wasm/meson.build` | Emscripten `executable()` target and link flags |
| `wasm/plutobook_wasm.c` | C glue layer: exposes `plutobook_wasm_*` functions to JS |
| `wasm/plutobook.js` | JS wrapper: `createPlutoBook(factory, { fonts })` |
| `wasm/filter_icu_data.py` | Generates the stripped `icudt78l-min.dat` |
| `wasm/fonts/` | Font files loaded at runtime (not embedded in the binary) |

## Output sizes

| File | Size |
|---|---|
| `dist/plutobook.wasm` | ~9 MB |
| `dist/plutobook.js` | ~182 KB |

The `.wasm` embeds the filtered ICU data (~4 MB). Fonts are loaded separately at runtime via the `fonts` option.
