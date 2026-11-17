/* Reproducible image comparisons within the existing adiabatic ray model. */
(function (root) {
  const $ = (id) => document.getElementById(id),
    labels = {
      auto: '閉形式を優先（条件外は求積・ODE）',
      schur: '積分表示の数値求積を優先',
      rkf45: 'Hamilton方程式のRKF45',
    };
  let api,
    job = 0,
    active = false,
    worker = null,
    rejectPending = null,
    report = null;
  const eligible = (c) =>
    ['common', 'quadratic'].includes(c.material) &&
    c.transport === 'polarized' &&
    !root.Optics.polarization.layered?.enabled(c) &&
    !root.Optics.polarization.coherent?.selected(c);
  function sync(c) {
    if ($('comparisonStale'))
      $('comparisonStale').hidden =
        !report || JSON.stringify({ ...c, preset: 'custom' }) === JSON.stringify(report.baseConfig);
    const ok = eligible(c);
    $('comparisonSection').hidden = false;
    $('compareGradients').disabled = $('compareSolvers').disabled = active || !ok;
    $('comparisonCancel').disabled = !active;
    $('comparisonSave').disabled = !report || !report.complete;
    $('comparisonHint').textContent = ok
      ? '現在の形状・配向・観察・背景・寄与表示を固定して比較します。画像の明るさは再正規化しません。まず64 pxを推奨します。'
      : 'Common-scaleの逆二乗／二次scaleが対象です。下の実験プリセットから条件を読み込めます。位相輸送・層近似を使う設定は、この比較の対象外です。';
  }
  function cancel() {
    if (!active) return;
    job++;
    active = false;
    worker?.terminate();
    worker = null;
    const reject = rejectPending;
    rejectPending = null;
    reject?.(Error('比較を停止しました。'));
    $('comparisonStatus').textContent = '比較を停止しました。完了した画像は比較開始時の設定です。';
    sync(api.getConfig());
  }
  function difference(a, b) {
    let sum = 0,
      max = 0;
    for (let i = 0; i < a.length; i++) {
      const d = Math.abs(a[i] - b[i]);
      sum += d * d;
      max = Math.max(max, d);
    }
    return { linearRgbRMSE: Math.sqrt(sum / a.length), linearRgbMax: max };
  }
  function saveRecord() {
    api.download(
      new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
      'common-scale-comparison.json',
    );
  }
  function drawCase(c, label, index, total, token, differences) {
    const card = document.createElement('section');
    card.className = 'comparison-card';
    const title = document.createElement('h3');
    title.textContent = label;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = c.resolution;
    canvas.setAttribute('aria-label', label + 'の比較画像');
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#101b27';
    ctx.fillRect(0, 0, c.resolution, c.resolution);
    const metrics = document.createElement('p');
    metrics.className = 'hint';
    metrics.textContent = '計算待ち';
    const diff = document.createElement('p');
    diff.className = 'hint comparison-difference';
    const load = document.createElement('button');
    load.textContent = 'この条件をメイン画面で開く';
    load.disabled = true;
    load.onclick = () => api.applyConfig({ ...c });
    card.append(title, canvas, metrics, diff, load);
    $('comparisonImages').append(card);
    const diffView = differences.view(canvas, label);
    const linear = new Float64Array(c.resolution * c.resolution * 3);
    return new Promise((resolve, reject) => {
      rejectPending = reject;
      worker = RenderWorkers.create(api.build, c.computeBackend);
      worker.onerror = (e) => {
        worker?.terminate();
        worker = null;
        rejectPending = null;
        reject(Error(e.message));
      };
      worker.onmessage = ({ data: r }) => {
        if (token !== job) return;
        if (r.progressOnly) {
          $('comparisonStatus').textContent =
            'スペクトル計算中 ' +
            Math.round(100 * r.progress) +
            '% · ' +
            r.sample +
            '/' +
            r.sampleCount +
            '波長';
          return;
        }
        if (r.fatalError) {
          worker?.terminate();
          worker = null;
          rejectPending = null;
          reject(Error(r.fatalError));
          return;
        }
        if (r.build !== api.build) {
          worker.terminate();
          worker = null;
          rejectPending = null;
          reject(Error('計算コードの版が一致しません。再読み込みしてください。'));
          return;
        }
        ctx.putImageData(new ImageData(r.pixels, c.resolution, r.rows), 0, r.y);
        linear.set(r.linearPixels, r.y * c.resolution * 3);
        $('comparisonStatus').textContent =
          `比較 ${index + 1}/${total}：${label} · ${Math.round(100 * (r.progress ?? (r.y + r.rows) / c.resolution))}%`;
        if (!r.done) return;
        worker.terminate();
        worker = null;
        rejectPending = null;
        const s = r.stats,
          e = s.evaluations,
          n = s.budgetPixels || c.resolution ** 2;
        metrics.textContent = `内部分岐 ${s.internalBranches || 0}回 / 最大深さ ${s.maxInternalDepth || 0} · 非伝播寄与 ${((100 * (s.unavailableWeight || 0)) / n).toFixed(4)}% · ${(r.ms / 1000).toFixed(2)}秒 · 条件外 ${s.error} · 失敗寄与 ${((100 * s.failedWeight) / n).toFixed(4)}% · 打切り 平均 ${((100 * s.dropped) / n).toFixed(3)}% / 最大 ${(100 * s.maxDropped).toFixed(3)}% · 界面収支誤差 ${s.fluxError.toExponential(1)} · 閉形式 ${e.closed} / 求積 ${e.quadrature} / ODE ${e.ode}`;
        metrics.textContent +=
          ' 未追跡の許容量超過・計算失敗 ' +
          (s.overBudgetPixels || 0) +
          '画素、最大未解決 ' +
          (100 * (s.maxUnresolvedWeight || 0)).toFixed(3) +
          '%。処理数上限による省略（全画素平均） ' +
          ((100 * (s.cutoffWeights?.work || 0)) / n).toFixed(3) +
          '%。';
        if (s.maxDropped > 0.01) {
          const warning = document.createElement('p');
          warning.className = 'hint';
          warning.textContent =
            '一部の画素に1%を超える打切り寄与があります。最大界面回数を増やした比較が必要です。';
          card.insertBefore(warning, diff);
        }
        load.disabled = false;
        resolve({
          linear,
          diff,
          diffView,
          record: {
            label,
            config: { ...c },
            milliseconds: r.ms,
            stats: s,
            linearPixels: Array.from(linear),
            imagePng: canvas.toDataURL('image/png'),
          },
        });
      };
      worker.postMessage({ ...c, captureLinear: true });
    });
  }
  async function start(kind) {
    const original = SceneConfig.customize(api.getConfig());
    if (!eligible(original)) return;
    const cases =
      kind === 'gradient'
        ? [0, 1 / 3, 2 / 3, 1].map((f) => ({
            label:
              f === 0
                ? 'g = 0（均質極限）'
                : 'g = ' + Number((original.gradient * f).toPrecision(5)),
            config: { ...original, gradient: original.gradient * f },
          }))
        : [
            { label: labels.auto, config: { ...original, solver: 'auto' } },
            { label: labels.schur, config: { ...original, solver: 'schur' } },
            { label: labels.rkf45, config: { ...original, solver: 'rkf45' } },
            {
              label: 'RKF45：許容誤差を1/10',
              config: {
                ...original,
                solver: 'rkf45',
                odeRtol: Math.max(1e-12, original.odeRtol / 10),
                odeAtolPosition: Math.max(1e-12, original.odeAtolPosition / 10),
                odeAtolMomentum: Math.max(1e-12, original.odeAtolMomentum / 10),
              },
            },
          ];
    try {
      if (kind === 'gradient' && Math.abs(original.gradient) < 1e-12)
        throw Error('勾配比較には、材料パラメータのgを0以外に設定してください。');
      cases.forEach((x) => root.Optics.polarization.validate(x.config));
    } catch (e) {
      $('comparisonStatus').textContent = e.message;
      return;
    }
    api.beforeStart();
    const token = ++job;
    active = true;
    report = {
      type: 'RayOpticsLab common-scale comparison',
      version: 1,
      build: api.build,
      complete: false,
      kind,
      baseConfig: original,
      metric: 'All-pixel linear RGB difference before 8-bit encoding; no image normalization.',
      cases: [],
    };
    $('comparisonImages').replaceChildren();
    $('comparisonStatus').textContent = '比較を開始しています…';
    const shapeName = { cube: '立方体', sphere: '球', torus: 'トーラス' }[original.shape],
      projectionName = original.projection === 'ortho' ? '平行投影' : '透視投影',
      backgroundName = {
        grid: 'チェック模様',
        uv: '連続座標パターン',
        markers: '白い十字',
        white: '全方向の一様白',
      }[original.background],
      viewName = {
        all: '全経路の合成',
        o: 'ordinary',
        e: 'extraordinary',
        reflected: '反射を経た経路',
      }[original.transportView];
    const profile = original.material === 'common' ? 'η(z)=(1+gz)⁻²' : 'η(z)=1+gz²';
    $('comparisonConditions').textContent =
      `比較開始時の条件：${profile}、nₒ₀=${original.no}、nₑ₀=${original.ne}（z=0）。${shapeName}、${original.resolution} px、軸傾斜${original.tilt}°・方位${original.azimuth}°、視点水平${original.yaw}°・仰角${original.pitch}°、${projectionName}、背景：${backgroundName}、表示：${viewName}、外部n=${original.outsideN}、最大${original.maxInterfaces}界面、最小寄与${original.minContribution}。`;
    const branches = root.Optics.branching.settings(original);
    $('comparisonConditions').textContent += branches.planes.length
      ? (original.branchModel === 'modal'
          ? ' 内部は位相差を省いた前方モード分配：z='
          : ' 内部は指定面で各0.5の仮定分岐：z=') +
        branches.planes.join(',') +
        '、最大深さ' +
        branches.branchDepth +
        '。'
      : ' 内部で光線の種類を切り替えません。';
    $('comparisonScope').textContent =
      kind === 'gradient'
        ? '0から現在のgまで4条件を計算します。nₒ₀・nₑ₀を固定するので、勾配を変えると表面の屈折率・反射透過率も変わります。画像の差には内部軌道と表面分配の両方が含まれます。'
        : '同じ媒質・同じ界面分配を使います。自動計算を比較基準とし、全画素の線形RGBのRMSEと最大差を表示します。これは計算法間の差で、物理モデルの正確さを保証しません。RKF45同士の許容誤差変更による差も表示します。';
    if (Spectral.enabled(original))
      $('comparisonConditions').textContent +=
        ' ' + Spectral.description(original) + '。件数＝画素×波長、寄与は波長の単純平均。';
    sync(original);
    root.WorkspaceUI?.show('trajectory');
    $('comparisonSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
    const completed = [],
      differences = ComparisonDifference.createGroup($('comparisonImages'), {
        reference: cases[0].label,
        gain: kind === 'gradient' ? 1 : 1000,
      });
    try {
      for (let i = 0; i < cases.length; i++) {
        const item = await drawCase(
          cases[i].config,
          cases[i].label,
          i,
          cases.length,
          token,
          differences,
        );
        if (token !== job) return;
        completed.push(item);
        report.cases.push(item.record);
        item.record.differenceImage = differences.set(
          item.diffView,
          item.linear,
          completed[0].linear,
          original.resolution,
          item.record.stats.error === 0 && completed[0].record.stats.error === 0,
        );
        if (kind === 'solver') {
          const metric = difference(item.linear, completed[0].linear);
          item.record.differenceFromAuto = metric;
          item.diff.textContent =
            i === 0
              ? '差の基準：自動計算'
              : `自動計算との差（線形RGB）：RMSE ${metric.linearRgbRMSE.toExponential(2)} / 最大 ${metric.linearRgbMax.toExponential(2)}`;
          if (i === 3) {
            const half = difference(item.linear, completed[2].linear);
            item.record.rkf45ToleranceDifference = half;
            item.diff.textContent += `。RKF45許容誤差変更の差：RMSE ${half.linearRgbRMSE.toExponential(2)} / 最大 ${half.linearRgbMax.toExponential(2)}`;
          }
        }
      }
      report.complete = true;
      $('comparisonStatus').textContent =
        '比較完了。画像・設定・診断値を「比較記録を保存」で保存できます。' +
        (report.cases.some((r) => r.stats.error)
          ? ' 条件外の光線があります。失敗寄与と計算条件を確認してください。'
          : '');
    } catch (e) {
      if (token === job) $('comparisonStatus').textContent = '比較エラー：' + e.message;
    } finally {
      if (token === job) {
        worker?.terminate();
        worker = null;
        rejectPending = null;
        active = false;
        sync(api.getConfig());
      }
    }
  }
  function init(callbacks) {
    api = callbacks;
    $('compareGradients').onclick = () => start('gradient');
    $('compareSolvers').onclick = () => start('solver');
    $('comparisonCancel').onclick = cancel;
    $('comparisonSave').onclick = saveRecord;
  }
  root.CommonScaleComparison = { init, sync, cancel, getReport: () => report };
})(globalThis);
