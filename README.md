# DDS3-Wasm-Build – Migration Package

This package contains everything needed to compile your existing
application (DDummy.cpp as the wrapper, exporting `handleDDSRequest`)
against the modernised double-dummy solver from
https://github.com/dds-bridge/dds (as of the `develop` branch at test
time), without structurally changing DDummy.cpp.

## Update: re-synced against current upstream, output renamed, small cleanups

Re-pulling `dds-bridge/dds` broke the previous build. Fixed, plus a
few requested cleanups - see "Upstream regression" and "Requested
source changes" below for the details. Output files are now named
`dds.js` / `dds.wasm` (previously `dds_new.js` / `dds_new.wasm`)
throughout `build.sh`, `build_bench.sh`, and this README.

### Upstream regression fix (in `library_src/`, not your code)

A fresh clone of `dds-bridge/dds` no longer compiles as-is:
`library_src/api/dds_c_api.cpp` calls the legacy PascalCase functions
(`Par`, `SidesPar`, `DealerPar`, `DealerParBin`, `SidesParBin`,
`ConvertToDealerTextFormat`, `ConvertToSidesTextFormat`, `GetDDSInfo`,
`ErrorMessage`) but no longer includes anything that declares them.
`dds_c_api.h` used to pull in `<api/dll.h>` (which declares all of
these) transitively; a later refactor replaced that with the narrower
`<api/dds_c_data_types.h>` (struct types only), and `dds_c_api.cpp`
itself was never updated to include `<api/dll.h>` directly. The file's
own top-of-file comment says it forwards "straight to the
corresponding legacy dll.h function" - confirming this was always the
intent, just missing the include that intent assumed was present.
Fixed with a one-line `#include <api/dll.h>` addition to
`library_src/api/dds_c_api.cpp`, with a comment explaining why.

### Requested source changes (in `app/DDummy.cpp`)

Unlike every other change in this package, these were requested
directly rather than needed to make anything compile - `DDummy.cpp` is
no longer left completely untouched, by choice:

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

## Contents

- `library_src/` – a 1:1 copy of `library/src/` from dds-bridge/dds.
  This is the complete new solver core (39 files, plus the one-line fix
  above). Note that there is deliberately **no single "dds.cpp"**
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

Output: `out/dds.js` + `out/dds.wasm`.

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

## Reproducible builds

Two independent issues can otherwise make `dds.wasm` differ
byte-for-byte between machines or install locations, even though the
compiled logic is 100% identical both times:

1. **Object link order.** `find` does not guarantee a particular file
   order - it depends on filesystem directory-entry order, which
   depends on how/when/with-what-tool this package was unpacked. Wasm
   function calls are LEB128-index-encoded, so a different link order
   can shift several call-site encodings by a byte each, changing the
   overall `.wasm` size by a few hundred bytes. Fixed by explicitly
   sorting the file list (`find ... | sort`) and archiving with
   `emar rcsD` (deterministic mode, strips embedded timestamps/uid/gid
   from the `.a` archive).
2. **Embedded absolute paths.** `ab_search.cpp` and `moves/moves.cpp`
   are the only two files in the library that use `assert()`. Since
   `NDEBUG` is not defined, `assert()` expands to code that embeds the
   compiler's `__FILE__` value - i.e. the *exact absolute path* used to
   invoke the compiler - as a string literal, for use in the failure
   message if the assertion ever fires. Because `build.sh` resolves
   `$LIB` etc. to an absolute path based on wherever the package
   happens to live on disk, `ab_search.o` and `moves_moves.o` (and
   nothing else) end up byte-different between install locations, even
   with identical source and identical link order. Fixed by adding
   `-ffile-prefix-map=$ROOT=/dds3-wasm-build` to every compile
   invocation, which rewrites that embedded path to a fixed,
   install-location-independent placeholder.

With both fixes in place, rebuilding this exact package from two
completely different, differently-named, differently-nested directories
produces a byte-identical `dds.wasm` (verified, including the two
previously-affected object files, `ab_search.o` and `moves_moves.o`).

## Performance

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

### A second, source-level fix: `InitStart()` moved to one-time init

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

## Timing tool: how long does solving N boards take?

`tools/bench_pbn.cpp` + `tools/bench_pbn_cli.js` (built via
`build_bench.sh`) let you measure real wall-clock throughput against a
`.pbn` file containing any number of boards, using the exact same
solving path as `handleDDSRequest('m', ...)` - i.e.
`CalcDDtableAndLeadsPBN()`, the same one-time module-load
initialisation from the "Performance" section above, and the same
`-O3 -flto -DNDEBUG` build settings.

Build (after `./build.sh` has been run at least once):
```bash
./build_bench.sh
node out/bench_pbn_cli.js boards.pbn          # solve every board found
node out/bench_pbn_cli.js boards.pbn 100      # only solve the first 100
```

Accepted `.pbn` input: either a bare deal string per line
(`N:AKQ.J92.T865.Q73 ...`) or a standard PBN `[Deal "N:..."]` tag; any
other line (blank, other tags, `%` comments) is ignored. This is
intentionally permissive rather than a full PBN-format parser, since
the production app only ever needs the raw deal string.

Output includes total elapsed time, average time per board, median time
per board, maximum (worst-case) time per board, and boards/sec, both as
human-readable text and as a single JSON line suitable for CI logs or
scripts:
```json
{"boards":500,"solvedOk":500,"solvedErr":0,"totalMs":160628.2,"avgMs":321.256,"medianMs":298.041,"maxMs":1845.203,"boardsPerSec":3.1}
```

The median and max are computed from each board's individually-timed
solve duration (not derived from the total/average), since a handful of
unusually hard boards can pull the mean away from what a "typical"
board actually costs - the median is more representative of what most
requests will actually experience, and the max shows the worst case
you might need to plan for (e.g. a request timeout budget).

Tested end-to-end against a generated 500-board file of random, valid
deals in this sandbox: all 500 solved correctly, ~321 ms/board average
(single-threaded, this sandbox's Emscripten 3.1.6 - expect different
absolute numbers on your machine/toolchain, but the tool's timing
itself was cross-checked against Node's own wall clock and matched to
within a few milliseconds out of ~160 seconds total).

Note on `bench_pbn.js`'s build: unlike `dds.js`, it's built with
`-s MODULARIZE=1 -s EXPORT_NAME=createBenchModule` rather than the
plain/global style. This is deliberate, not an inconsistency: the
non-modularized style only works when the code declaring
`Module = {...}` and the generated glue code share the exact same
JavaScript scope (true in a browser, where a preceding `<script>` tag
shares the page's global scope with the next). Under Node's CommonJS
module system, a separate CLI script and a `require()`'d glue file do
*not* share scope, so that pattern silently fails to pick up
`Module` overrides there. `dds.js` keeps the non-modularized style
because that's what your existing front-end integration already
expects and works with; `bench_pbn.js` is a new, standalone tool with
no such constraint, so it uses the pattern that actually works
reliably under Node.

### Running the benchmark across multiple worker threads

```bash
node out/bench_pbn_cli.js boards.pbn --workers=4              # all boards, split across 4 workers
node out/bench_pbn_cli.js boards.pbn --max=200 --workers=4    # first 200 boards, 4 workers
```

(A legacy positional form, `boards.pbn [maxBoards] [workers]`, is still
accepted, but `--max=`/`--workers=` is recommended: it's easy to type
`node bench_pbn_cli.js boards.pbn 8` intending "8 workers" when
positional arg #2 is actually `maxBoards`, silently leaving `workers`
at its default of 1. The tool always prints a `Config: ...` line with
the settings it actually used, specifically so this kind of mix-up is
caught immediately instead of silently running single-threaded.)

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

The CLI also prints its own diagnostics for this, no external tool
needed: a `Per-worker board counts: ...` line (do all workers actually
get a similar amount of work?), each worker's own solve time, and an
"effective parallelism factor" - the sum of every worker's own solve
time divided by the actual wall-clock time. A factor close to the
worker count means real parallel scaling; a factor close to 1 means the
workers are effectively running one after another despite being
requested - which is exactly the symptom of the distribution bugs
described below, and was how the third one (the `[Dealer]`/`[Deal]`
mix-up) was tracked down.

Fixed by having each worker's `benchmarkPBN()` call return its
individual per-board solve durations (a new `times` array in the JSON
result, alongside the existing scalar summary), and having the CLI pool
every worker's `times` together before computing a single combined
average and a true, exact median across all boards - regardless of how
many workers produced them. `boardsPerSec` was correct all along and is
unchanged: it's legitimately wall-clock-based, since that IS a
throughput figure.

Re-verified after the fix, still in this **single-core** sandbox:
running the same 40-board file with 1 / 2 / 4 / 8 workers now shows
`avgMs` *increasing* with worker count (330 / 550 / 1140 / 2128 ms),
while total wall-clock time stays roughly flat (~11.5-13.5s) throughout.
That is the mathematically correct result for one physical core: with
more worker threads time-slicing the same single core, each
individual board's real wall-clock solve duration genuinely gets
longer (context-switch and cache-eviction overhead from contention),
while the fixed total amount of work still takes roughly the same
total time regardless of how many threads it's spread across. On a
real multi-core machine, expect the opposite and much more useful
picture: `avgMs`/`medianMs` should stay close to flat (matching the
single-worker number, since each worker gets its own core and isn't
fighting for CPU time) while `totalMs`/`boardsPerSec` improve with
worker count, up to the number of physical cores available.
