/* WebGPU host runs in the existing Worker. Pixels rejected by f32 guards are
 * recomputed from their original camera rays in the CPU double reference. */
(function (root) {
  'use strict';
  const O = root.Optics,
    F = O.polarization,
    MAX_PENDING_RAYS = 128,
    PIXEL_BYTES = 272,
    RAY_BYTES = 80;
  // IDs and byte strides form the host/shader ABI. Keep them aligned with
  // cfg, Ray and Pixel in gpu-optics.wgsl (documented in docs/DEVELOPING.md).
  const MATERIAL_IDS = {
    isotropic: 0,
    uniaxial: 1,
    common: 2,
    biaxial: 3,
    sphericalSquared: 4,
    radialSquared: 5,
    axialSquared: 6,
    radial: 7,
    axial: 8,
    quadratic: 9,
    heliconical: 10,
    axial2013Uniaxial: 11,
    hyperbolic: 12,
    shear: 13,
    eng2013Magnetic: 14,
    radialAnisotropic: 15,
    sphericalTransform: 16,
    cylindricalTransform: 17,
  };
  const SHAPE_IDS = { cube: 0, sphere: 1, torus: 2, slab: 3, asphere: 4 };
  const SOLVER_IDS = { auto: 0, schur: 1, rkf45: 2 };
  const PIXEL_WORDS = 68;
  const UNIFORM_FLOATS = 160;
  const reasons = {
    1: '臨界角・根の精度',
    2: '接線・固有偏光',
    3: '界面行列・収支',
    4: 'GPU待機領域の上限',
    5: '形状の稜線・交点',
    6: '背景境界の判定',
    7: '閉式解による軌道の条件外',
    8: 'GPU結果の収支・有限値',
    9: '二軸の四次根・近接根',
    10: '二軸の固有偏光・縮退',
    11: 'GRIN軌道・曲面交点・追跡上限',
    12: 'GRIN偏光輸送',
    13: '不均一異方性：構成式・伝播条件・分散残差',
    14: '前方2モード・流束規格化・縮退',
    15: '位相・分配積分の単精度による誤差／計算回数の上限',
    16: '光束分離・内部評価面・表面の条件',
    17: '数値軌道・交点・単調z区間・追跡上限',
    18: 'RKF45の誤差制御・刻み下限・試行回数上限',
    19: '出口の位置・方向の収束確認',
  };
  // Retain the device and a bounded set of compiled variants in the GPU Worker.
  // Every image still gets fresh uniforms, ray queues, output buffers and counters.
  let cached = null;
  function clearCache() {
    if (cached) {
      const old = cached;
      cached = null;
      old.device.destroy();
    }
  }
  async function runtime(build, assetBase) {
    if (cached && (cached.build !== build || cached.assetBase !== assetBase || cached.fatal))
      clearCache();
    if (cached) return { state: cached, reused: true };
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw Error('WebGPUデバイスを取得できません。');
    const device = await adapter.requestDevice(),
      state = {
        build,
        assetBase,
        adapter,
        device,
        fatal: null,
        pipelines: new Map(),
        sources: null,
      };
    cached = state;
    device.addEventListener('uncapturederror', (e) => {
      state.fatal = e.error.message;
    });
    device.lost.then((info) => {
      state.fatal = info.message || 'GPUデバイスが失われました';
      if (cached === state) cached = null;
    });
    state.layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    state.pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [state.layout] });
    return { state, reused: false };
  }
  async function pipelines(state, config, branchKind, effectiveMaterial, timing) {
    const key = JSON.stringify([
        config.material,
        effectiveMaterial,
        config.shape,
        config.solver,
        branchKind,
      ]),
      cache = state.pipelines;
    if (cache.has(key)) {
      const hit = cache.get(key);
      cache.delete(key);
      cache.set(key, hit);
      timing.pipelineCacheHit = true;
      return hit;
    }
    timing.pipelineCacheHit = false;
    const loadStart = performance.now();
    if (!state.sources)
      state.sources = await Promise.all(
        ['gpu-optics.wgsl', 'gpu-numerical.wgsl', 'gpu-phase.wgsl'].map(async (name) => {
          const response = await fetch(
            state.assetBase + name + '?v=' + encodeURIComponent(state.build),
          );
          if (!response.ok) throw Error('GPUシェーダを読み込めません: ' + name);
          return response.text();
        }),
      );
    timing.sourceLoadMs = performance.now() - loadStart;
    const compileStart = performance.now();
    let [base, numerical, phaseSource] = state.sources;
    if (branchKind === 0)
      phaseSource =
        'fn internalSplit(r:Ray,end:Path)->bool{return false;} fn coherentBulk(r:Ray){}';
    else if (branchKind !== 3)
      phaseSource =
        phaseSource.slice(0, phaseSource.indexOf('fn helicalSeparation')) +
        'fn coherentBulk(r:Ray){}';
    const source = base.replace(/^\uFEFF/, '') + '\n' + numerical + '\n' + phaseSource;
    // These are all compile-time substitutions; other settings remain uniforms.
    let code = source
      .replaceAll('cfg[16].x', String(branchKind) + '.')
      .replaceAll('cfg[9].y', String(SHAPE_IDS[config.shape]) + '.');
    // Biaxial presets can reach isotropic or uniaxial limits as indices change.
    // Specialize to the effective model and include it in the pipeline cache key.
    code = code.replaceAll('cfg[0].w', String(MATERIAL_IDS[effectiveMaterial]) + '.');
    code = code.replaceAll('cfg[10].w', String(SOLVER_IDS[config.solver] ?? 0) + '.');
    const { device } = state,
      shader = device.createShaderModule({ label: 'Optics lossless transport', code }),
      messages = await shader.getCompilationInfo(),
      errors = messages.messages.filter((m) => m.type === 'error');
    if (errors.length) throw Error(errors.map((m) => `WGSL ${m.lineNum}: ${m.message}`).join('\n'));
    timing.shaderModuleMs = performance.now() - compileStart;
    const pipelineStart = performance.now();
    const [init, step] = await Promise.all(
      ['init', 'step'].map((entryPoint) =>
        device.createComputePipelineAsync({
          layout: state.pipelineLayout,
          compute: { module: shader, entryPoint },
        }),
      ),
    );
    timing.pipelineCreationMs = performance.now() - pipelineStart;
    timing.pipelineCompileMs = performance.now() - compileStart;
    const value = { init, step };
    cache.set(key, value);
    if (cache.size > 4) cache.delete(cache.keys().next().value);
    return value;
  }
  async function create(config, build, options = {}) {
    const policy = GPUOpticsSupport.support(config);
    if (!policy.ok) throw Error(policy.reason);
    F.validate(config);
    const precision = GPUOpticsSupport.effectiveODE(config),
      odeControl = precision.effective;
    const branches = O.branching.settings(config),
      branchKind =
        config.branchModel === 'coherent'
          ? 3
          : branches.planes.length && config.branchDepth > 0
            ? { equal: 1, modal: 2 }[config.branchModel] || 0
            : 0;
    if (!root.navigator?.gpu) throw Error('このブラウザではWebGPUを利用できません。');
    let effective = config,
      ordinaryMode = 0;
    if (config.material === 'biaxial') {
      if (F.isIso(config)) effective = { ...config, material: 'isotropic', n: config.nx };
      else {
        const limit = F.uniaxialLimit(config);
        if (limit) {
          effective = limit.medium;
          ordinaryMode = limit.ordinaryMode;
        }
      }
    }
    const begin = performance.now(),
      timing = {
        deviceReused: false,
        pipelineCacheHit: false,
        deviceSetupMs: 0,
        sourceLoadMs: 0,
        pipelineCompileMs: 0,
        shaderModuleMs: 0,
        pipelineCreationMs: 0,
        bufferSetupMs: 0,
      };
    const buffers = [];
    const release = () => {
      for (const buffer of buffers.splice(0)) buffer.destroy();
    };
    try {
      const { state, reused } = await runtime(build, options.assetBase || ''),
        { device, adapter, layout } = state;
      timing.deviceReused = reused;
      timing.deviceSetupMs = performance.now() - begin;
      if (options.shaderSources) state.sources = options.shaderSources;
      const { init, step } = await pipelines(state, config, branchKind, effective.material, timing),
        bufferStart = performance.now();
      const makeBuffer = (descriptor) => {
        const buffer = device.createBuffer(descriptor);
        buffers.push(buffer);
        return buffer;
      };
      const maxPixels = Math.min(
          Math.max(
            config.resolution,
            F.isotropicGradient(config) || F.varying(config) ? 512 : 2048,
          ),
          Math.floor(device.limits.maxStorageBufferBindingSize / (MAX_PENDING_RAYS * RAY_BYTES)),
        ),
        uniformBuffer = makeBuffer({
          size: UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        }),
        pixelBuffer = makeBuffer({
          size: maxPixels * PIXEL_BYTES,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        }),
        queue = makeBuffer({
          size: maxPixels * MAX_PENDING_RAYS * RAY_BYTES,
          usage: GPUBufferUsage.STORAGE,
        }),
        readbackBuffer = makeBuffer({
          size: maxPixels * PIXEL_BYTES,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
      const group = device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 1, resource: { buffer: pixelBuffer } },
          { binding: 2, resource: { buffer: queue } },
        ],
      });
      timing.bufferSetupMs = performance.now() - bufferStart;
      const info = {
          vendor: adapter.info?.vendor || '',
          architecture: adapter.info?.architecture || '',
          description: adapter.info?.description || '',
          isFallbackAdapter: adapter.info?.isFallbackAdapter ?? null,
        },
        diagnostics = {
          requested: 'gpu',
          actual: 'WebGPU',
          precision: {
            arithmetic: 'float32',
            cpuArithmetic: 'float64',
            requestedODE: precision.requested,
            effectiveODE: odeControl,
            exitRelativeTolerance: 9.5367431640625e-7,
            backgroundRadianceBudget: 1e-5,
          },
          adapter: info,
          ...timing,
          initializationMs: performance.now() - begin,
          gpuPixels: 0,
          cpuFallbackPixels: 0,
          fallbackReasons: {},
          discardedGpuPackets: 0,
          dispatches: 0,
          computeAndReadbackMs: 0,
          cpuFallbackMs: 0,
          surfaceHits: 0,
          reentries: 0,
          objectPixels: 0,
          internalBranchEvents: 0,
          coherentSegments: 0,
          phaseClosed: 0,
          phaseNumerical: 0,
          trajectoryClosed: 0,
          trajectoryQuadrature: 0,
          trajectoryODE: 0,
          odeAccepted: 0,
          odeRejected: 0,
          odeEvaluations: 0,
          odeFailures: 0,
          odeMaxAcceptedError: 0,
          odeMinStep: 0,
          odeMaxStep: 0,
          maxBackgroundUncertainty: 0,
          uncertainBackgroundSamples: 0,
        };
      const eps =
          config.material === 'biaxial'
            ? O.biaxialTensor(config)
            : [
                [1, 0, 0],
                [0, 1, 0],
                [0, 0, 1],
              ],
        inverse = O.inv(eps),
        tensorParams = [...eps.flatMap((v) => [...v, 0]), ...inverse.flatMap((v) => [...v, 0])];
      tensorParams[3] = SOLVER_IDS[config.solver] ?? 0;
      tensorParams[7] = config.twist;
      tensorParams[11] = config.shift;
      const frame = O.cameraFrame(config),
        size = config.resolution,
        extent = config.projection === 'ortho' ? 3.4 : 8 * Math.tan((config.fov * Math.PI) / 360),
        axis = O.principalAxes(effective)[2],
        view = { all: 0, o: 1, e: 2, mode1: 1, mode2: 2, reflected: 3 }[config.transportView];
      const T = root.LandmarkTarget;
      T.prepareColors();
      const landmarkPalette = options.palette || [
        [1, 1, 1],
        [0.05, 0.05, 0.05],
        [0.01, 0.01, 0.01],
        ...T.landmarks.map((m) =>
          config.spectralSample
            ? Array(3).fill(T.reflectance(m.spectrum, config.wavelengthNm))
            : m.color.map(F.decode),
        ),
      ];
      function cameraRay(index, y) {
        const x = index % size,
          j = Math.floor(index / size),
          u = ((x + 0.5 - size / 2) / size) * extent,
          v = ((size / 2 - y - j - 0.5) / size) * extent,
          off = O.add(O.mul(frame.right, u), O.mul(frame.up, v));
        return {
          o: config.projection === 'ortho' ? O.add(frame.eye, off) : frame.eye,
          d:
            config.projection === 'ortho'
              ? frame.forward
              : O.unit(O.add(O.mul(frame.forward, 4), off)),
        };
      }
      // cfg is an array of vec4f. Offsets below count scalar float32 values,
      // including padding slots shared by the constitutive and camera data.
      function packUniforms(y, rows, count) {
        const uniforms = new Float32Array(UNIFORM_FLOATS);
        uniforms.set([
          size,
          y,
          rows,
          MATERIAL_IDS[effective.material],
          effective.n,
          effective.no,
          effective.ne,
          O.outsideIndex(config),
          ...axis,
          config.gradient,
          config.maxInterfaces,
          config.minContribution,
          config.maxRayWork ?? 2048,
          config.untracedTolerance ?? 0.001,
          ...frame.eye,
          config.projection === 'ortho' ? 1 : 0,
          ...frame.forward,
          extent,
          ...frame.right,
          config.backgroundZ,
          ...frame.up,
          {
            grid: 6,
            uv: 1,
            markers: 2,
            white: 3,
            spectralChecker: 4,
            spectralSmooth: 5,
            spectralLandmarks: 6,
          }[config.background],
          config.step,
          config.maxSteps || 650,
          O.axisHalfWidth(config),
          view,
          count,
          SHAPE_IDS[config.shape],
          ordinaryMode,
          config.material === 'biaxial' ? 1 : 0,
          ...tensorParams,
        ]);
        uniforms.set(
          [
            branchKind,
            config.branchDepth,
            branches.planes.length,
            config.coherentInterface === 'resolved' ? 1 : 0,
          ],
          64,
        );
        uniforms.set(
          [
            (2 * Math.PI * config.lengthUnitUm) / (config.wavelengthNm * 0.001),
            (config.beamRadiusUm / config.lengthUnitUm) *
              Math.sqrt(-2 * Math.log(config.overlapCutoff)),
            config.phaseSlices,
            config.phaseTolerance,
          ],
          68,
        );
        uniforms.set(
          [
            odeControl.odeRtol,
            odeControl.odeAtolPosition,
            odeControl.odeAtolMomentum,
            odeControl.odeMaxSteps,
          ],
          72,
        );
        uniforms.set(
          [
            ...(config.material === 'radialAnisotropic'
              ? config.radialCenter || [2, 1, -3]
              : config.transformCenter || [0.7, 0, -3]),
            config.radialRadius ?? 7,
          ],
          80,
        );
        uniforms.set(
          [
            config.transformInner ?? 0.7,
            config.transformOuter ?? 5,
            config.engStrength ?? 1,
            Math.max(1, ...landmarkPalette.flat()),
          ],
          84,
        );
        uniforms.set(branches.planes, 96);
        uniforms.set(
          landmarkPalette.flatMap((rgb) => [...rgb, 0]),
          128,
        );
        uniforms.set(
          [
            config.paperDirectOnly ? 1 : 0,
            config.spectralSample ? 1 : 0,
            config.paperXYZConstant ? 1 : 0,
            config.paperRKF45Fallback ? 1 : 0,
          ],
          156,
        );
        return uniforms;
      }
      // Each round advances all pending queues, then reads completion flags.
      // Copy the mapped range before unmapping, because its view then expires.
      async function dispatchTile(count) {
        let encoder = device.createCommandEncoder(),
          pass = encoder.beginComputePass();
        pass.setPipeline(init);
        pass.setBindGroup(0, group);
        pass.dispatchWorkgroups(Math.ceil(count / 32));
        pass.end();
        device.queue.submit([encoder.finish()]);
        let data;
        const maxRounds = Math.ceil((config.maxRayWork ?? 2048) / 32) + 2;
        for (let round = 0; round < maxRounds; round++) {
          if (state.fatal) throw Error(state.fatal);
          encoder = device.createCommandEncoder();
          pass = encoder.beginComputePass();
          pass.setPipeline(step);
          pass.setBindGroup(0, group);
          for (let k = 0; k < 4; k++) {
            pass.dispatchWorkgroups(Math.ceil(count / 32));
            diagnostics.dispatches++;
          }
          pass.end();
          encoder.copyBufferToBuffer(pixelBuffer, 0, readbackBuffer, 0, count * PIXEL_BYTES);
          device.queue.submit([encoder.finish()]);
          await readbackBuffer.mapAsync(GPUMapMode.READ, 0, count * PIXEL_BYTES);
          data = readbackBuffer.getMappedRange(0, count * PIXEL_BYTES).slice(0);
          readbackBuffer.unmap();
          const ints = new Uint32Array(data);
          let done = true;
          for (let i = 0; i < count; i++)
            if (ints[i * PIXEL_WORDS + 20] !== 1) {
              done = false;
              break;
            }
          if (done) break;
          if (round === maxRounds - 1) throw Error('GPU追跡の終了を確認できません');
        }
        return data;
      }
      // A rejection invalidates the whole pixel, including its reflected rays.
      function retryOnCPU(i, y, reason, counts) {
        diagnostics.odeFailures += counts[59];
        diagnostics.discardedGpuPackets += counts[13];
        const start = performance.now(),
          ray = cameraRay(i, y);
        let result;
        try {
          result = options.cpuFallback
            ? options.cpuFallback(ray.o, ray.d, config, i, y)
            : F.trace(ray.o, ray.d, config);
        } catch (e) {
          result = {
            color: [210, 50, 100],
            status: 'error',
            drift: 0,
            message: e.message,
            failedWeight: 1,
            accounted: 1,
          };
        }
        diagnostics.cpuFallbackMs += performance.now() - start;
        diagnostics.cpuFallbackPixels++;
        const label = reasons[reason] || String(reason);
        diagnostics.fallbackReasons[label] = (diagnostics.fallbackReasons[label] || 0) + 1;
        result.gpuFallbackReason = label;
        return result;
      }
      function recordGpuDiagnostics(values, counts) {
        diagnostics.maxBackgroundUncertainty = Math.max(
          diagnostics.maxBackgroundUncertainty,
          values[64],
        );
        diagnostics.uncertainBackgroundSamples += values[65];
        diagnostics.odeAccepted += counts[56];
        diagnostics.odeRejected += counts[57];
        diagnostics.odeEvaluations += counts[58];
        diagnostics.odeMaxAcceptedError = Math.max(diagnostics.odeMaxAcceptedError, values[60]);
        if (values[61] > 0)
          diagnostics.odeMinStep = diagnostics.odeMinStep
            ? Math.min(diagnostics.odeMinStep, values[61])
            : values[61];
        diagnostics.odeMaxStep = Math.max(diagnostics.odeMaxStep, values[62]);
        diagnostics.gpuPixels++;
        diagnostics.trajectoryClosed += counts[22];
        diagnostics.trajectoryQuadrature += counts[34];
        diagnostics.trajectoryODE += counts[35];
        diagnostics.internalBranchEvents += counts[36];
        diagnostics.coherentSegments += counts[40];
        diagnostics.phaseClosed += counts[42];
        diagnostics.phaseNumerical += counts[43];
        diagnostics.reentries += values[28];
        diagnostics.surfaceHits += values[29];
        if (values[29] > 0) diagnostics.objectPixels++;
        O.evaluations.closed += counts[22];
        O.evaluations.quadrature += counts[34];
        O.evaluations.ode += counts[35];
      }
      function traceResult(values, counts, dropped, accounted) {
        return F.finishTraceBudget(config, {
          status: 'ok',
          linear: [values[0], values[1], values[2]],
          backgroundUncertainty: values[64],
          uncertainBackgroundSamples: values[65],
          color: [values[0], values[1], values[2]].map(F.encode),
          weightSum: values[3],
          dropped,
          excludedReflectionWeight: values[63],
          failedWeight: 0,
          unavailableWeight: 0,
          accounted,
          cutoffWeights: {
            threshold: values[4],
            interface: values[5],
            work: values[6],
            tolerance: values[7],
            internal: values[44],
          },
          workLimitWeight: values[6],
          processedRays: counts[13],
          maxPendingRays: counts[14],
          maxDepth: values[16],
          interfaces: values[17],
          reflections: values[18],
          leaves: values[19],
          branches: counts[23],
          fluxError: values[9],
          boundaryResidual: values[10],
          drift: values[11],
          fieldResidual: values[30],
          rootResidual: values[31],
          bulkSteps: counts[32],
          bulkSegments: counts[33],
          channels:
            config.material === 'biaxial'
              ? { direct: values[24], mode1: values[25], mode2: values[26], reflected: values[27] }
              : { direct: values[24], o: values[25], e: values[26], reflected: values[27] },
          internalBranches: counts[36],
          maxInternalDepth: counts[37],
          modalClosed: counts[38],
          modalQuadrature: counts[39],
          modalWeightError: values[52],
          modalQuadratureError: values[47],
          coherentSegments: counts[40],
          coherentSplits: counts[41],
          phaseClosed: counts[42],
          phaseNumerical: counts[43],
          coherentLimitWeight: values[44],
          phaseIntegrationError: values[45],
          coherencyError: values[46],
          phaseBoundaryProjections: counts[48],
          phaseBoundaryTails: counts[49],
          phaseSurfaceDephasings: counts[50],
          phaseReentries: branchKind === 3 ? values[28] : 0,
          phaseEscapedDirect: values[53],
          phaseEscapedReflected: values[54],
          geometryResidual: values[55],
          phaseTransmitted:
            branchKind === 3 && config.coherentInterface === 'resolved' ? values[51] : 0,
          phaseReflected:
            branchKind === 3 && config.coherentInterface === 'resolved'
              ? values[3] - values[51]
              : 0,
        });
      }
      function decodeResults(data, y, count) {
        const floatData = new Float32Array(data),
          uintData = new Uint32Array(data),
          results = [];
        for (let i = 0; i < count; i++) {
          const offset = i * PIXEL_WORDS,
            values = floatData.subarray(offset, offset + PIXEL_WORDS),
            counts = uintData.subarray(offset, offset + PIXEL_WORDS);
          let reason = counts[21];
          const dropped = values[4] + values[5] + values[6] + values[7] + values[44],
            accounted = values[3] + dropped + values[63];
          if (
            ![values[0], values[1], values[2], accounted].every(Number.isFinite) ||
            Math.abs(accounted - 1) > 1e-4
          )
            reason = reason || 8;
          if (reason) {
            results.push(retryOnCPU(i, y, reason, counts));
            continue;
          }
          recordGpuDiagnostics(values, counts);
          results.push(traceResult(values, counts, dropped, accounted));
        }
        return results;
      }
      async function renderTile(y, rows) {
        if (state.fatal) throw Error(state.fatal);
        const count = size * rows;
        if (count > maxPixels) throw Error('GPUのバッチが大きすぎます');
        const start = performance.now();
        device.queue.writeBuffer(uniformBuffer, 0, packUniforms(y, rows, count));
        const data = await dispatchTile(count);
        diagnostics.computeAndReadbackMs += performance.now() - start;
        return decodeResults(data, y, count);
      }
      return {
        renderTile,
        diagnostics,
        batchRows: Math.min(16, Math.max(1, Math.floor(maxPixels / size))),
        destroy: release,
      };
    } catch (e) {
      release();
      clearCache();
      throw e;
    }
  }
  root.GPUOptics = { create, clearCache, support: root.GPUOpticsSupport.support };
})(globalThis);
