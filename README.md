# bsol-wasm
Build wasm for https://mirgo2.co.uk/bridgesolver/ (Bridge Solver Online, by John Goacher)

This package contains everything needed to compile your existing
application (DDummy.cpp as the wrapper, exporting `handleDDSRequest`)
against the modernised double-dummy solver from
https://github.com/dds-bridge/dds (as of the `develop` branch at test
time), without structurally changing DDummy.cpp.

## Contents

- `library_src/` – a 1:1 copy of `library/src/` from dds-bridge/dds.
  This is the complete new solver core (39 files). Note that there is
  deliberately **no single "dds.cpp"** anymore – the old monolithic file
  was split into these modules.
- `compat/dll.h` – compatibility header. Included by `DDummy.cpp` in
  place of the old `dll.h` (its `#include "dll.h"` resolves to this one
  via the include path) and translates between old and new struct/field
  names via preprocessor macros.
- `compat/compat.cpp` – implements the two functions `DDummy.cpp` needs
  that the new library no longer provides under the old name:
  `InitStart()` and your own 2015 extension `CalcDDtableAndLeadsPBN()`.
- `app/DDummy.cpp`, `app/timer.cpp`, `app/timer.h` – your original
  files, unchanged (see the note below about one small fix that was
  needed).
- `build.sh` – the exact `emcc` commands that successfully built and
  tested this setup.

## Prerequisite

A working `emcc` on your PATH (recommended: `emsdk`, see
https://emscripten.org/docs/getting_started/downloads.html). Tested
with Emscripten 3.1.6; the original repo itself pins 5.0.7 via Bazel –
both should work, but a newer version is recommended for production.

## The one manual change needed in DDummy.cpp

`DDummy.cpp` calls `time()` but never includes `<time.h>` directly.
This used to work only because some other include chain (e.g. via
`<sys/time.h>` on an older/different libc) declared `time()`
transitively. With Emscripten's own libc headers that is no longer the
case. This is **not a DDS migration issue** – it's a pre-existing gap
that only becomes visible now. Simply add:

```cpp
#include "emscripten.h"
#include <time.h>   // <- add this line
```

That is the only change that was required in your actual application
code to compile against the new library.

## Build

```bash
chmod +x build.sh
./build.sh
```

Output: `out/dds_new.js` + `out/dds_new.wasm`.

## What has already been verified

- All `library_src/*.cpp` files compile cleanly with `emcc -std=c++20`.
- `DDummy.cpp` (with only the `time.h` addition) compiles unchanged
  against `compat/dll.h`.
- A full request through `handleDDSRequest` (table calculation + opening
  leads) runs successfully in Node.js and returns a valid JSON response.
- The 20 values of the double-dummy table were checked against DDS3's
  own reference data (`examples/hands.cpp`, `dd_table_[0]`) – exact
  match.
- The final build was produced from a clean unzip of this exact package
  and tested using the same global-`Module` loading pattern your
  existing `dds.js` uses (not `MODULARIZE`), so it should be a drop-in
  replacement for your current front-end integration.

## Known open points for production use

- Multithreading (`SolverContext`) was not tested; this build is
  single-threaded (no `-pthread`, no `SharedArrayBuffer`).
- The 80-byte limit for PBN deal strings (`DdTableDealPBN.cards[80]`)
  carries over unchanged from the old version – may be relevant for
  hands with many voids.
- Recommended: test with your own real production requests before
  rollout, especially edge cases like claims or doubleton situations.
