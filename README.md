# WASM build for BSOL


This package contains everything needed to compile your existing
application (DDummy.cpp as the wrapper, exporting `handleDDSRequest`)
against the modernised double-dummy solver from
https://github.com/dds-bridge/dds (as of the `develop` branch at test
time), without structurally changing DDummy.cpp.

## Contents

- `library_src/` – a 1:1 copy of `library/src/` from dds-bridge/dds.
  This is the complete new solver core. Note that there is deliberately **no single "dds.cpp"**
  anymore – the old monolithic file was split into these modules.
- `compat/dll.h` – compatibility header. Included by `DDummy.cpp` in
  place of the old `dll.h` (its `#include "dll.h"` resolves to this one
  via the include path) and translates between old and new struct/field
  names via preprocessor macros.
- `compat/compat.cpp` – implements the two functions `DDummy.cpp` needs
  that the new library no longer provides under the old name:
  `InitStart()` and your own 2015 extension `CalcDDtableAndLeadsPBN()`.
- `app/DDummy.cpp`, `app/timer.cpp`, `app/timer.h` – your original
  files, with the three small requested changes above applied to
  `DDummy.cpp` (see "Requested source changes"); `timer.cpp`/`timer.h`
  remain untouched.
- `build.sh` – the exact `em++` commands that successfully built and
  tested this setup.
- `build_bench.sh` - building the benchmark tool that allows to run
  tests for performance measurements. Needs `node` to be installed to run it.
- `bench.sh/bench.py` - Script to batch run the benchmark tool. As the results
  of a single benchmark vary in timing it is advisable to run a couple of benchmarks
  and take arithmetic mean of the runs. 
- `hands/` - Folder containg a number of randomly created boards 
  (via `bigdeal` [see https://github.com/hansvanstaveren/BigDeal]), complemented by
  two hard to solve boards.
- `out/` - Output of `build.sh|build_bench.sh` are placed in this folder

## Prerequisite

A working `em++` on your PATH (recommended: `emsdk`, see

https://emscripten.org/docs/getting_started/downloads.html). Tested
with Emscripten 3.1.6; the original repo itself pins 5.0.7 via Bazel –
both should work, but a newer version is recommended for production.

## Build 

### Build the wasm module

```bash
chmod +x build.sh
./build.sh
```

Output: `out/dds.js` + `out/dds.wasm`.

### Build the benchmark tool

```bash
chmod +x build_bench.sh
./build_bench.sh
```

Output: on screen

### Running a single benchmark

The benchmark tool takes 3 parameters:

- --max: Number of boards out of the .pbn file to be analyzed <optional, default is 0 which translates to all>
- --workers: Number of workers that should be run to analyze the boards

```
node out/bench_pbn_cli.js <path to pbn file> --max=<number of boards> --workers=<number of workers to run>
```

Sample output:

```bash
**node out/bench_pbn_cli.js test200.pbn --max=50 --workers=8**
Config: file=test200.pbn, maxBoards=50, workers=8

Per-worker board counts: 7, 7, 6, 6, 6, 6, 6, 6

Worker 6: 6 boards, own totalMs=1060.1, wall (incl. startup)=1139ms
Worker 3: 6 boards, own totalMs=1161.5, wall (incl. startup)=1245ms
Worker 4: 6 boards, own totalMs=1286.5, wall (incl. startup)=1371ms
Worker 7: 6 boards, own totalMs=1317.9, wall (incl. startup)=1403ms
Worker 2: 6 boards, own totalMs=1546.4, wall (incl. startup)=1634ms
Worker 0: 7 boards, own totalMs=2612.3, wall (incl. startup)=2706ms
Worker 5: 6 boards, own totalMs=3197.9, wall (incl. startup)=3275ms
Worker 1: 7 boards, own totalMs=3330.5, wall (incl. startup)=3412ms

Sum of each worker's own solve time : 15513.1 ms
Actual wall-clock time               : 3423 ms
=> effective parallelism factor       : 4.53x (close to 8 = good parallel scaling; close to 1 = not running in parallel)

(8 worker threads, 50 boards total)
Boards found       : 50
Solved OK          : 50
Solve errors       : 0
Total time         : 3423.0 ms (wall-clock across all workers)
Average per board  : 310.260 ms
Median per board   : 188.057 ms
Max per board      : 1875.629 ms
Throughput         : 14.6 boards/sec
(Node wall-clock check: 3423 ms)

JSON: {"boards":50,"solvedOk":50,"solvedErr":0,"totalMs":3423,"avgMs":310.26003999999995,"medianMs":188.057,"maxMs":1875.629,"boardsPerSec":14.607069821793749,"workers":8}
```

With a worker count > 1, the tool splits the input lines round-robin
across that many **Node `worker_threads`**, each loading its own
independent instance of `bench_pbn.wasm` and solving only its share.
This deliberately mirrors how the production application itself
parallelises - multiple browser Web Workers, each running one
single-threaded wasm module instance - rather than using DDS3's
internal pthread-based multithreading (`-pthread` / `SetMaxThreads`).
That distinction matters: enabling DDS3's own internal threading inside
each already-parallel worker would oversubscribe the same CPU cores
twice over, which is exactly the concern raised earlier about internal
DDS multithreading in general (see the "Multithreading" discussion
elsewhere in this project's history) - this benchmark mode avoids that
by only ever running one thread per wasm instance, same as production.

**Checking that it's actually parallel:** `worker_threads` run as OS
threads *inside one Node process*, not as separate processes. A plain
process list (Task Manager's default view, `top`, `ps`) will always
show exactly **one** `node` entry regardless of worker count - that is
expected, not a sign that nothing is happening in parallel. To see the
parallelism, watch that one process's CPU%: on Linux, `top`/`htop`
report per-process CPU as a sum across its threads, so 8 busy workers
show up as ~800%, not 100%; on Windows, use Task Manager's "Details"
tab or Resource Monitor's per-thread CPU view rather than the default
process list.

### Running a batch of benchmarks

The times for single benchmarks vary quite a bit (e.g. depending on 
other processes running on the computer). 
To account for such variations a batch of benchmarks can be run 
through `bench.sh|bench.py` (shell script and python script are 
functionally identical). The script takes three parameters:

- -n: Number of single benchmarks to run (*optional*, default: 10)
- -d: Delay in seconds to sleep the script between individual benchmarks (*optional*, default: 10)
- Separated by `--` as the last parameter the command to run (which 
  is the command to run a single benchmark) 

The script picks up the run time for each benchmark and calculates the 
arithmetic mean.

Sample output:

```bash
**./bench.sh -n 10 -d 10 -- node out/bench_pbn_cli.js test200.pbn --max=25 --workers=8**
Run command 10x : node out/bench_pbn_cli.js test200.pbn --max=25 --workers=8
---------------------------------------------
Run 1: 2302.0 ms
Run 2: 2460.0 ms
Run 3: 2406.0 ms
Run 4: 2440.0 ms
Run 5: 2357.0 ms
Run 6: 2280.0 ms
Run 7: 2283.0 ms
Run 8: 2316.0 ms
Run 9: 2157.0 ms
Run 10: 2260.0 ms
---------------------------------------------
Number of valid runs : 10 / 10
Arithmetic mean      : 2326.100 ms
```

## Notes regarding the migration from the 2.5.3 version

### In `app/DDummy.cpp`

Some changes were applied to remove compiler warnings:

- The three `char*` variables holding string literals (`suitLetters`,
  `cardLetters`, `direction`) are now declared `const char*`. All
  their uses (`strchr(...)`, pointer-difference arithmetic) work
  identically with `const char*` - `strchr` has a `const`-input
  overload that returns `const char*`, and pointer subtraction doesn't
  care about constness - so this is a pure warning fix with no
  behavioural change.
- `int playCard(...)` has been removed. It was dead code - not called
  anywhere in `DDummy.cpp`, not exported - and, as demonstrated
  earlier in this project, removing it produces a byte-identical
  `dds.wasm`/`dds.js` either way, since Emscripten's linker already
  discards unreachable functions.
- `strlen(cards)/2` (an `unsigned long`) passed to a `%d` (`int`)
  format specifier is now `(int)(strlen(cards)/2)`, matching the
  format specifier and removing the `-Wformat` warning.


### `include` addition in DDummy.cpp

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

## Performance improvements

`build.sh` compiles and links with `-O3 -flto -DNDEBUG` (previously
`-O2`, no LTO, no `NDEBUG`). This was benchmarked head-to-head against
`-O2`, `-O3` alone, and `-O3 -flto` alone, running 30 repeated solves
across a mix of easy and hard real deals (from DDS3's own
`examples/hands.cpp` test set) in each configuration:

| Build              | ms/request (avg) | `dds.wasm` size |
|--------------------|-------------------|----------------------|
| `-O2` (previous)   | ~296 ms           | 335,507 bytes         |
| `-O3`              | ~291 ms           | 377,481 bytes         |
| `-O3 -flto`        | ~283 ms           | 331,549 bytes         |
| `-O3 -flto -DNDEBUG` | ~283 ms         | 331,248 bytes          |

`-O3 -flto` gives a real (~4-5%) speedup *and* a smaller binary than
`-O2` - LTO lets the compiler inline and dead-code-eliminate across the
39 library translation units, which a per-file `-O3` alone cannot do.
Adding `-DNDEBUG` gives no further measurable speed gain here, but
strips the two `assert()` calls entirely (see "Reproducible builds"
above) and marginally shrinks the binary further. Every variant was
checked against DDS3's own reference double-dummy table
(`examples/hands.cpp`, `dd_table_[0]`) and produced byte-identical,
correct results - the optimization gain observed is not a correctness
compromise.

Absolute numbers above are from this sandbox's Emscripten 3.1.6 and
will differ on your machine/toolchain version; the *relative* ordering
(`-O3 -flto` clearly ahead of `-O2`) is the part expected to hold.

### Source-level fix: `InitStart()` moved to one-time init

`DDummy.cpp` used to call `InitStart(1, 1)` inside the per-request
handler (once per `handleDDSRequest` call), which forwards to DDS3's
`SetResources()` / `InitializeStaticMemory()`. Looking at
`library_src/init.cpp`, `SetResources()` unconditionally does
`memory.Resize(...)` on the thread-local transposition-table pool ("
Clear the thread memory and fill it up again") plus a
`ThreadMgr::instance().Reset(...)` call - i.e. it is not a cheap no-op,
even when called with the same arguments as last time.

Benchmarking calling `InitStart()` once (at module/worker startup) vs.
before every single solve showed a measurable ~1-4% per-request
overhead attributable to the repeated re-initialisation (varies with
optimisation level; more overhead is visible at higher optimisation
levels because the actual solve got faster while the fixed re-init cost
stayed the same, so it makes up a larger share of the total).

Unlike the compiler-flag changes above, this **does** modify
`DDummy.cpp`: the three per-request `InitStart(1, 1);` calls were
removed (replaced with a comment pointing here), and
`compat/compat.cpp` now calls it exactly once via a static
constructor-priority object:
```cpp
namespace {
  struct OneTimeInit {
    OneTimeInit() { InitStart(1, 1); }
  } g_oneTimeInit;
}
```
This runs automatically via Emscripten's `__wasm_call_ctors`, which is
guaranteed to complete before any exported function (including
`handleDDSRequest`) can be called - once per loaded module instance,
i.e. once per Web Worker in this application's architecture, not once
per request. Verified: two consecutive `handleDDSRequest` calls on the
same module instance return identical, correct results, and a separate
test that never calls `InitStart()` explicitly still matches DDS3's own
reference double-dummy table exactly - confirming the constructor
actually runs and nothing else is silently doing the initialisation.

