/* Keep one completed GPU Worker so its device/pipelines survive between images.
 * CPU reference jobs keep their original fresh-Worker lifecycle. Cancelling a
 * running job always terminates the native Worker; partial work is never reused. */
(function (root) {
  'use strict';
  let idle = null;
  function clear() {
    if (idle) {
      idle.worker.terminate();
      idle = null;
    }
  }
  function create(build, backend) {
    if (backend !== 'gpu') return new Worker('worker.js?v=' + encodeURIComponent(build));
    if (idle && idle.build !== build) clear();
    const worker = idle?.worker || new Worker('worker.js?v=' + encodeURIComponent(build));
    idle = null;
    let busy = false,
      complete = false,
      broken = false,
      released = false;
    const lease = {
      onmessage: null,
      onerror: null,
      postMessage(data) {
        if (released || busy || complete) throw Error('計算Workerは使用中または解放済みです');
        busy = true;
        worker.postMessage(data);
      },
      terminate() {
        if (released) return;
        released = true;
        worker.onmessage = null;
        worker.onerror = null;
        if (complete && !busy && !broken) {
          clear();
          idle = { worker, build };
          worker.onerror = () => {
            if (idle?.worker === worker) clear();
          };
        } else worker.terminate();
      },
    };
    worker.onmessage = (event) => {
      if (released) return;
      if (event.data.fatalError || event.data.build !== build) {
        broken = true;
        busy = false;
      }
      if (event.data.done) {
        complete = true;
        busy = false;
      }
      lease.onmessage?.(event);
    };
    worker.onerror = (event) => {
      if (released) return;
      broken = true;
      busy = false;
      lease.onerror?.(event);
    };
    return lease;
  }
  root.RenderWorkers = { create, clear };
  root.addEventListener('pagehide', clear);
})(globalThis);
