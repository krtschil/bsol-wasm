#!/usr/bin/env bash
# build_bench.sh - builds the bench_pbn benchmark tool (out/bench_pbn.js
# + .wasm). Run build.sh first - this reuses out/libdds3.a and
# out/compat.o from that build instead of recompiling the whole library.
#
# Usage:
#   ./build.sh          (if not already done)
#   ./build_bench.sh
#   node tools/bench_pbn_cli.js boards.pbn

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
LIB="$ROOT/library_src"
COMPAT="$ROOT/compat"
OUT="$ROOT/out"

if [ ! -f "$OUT/libdds3.a" ] || [ ! -f "$OUT/compat.o" ]; then
  echo "out/libdds3.a or out/compat.o not found - run ./build.sh first." >&2
  exit 1
fi

APPINC="-I $COMPAT -I $LIB -I $LIB/api"
PREFIXMAP="-ffile-prefix-map=$ROOT=/dds3-wasm-build"

echo "== Compiling bench_pbn.cpp =="
emcc -std=c++20 -O3 -flto -DNDEBUG $PREFIXMAP $APPINC -c "$ROOT/tools/bench_pbn.cpp" -o "$OUT/bench_pbn.o"

echo "== Linking bench_pbn.js / bench_pbn.wasm =="
emcc -std=c++20 -O3 -flto \
  "$OUT/bench_pbn.o" "$OUT/compat.o" "$OUT/libdds3.a" \
  -s WASM=1 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s TOTAL_STACK=8388608 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME=createBenchModule \
  -s EXPORTED_FUNCTIONS="['_benchmarkPBN','_malloc','_free']" \
  -s EXPORTED_RUNTIME_METHODS="['ccall','cwrap','UTF8ToString','stringToUTF8','lengthBytesUTF8']" \
  -o "$OUT/bench_pbn.js"

cp "$ROOT/tools/bench_pbn_cli.js" "$OUT/bench_pbn_cli.js"
cp "$ROOT/tools/bench_pbn_worker.js" "$OUT/bench_pbn_worker.js"

echo "== Done: $OUT/bench_pbn.js + $OUT/bench_pbn.wasm =="
echo "Run with: node $OUT/bench_pbn_cli.js <file.pbn> [--max=maxBoards] [--workers=numWorkers]"
