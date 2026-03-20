# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PlutoBook is a C++20 HTML/CSS rendering library for paged media. It implements its own rendering engine (no dependency on Chromium, WebKit, or Gecko) and renders HTML/XML to PDF, PNG, and other image formats. It exposes both a C++ API (`plutobook.hpp`) and a C API (`plutobook.h`).

## Build Commands

```bash
# Configure
meson setup build

# Build
meson compile -C build

# Install
meson install -C build
```

Optional feature flags:
```bash
meson setup build -Dcurl=enabled -Dturbojpeg=enabled -Dwebp=enabled -Dtools=enabled -Dexamples=enabled
```

There is no test suite — CI validates by building successfully. The CI uses `--wrap-mode=nodownload` which assumes dependencies are pre-installed.

## Architecture

The rendering pipeline flows through these layers:

```
HTML/XML Input
  → Tokenizer (htmltokenizer.cpp, csstokenizer.cpp)
  → Parser (htmlparser.cpp, cssparser.cpp, xmlparser.cpp)
  → DOM Tree (document.h, htmldocument.h, svgdocument.h)
  → Style Resolution (cssrule.cpp, cssstylesheet.cpp, boxstyle.h)
  → Layout Engine (layout/)
  → Graphics (graphics/)
  → Output (Cairo PDF/PNG)
```

### Key subsystems

**`source/`** — Core parsing and top-level API:
- `plutobook.cpp` / `plutobook.cc` — C++ and C API implementations
- `htmlparser.cpp`, `htmltokenizer.cpp` — HTML5 parsing
- `cssparser.cpp`, `csstokenizer.cpp`, `cssstylesheet.cpp` — CSS engine
- `xmlparser.cpp`, `xmldocument.h` — XML/SVG parsing
- `globalstring.h` — String interning for performance
- `textbreakiterator.cpp` — ICU-based text breaking

**`source/layout/`** — Layout engine (~56 files):
- `box.h`, `boxstyle.h` — Core box model abstractions
- `blockbox.cpp`, `flexiblebox.cpp`, `tablebox.cpp`, `multicolumnbox.cpp` — Layout algorithms
- `linelayout.cpp`, `linebox.h`, `inlinebox.h` — Inline/line layout
- `pagebox.cpp` — Pagination logic
- SVG layout: `svgboxmodel.h`, `svgcontainerbox.h`, `svggeometrybox.h`, etc.

**`source/graphics/`** — Rendering primitives:
- `graphicscontext.cpp/.h` — Drawing context abstraction over Cairo
- `textshape.cpp/.h` — HarfBuzz text shaping
- `color.cpp/.h`, `geometry.cpp/.h` — Primitives

**`source/resource/`** — Resource loading:
- `fontresource.cpp` — FreeType + Fontconfig font loading
- `imageresource.cpp` — Image decoding (stb_image, libjpeg-turbo, libwebp)
- `url.cpp` — URL parsing and resolution
- `resource.cpp` — Base resource/fetcher abstractions

**`tools/`** — CLI tools (`html2pdf`, `html2png`)

**`include/`** — Public API headers (`plutobook.hpp`, `plutobook.h`)

### Main C++ API entry points

- `plutobook::Book` — Top-level class: load content, paginate, render, export
- `plutobook::Canvas` / `plutobook::PDFCanvas` / `plutobook::ImageCanvas` — Output surfaces
- `plutobook::ResourceFetcher` — Override to customize resource loading

## Dependencies

Required: `cairo` (≥1.15.10), `freetype2`, `harfbuzz`, `fontconfig`, `expat`, `icu`

Optional: `libcurl` (HTTP fetching), `libturbojpeg`, `libwebp`

Dependencies can be built from source via Meson subprojects (`.wrap` files in `subprojects/`).
