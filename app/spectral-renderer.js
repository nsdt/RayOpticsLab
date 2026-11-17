/* One worker, one cached GPU runtime; wavelength-specific uniforms and rays. */
(function (root) {
  'use strict';
  function merge(a, b) {
    for (const [k, v] of Object.entries(b)) {
      if (k === 'centerTransmitStokes') continue; // recorded per wavelength, not mixed bases
      if (typeof v === 'number') {
        if (
          k === 'phaseSurfaceCoherence' ||
          /^(max|.*Max)|Error$|Residual$|^drift$|^geometryResidual$/.test(k)
        )
          a[k] = Math.max(a[k] ?? 0, v);
        else if (/Min|^min/.test(k)) a[k] = a[k] === undefined ? v : Math.min(a[k], v);
        else a[k] = (a[k] || 0) + v;
      } else if (v && typeof v === 'object' && !Array.isArray(v)) merge((a[k] ??= {}), v);
      else if (typeof v === 'boolean')
        a[k] =
          k === 'pipelineCacheHit' || k === 'deviceReused'
            ? (a[k] ?? true) && v
            : a[k] || false || v;
      else if (v !== undefined && (v !== '' || !a[k])) a[k] = v;
    }
    return a;
  }
  async function render(c, mono, emit, build) {
    const start = performance.now(),
      samples = Spectral.plan(c),
      N = c.resolution,
      xyz = new Float64Array(N * N * 3),
      stats = {},
      records = [];
    for (let wi = 0; wi < samples.length; wi++) {
      const sample = samples[wi];
      let final;
      await mono(sample.config, (r) => {
        const a = r.linearPixels;
        for (let i = 0; i < a.length; i += 3) {
          // Each monochromatic sample carries scalar radiance in all three channels.
          const intensity = (a[i] + a[i + 1] + a[i + 2]) / 3,
            offset = r.y * N * 3 + i;
          for (let j = 0; j < 3; j++) xyz[offset + j] += intensity * sample.xyz[j];
        }
        if (r.done) final = r;
        else
          emit({
            build,
            progressOnly: true,
            progress: (wi + (r.y + r.rows) / N) / samples.length,
            wavelengthNm: sample.nm,
            sample: wi + 1,
            sampleCount: samples.length,
          });
      });
      merge(stats, final.stats);
      records.push({
        wavelengthNm: sample.nm,
        xyzWeight: sample.xyz,
        indices: Object.fromEntries(
          [...Spectral.keys(c), 'outsideN'].map((k) => [k, sample.config[k]]),
        ),
        milliseconds: final.ms,
        error: final.stats.error,
        meanUntraced: (final.stats.unresolvedWeight || 0) / (N * N),
        gpuPreparationMs: final.stats.gpu?.initializationMs ?? 0,
        pipelineCacheHit: final.stats.gpu?.pipelineCacheHit ?? null,
        centerTransmitStokes: final.stats.centerTransmitStokes,
      });
      stats.spectral = {
        description: Spectral.description(c),
        completed: wi + 1,
        total: samples.length,
        range: [c.spectralMin, c.spectralMax],
        illuminant: 'CIE D65',
        observer: 'CIE 1931 2°',
        background: c.spectralBackground,
        quadrature: 'midpoint transport; bin-integrated D65 × CMF',
        normalization: Spectral.normalization,
        diagnosticUnit: 'pixel-wavelength (unweighted counts/means)',
        records,
        clippedPixels: 0,
      };
      const pixels = new Uint8ClampedArray(N * N * 4),
        linearPixels = c.captureLinear ? new Float64Array(N * N * 3) : null;
      for (let i = 0; i < xyz.length; i += 3) {
        const rgb = Spectral.rgb(xyz[i], xyz[i + 1], xyz[i + 2]);
        if (rgb.some((v) => v < 0 || v > 1)) stats.spectral.clippedPixels++;
        pixels.set([...rgb.map(Optics.polarization.encode), 255], (i / 3) * 4);
        if (linearPixels) linearPixels.set(rgb, i);
      }
      stats.gpu.actual = stats.gpu.gpuPixels
        ? 'WebGPU' + (stats.gpu.cpuPixels ? ' + CPU' : '')
        : 'CPU';
      emit(
        {
          build,
          y: 0,
          rows: N,
          pixels,
          linearPixels,
          stats,
          progress: (wi + 1) / samples.length,
          ms: performance.now() - start,
          done: wi + 1 === samples.length,
        },
        linearPixels ? [pixels.buffer, linearPixels.buffer] : [pixels.buffer],
      );
    }
  }
  root.SpectralRenderer = { render, merge };
})(globalThis);
