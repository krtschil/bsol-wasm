#!/usr/bin/env node
/* bench_pbn_cli.js - command-line wrapper around bench_pbn.js/.wasm.
 *
 * Usage:
 *   node bench_pbn_cli.js boards.pbn
 *   node bench_pbn_cli.js boards.pbn --max=100
 *   node bench_pbn_cli.js boards.pbn --workers=8
 *   node bench_pbn_cli.js boards.pbn --max=200 --workers=8
 *
 * Legacy positional form is still accepted for backward compatibility:
 *   node bench_pbn_cli.js boards.pbn [maxBoards] [workers]
 * but the --max=/--workers= flags are recommended - it's easy to
 * mistake "node bench_pbn_cli.js boards.pbn 8" for "8 workers" when it
 * is actually positional arg #2, i.e. maxBoards=8, workers left at the
 * default of 1. The tool always prints the settings it actually used
 * (see "Config:" below) specifically so that kind of mix-up is caught
 * immediately instead of silently running single-threaded.
 *
 * Prints a human-readable summary and the raw JSON result (total time,
 * average per board, median per board, throughput).
 *
 * With workers <= 1 (default), everything runs in this single process,
 * single-threaded, exactly as before.
 *
 * With workers > 1, the board lines are split round-robin across that
 * many Node worker_threads. Each worker loads its OWN independent
 * instance of bench_pbn.wasm and solves only its share - this mirrors
 * how the actual application parallelises (multiple Web Workers, each
 * running a single-threaded wasm module), rather than using DDS3's
 * internal pthread-based multithreading. That distinction matters: see
 * the README's "Multithreading" discussion for why internal DDS
 * multithreading was deliberately NOT enabled for the production
 * module (it would conflict with - oversubscribe against - the app's
 * existing worker-based parallelism). This benchmark mode measures the
 * throughput actually achievable with that same worker-per-instance
 * architecture, not a different one.
 *
 * IMPORTANT: worker_threads run as OS threads *inside this one Node
 * process*, not as separate processes. A process list (Task Manager's
 * default view, plain `top`, `ps`) will always show exactly one `node`
 * entry regardless of worker count - that is expected, not a sign that
 * parallelism isn't happening. To actually see it: watch this one
 * process's CPU%, which should rise towards (workers x 100%) while
 * busy - e.g. Linux `top`/`htop` (per-process CPU% is a sum across all
 * its threads, so 8 busy workers show up as ~800%, not 100%), or
 * Windows Task Manager's "Details" tab with CPU shown per logical core,
 * or Resource Monitor's per-thread CPU view.
 *
 * bench_pbn.js is built with -s MODULARIZE=1 -s EXPORT_NAME=createBenchModule
 * (unlike dds.js, which stays non-modularized for drop-in compatibility
 * with the existing front-end). MODULARIZE's factory-function pattern avoids
 * a real Node/CommonJS scoping issue: Emscripten's non-modularized output
 * declares `var Module = typeof Module != "undefined" ? Module : {}` inside
 * its own module scope, so a `global.Module = {...}` set from a *different*
 * file (as this CLI would otherwise need to do) is never seen - it only
 * works when both live in the exact same scope, e.g. a browser page where a
 * preceding <script> tag shares the global/window scope. There's no reason
 * to work around that for this standalone tool, so it's built differently.
 */

const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (const arg of argv) {
    const m = /^--([a-zA-Z]+)=(.+)$/.exec(arg);
    if (m) {
      flags[m[1]] = m[2];
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

const { positional, flags } = parseArgs(process.argv.slice(2));

if (positional.length < 1) {
  console.error('Usage: node bench_pbn_cli.js <file.pbn> [--max=N] [--workers=N]');
  console.error('       node bench_pbn_cli.js <file.pbn> [maxBoards] [workers]   (legacy positional form)');
  process.exit(1);
}

const pbnPath = positional[0];
const maxBoards = flags.max !== undefined
  ? parseInt(flags.max, 10)
  : (positional[1] ? parseInt(positional[1], 10) : 0);
const numWorkers = flags.workers !== undefined
  ? parseInt(flags.workers, 10)
  : (positional[2] ? parseInt(positional[2], 10) : 1);

console.log(`Config: file=${pbnPath}, maxBoards=${maxBoards || 'all'}, workers=${numWorkers}`);
console.log();

const pbnContent = fs.readFileSync(pbnPath, 'utf8');

function printResult(result, wallMs, extraLabel) {
  console.log(`Boards found       : ${result.boards}`);
  console.log(`Solved OK          : ${result.solvedOk}`);
  console.log(`Solve errors       : ${result.solvedErr}`);
  console.log(`Total time         : ${result.totalMs.toFixed(1)} ms${extraLabel || ''}`);
  console.log(`Average per board  : ${result.avgMs.toFixed(3)} ms`);
  console.log(`Median per board   : ${result.medianMs.toFixed(3)} ms`);
  console.log(`Max per board      : ${result.maxMs.toFixed(3)} ms`);
  console.log(`Throughput         : ${result.boardsPerSec.toFixed(1)} boards/sec`);
  console.log(`(Node wall-clock check: ${wallMs} ms)`);
  console.log();
  console.log('JSON:', JSON.stringify(result));
}

if (numWorkers <= 1) {
  // --- Single-threaded, single-process path (unchanged from before) ---
  const createBenchModule = require(path.join(__dirname, 'bench_pbn.js'));

  const moduleOptions = {
    instantiateWasm: function (imports, successCallback) {
      const wasmBinary = fs.readFileSync(path.join(__dirname, 'bench_pbn.wasm'));
      WebAssembly.instantiate(wasmBinary, imports).then((result) => {
        successCallback(result.instance, result.module);
      });
      return {};
    },
  };

  createBenchModule(moduleOptions).then((Module) => {
    const benchmarkPBN = Module.cwrap('benchmarkPBN', 'string', ['string', 'number']);

    const t0 = Date.now();
    const resultJson = benchmarkPBN(pbnContent, maxBoards);
    const wallMs = Date.now() - t0;

    const result = JSON.parse(resultJson);
    if (result.error) {
      console.error('Error:', result.error);
      process.exit(1);
    }

    // bench_pbn.cpp always includes the individual per-board `times`
    // array now (used for correct multi-worker aggregation - see
    // below); reuse it here too so single-worker output stays
    // consistent with the multi-worker path.
    result.maxMs = result.times && result.times.length > 0
      ? Math.max(...result.times)
      : 0;

    printResult(result, wallMs);
    process.exit(result.solvedErr === 0 ? 0 : 2);
  }).catch((e) => {
    console.error('Failed to load/run bench_pbn.wasm:', e);
    process.exit(1);
  });
} else {
  // --- Multi-worker path: split BOARD LINES round-robin across N workers ---
  //
  // IMPORTANT: we must filter down to actual deal-bearing lines *before*
  // distributing, not split the raw file by line index. A naive
  // `lineIndex % numWorkers` split looked reasonable but silently breaks
  // on real multi-line-per-record .pbn files: if the number of
  // lines-per-board-record shares a common factor with numWorkers (e.g.
  // 8 header lines + 1 [Deal] line per record, 8 workers), every single
  // [Deal] line lands on the exact same modulo bucket, so one worker
  // gets ALL the boards and the rest get none - which looks exactly like
  // "no parallelism, only one core busy" even though workers=N was
  // correctly requested. Filtering to deal lines first and round-robining
  // *those* guarantees an even split regardless of the file's structure.
  const lines = pbnContent.split(/\r?\n/);
  const dealLinePattern = /^(\[Deal\s|[NESW]:)/;
  let dealLines = lines
    .map((l) => l.trim())
    .filter((l) => dealLinePattern.test(l));

  if (maxBoards > 0) dealLines = dealLines.slice(0, maxBoards);

  const chunks = Array.from({ length: numWorkers }, () => []);
  dealLines.forEach((line, i) => chunks[i % numWorkers].push(line));

  console.log('Per-worker board counts:', chunks.map((c) => c.length).join(', '));
  console.log();

  const t0 = Date.now();
  let remaining = numWorkers;
  const results = [];
  let hadError = false;

  chunks.forEach((chunkLines, idx) => {
    const workerT0 = Date.now();
    const worker = new Worker(path.join(__dirname, 'bench_pbn_worker.js'), {
      workerData: { pbnChunk: chunkLines.join('\n') },
    });

    worker.on('message', (msg) => {
      const workerWallMs = Date.now() - workerT0;
      if (!msg.ok) {
        console.error(`Worker ${idx} failed:`, msg.error);
        hadError = true;
      } else if (msg.result.error) {
        // e.g. a worker whose chunk happened to contain zero boards
        // (possible with few boards and many workers) - not fatal.
        console.log(`Worker ${idx}: 0 boards (empty chunk)`);
      } else {
        console.log(`Worker ${idx}: ${msg.result.boards} boards, ` +
          `own totalMs=${msg.result.totalMs.toFixed(1)}, ` +
          `wall (incl. startup)=${workerWallMs}ms`);
        results.push(msg.result);
      }
      worker.terminate();
    });

    worker.on('error', (err) => {
      console.error(`Worker ${idx} error:`, err);
      hadError = true;
    });

    worker.on('exit', () => {
      remaining--;
      if (remaining === 0) finish();
    });
  });

  function finish() {
    const wallMs = Date.now() - t0;

    if (results.length === 0) {
      console.error('No worker produced a result.');
      process.exit(1);
    }

    // Parallelism diagnostic: if workers ran truly concurrently, the
    // wall-clock time should be well under the SUM of each worker's own
    // solve time - close to the slowest single worker's own time, not
    // the sum of all of them. If wallMs is close to the *sum*, something
    // is serialising the workers instead of running them in parallel
    // (e.g. all CPU-bound work landing on the same core, a CPU quota/
    // cgroup limit lower than the worker count, or - on some
    // Windows/antivirus setups - process/thread creation overhead
    // dominating for small workloads).
    const sumOfWorkerTimes = results.reduce((s, r) => s + r.totalMs, 0);
    console.log();
    console.log(`Sum of each worker's own solve time : ${sumOfWorkerTimes.toFixed(1)} ms`);
    console.log(`Actual wall-clock time               : ${wallMs} ms`);
    console.log(`=> effective parallelism factor       : ${(sumOfWorkerTimes / wallMs).toFixed(2)}x ` +
      `(close to ${numWorkers} = good parallel scaling; close to 1 = not running in parallel)`);
    console.log();

    const boards = results.reduce((s, r) => s + r.boards, 0);
    const solvedOk = results.reduce((s, r) => s + r.solvedOk, 0);
    const solvedErr = results.reduce((s, r) => s + r.solvedErr, 0);

    // avgMs/medianMs are LATENCY figures (how long does solving one
    // board take), and must be computed by pooling every individual
    // board's own solve duration - never by dividing the parallel
    // wall-clock time by the total board count. That earlier approach
    // conflated a throughput measure with a latency measure: the more
    // workers were used, the smaller (and less meaningful) the reported
    // "average" became, even with zero real speedup, simply because the
    // same wall-clock time was being divided by a larger board count.
    // Each worker's bench_pbn.wasm returns its own individual per-board
    // times in `times`; pooling all of them across workers gives the
    // correct combined average/median regardless of worker count.
    const allTimes = results.reduce((acc, r) => acc.concat(r.times || []), []);
    const avgMs = allTimes.length > 0
      ? allTimes.reduce((s, t) => s + t, 0) / allTimes.length
      : 0;
    const medianMs = median(allTimes);
    const maxMs = allTimes.length > 0 ? Math.max(...allTimes) : 0;

    // boardsPerSec, in contrast, IS legitimately based on wall-clock
    // time - it's a throughput figure ("how many boards did the whole
    // batch get through per second"), which is exactly where running
    // more workers in parallel should show a real improvement.
    const boardsPerSec = wallMs > 0 ? (boards / wallMs) * 1000 : 0;

    const combined = {
      boards,
      solvedOk,
      solvedErr,
      totalMs: wallMs,
      avgMs,
      medianMs,
      maxMs,
      boardsPerSec,
      workers: numWorkers,
    };

    console.log(`(${numWorkers} worker threads, ${boards} boards total)`);
    printResult(combined, wallMs, ' (wall-clock across all workers)');
    process.exit(hadError || solvedErr > 0 ? 2 : 0);
  }

  function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;
    if (n === 0) return 0;
    return n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  }
}

