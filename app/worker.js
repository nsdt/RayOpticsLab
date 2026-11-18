// Version every dependency: a new worker URL alone does not invalidate importScripts caches.
const WORKER_BUILD = '20261118-english1';
importScripts(
  ...[
    'polynomial.js',
    'landmark-target.js',
    'asphere.js',
    'literature-media.js',
    'optics.js',
    'rkf45.js',
    'analytical.js',
    'schur.js',
    'approximate.js',
    'homogeneous.js',
    'grin.js',
    'branching.js',
    'polarization.js',
    'layered.js',
    'modal.js',
    'coherent.js',
    'coherent-general.js',
    'coherent-interface.js',
    'coherent-finite.js',
    'gpu-support.js',
    'gpu-transport.js',
    'data/spectral/cie-visible.js',
    'data/spectral/schott-visible.js',
    'spectral.js',
    'spectral-renderer.js',
    'render-statistics.js',
  ].map((file) => file + '?v=' + WORKER_BUILD),
);

// Sample pixel centers. The GPU shader and its CPU fallback use the same
// camera geometry (see cameraRay in gpu-transport.js).
function cameraRay(config, frame, x, y) {
  const size = config.resolution;
  const extent = config.projection === 'ortho' ? 3.4 : 8 * Math.tan((config.fov * Math.PI) / 360);
  const horizontal = ((x + 0.5 - size / 2) / size) * extent;
  const vertical = ((size / 2 - y - 0.5) / size) * extent;
  const offset = Optics.add(Optics.mul(frame.right, horizontal), Optics.mul(frame.up, vertical));
  return {
    origin: config.projection === 'ortho' ? Optics.add(frame.eye, offset) : frame.eye,
    direction:
      config.projection === 'ortho'
        ? frame.forward
        : Optics.unit(Optics.add(Optics.mul(frame.forward, 4), offset)),
  };
}

function traceRay(config, ray, mode, gpuResult) {
  try {
    if (gpuResult) return gpuResult;
    return config.transport === 'polarized'
      ? Optics.polarization.trace(ray.origin, ray.direction, config)
      : Optics.branching.trace(ray.origin, ray.direction, config, mode);
  } catch (error) {
    // A failed ray remains visible and is counted in the error budget.
    return {
      color: [210, 50, 100],
      status: 'error',
      drift: 0,
      message: error.message,
      failedWeight: 1,
      accounted: 1,
    };
  }
}

function renderRows(config, frame, firstRow, rowCount, gpuResults, stats) {
  const size = config.resolution;
  const pixels = new Uint8ClampedArray(size * rowCount * 4);
  const linearPixels = config.captureLinear ? new Float64Array(size * rowCount * 3) : null;
  // Polarized tracing already includes both input polarization states. Only
  // the legacy geometric mode averages separately traced o/e images here.
  const modes = config.transport === 'polarized' ? [0] : config.mode === 2 ? [0, 1] : [config.mode];
  for (let localRow = 0; localRow < rowCount; localRow++) {
    const y = firstRow + localRow;
    for (let x = 0; x < size; x++) {
      const pixelIndex = localRow * size + x;
      const ray = cameraRay(config, frame, x, y);
      let color = [0, 0, 0];
      for (const mode of modes) {
        const result = traceRay(config, ray, mode, gpuResults?.[pixelIndex]);
        RenderStatistics.collect(stats, result, config);
        if (
          config.captureLinear &&
          x === Math.floor(size / 2) &&
          y === Math.floor(size / 2) &&
          result.phaseExitStokes
        ) {
          stats.centerTransmitStokes = { pixel: [x, y], S: result.phaseExitStokes };
        }
        color = Optics.add(color, Optics.mul(result.color, 1 / modes.length));
      }
      pixels.set([...color, 255], pixelIndex * 4);
      // Decode before byte rounding so spectral integration retains precision.
      if (linearPixels) linearPixels.set(color.map(Optics.polarization.decode), pixelIndex * 3);
    }
  }
  return { pixels, linearPixels };
}

async function prepareGPU(config, stats) {
  stats.gpu = {
    requested: config.computeBackend || 'cpu',
    actual: 'CPU',
    gpuPixels: 0,
    cpuPixels: 0,
    cpuFallbackPixels: 0,
    fallbackReasons: {},
  };
  if (config.computeBackend !== 'gpu') return null;
  try {
    const gpu = await GPUOptics.create(config, WORKER_BUILD);
    stats.gpu = gpu.diagnostics;
    return gpu;
  } catch (error) {
    stats.gpu.fallbackReason = error.message;
    return null;
  }
}

async function renderMono(config, emit) {
  // Retain compatibility with old saved settings. The integrator is RKF45.
  if (config.solver === 'rk4') config.solver = 'rkf45';
  Optics.odeSettings(config);
  Optics.resetODEStats();
  Optics.resetExitStats();
  Optics.evaluations = { closed: 0, quadrature: 0, ode: 0, approximate: 0, layered: 0 };
  const stats = RenderStatistics.create();
  const start = performance.now();
  const frame = Optics.cameraFrame(config);
  const size = config.resolution;
  let gpu = await prepareGPU(config, stats);
  const batchRows = gpu ? gpu.batchRows : 4;
  try {
    for (let y = 0; y < size; y += batchRows) {
      const rows = Math.min(batchRows, size - y);
      let gpuResults = null;
      if (gpu) {
        try {
          gpuResults = await gpu.renderTile(y, rows);
        } catch (error) {
          // Individual rejected pixels are retraced by GPUOptics. A failed
          // device/tile instead switches this and all remaining tiles to CPU.
          stats.gpu.fallbackReason = 'GPU処理中断：' + error.message;
          gpu.destroy();
          gpu = null;
        }
      }
      const { pixels, linearPixels } = renderRows(config, frame, y, rows, gpuResults, stats);
      stats.gpu.cpuPixels = size * (y + rows) - (stats.gpu.gpuPixels || 0);
      stats.gpu.actual = stats.gpu.gpuPixels
        ? 'WebGPU' + (stats.gpu.cpuPixels ? ' + CPU' : '')
        : 'CPU';
      stats.evaluations = { ...Optics.evaluations };
      stats.ode = { ...Optics.odeStats };
      stats.exit = { ...Optics.exitStats };
      emit(
        {
          build: WORKER_BUILD,
          y,
          rows,
          pixels,
          linearPixels,
          stats,
          ms: performance.now() - start,
          done: y + rows === size,
        },
        linearPixels ? [pixels.buffer, linearPixels.buffer] : [pixels.buffer],
      );
    }
  } finally {
    gpu?.destroy();
  }
}

// A spectral job emits done only after the final wavelength (worker pooling).
onmessage = (event) => {
  const config = { ...Spectral.defaults, ...event.data };
  const emit = (result, transfer) => postMessage(result, transfer || []);
  Promise.resolve(
    Spectral.enabled(config)
      ? SpectralRenderer.render(config, renderMono, emit, WORKER_BUILD)
      : renderMono(config, emit),
  ).catch((error) =>
    postMessage({ build: WORKER_BUILD, fatalError: error?.stack || String(error) }),
  );
};
