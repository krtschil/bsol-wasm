#!/usr/bin/env bash
# build.sh - builds dds.js / dds.wasm from the DDS3 library sources
# plus the legacy compatibility shim and the unmodified DDummy.cpp/timer.cpp.
# (KK): small corrections in DDummy.cpp due to warnings during the build process (see there)
#
# Prerequisite: a working emcc on your PATH (emsdk recommended; this was
# verified against emcc 3.1.6, the repo itself pins 5.0.7 via Bazel - both
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

echo "== 1) Compiling all DDS3 library sources =="
for f in $(find "$LIB" -name "*.cpp" | sort); do
  base=$(echo "$f" | sed "s#$LIB/##" | tr '/' '_')
  emcc -std=c++20 -O3 $LIBINC -c "$f" -o "$OUT/obj/${base%.cpp}.o"
done

echo "== 2) Archiving library into libdds3.a =="
emar rcs "$OUT/libdds3.a" "$OUT"/obj/*.o

echo "== 3) Compiling compatibility shim =="
emcc -std=c++20 -O3 $APPINC -c "$COMPAT/compat.cpp" -o "$OUT/compat.o"

echo "== 4) Compiling unmodified app files (DDummy.cpp, timer.cpp) =="
# NOTE: DDummy.cpp needs one pre-existing, DDS-unrelated fix: add
#   #include <time.h>
# near its other includes (for the time() call). Older/other libc header
# chains pulled this in transitively; modern Emscripten's libc does not.
emcc -std=c++20 -O3 $APPINC -I "$APP" -c "$APP/DDummy.cpp" -o "$OUT/DDummy.o"
emcc -std=c++20 -O3 $APPINC -I "$APP" -c "$APP/timer.cpp"  -o "$OUT/timer.o"

echo "== 5) Linking final dds.js / dds.wasm =="
emcc -std=c++20 -O3 \
  "$OUT/DDummy.o" "$OUT/compat.o" "$OUT/timer.o" "$OUT/libdds3.a" \
  -s WASM=1 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s TOTAL_STACK=8388608 \
  -s EXPORTED_FUNCTIONS="['_handleDDSRequest','_malloc','_free']" \
  -s EXPORTED_RUNTIME_METHODS="['ccall','cwrap','UTF8ToString','stringToUTF8']" \
  -o "$OUT/dds.js"

echo "== Done: $OUT/dds.js + $OUT/dds.wasm =="
