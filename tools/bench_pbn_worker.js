/* bench_pbn_worker.js - runs inside a Node worker_thread.
 *
 * Loads its own independent instance of bench_pbn.wasm (mirroring how
 * the actual application loads one wasm module instance per browser Web
 * Worker) and solves the subset of boards it was handed via workerData.
 * Posts the parsed JSON result back to the parent thread.
 */

const fs = require('fs');
const path = require('path');
const { workerData, parentPort } = require('worker_threads');

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
  const resultJson = benchmarkPBN(workerData.pbnChunk, 0);
  parentPort.postMessage({ ok: true, result: JSON.parse(resultJson) });
}).catch((e) => {
  parentPort.postMessage({ ok: false, error: String(e) });
});
