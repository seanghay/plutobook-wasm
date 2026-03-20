#!/usr/bin/env python3
"""
Generate a minimal icudt78l-min.dat for PlutoBook WASM.

PlutoBook needs:
  - brkitr/   (line-break & character-break iterator rules)
  - root.res  (root locale fallback for ulocdata_getDelimiter)
  - *.nrm     (normalization data, used by HarfBuzz via ICU)
  - ulayout.icu, langInfo.res, metadata.res, supplementalData.res
      (locale infrastructure / script detection)

Everything else (800+ locale .res files, 200+ .cnv converters,
collation, currency, units, timezone, transliteration, …) is removed
— saving ~27 MB of the original 32 MB dat file.

Strategy: extract all items → delete unwanted → repackage with pkgdata.
(icupkg -r does not compact the data section, so removal alone saves nothing.)
"""

import subprocess, shutil, os, tempfile, sys

ICUPKG  = '/opt/homebrew/opt/icu4c/sbin/icupkg'
PKGDATA = '/opt/homebrew/opt/icu4c/bin/pkgdata'
ICU_LIB = '/opt/homebrew/opt/icu4c/lib'  # for pkgdata's -L flag

SRC = os.path.normpath(os.path.join(os.path.dirname(__file__),
      '../subprojects/icu/source/data/in/icudt78l.dat'))
DST = os.path.normpath(os.path.join(os.path.dirname(__file__),
      '../subprojects/icu/source/data/in/icudt78l-min.dat'))

PKG_NAME = os.path.basename(SRC).replace('.dat', '')  # icudt78l

KEEP_DIRS  = {'brkitr'}
KEEP_FILES = {
    'root.res',
    'supplementalData.res',
    'langInfo.res',
    'metadata.res',
    'ulayout.icu',
    'nfkc.nrm',
    'nfkc_cf.nrm',
    'nfkc_scf.nrm',
}

def extract(src: str, dest_dir: str) -> None:
    subprocess.run([ICUPKG, '-x', '*', '-d', dest_dir, src],
                   check=True, capture_output=True)

def filter_dir(data_dir: str) -> list[str]:
    """Remove unwanted files in-place; return list of kept relative paths."""
    kept = []
    for root, dirs, files in os.walk(data_dir, topdown=True):
        rel_root = os.path.relpath(root, data_dir)
        if rel_root == '.':
            # Top-level: keep only files in KEEP_FILES, subdirs in KEEP_DIRS
            dirs[:] = [d for d in dirs if d in KEEP_DIRS]
            for f in files:
                if f in KEEP_FILES:
                    kept.append(f)
                else:
                    os.remove(os.path.join(root, f))
        else:
            # Inside a kept subdir — keep everything
            for f in files:
                kept.append(os.path.join(rel_root, f))
    return sorted(kept)

def repackage(data_dir: str, filelist: list[str], out_dir: str) -> str:
    lst_path = os.path.join(data_dir, 'pkglist.txt')
    with open(lst_path, 'w') as fh:
        fh.write('\n'.join(filelist) + '\n')

    subprocess.run([
        PKGDATA,
        '-m', 'common',          # output .dat archive
        '-p', PKG_NAME,          # package name = icudt78l
        '-s', data_dir,          # source directory for the items
        '-d', out_dir,           # destination directory for the .dat
        '-L', ICU_LIB,           # ICU lib path (needed on macOS)
        lst_path,
    ], check=True, capture_output=True)

    return os.path.join(out_dir, PKG_NAME + '.dat')

def main() -> None:
    print(f'Source : {SRC}  ({os.path.getsize(SRC)//1024} KB)')

    with tempfile.TemporaryDirectory() as tmp:
        data_dir = os.path.join(tmp, 'data')
        out_dir  = os.path.join(tmp, 'out')
        os.makedirs(data_dir)
        os.makedirs(out_dir)

        print('Extracting…')
        extract(SRC, data_dir)
        total = sum(len(f) for _, _, fs in os.walk(data_dir) for f in fs)
        print(f'  {total} files extracted')

        kept = filter_dir(data_dir)
        print(f'  {len(kept)} files kept after filter')

        print('Repackaging…')
        result = repackage(data_dir, kept, out_dir)
        shutil.copy2(result, DST)

    print(f'Done   : {DST}  ({os.path.getsize(DST)//1024} KB)')
    print(f'Saved  : {(os.path.getsize(SRC) - os.path.getsize(DST))//1024} KB '
          f'({100*(1 - os.path.getsize(DST)/os.path.getsize(SRC)):.0f}%)')

if __name__ == '__main__':
    main()
