/* Reproduction protocol for the archived manuscript; independent of interactive settings. */
(function (root) {
  'use strict';
  const O = root.Optics,
    F = O.polarization,
    T = root.LandmarkTarget;
  const names = ['white', 'dark', 'ink', 'blue', 'orange', 'green', 'purple'];
  T.install(O);
  T.prepareColors();
  function camera(x, y, n, c) {
    const { eye, forward, right, up } = O.cameraFrame(c),
      scale = c.projection === 'ortho' ? 3.4 : 8 * Math.tan((c.fov * Math.PI) / 360);
    const off = O.add(
      O.mul(right, ((x + 0.5 - n / 2) / n) * scale),
      O.mul(up, ((n / 2 - y - 0.5) / n) * scale),
    );
    return {
      o: c.projection === 'ortho' ? O.add(eye, off) : eye,
      d: c.projection === 'ortho' ? forward : O.unit(O.add(O.mul(forward, 4), off)),
    };
  }
  function reflect(name, nm) {
    return name === 'white'
      ? 1
      : name === 'dark'
        ? 0.05
        : name === 'ink'
          ? 0.01
          : T.reflectance(name, nm);
  }
  function palette(c) {
    return names.map((name) =>
      name === 'white'
        ? [1, 1, 1]
        : name === 'dark'
          ? [0.05, 0.05, 0.05]
          : name === 'ink'
            ? [0.01, 0.01, 0.01]
            : c.spectralSample
              ? Array(3).fill(T.reflectance(name, c.wavelengthNm))
              : T.landmarks.find((m) => m.spectrum === name).color.map(F.decode),
    );
  }
  function coverage(x, y, n, c) {
    const q = camera(x, y, n, c),
      t = O.backgroundDistance(q.o, q.d, c),
      p = O.add(q.o, O.mul(q.d, t));
    const width = (14 * Math.tan((c.fov * Math.PI) / 360)) / n,
      counts = new Float32Array(7);
    for (let sy = 0; sy < 12; sy++)
      for (let sx = 0; sx < 12; sx++)
        counts[
          names.indexOf(
            T.region(
              p[0] + ((sx + 0.5) / 12 - 0.5) * width,
              p[1] + ((sy + 0.5) / 12 - 0.5) * width,
            ),
          )
        ] += 1 / 144;
    return counts;
  }
  function background(counts, pal) {
    const rgb = [0, 0, 0];
    for (let k = 0; k < 7; k++) for (let j = 0; j < 3; j++) rgb[j] += counts[k] * pal[k][j];
    return rgb;
  }
  function integrated(c) {
    const plan = Spectral.plan({ ...c, spectralMode: 'off', spectralModel: 'constant' });
    return names.map((name) =>
      [0, 1, 2].map((j) => plan.reduce((s, w) => s + reflect(name, w.nm) * w.xyz[j], 0)),
    );
  }
  const originalBG = O.bg;
  let constantPalette;
  O.bg = (o, d, c) => {
    if (!c.paperXYZConstant) return originalBG(o, d, c);
    const t = O.backgroundDistance(o, d, c);
    if (!Number.isFinite(t)) return constantPalette[0].map((v) => F.encode(v * 0.05));
    const p = O.add(o, O.mul(d, t));
    return constantPalette[names.indexOf(T.region(p[0], p[1]))].map(F.encode);
  };
  function pixel(x, y, n, c, pal, cover) {
    const q = camera(x, y, n, c);
    if (!O.hit(q.o, q.d, c.shape))
      return { linear: background(cover || coverage(x, y, n, c), pal), status: 'ok' };
    const result = F.trace(q.o, q.d, c);
    return { ...result, linear: result.color.map(F.decode) };
  }
  async function render(recipe, emit, options = {}) {
    const c = { ...recipe.config },
      n = c.resolution,
      kind = recipe.kind,
      start = performance.now();
    F.validate(c);
    O.resetODEStats();
    O.resetExitStats();
    O.evaluations = { closed: 0, quadrature: 0, ode: 0, approximate: 0 };
    const plan = kind === 'spectral' ? Spectral.plan(c) : [{ config: c }],
      xyz = new Float64Array(n * n * 3);
    const stats = { errors: 0, maxDropped: 0, maxFailed: 0, maxExcludedReflectionWeight: 0 };
    constantPalette = kind === 'constant' ? integrated(c) : null;
    const covers = new Map(),
      gpuStats = {
        requested: c.computeBackend || 'cpu',
        actual: 'CPU',
        gpuPixels: 0,
        cpuPixels: 0,
        cpuFallbackPixels: 0,
        fallbackReasons: {},
        backgroundSamples: 0,
      };
    stats.gpu = gpuStats;
    for (let w = 0; w < plan.length; w++) {
      const sample = plan[w],
        cc = kind === 'spectral' ? { ...sample.config, paperTarget: 'landmarks' } : c;
      const pal = kind === 'constant' ? constantPalette : palette(cc);
      let gpu = null,
        gpuRows = null,
        batchStart = -1;
      const recordGPU = () => {
        if (!gpu) return;
        const d = gpu.diagnostics;
        gpuStats.adapter = d.adapter;
        gpuStats.precision = d.precision;
        gpuStats.initializationMs = (gpuStats.initializationMs || 0) + d.initializationMs;
        gpuStats.computeAndReadbackMs =
          (gpuStats.computeAndReadbackMs || 0) + d.computeAndReadbackMs;
        gpuStats.cpuFallbackMs = (gpuStats.cpuFallbackMs || 0) + d.cpuFallbackMs;
      };
      if (c.computeBackend === 'gpu') {
        try {
          gpu = await root.GPUOptics.create(cc, '20261114-gpu-asphere1', {
            assetBase: '../',
            palette: pal,
            shaderSources: root.rootGPUShaders,
          });
        } catch (e) {
          gpuStats.fallbackReason = e.message;
        }
      }
      try {
        for (let y = 0; y < n; y++) {
          if (gpu && (batchStart < 0 || y >= batchStart + gpu.batchRows)) {
            try {
              gpuRows = await gpu.renderTile(y, Math.min(gpu.batchRows, n - y));
              batchStart = y;
            } catch (e) {
              recordGPU();
              gpuStats.fallbackReason = e.message;
              gpu.destroy();
              gpu = null;
              gpuRows = null;
            }
          }
          const pixels = new Uint8ClampedArray(n * 4);
          for (let x = 0; x < n; x++) {
            const i = y * n + x,
              q = camera(x, y, n, cc);
            if (!O.hit(q.o, q.d, cc.shape) && !covers.has(i)) covers.set(i, coverage(x, y, n, cc));
            const gpuResult = gpuRows?.[(y - batchStart) * n + x];
            const unobstructed = covers.has(i);
            const r =
              gpuResult && !unobstructed
                ? { ...gpuResult, linear: gpuResult.linear || gpuResult.color.map(F.decode) }
                : pixel(x, y, n, cc, pal, covers.get(i));
            if (unobstructed) {
              gpuStats.backgroundSamples += 144;
              gpuStats.backgroundPixels = (gpuStats.backgroundPixels || 0) + 1;
            } else if (gpuResult && !gpuResult.gpuFallbackReason) gpuStats.gpuPixels++;
            else if (gpuResult?.gpuFallbackReason) {
              gpuStats.cpuFallbackPixels++;
              const reason = gpuResult.gpuFallbackReason;
              gpuStats.fallbackReasons[reason] = (gpuStats.fallbackReasons[reason] || 0) + 1;
            } else gpuStats.cpuOnlyPixels = (gpuStats.cpuOnlyPixels || 0) + 1;
            for (const key of [
              'fluxError',
              'boundaryResidual',
              'geometryResidual',
              'drift',
              'backgroundUncertainty',
            ])
              stats[key] = Math.max(stats[key] || 0, r[key] || 0);
            stats.errors += r.status !== 'ok' ? 1 : 0;
            stats.maxDropped = Math.max(stats.maxDropped, r.dropped || 0);
            stats.maxFailed = Math.max(stats.maxFailed, r.failedWeight || 0);
            stats.maxExcludedReflectionWeight = Math.max(
              stats.maxExcludedReflectionWeight,
              r.excludedReflectionWeight || 0,
            );
            let rgb = r.linear;
            if (kind === 'spectral') {
              const intensity = rgb.reduce((a, b) => a + b, 0) / 3;
              for (let j = 0; j < 3; j++) xyz[i * 3 + j] += intensity * sample.xyz[j];
              rgb = Spectral.rgb(...xyz.subarray(i * 3, i * 3 + 3));
            } else if (kind === 'constant') {
              xyz.set(rgb, i * 3);
              rgb = Spectral.rgb(...rgb);
            } else xyz.set(rgb, i * 3);
            pixels.set([...rgb.map(F.encode), 255], x * 4);
          }
          emit({
            y,
            rows: 1,
            pixels,
            progress: (w * n + y + 1) / (plan.length * n),
            sample: w + 1,
            samples: plan.length,
            backend: gpu ? 'WebGPU + CPU' : 'CPU',
            ms: performance.now() - start,
          });
        }
      } finally {
        if (gpu) {
          recordGPU();
          gpu.destroy();
        }
      }
    }
    gpuStats.cpuPixels = n * n * plan.length - gpuStats.gpuPixels;
    gpuStats.actual = gpuStats.gpuPixels ? 'WebGPU + CPU' : 'CPU';
    if (options.captureLinear) {
      const rgb =
        kind === 'mono'
          ? xyz
          : Float64Array.from(
              xyz,
              (_, i) => Spectral.rgb(...xyz.subarray(i - (i % 3), i - (i % 3) + 3))[i % 3],
            );
      options.captureLinear(rgb);
    }
    emit({
      done: true,
      stats: { ...stats, evaluations: { ...O.evaluations }, ode: { ...O.odeStats } },
      ms: performance.now() - start,
    });
  }
  root.PaperProtocol = { camera, coverage, background, palette, integrated, pixel, render };
})(globalThis);
