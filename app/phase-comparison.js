/* Snapshot-based one-pass image and numerical comparisons. All cases use the
 * same camera, background, resolution and unit exposure. Model differences are
 * distinguished from numerical convergence; no full-wave image claim. */
(function (root) {
  'use strict';
  const $ = (id) => document.getElementById(id),
    names = {
      common: 'Common-scale / reciprocal',
      quadratic: 'Common-scale / quadratic',
      heliconical: 'Heliconical',
      axial2013Uniaxial: '2013 axialの一軸媒質モデル',
    };
  let api,
    worker = null,
    rejectPending = null,
    active = false,
    job = 0,
    report = null;
  const eligible = (c) =>
    c.transport === 'polarized' &&
    c.branchModel === 'coherent' &&
    ['slab', 'cube', 'sphere', 'torus'].includes(c.shape) &&
    Object.hasOwn(names, c.material);
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
  function profile(a, n) {
    const row = Math.floor(n / 2);
    return Array.from({ length: n }, (_, x) => {
      const i = (row * n + x) * 3;
      return 0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2];
    });
  }
  function cases(c, kind, n) {
    c = SceneConfig.customize(c);
    if (c.shape !== 'slab') {
      const base = {
        ...c,
        preset: 'custom',
        resolution: n,
        transportView: 'all',
        captureLinear: true,
        coherentInterface: 'finite-resolved',
      };
      if (kind === 'shapes')
        return ['cube', 'sphere', 'torus'].map((shape, i) => ({
          label:
            String.fromCharCode(65 + i) +
            '：' +
            { cube: '立方体', sphere: '球', torus: 'トーラス' }[shape],
          note: '同じ媒質・視点・座標スケール。表面と光路長は形状ごとに異なります。',
          config: { ...base, shape },
        }));
      if (kind === 'accuracy')
        return [
          {
            label: 'A：閉式解を優先',
            note: '曲線軌道と局所表面を計算。',
            config: { ...base, solver: 'auto' },
          },
          {
            label: 'B：RKF45・高精度',
            note: '同じ有限形状と分配近似で軌道の数値差を確認。',
            config: {
              ...base,
              solver: 'rkf45',
              odeRtol: Math.max(1e-12, (c.odeRtol ?? 1e-6) / 10),
              odeAtolPosition: Math.max(1e-12, (c.odeAtolPosition ?? 1e-7) / 10),
              odeAtolMomentum: Math.max(1e-12, (c.odeAtolMomentum ?? 1e-7) / 10),
            },
          },
          {
            label: 'C：偏光積分を細かく',
            note: 'Aと同じ軌道。偏光の許容誤差を1/10に設定。',
            config: {
              ...base,
              solver: 'auto',
              phaseTolerance: Math.max(1e-8, c.phaseTolerance / 10),
              phaseSlices: Math.min(256, Math.max(8, c.phaseSlices * 2)),
            },
          },
        ];
      const key = kind === 'width' ? 'beamRadiusUm' : 'overlapCutoff',
        values =
          kind === 'width'
            ? [c.beamRadiusUm / 2, c.beamRadiusUm, c.beamRadiusUm * 2]
            : [c.overlapCutoff / 10, c.overlapCutoff, c.overlapCutoff * 10];
      return values.map((value, i) => ({
        label:
          String.fromCharCode(65 + i) +
          '：' +
          (kind === 'width' ? '光束半径 ' : '分離閾値 ') +
          value.toPrecision(4) +
          (kind === 'width' ? ' μm' : ''),
        note: '有限形状での光束分離の仮定への感度。',
        config: { ...base, [key]: value },
      }));
    }
    const base = {
      ...c,
      preset: 'custom',
      resolution: n,
      transportView: 'all',
      maxInterfaces: 2,
      captureLinear: true,
    };
    if (kind === 'interfaces')
      return [
        {
          label: 'A：界面で相関を保持',
          note: '共通光束：入口・出口とも相関を保持。二本の軌道の中点で背景を評価。',
          config: { ...base, coherentInterface: 'coupled' },
        },
        {
          label: 'B：界面で相関を除去',
          note: 'Aと同じ共通光束・同じ背景評価位置。入口・出口で相関を捨てる影響を比較。',
          config: { ...base, coherentInterface: 'coupled-dephased' },
        },
        {
          label: 'C：従来の独立光線',
          note: '各o/e位置で背景を評価。Aとの差には偏光と空間的な扱いの両方が含まれる。',
          config: { ...base, coherentInterface: 'resolved' },
        },
      ];
    if (kind === 'accuracy')
      return [
        {
          label: 'A：閉式解を優先',
          note: '閉式解の条件外はSchur求積。界面は相関保持。',
          config: { ...base, coherentInterface: 'coupled', solver: 'auto' },
        },
        {
          label: 'B：軌道をRKF45で確認',
          note: 'ODE許容誤差は現在の設定の1/10。偏光設定はAと共通。',
          config: {
            ...base,
            coherentInterface: 'coupled',
            solver: 'rkf45',
            odeRtol: Math.max(1e-12, (c.odeRtol ?? 1e-6) / 10),
            odeAtolPosition: Math.max(1e-12, (c.odeAtolPosition ?? 1e-7) / 10),
            odeAtolMomentum: Math.max(1e-12, (c.odeAtolMomentum ?? 1e-7) / 10),
          },
        },
        {
          label: 'C：偏光積分を細かく',
          note: 'Aと同じ軌道。許容誤差を1/10、初期分割を増やす（下限10⁻⁸・上限256分割）。',
          config: {
            ...base,
            coherentInterface: 'coupled',
            solver: 'auto',
            phaseTolerance: Math.max(1e-8, c.phaseTolerance / 10),
            phaseSlices: Math.min(256, Math.max(8, c.phaseSlices * 2)),
          },
        },
      ];
    const key = kind === 'width' ? 'beamRadiusUm' : 'overlapCutoff',
      values =
        kind === 'width'
          ? [c.beamRadiusUm / 2, c.beamRadiusUm, c.beamRadiusUm * 2]
          : [c.overlapCutoff / 10, c.overlapCutoff, c.overlapCutoff * 10];
    return values.map((value, i) => ({
      label:
        String.fromCharCode(65 + i) +
        '：' +
        (kind === 'width'
          ? '光束半径 ' + value.toPrecision(4) + ' μm'
          : '分離閾値 ' + value.toPrecision(4)),
      note: '従来の独立光線方式で、光束分離の仮定への感度を比較。閾値は数値誤差ではありません。',
      config: { ...base, coherentInterface: 'resolved', [key]: value },
    }));
  }
  function sync(c) {
    if (!api) return;
    const ok = eligible(c);
    $('phaseCompareJump').hidden = !ok;
    $('phaseComparisonSection').hidden = false;
    $('phaseCompareStart').disabled = active || !ok;
    $('phaseCompareKind').disabled = active;
    $('phaseCompareResolution').disabled = active;
    $('phaseCompareCancel').disabled = !active;
    $('phaseCompareSave').disabled = !report?.complete;
    const finite = c.shape !== 'slab';
    for (const option of $('phaseCompareKind').options)
      option.disabled =
        option.value === 'interfaces' ? finite : option.value === 'shapes' ? !finite : false;
    if ($('phaseCompareKind').selectedOptions[0]?.disabled)
      $('phaseCompareKind').value = finite ? 'shapes' : 'interfaces';
    $('phaseCompareHint').textContent =
      ok && finite
        ? '現在の媒質・視点・背景で比較します。有限形状では現在の最大界面回数を使用し、内部反射とトーラスへの再入射も追跡します。'
        : ok
          ? '現在の媒質・視点・背景を使用します。比較では、入口と出口を一回ずつ通過する条件にそろえ、すべての光を同じ露光条件で合成します。出口から内部へ反射した光は追跡せず、未追跡寄与として記録します。'
          : '比較には、4種のz依存一軸媒質・位相を含む連続輸送を選んでください。';
    $('phaseCompareStale').hidden =
      !report || JSON.stringify(c) === JSON.stringify(report.sourceConfig);
  }
  function cancel() {
    if (!active) return;
    ++job;
    active = false;
    worker?.terminate();
    worker = null;
    const reject = rejectPending;
    rejectPending = null;
    reject?.(Error('比較を停止しました'));
    $('phaseCompareStatus').textContent = '比較を停止しました。完了済みの画像だけを残しています。';
    sync(api.getConfig());
  }
  const fmt = (x) => (Number.isFinite(x) ? x.toExponential(3) : '—'),
    pct = (x) => (Number.isFinite(x) ? (100 * x).toFixed(6) + '%' : '—');
  function plot(canvas, values) {
    const ctx = canvas.getContext('2d'),
      w = canvas.width,
      h = canvas.height;
    ctx.fillStyle = '#0b1520';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#476070';
    ctx.beginPath();
    ctx.moveTo(32, 12);
    ctx.lineTo(32, h - 24);
    ctx.lineTo(w - 12, h - 24);
    ctx.stroke();
    ctx.fillStyle = '#aec5d5';
    ctx.font = '12px sans-serif';
    ctx.fillText('1', 12, 18);
    ctx.fillText('0', 12, h - 24);
    ctx.fillText('0', 32, h - 7);
    ctx.fillText(String(values.length - 1), w - 33, h - 7);
    ctx.strokeStyle = '#79e1cd';
    ctx.beginPath();
    values.forEach((y, i) => {
      const x = 32 + (i / (values.length - 1)) * (w - 44),
        v = h - 24 - Math.max(0, Math.min(1, y)) * (h - 36);
      if (i) ctx.lineTo(x, v);
      else ctx.moveTo(x, v);
    });
    ctx.stroke();
  }
  function card(item, i, total, token, differences) {
    const c = item.config,
      el = document.createElement('section');
    el.className = 'comparison-card';
    const title = document.createElement('h3');
    title.textContent = item.label;
    const note = document.createElement('p');
    note.className = 'hint phase-card-description';
    note.textContent = item.note;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = c.resolution;
    canvas.setAttribute('aria-label', item.label + 'の比較画像');
    const ctx = canvas.getContext('2d');
    const metrics = document.createElement('p');
    metrics.className = 'hint phase-card-metrics';
    metrics.textContent = '計算待ち';
    const line = document.createElement('canvas');
    line.className = 'phase-profile';
    line.width = 480;
    line.height = 150;
    line.setAttribute('aria-label', item.label + 'の中央行の輝度');
    const lineLabel = document.createElement('p');
    lineLabel.className = 'hint phase-profile-label';
    lineLabel.textContent = '中央行の線形輝度：横軸は画素位置、縦軸0〜1（全条件共通）';
    const actions = document.createElement('div');
    actions.className = 'comparison-actions';
    const open = document.createElement('button');
    open.textContent = 'この条件をメイン画面へ';
    open.disabled = true;
    open.onclick = () => api.applyConfig({ ...c, captureLinear: false });
    const png = document.createElement('button');
    png.textContent = '画像を保存';
    png.disabled = true;
    png.onclick = () =>
      canvas.toBlob((b) => api.download(b, 'phase-comparison-' + (i + 1) + '.png'));
    actions.append(open, png);
    el.append(title, note, canvas, metrics, lineLabel, line, actions);
    const diff = differences.view(canvas, item.label);
    $('phaseCompareImages').append(el);
    const linear = new Float64Array(c.resolution ** 2 * 3);
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
          $('phaseCompareStatus').textContent =
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
          rejectPending = null;
          reject(Error('計算コードの版が一致しません'));
          return;
        }
        ctx.putImageData(new ImageData(r.pixels, c.resolution, r.rows), 0, r.y);
        linear.set(r.linearPixels, r.y * c.resolution * 3);
        $('phaseCompareStatus').textContent =
          `${i + 1}/${total} ${item.label}：${Math.round(100 * (r.progress ?? (r.y + r.rows) / c.resolution))}%`;
        if (!r.done) return;
        worker.terminate();
        worker = null;
        rejectPending = null;
        const s = r.stats;
        metrics.textContent =
          `条件外 ${s.error}画素。軌道：閉式解 ${s.evaluations.closed}／求積 ${s.evaluations.quadrature}／ODE ${s.evaluations.ode}。偏光積分の誤差目安 ${fmt(s.phaseIntegrationError || 0)}。` +
          (c.coherentInterface.startsWith('coupled')
            ? ' 最小光束重なり ' + (s.phaseMinOverlap ?? 1).toPrecision(6) + '。'
            : ' 光束分離 ' + (s.coherentSplits || 0) + '回。') +
          (s.errorMessage ? ' ' + s.errorMessage : '');
        if (c.shape !== 'slab')
          metrics.textContent +=
            ' 表面接触による分離 ' +
            (s.phaseBoundaryProjections || 0) +
            '回／単独モードでの近似 ' +
            (s.phaseAdiabaticSegments || 0) +
            '区間／再入射 ' +
            (s.phaseReentries || 0) +
            '回。';
        metrics.textContent +=
          ' 許容量超過・計算失敗 ' +
          (s.overBudgetPixels || 0) +
          '画素、未評価の重みの最大値 ' +
          pct(s.maxUnresolvedWeight || 0) +
          '。打ち切り内訳（全画素平均）：' +
          Object.entries({
            threshold: '微小光',
            interface: '表面上限',
            internal: '内部上限',
            work: '処理上限',
            tolerance: '許容量内終了',
          })
            .map(
              ([k, label]) =>
                label +
                ' ' +
                pct((s.cutoffWeights?.[k] || 0) / (s.budgetPixels || c.resolution ** 2)),
            )
            .join(' / ') +
          '。';
        if (s.centerTransmitStokes) {
          const S = s.centerTransmitStokes.S;
          metrics.textContent +=
            ' 中央画素の透過偏光 (Q,U,V)/I = (' +
            S.slice(1)
              .map((v) => (S[0] > 0 ? (v / S[0]).toFixed(5) : '—'))
              .join(', ') +
            ')。';
        }
        open.disabled = png.disabled = false;
        const values = profile(linear, c.resolution);
        plot(line, values);
        resolve({
          linear,
          diff,
          record: {
            label: item.label,
            note: item.note,
            config: { ...c },
            milliseconds: r.ms,
            stats: s,
            centerRow: Math.floor(c.resolution / 2),
            luminanceProfile: values,
            linearPixels: Array.from(linear),
            imagePng: canvas.toDataURL(),
          },
        });
      };
      worker.postMessage(c);
    });
  }
  function table(record, index) {
    const s = record.stats,
      n = s.budgetPixels || record.config.resolution ** 2,
      row = document.createElement('tr'),
      T = (record.config.shape === 'slab' ? s.phaseTransmitted : s.phaseEscapedDirect || 0) / n,
      R = (record.config.shape === 'slab' ? s.phaseReflected : s.phaseEscapedReflected || 0) / n;
    const values = [
      record.label,
      pct(T),
      pct(R),
      pct(s.dropped / n),
      fmt(s.weightError),
      (record.milliseconds / 1000).toFixed(3) + ' s',
      record.differenceFromA ? fmt(record.differenceFromA.linearRgbRMSE) : '条件外',
      String(s.error),
    ];
    for (const value of values) {
      const td = document.createElement('td');
      td.textContent = value;
      row.append(td);
    }
    $('phaseCompareTableBody').append(row);
    record.means = {
      transmitted: T,
      entryReflected: record.config.shape === 'slab' ? R : null,
      reflected: R,
      quantity:
        record.config.shape === 'slab'
          ? 'single-pass slab T / entrance R'
          : 'escaped without / with a reflection; includes unobstructed background',
      untraced: s.dropped / n,
      failed: s.failedWeight / n,
    };
  }
  async function start() {
    if (!eligible(api.getConfig())) return;
    const original = { ...api.getConfig() },
      kind = $('phaseCompareKind').value,
      n = Number($('phaseCompareResolution').value),
      items = cases(original, kind, n);
    try {
      items.forEach((v) => root.Optics.polarization.validate(v.config));
    } catch (e) {
      $('phaseCompareStatus').textContent = '比較条件を確認してください：' + e.message;
      return;
    }
    api.beforeStart();
    const token = ++job;
    active = true;
    report = {
      type: 'RayOpticsLab phase interface comparison',
      version: 1,
      settingsVersion: 11,
      build: api.build,
      complete: false,
      valid: false,
      kind,
      sourceConfig: original,
      conditions:
        'Single traversal, two surface encounters, unpolarized input, common exposure. Exit-reflected power remains untraced. External round-trip interference excluded.',
      metric:
        'Linear RGB difference before 8-bit quantization. Common-carrier model differences are not full-wave image error.',
      cases: [],
    };
    $('phaseCompareImages').replaceChildren();
    $('phaseCompareTableBody').replaceChildren();
    $('phaseCompareConditions').textContent =
      `比較開始時：${names[original.material]}、${n} px、視点${original.yaw}°／${original.pitch}°、光軸${original.tilt}°／${original.azimuth}°、${original.projection === 'ortho' ? '平行' : '透視'}投影、背景 ${original.background}、外部n=${original.outsideN}、厚さ${2 * original.lengthUnitUm} μm、波長${original.wavelengthNm} nm。入口反射と一回通過の透過を同じ露光で合成。中央画素の偏光は、外部の伝播方向に直交する共通の計算基底で表示（実験室x/yの成分ではありません）。`;
    $('phaseCompareScope').textContent =
      kind === 'interfaces'
        ? 'AとBは同じ共通光束の位置を使用し、表面で相関を捨てる影響を比較します。Cは従来の二本の光線で、空間的な扱いも異なります。共通光束では二本の軌道の中点に像を代表させる追加近似があり、細かな背景の二重像を正確に予測する保証はありません。'
        : kind === 'accuracy'
          ? '同じ物理モデルで軌道と偏光積分の数値精度を確認します。Aとの差は計算法間の差で、物理モデルの誤差ではありません。'
          : '光束の分離条件を変えたときに、像がどの程度変化するかを調べます。像に変化がなければ、その条件では分離判定が結果に影響していない可能性があります。光束幅や閾値を小さくしても、波動光学の解に収束するとは限りません。';
    if (original.shape !== 'slab') {
      report.conditions =
        'Finite boundary, local eigenray interfaces; current interface limit; external re-entry enabled. Common-z phase transport ends at first boundary contact. Adiabatic fallback is counted.';
      $('phaseCompareConditions').textContent =
        `比較開始時：${names[original.material]}、${n} px、視点${original.yaw}°／${original.pitch}°、光軸${original.tilt}°／${original.azimuth}°、座標1単位${original.lengthUnitUm} μm、波長${original.wavelengthNm} nm、最大界面${original.maxInterfaces}回。背景を含む全画素の平均。形状以外は各カードの条件に従います。`;
      $('phaseCompareScope').textContent =
        kind === 'shapes'
          ? '形状による像と明るさの比較です。同じ外形の大きさ・体積・光路長にそろえた比較ではありません。内部では解析軌道を優先し、表面で固有光線へ分ける近似を使います。z折り返し等で単独モードにした区間数も各画像に表示します。'
          : '同じ有限形状での数値条件または光束分離の仮定への感度を確認します。表面での相関解消と単独モード近似は共通です。';
    }
    const finite = original.shape !== 'slab';
    $('phasePowerA').textContent = finite ? '反射なしで背景へ' : '一回透過T';
    $('phasePowerB').textContent = finite ? '反射後に背景へ' : '入口反射R';
    $('phasePowerNote').textContent = finite
      ? '強度比は物体に当たらない背景光も含む全画素平均です。反射なし＋反射あり＋未追跡＋計算失敗の収支を確認します。反射なしの値は試料の透過率ではありません。'
      : 'T・Rは背景色によらない流束比です。T＋入口反射R＋未追跡＋計算失敗の収支を確認します。';
    if (Spectral.enabled(original)) {
      $('phaseCompareConditions').textContent +=
        ' スペクトル設定：' +
        Spectral.description(original) +
        '。上記の単色波長に代えて各サンプル波長を使用します。中央Stokesは波長ごとに記録し、ここでは平均しません。';
      $('phasePowerNote').textContent +=
        ' スペクトル時のT・R・打ち切りは画素と波長の単純平均です。画像の色はD65・等色関数で積分します。件数は画素×波長です。';
    }
    sync(original);
    root.WorkspaceUI?.show('polarization');
    $('phaseComparisonSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
    const done = [],
      differences = ComparisonDifference.createGroup($('phaseCompareImages'), {
        reference: items[0].label,
        gain: kind === 'shapes' ? 1 : 1000,
      });
    try {
      for (let i = 0; i < items.length; i++) {
        const v = await card(items[i], i, items.length, token, differences);
        if (token !== job) return;
        done.push(v);
        const valid = v.record.stats.error === 0 && done[0].record.stats.error === 0;
        v.record.differenceFromA = valid ? difference(v.linear, done[0].linear) : null;
        v.record.differenceImage = differences.set(v.diff, v.linear, done[0].linear, n, valid);
        report.cases.push(v.record);
        table(v.record, i);
      }
      report.complete = true;
      report.valid = report.cases.every((v) => v.stats.error === 0);
      $('phaseCompareStatus').textContent = report.valid
        ? '比較完了。画像・線形RGB・中央行プロファイル・設定・診断値を保存できます。'
        : '比較完了：条件外の画素があります。該当画像の誤差比較は無効です。条件外の理由と失敗寄与を記録しています。';
    } catch (e) {
      if (token === job) $('phaseCompareStatus').textContent = '比較エラー：' + e.message;
    } finally {
      if (token === job) {
        active = false;
        worker?.terminate();
        worker = null;
        rejectPending = null;
        sync(api.getConfig());
      }
    }
  }
  function init(callbacks) {
    api = callbacks;
    $('phaseCompareStart').onclick = start;
    $('phaseCompareCancel').onclick = cancel;
    $('phaseCompareSave').onclick = () =>
      api.download(
        new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
        'phase-interface-comparison.json',
      );
  }
  root.PhaseComparison = {
    init,
    sync,
    cancel,
    eligible,
    cases,
    difference,
    profile,
    start,
    getReport: () => report,
  };
})(globalThis);
