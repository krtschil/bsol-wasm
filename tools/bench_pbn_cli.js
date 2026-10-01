#!/usr/bin/env node
/* bench_pbn_cli.js - command-line wrapper around bench_pbn.js/.wasm.
 *
 * Usage:
 *   node bench_pbn_cli.js boards.pbn
 *   node bench_pbn_cli.js boards.pbn --max=100
 *   node bench_pbn_cli.js boards.pbn --workers=8
 *   node bench_pbn_cli.js boards.pbn --max=200 --workers=8
 *
 * Board labels: the wasm side now returns each board's real PBN
 * [Board "N"] number (or a sequential fallback "1","2",... when the
 * input has no [Board ...] tags), in a "labels" array parallel to
 * "times". "Max per board" below reports that real label - e.g.
 * "Board #17" - rather than a computed position, so the hardest board
 * can be looked up directly in the source .pbn file.
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
  console.log(`Max per board      : ${result.maxMs.toFixed(3)} ms${result.maxBoard ? ' (Board #' + result.maxBoard + ')' : ''}`);
  console.log(`Throughput         : ${result.boardsPerSec.toFixed(1)} boards/sec`);
  console.log(`(Node wall-clock check: ${wallMs} ms)`);
  console.log();
  console.log('JSON:', JSON.stringify(result));
}

if (numWorkers <= 1) {
  // --- Single-threaded, single-process path ---
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
    // array, and now a parallel `labels` array with each board's real
    // PBN board number (or a sequential fallback) - reuse both here so
    // single-worker output stays consistent with the multi-worker path.
    if (result.times && result.times.length > 0) {
      result.maxMs = Math.max(...result.times);
      const idx = result.times.indexOf(result.maxMs);
      result.maxBoard = (result.labels && result.labels[idx] !== undefined)
        ? result.labels[idx]
        : String(idx + 1);
    } else {
      result.maxMs = 0;
      result.maxBoard = null;
    }

    printResult(result, wallMs);
    process.exit(result.solvedErr === 0 ? 0 : 2);
  }).catch((e) => {
    console.error('Failed to load/run bench_pbn.wasm:', e);
    process.exit(1);
  });
} else {
  // --- Multi-worker path: split BOARD LINES round-robin across N workers ---
  const lines = pbnContent.split(/\r?\n/);
  const dealLinePattern = /^(\[Deal\s|[NESW]:)/;
  const boardTagPattern = /^\[Board\s/;

  // The round-robin split below only needs to move whole "board
  // records" together, i.e. a [Board ...]/[Dealer ...]/... group along
  // with its [Deal ...] line, so each worker's chunk still has the
  // [Board "N"] tag immediately available to parse alongside its own
  // deal - the wasm-side label extraction logic is unchanged from the
  // single-worker path. We do this by keeping consecutive input lines
  // together up to (and including) each deal line, then round-robining
  // those *groups*, rather than the raw deal lines alone.
  const groups = [];
  let currentGroup = [];
  for (const line of lines) {
    currentGroup.push(line);
    if (dealLinePattern.test(line.trim())) {
      groups.push(currentGroup);
      currentGroup = [];
    }
  }
  // Any trailing lines after the last deal (e.g. [Auction ...] etc.)
  // aren't needed by this tool and are dropped.

  const limitedGroups = maxBoards > 0 ? groups.slice(0, maxBoards) : groups;

  const chunks = Array.from({ length: numWorkers }, () => []);
  limitedGroups.forEach((group, i) => chunks[i % numWorkers].push(group.join('\n')));

  console.log('Per-worker board counts:', chunks.map((c) => c.length).join(', '));
  console.log();

  const t0 = Date.now();
  let remaining = numWorkers;
  const results = [];
  let hadError = false;

  chunks.forEach((chunkGroups, idx) => {
    const chunkText = chunkGroups.join('\n');
    const workerT0 = Date.now();
    const worker = new Worker(path.join(__dirname, 'bench_pbn_worker.js'), {
      workerData: { pbnChunk: chunkText },
    });

    worker.on('message', (msg) => {
      const workerWallMs = Date.now() - workerT0;
      if (!msg.ok) {
        console.error(`Worker ${idx} failed:`, msg.error);
        hadError = true;
      } else if (msg.result.error) {
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

    // Pool every worker's individual (time, label) pairs directly - no
    // round-robin math needed to recover the real board number
    // anymore, since the label already came from the wasm side's own
    // [Board "N"] parsing of whatever chunk that worker received.
    const allEntries = [];
    results.forEach((r) => {
      const times = r.times || [];
      const labels = r.labels || [];
      times.forEach((t, k) => {
        allEntries.push({
          time: t,
          board: labels[k] !== undefined ? labels[k] : String(k + 1),
        });
      });
    });

    const allTimes = allEntries.map((e) => e.time);
    const avgMs = allTimes.length > 0
      ? allTimes.reduce((s, t) => s + t, 0) / allTimes.length
      : 0;
    const medianMs = median(allTimes);

    let maxMs = 0;
    let maxBoard = null;
    if (allEntries.length > 0) {
      const maxEntry = allEntries.reduce((a, b) => (b.time > a.time ? b : a));
      maxMs = maxEntry.time;
      maxBoard = maxEntry.board;
    }

    const boardsPerSec = wallMs > 0 ? (boards / wallMs) * 1000 : 0;

    const combined = {
      boards,
      solvedOk,
      solvedErr,
      totalMs: wallMs,
      avgMs,
      medianMs,
      maxMs,
      maxBoard,
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
