#!/usr/bin/env bash
# build.sh - builds dds.js / dds.wasm from the DDS3 library sources
# plus the legacy compatibility shim and the unmodified DDummy.cpp/timer.cpp.
#
# Prerequisite: a working em++ on your PATH (emsdk recommended; this was
# verified against em++ 3.1.6, the repo itself pins 5.0.7 via Bazel - both
# should work, newer is preferable for production).
#
# Usage:
#   chmod +x build.sh
#   ./build.sh

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
LIB="$ROOT/library_src"
COMPAT="$ROOT/compat"
APP="$ROOT/app"
OUT="$ROOT/out"

mkdir -p "$OUT/obj"

# IMPORTANT: two different include orders are needed.
# - The library itself must see the REAL library_src/api/dll.h.
# - compat.cpp and DDummy.cpp must see OUR compat/dll.h *first*, so that
#   its "#include "dll.h"" (quote-form) picks up the shim, not the real
#   header (which also happens to be named dll.h and would otherwise
#   shadow it if listed first / found first on the include path).
LIBINC="-I $LIB -I $LIB/api"
APPINC="-I $COMPAT -I $LIB -I $LIB/api"

# Normalise every absolute path baked into object files (via __FILE__ in
# assert() calls - ab_search.cpp and moves/moves.cpp use them - plus any
# debug/line info) to a fixed, install-location-independent string. Without
# this, dds.wasm is functionally identical but not byte-for-byte
# reproducible: the exact install path (e.g. /home/alice/dds3-wasm-build
# vs /Users/bob/projects/dds3-wasm-build) gets embedded as a string
# literal in any object file that calls assert(), so those specific
# .o files - and therefore the final .wasm - differ byte-for-byte
# between machines/install locations even though the compiled logic is
# identical. -ffile-prefix-map rewrites the prefix so every build emits
# the same fixed placeholder path regardless of where the package lives.
PREFIXMAP="" #-ffile-prefix-map=$ROOT=/dds3-wasm-build"

echo "== 1) Compiling all DDS3 library sources =="
# NOTE: files are explicitly sorted here. `find` does not guarantee any
# particular order - it depends on directory-entry order, which in turn
# depends on how/when/with-what-tool this package was unpacked. That
# order feeds directly into the object link order, and wasm function
# call sites are LEB128-index-encoded, so a different link order can
# shift several call-site encodings by a byte each. This makes the
# final dds.wasm several hundred bytes larger/smaller depending on
# unpack order - functionally identical, but not byte-for-byte
# reproducible. Sorting fixes the order so builds are reproducible
# regardless of how the package was extracted.
for f in $(find "$LIB" -name "*.cpp" | sort); do
  base=$(echo "$f" | sed "s#$LIB/##" | tr '/' '_')
  em++ -std=c++20 -O3 -flto -DNDEBUG $PREFIXMAP $LIBINC -c "$f" -o "$OUT/obj/${base%.cpp}.o"
done

echo "== 2) Archiving library into libdds3.a =="
# -D = deterministic mode: normalises timestamps/uid/gid/mode metadata
# inside the .a archive itself, so re-running the build twice (or on a
# different machine) produces a byte-identical archive.
emar rcsD "$OUT/libdds3.a" "$OUT"/obj/*.o

echo "== 3) Compiling compatibility shim =="
em++ -std=c++20 -O3 -flto -DNDEBUG $PREFIXMAP $APPINC -c "$COMPAT/compat.cpp" -o "$OUT/compat.o"

echo "== 4) Compiling app files (DDummy.cpp, timer.cpp) =="
# NOTE: DDummy.cpp needs one pre-existing, DDS-unrelated fix: add
#   #include <time.h>
# near its other includes (for the time() call). Older/other libc header
# chains pulled this in transitively; modern Emscripten's libc does not.
em++ -std=c++20 -O3 -flto -DNDEBUG $PREFIXMAP $APPINC -I "$APP" -c "$APP/DDummy.cpp" -o "$OUT/DDummy.o"
em++ -std=c++20 -O3 -flto -DNDEBUG $PREFIXMAP $APPINC -I "$APP" -c "$APP/timer.cpp"  -o "$OUT/timer.o"

echo "== 5) Linking final dds.js / dds.wasm =="
em++ -std=c++20 -O3 -flto \
  "$OUT/DDummy.o" "$OUT/compat.o" "$OUT/timer.o" "$OUT/libdds3.a" \
  -s WASM=1 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s TOTAL_STACK=8388608 \
  -s EXPORTED_FUNCTIONS="['_handleDDSRequest','_malloc','_free']" \
  -s EXPORTED_RUNTIME_METHODS="['ccall','cwrap','UTF8ToString','stringToUTF8']" \
  -o "$OUT/dds.js"

echo "== Done: $OUT/dds.js + $OUT/dds.wasm =="
