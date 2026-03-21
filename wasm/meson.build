wasm_exported_functions = [
    '_plutobook_wasm_init',
    '_plutobook_wasm_html_to_pdf',
    '_plutobook_wasm_html_to_image',
    '_plutobook_wasm_free_buffer',
    '_plutobook_wasm_register_resource',
    '_plutobook_wasm_clear_resources',
    '_malloc',
    '_free',
]

wasm_link_args = [
    '-sUSE_LIBPNG=1',
    '-sUSE_ZLIB=1',
    # Explicitly disable pthreads so --shared-memory is not injected by
    # sub-dependencies (HarfBuzz/Cairo detect pthreads but we don't need them).
    '-sUSE_PTHREADS=0',
    '-sMODULARIZE=1',
    '-sEXPORT_NAME=PlutoBook',
    '-sEXPORT_ES6=1',
    '-sUSE_ES6_IMPORT_META=1',
    '-sALLOW_MEMORY_GROWTH=1',
    '-sMAXIMUM_MEMORY=2147483648',
    '-sINITIAL_MEMORY=67108864',
    '-sENVIRONMENT=web,worker,node',
    '-sEXPORTED_FUNCTIONS=' + ','.join(wasm_exported_functions),
    '-sEXPORTED_RUNTIME_METHODS=["ccall","cwrap","FS","allocateUTF8","UTF8ToString","getValue","HEAPU8","HEAPU32"]',
    '--embed-file', meson.source_root() / 'subprojects/icu/source/data/in/icudt78l-min.dat@/icudata/icudt78l.dat',
]

# Release-only: size optimisation + closure compiler for the JS glue.
if get_option('buildtype') == 'release'
    wasm_link_args += [
        '-Oz',
        '--closure', '1',
        '-sMALLOC=emmalloc',   # smaller allocator (~60 KB saved vs dlmalloc)
    ]
endif

executable('plutobook',
    'plutobook_wasm.c',
    dependencies: [plutobook_dep],
    link_args: wasm_link_args,
    override_options: ['b_lto=' + (get_option('buildtype') == 'release' ? 'true' : 'false')],
)
