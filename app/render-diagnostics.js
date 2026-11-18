/* Human-readable progress and diagnostics. Raw records stay unchanged. */
(function (root) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const pct = (value) => (100 * (value || 0)).toFixed(3) + '%';
  const exp = (value) => (value || 0).toExponential(2);
  const count = (value) => (value || 0).toLocaleString('ja-JP');

  function unit(stats) {
    return stats.spectral ? '画素×波長' : '画素';
  }
  function denominator(stats, c, r) {
    return stats.budgetPixels || c.resolution * (r.y + r.rows);
  }
  function progress(r) {
    if (!r.progressOnly) return false;
    $('progress').value = r.progress;
    $('status').textContent =
      '計算中 · ' + r.sample + '/' + r.sampleCount + ' 波長 · ' + r.wavelengthNm.toFixed(2) + ' nm';
    return true;
  }
  function budget(s, c, done) {
    $('budgetPanel').hidden = c.transport !== 'polarized';
    if (c.transport !== 'polarized') return;
    const n = s.budgetPixels || 1,
      u = unit(s),
      hit = s.hitPixels || 0;
    $('budgetStats').textContent =
      (done ? '追跡結果' : '追跡中') +
      '：追跡を省略する寄与の目安 ' +
      pct(c.untracedTolerance) +
      '。目安の超過・計算失敗 ' +
      count(s.overBudgetPixels) +
      ' / ' +
      count(n) +
      u +
      '。未評価の重み：物体と交差した光線に対応する' +
      u +
      'の平均 ' +
      (hit ? pct(s.hitUnresolved / hit) : '対象なし') +
      ' / 全' +
      u +
      'の最大 ' +
      pct(s.maxUnresolvedWeight) +
      '。';
    $('budgetStats').style.color = s.overBudgetPixels ? '#ffd18a' : '';
    const reasons = {
      threshold: '微小な光',
      interface: '表面の回数上限',
      internal: '内部の回数上限',
      work: '処理回数の上限',
      tolerance: '目安の範囲で終了',
    };
    $('budgetBreakdown').textContent =
      '追跡を省略した重み（全' +
      u +
      '平均）：' +
      Object.entries(reasons)
        .map(([key, label]) => label + ' ' + pct((s.cutoffWeights?.[key] || 0) / n))
        .join(' / ') +
      '。1' +
      u +
      'の処理数：平均 ' +
      ((s.processedRays || 0) / n).toFixed(1) +
      ' / 最大 ' +
      count(s.maxProcessedRays) +
      '、待機数の最大 ' +
      count(s.maxPendingRays) +
      '。未評価の重みには、計算が失敗した光線や伝播しない光線の寄与も含みます。光学モデルや数値計算そのものの誤差とは別です。';
  }
  function trace(s, c, n) {
    const items =
      c.transport === 'polarized'
        ? [
            '界面 ' + count(s.interfaces) + '回',
            '反射枝 ' + count(s.reflections) + '本',
            '内部分岐 ' + count(s.internalBranches) + '回',
            '最大界面回数 ' + count(s.maxDepth),
            '分配の収支誤差 ' + exp(s.fluxError),
            '省略した重み：平均 ' + pct(s.dropped / n) + ' / 最大 ' + pct(s.maxDropped),
            '計算失敗の重み ' + pct(s.failedWeight / n),
          ]
        : [
            '全反射 ' + count(s.tir),
            '伝播できない光線 ' + count(s['no-mode']),
            '追跡上限 ' + count(s.limit),
            '分岐 ' + count(s.branches),
            '重みの収支誤差 ' + exp(s.weightError),
          ];
    items.push('条件外 ' + count(s.error) + unit(s), '最大 |2H−1| ' + exp(s.drift));
    if (s.internalBranches)
      items.push(
        '媒質内の最大分岐回数 ' + count(s.maxInternalDepth),
        '非伝播の重み ' + pct(s.unavailableWeight / n),
      );
    if (c.material === 'biaxial')
      items.push('固有偏光の残差 ' + exp(s.fieldResidual), '四次式の残差 ' + exp(s.rootResidual));
    if (s.errorMessage) items.push(s.errorMessage);
    return items.join(' / ');
  }
  function methods(s, c, n) {
    const parts = [],
      e = s.evaluations;
    if (e)
      parts.push(
        '軌道の評価回数：閉式解 ' +
          count(e.closed) +
          ' / 積分表示の数値求積 ' +
          count(e.quadrature) +
          ' / ODE ' +
          count(e.ode) +
          ' / 小傾斜近似 ' +
          count(e.approximate) +
          ' / 層内の直線 ' +
          count(e.layered) +
          '。交点・分岐位置の探索も含みます。',
      );
    if (s.bulkSteps || s.bulkSegments)
      parts.push(
        '媒質内の処理：' + count(s.bulkSegments) + '区間 / ' + count(s.bulkSteps) + 'ステップ。',
      );
    if (c.branchModel === 'layers')
      parts.push(
        '均一層近似：' +
          count(s.layerSegments) +
          '区間。内部上限による省略 ' +
          pct(s.layerLimitWeight / n) +
          '、処理上限による省略 ' +
          pct(s.workLimitWeight / n) +
          '（全省略量に含む）。',
      );
    if (c.branchModel === 'modal' && c.branchPolicy !== 'off')
      parts.push(
        'モード分配：閉式解 ' +
          count(s.modalClosed) +
          ' / 求積 ' +
          count(s.modalQuadrature) +
          '。重みの収支誤差 ' +
          exp(s.modalWeightError) +
          '、求積誤差の目安 ' +
          exp(s.modalQuadratureError) +
          '。',
      );
    if (c.branchModel === 'coherent') {
      parts.push(
        '位相を含む輸送：' +
          count(s.coherentSegments) +
          '区間 / 光束の分離 ' +
          count(s.coherentSplits) +
          '回。分離上限で省略した重み ' +
          pct(s.coherentLimitWeight / n) +
          '。偏光強度の保存誤差 ' +
          exp(s.coherencyError) +
          '。',
      );
      parts.push(
        '位相輸送の評価：解析 ' +
          count(s.phaseClosed) +
          ' / 数値 ' +
          count(s.phaseNumerical) +
          '。積分誤差の目安 ' +
          exp(s.phaseIntegrationError) +
          '。界面で相関を保持 ' +
          count(s.phaseSurfaceRetentions) +
          '回 / 解消 ' +
          count(s.phaseSurfaceDephasings) +
          '回。経路の再利用 ' +
          count(s.phasePathCacheHits) +
          '。',
      );
      parts.push(
        '有限形状：表面での相関解消 ' +
          count(s.phaseBoundaryProjections) +
          '回、残る単独経路 ' +
          count(s.phaseBoundaryTails) +
          '本。条件外で単独モードで近似 ' +
          count(s.phaseAdiabaticSegments) +
          '区間 / 累計重み ' +
          pct(s.phaseAdiabaticWeight / n) +
          '（同じ光の再通過を含む）。再入射 ' +
          count(s.phaseReentries) +
          '回。',
      );
    }
    if (s.ode) {
      const a = s.ode,
        g = s.gpu || {};
      parts.push(
        'RKF45：CPUの採用 ' +
          count(a.accepted) +
          ' / 棄却 ' +
          count(a.rejected) +
          '、GPUの採用 ' +
          count(g.odeAccepted) +
          ' / 棄却 ' +
          count(g.odeRejected) +
          '。右辺評価 CPU ' +
          count(a.evaluations) +
          ' / GPU ' +
          count(g.odeEvaluations) +
          '。',
      );
    }
    if (s.exit?.calls)
      parts.push(
        '出口の再評価（CPU）：' +
          count(s.exit.calls) +
          '区間 / ' +
          count(s.exit.iterations) +
          '反復。表面残差の最大 ' +
          exp(s.exit.maxResidual) +
          '、方向の区間差の最大 ' +
          exp(s.exit.maxDirectionSpan) +
          '。',
      );
    if (s.spectral)
      parts.push(
        'スペクトル：件数は画素×波長、診断の平均は波長の単純平均です。画像の色はD65・等色関数で積分します。表示色域外 ' +
          count(s.spectral.clippedPixels) +
          '画素（表示のみクリップ）。',
      );
    return parts.join('\n');
  }
  function update(r, c) {
    const s = r.stats,
      n = denominator(s, c, r),
      backend = s.gpu?.actual || 'CPU';
    const spectral = s.spectral
      ? ' · ' +
        s.spectral.completed +
        '/' +
        s.spectral.total +
        '波長' +
        (r.done ? '' : '（途中の色）')
      : '';
    $('status').textContent =
      (r.done ? '完了' : '計算中') +
      ' · ' +
      (r.ms / 1000).toFixed(2) +
      ' 秒 · ' +
      c.resolution +
      ' × ' +
      c.resolution +
      ' px · ' +
      backend +
      spectral;
    $('traceStats').textContent = trace(s, c, n);
    $('methodStats').textContent = methods(s, c, n);
    $('backend').textContent = GPUBackendUI.runtime(s) + ' · build ' + r.build;
    $('gpuRuntime').hidden = c.computeBackend !== 'gpu';
    $('gpuRuntime').textContent = GPUBackendUI.detail(s);
    budget(s, c, r.done);
    const notices = [];
    if (s.error) notices.push('計算できなかった条件が ' + count(s.error) + unit(s) + 'あります。');
    if (s.overBudgetPixels)
      notices.push(
        '追跡を省略した光が設定の目安を超える箇所があります（最大 ' +
          pct(s.maxUnresolvedWeight) +
          '）。',
      );
    if (c.computeBackend === 'gpu' && r.done && !s.gpu?.gpuPixels)
      notices.push('この結果はCPUで計算しました。');
    $('renderWarning').hidden = !notices.length;
    $('renderWarning').textContent =
      notices.join(' ') + ' 詳細は「計算結果の詳細」で確認できます。';
  }
  root.RenderDiagnostics = { progress, update, budget, trace, methods, unit };
})(globalThis);
