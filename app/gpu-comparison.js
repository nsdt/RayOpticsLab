(function (root) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let environment = 'WebGPUの利用可否を確認中…',
    api = null,
    active = false,
    worker = null,
    job = 0,
    report = null,
    pendingReject = null;
  function syncBackend(c) {
    if (!$('computeBackend')) return;
    c.computeBackend ??= 'cpu';
    $('computeBackend').value = c.computeBackend;
    const s = GPUOpticsSupport.support(c);
    $('gpuSupportNote').textContent =
      environment +
      ' ' +
      s.reason +
      (!s.ok && c.computeBackend === 'gpu' ? ' この設定ではCPUを使用します。' : '');
  }
  async function probe(getConfig) {
    try {
      if (!navigator.gpu) environment = 'このブラウザではWebGPUを利用できません。';
      else {
        const a = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
        environment = a
          ? 'WebGPUアダプタ：' +
            [a.info?.vendor, a.info?.architecture].filter(Boolean).join(' ') +
            (a.info?.isFallbackAdapter ? '（ソフトウェア実装）' : '') +
            '。'
          : 'WebGPUアダプタを取得できません。';
      }
    } catch (e) {
      environment = 'WebGPU確認：' + e.message;
    }
    syncBackend(getConfig());
  }
  function runtime(stats) {
    const d = stats.gpu;
    if (!d) return 'CPU（倍精度）';
    if (d.requested !== 'gpu') return 'CPU（倍精度）';
    return (
      (stats.spectral ? 'スペクトル（件数＝画素×波長） · ' : '') +
      d.actual +
      '：GPU ' +
      (d.gpuPixels || 0) +
      '画素 / CPU ' +
      (d.cpuPixels || 0) +
      '画素' +
      (d.adapter
        ? ' · ' +
          [d.adapter.vendor, d.adapter.architecture].filter(Boolean).join(' ') +
          (d.adapter.isFallbackAdapter ? '（ソフトウェア実装）' : '')
        : '')
    );
  }
  function detail(stats) {
    const d = stats.gpu || {};
    if (d.requested !== 'gpu') return '同じ光学モデルと打切り条件による基準計算です。';
    if (d.fallbackReason && !d.gpuPixels) return d.fallbackReason;
    return (
      (d.fallbackReason ? d.fallbackReason + ' ' : '') +
      (d.cpuFallbackPixels
        ? 'GPUでの精度判定等によるCPU再計算 ' +
          d.cpuFallbackPixels +
          '画素（' +
          Object.entries(d.fallbackReasons || {})
            .map(([k, n]) => k + ' ' + n)
            .join(' / ') +
          '）。'
        : '') +
      (d.objectPixels !== undefined
        ? 'GPUで媒質の表面を処理した画素 ' +
          d.objectPixels +
          '（背景のみを除く）、再入射 ' +
          d.reentries +
          '回。'
        : '') +
      (d.initializationMs !== undefined
        ? 'GPU準備 ' +
          (d.initializationMs / 1000).toFixed(3) +
          '秒（' +
          (d.pipelineCacheHit ? 'コンパイル済み処理を再利用' : 'シェーダをコンパイル') +
          '）、GPU計算＋読み戻し ' +
          (d.computeAndReadbackMs / 1000).toFixed(3) +
          '秒、CPU再計算 ' +
          (d.cpuFallbackMs / 1000).toFixed(3) +
          '秒。'
        : '') +
      (stats.evaluations
        ? '軌道評価：閉形式 ' +
          stats.evaluations.closed +
          ' / 求積 ' +
          stats.evaluations.quadrature +
          ' / ODE ' +
          stats.evaluations.ode +
          '。'
        : '') +
      (d.trajectoryQuadrature !== undefined
        ? 'GPU採用分の軌道評価：閉形式 ' +
          d.trajectoryClosed +
          ' / 求積 ' +
          d.trajectoryQuadrature +
          ' / ODE ' +
          d.trajectoryODE +
          '。'
        : '') +
      (d.internalBranchEvents !== undefined
        ? 'GPUの内部分岐 ' +
          d.internalBranchEvents +
          '回、位相輸送 ' +
          d.coherentSegments +
          '区間（解析 ' +
          d.phaseClosed +
          ' / 数値積分 ' +
          d.phaseNumerical +
          '）。'
        : '') +
      '単精度の局所残差による判定で、画像全体の精度保証ではありません。'
    );
  }
  function sync(c) {
    if (!api) return;
    for (const th of document.querySelectorAll('#gpuComparisonSection thead th')) {
      th.textContent = (root.I18n?.sourceText(th) || th.textContent).replaceAll(
        '画素×波長',
        '画素',
      );
      if (root.Spectral?.enabled(c))
        th.textContent = th.textContent.replaceAll('画素', '画素×波長');
    }
    const supported = GPUOpticsSupport.support(c);
    $('gpuCompareStart').disabled = active || !supported.ok;
    $('gpuCompareCancel').disabled = !active;
    $('gpuCompareSave').disabled = !report?.complete;
    $('gpuCompareResolution').disabled = active;
    $('gpuCompareHint').textContent = supported.ok
      ? '現在の材料・形状・偏光モデル・打切り条件を固定して、CPU倍精度とWebGPU単精度（必要な画素はCPUで再計算）を比較します。GPUは初回に準備が必要です。同じページで繰り返すと準備済みの処理を再利用します。'
      : supported.reason;
    $('gpuCompareStale').hidden =
      !report || JSON.stringify(c) === JSON.stringify(report.sourceConfig);
  }
  function cancel() {
    if (!active) return;
    job++;
    active = false;
    worker?.terminate();
    worker = null;
    const reject = pendingReject;
    pendingReject = null;
    reject?.(Error('比較を停止しました'));
    $('gpuCompareStatus').textContent = '比較を停止しました。';
    sync(api.getConfig());
  }
  async function run(c, label, token, differences) {
    const card = document.createElement('section');
    card.className = 'comparison-card';
    const title = document.createElement('h3');
    title.textContent = label;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = c.resolution;
    canvas.setAttribute('aria-label', label + 'の画像');
    const note = document.createElement('p');
    note.className = 'hint';
    note.textContent = '計算中';
    card.append(title, canvas, note);
    $('gpuCompareImages').append(card);
    const diff = differences.view(canvas, label);
    const ctx = canvas.getContext('2d'),
      linear = new Float64Array(c.resolution ** 2 * 3);
    return new Promise((resolve, reject) => {
      pendingReject = reject;
      worker = RenderWorkers.create(api.build, c.computeBackend);
      worker.onerror = (e) => {
        worker?.terminate();
        worker = null;
        pendingReject = null;
        reject(Error(e.message || 'Workerエラー'));
      };
      worker.onmessage = ({ data: r }) => {
        if (token !== job) return;
        if (r.progressOnly) {
          $('gpuCompareStatus').textContent =
            'スペクトル計算中 ' +
            Math.round(100 * r.progress) +
            '% · ' +
            r.sample +
            '/' +
            r.sampleCount +
            '波長';
          return;
        }
        if (r.fatalError || r.build !== api.build) {
          worker?.terminate();
          worker = null;
          pendingReject = null;
          reject(Error(r.fatalError || '計算コードの版が一致しません'));
          return;
        }
        ctx.putImageData(new ImageData(r.pixels, c.resolution, r.rows), 0, r.y);
        linear.set(r.linearPixels, r.y * c.resolution * 3);
        $('gpuCompareStatus').textContent =
          label + ' ' + Math.round(100 * (r.progress ?? (r.y + r.rows) / c.resolution)) + '%';
        if (!r.done) return;
        worker.terminate();
        worker = null;
        pendingReject = null;
        note.textContent = runtime(r.stats) + '。' + detail(r.stats);
        resolve({
          diff,
          record: {
            label,
            config: c,
            milliseconds: r.ms,
            stats: r.stats,
            linearPixels: Array.from(linear),
            imagePng: canvas.toDataURL(),
          },
        });
      };
      worker.postMessage(c);
    });
  }
  function conditions(c) {
    const grin = Optics.polarization.isotropicGradient(c),
      varying = Optics.polarization.varying(c),
      scalar = c.material === 'isotropic' || grin;
    const indices = scalar
      ? (grin ? 'n₀=' : 'n=') + c.n
      : c.material === 'biaxial'
        ? 'nₓ=' + c.nx + '・nᵧ=' + c.ny + '・n𝓏=' + c.nz
        : ['shear', 'eng2013Magnetic', 'axial2013Uniaxial'].includes(c.material)
          ? '構成式で指定'
          : 'nₒ=' + c.no + '・nₑ=' + c.ne;
    const parts = [
      c.material,
      indices +
        (grin || ['common', 'quadratic', 'hyperbolic', 'axial2013Uniaxial'].includes(c.material)
          ? '・g=' + c.gradient
          : ''),
      { cube: '立方体', sphere: '球', torus: 'トーラス', slab: '平行平板' }[c.shape],
      c.resolution + ' px',
      '外部n=' + c.outsideN,
    ];
    if (!scalar && !['shear', 'eng2013Magnetic', 'axial2013Uniaxial'].includes(c.material))
      parts.push(
        '主軸' +
          c.tilt +
          '°・' +
          c.azimuth +
          '°' +
          (c.material === 'biaxial' ? '・回転' + c.roll + '°' : ''),
      );
    parts.push(
      '視点' + c.yaw + '°・' + c.pitch + '°',
      '計算法 ' + ({ auto: '自動', schur: '求積優先', rkf45: 'RKF45' }[c.solver] || c.solver),
    );
    if (c.material === 'heliconical') parts.push('回転率 ' + c.twist);
    if (c.material === 'shear') parts.push('変位 ' + c.shift);
    if (grin || varying) parts.push('交点探索の刻み ' + c.step);
    if (c.branchModel === 'coherent')
      parts.push(
        '位相を保持・' + c.coherentInterface,
        '波長 ' + c.wavelengthNm + ' nm',
        '1単位 ' + c.lengthUnitUm + ' μm',
        '光束半径 ' + c.beamRadiusUm + ' μm',
        '重なり閾値 ' + c.overlapCutoff,
        '内部最大 ' + c.branchDepth + '回',
        '偏光許容誤差 ' + c.phaseTolerance,
      );
    else if (c.branchPolicy !== 'off')
      parts.push(
        '内部 ' + c.branchModel,
        '分岐 ' + c.branchPolicy,
        '内部最大 ' + c.branchDepth + '回',
      );
    parts.push(
      '表面最大' + c.maxInterfaces + '回',
      '処理上限' + c.maxRayWork,
      '許容量' + 100 * c.untracedTolerance + '%',
      '微小光閾値' + c.minContribution,
    );
    if (Spectral.enabled(c))
      parts.push(Spectral.description(c), '診断件数は画素×波長、寄与の平均は波長の単純平均');
    return parts.join(' / ');
  }
  async function start() {
    if (active) return;
    const source = api.getConfig();
    if (!GPUOpticsSupport.support(source).ok) return;
    api.beforeStart();
    const token = ++job;
    active = true;
    report = {
      version: 2,
      build: api.build,
      sourceConfig: { ...source },
      complete: false,
      cases: [],
    };
    $('gpuCompareImages').replaceChildren();
    $('gpuCompareTableBody').replaceChildren();
    $('gpuDifference').textContent = '';
    sync(source);
    const c = {
      ...source,
      resolution: Number($('gpuCompareResolution').value),
      captureLinear: true,
    };
    $('gpuCompareConditions').textContent = conditions(c);
    const differences = ComparisonDifference.createGroup($('gpuCompareImages'), {
      reference: 'CPU（倍精度・基準）',
    });
    try {
      for (const [backend, label] of [
        ['cpu', 'CPU（倍精度・基準）'],
        ['gpu', 'WebGPU（単精度＋CPU再計算）'],
      ]) {
        const item = await run({ ...c, computeBackend: backend }, label, token, differences);
        if (token !== job) return;
        const result = item.record;
        report.cases.push(result);
        result.differenceImage = differences.set(
          item.diff,
          result.linearPixels,
          report.cases[0].linearPixels,
          c.resolution,
          result.stats.error === 0 && report.cases[0].stats.error === 0,
        );
        result.timing = {
          totalMs: result.milliseconds,
          gpuPreparationMs: result.stats.gpu.initializationMs ?? null,
          afterPreparationMs: result.milliseconds - (result.stats.gpu.initializationMs || 0),
          pipelineCacheHit: result.stats.gpu.pipelineCacheHit ?? null,
        };
        const s = result.stats,
          n = s.budgetPixels || c.resolution ** 2,
          row = document.createElement('tr');
        for (const text of [
          label,
          (result.milliseconds / 1000).toFixed(3) + '秒',
          result.timing.gpuPreparationMs === null
            ? '—'
            : (result.timing.gpuPreparationMs / 1000).toFixed(3) +
              '秒（' +
              (result.timing.pipelineCacheHit ? '再利用' : '初回準備') +
              '）',
          (result.timing.afterPreparationMs / 1000).toFixed(3) + '秒',
          ((100 * s.dropped) / n).toFixed(5) + '%',
          (100 * s.maxDropped).toFixed(5) + '%',
          s.weightError.toExponential(2),
          String(s.error),
          String(s.gpu?.gpuPixels || 0),
          String(s.gpu?.cpuPixels || 0),
        ]) {
          const cell = document.createElement('td');
          cell.textContent = text;
          row.append(cell);
        }
        $('gpuCompareTableBody').append(row);
      }
      const [a, b] = report.cases;
      let sum = 0,
        max = 0;
      for (let i = 0; i < a.linearPixels.length; i++) {
        const d = Math.abs(a.linearPixels[i] - b.linearPixels[i]);
        sum += d * d;
        max = Math.max(max, d);
      }
      report.difference = {
        linearRgbRMSE: Math.sqrt(sum / a.linearPixels.length),
        maxLinearRgbDifference: max,
      };
      report.valid = report.cases.every((r) => r.stats.error === 0);
      report.difference.valid = report.valid;
      report.complete = true;
      report.gpuActuallyUsed = b.stats.gpu.gpuPixels > 0;
      report.mediumGpuActuallyUsed = b.stats.gpu.objectPixels > 0;
      $('gpuDifference').textContent =
        'CPUとの差（線形RGB）：RMSE ' +
        report.difference.linearRgbRMSE.toExponential(3) +
        ' / 最大絶対差 ' +
        max.toExponential(3) +
        '。実行時間は初期化・転送・CPU再計算を含むWorker内の計算開始後の1回測定です。「準備後の処理」はGPU計算・転送・CPU再計算・結果集計を含みます。形状・材料モデル・内部輸送方式・ソルバーを変えると、シェーダを再コンパイルする場合があります。少ない画素ではCPUの方が速いこともあります。';
      $('gpuCompareStatus').textContent = report.mediumGpuActuallyUsed
        ? '比較完了。打切り量とCPU再計算数も確認してください。'
        : report.gpuActuallyUsed
          ? '比較完了。GPU処理は背景のみで、媒質をGPUで処理した画素は0です。CPU再計算数を確認してください。'
          : '比較完了。両方ともCPU計算です。切替理由を確認してください。';
      if (!report.valid) {
        $('gpuDifference').textContent = '条件外の画素があるため、差の比較は無効です。';
        $('gpuCompareStatus').textContent = '比較完了：条件外の理由と失敗寄与を確認してください。';
      }
    } catch (e) {
      if (token === job) $('gpuCompareStatus').textContent = '比較を終了：' + e.message;
    } finally {
      if (token === job) {
        active = false;
        sync(api.getConfig());
      }
    }
  }
  function init(options) {
    api = options;
    $('gpuCompareStart').onclick = start;
    $('gpuCompareCancel').onclick = cancel;
    $('gpuCompareSave').onclick = () => {
      if (report?.complete)
        api.download(
          new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
          'cpu-webgpu-comparison.json',
        );
    };
    probe(api.getConfig);
    sync(api.getConfig());
  }
  root.GPUBackendUI = { sync: syncBackend, runtime, detail };
  root.GPUComparison = { init, sync, cancel, getReport: () => report };
})(globalThis);
