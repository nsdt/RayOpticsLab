/* Paper settings are independent of the editable scene and comparisons. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const groupJA = {
    'iso-uniform': '均一等方性媒質',
    'uniaxial-uniform': '均一一軸異方性媒質',
    'iso-axial': '不均一等方性：軸方向分布',
    'iso-cylindrical': '不均一等方性：円柱対称分布',
    'iso-spherical': '不均一等方性：球対称分布',
    'axial-2013': '軸方向の対角計量',
    reciprocal: '逆二乗型スケール',
    quadratic: '二次型スケール',
    heliconical: '螺旋円錐状の光学軸',
    'radial-axis': '放射状の光学軸',
    shear: '軸方向のせん断変換',
    'spherical-map': '球対称の座標変換',
    'cylindrical-map': '円柱対称の座標変換',
    hyperbolic: '双曲型・線形スケール',
    'eng-2013': '不定符号の対角計量',
    'iso-uniform-dispersion': '均一等方性媒質の分散',
    'reciprocal-dispersion': '逆二乗型スケールの分散',
  };
  let catalog,
    provenance,
    worker,
    idleWorker,
    job = 0,
    result = null,
    progress = null,
    error = '',
    completed = false;
  const tr = (en, ja) => (globalThis.I18n?.language === 'ja' ? ja : en);
  const labels = {
    paperHeading: ['Reproduction of the visualization results', '論文に掲載した可視化結果の再現'],
    paperIntro: [
      'Calculate images with the material distribution, lens, camera and background specified in the manuscript. The default mode retains the published resolution and wavelength sampling and prefers GPU calculation. The archived double-precision CPU calculation remains available for comparison.',
      '論文の媒質分布・レンズ形状・カメラ・背景を用いて、観察される像を計算します。初期状態では掲載画像の解像度と波長分割数を保持し、GPUを優先します。比較用に、掲載画像に使用したCPU倍精度計算も選択できます。',
    ],
    paperGroupLabel: ['Figure and medium', '図番号と媒質'],
    paperCaseLabel: ['Panel and material parameters', '図中のパネルと媒質パラメータ'],
    paperQualityLabel: ['Image resolution', '画像の解像度'],
    paperExact: ['Restore manuscript resolution', '掲載画像の解像度に戻す'],
    paperSamplesLabel: ['Wavelength samples', '波長方向の分割数'],
    paperSamplesExact: ['Restore manuscript sampling', '掲載図と同じ分割数に戻す'],
    paperBackendLabel: ['Calculation device', '計算装置'],
    paperGPU: ['Prefer GPU; use CPU where required', 'GPUを優先（必要な条件ではCPU）'],
    paperCPU: ['CPU — double-precision reference', 'CPU（倍精度の基準計算）'],
    paperResolutionNote: [
      'Adjust calculation settings permits a square image from 4 to 1024 pixels per side and separate wavelength sampling for spectral examples. The restore buttons select the published sampling. Material and observation parameters remain fixed.',
      '「計算条件を変更して比較」では、画像の一辺を4〜1024画素で指定でき、分散例の波長分割数も選べます。復元ボタンで掲載時のサンプリングに戻ります。媒質と観察条件は固定されます。',
    ],
    paperRun: ['Calculate image', '選択した条件で画像を計算'],
    paperStop: ['Stop calculation', '計算を停止'],
    paperPNG: ['Save image (PNG)', '計算画像を保存（PNG）'],
    paperJSON: ['Save selected settings (JSON)', '選択中の設定を保存（JSON）'],
    paperDetailsTitle: ['Calculation settings and sampling', '計算条件とサンプリング'],
    paperDetailsNote: [
      'The published images were calculated with the archived double-precision CPU implementation. GPU ray tracing uses single precision, with RKF45 relative tolerance at least 1e-6 and position and momentum absolute tolerances at least 1e-7. The requested CPU tolerances are retained for pixels recalculated on CPU. Strong target discontinuities and failed precision checks require CPU recalculation. Weak uncertain target samples may remain on GPU within a cumulative linear-radiance budget of 1e-5 per pixel. Actual precision, CPU fallback counts and residuals are saved with each completed calculation.',
      '掲載画像は、保存済みのCPU実装を用いて倍精度で計算しています。GPUでは単精度を使用し、RKF45の相対許容誤差は1e-6以上、位置と運動量の絶対許容誤差は1e-7以上とします。CPUで再計算する画素には、元の厳しい許容誤差を使用します。寄与の大きい背景境界や精度判定を通らない画素はCPUで再計算します。背景境界付近の微弱な寄与は、画素ごとの線形輝度の不確かさの合計が1e-5以内の場合にGPU結果を採用します。実際の計算精度、CPU補完数、残差を完了画像の記録に保存します。',
    ],
    paperSampling: [
      'For rays that intersect the lens, one ray is evaluated at the center of each pixel. Where the lens does not obstruct the background, 12 × 12 samples per pixel are averaged in linear radiance. For spectral examples, the selected number of uniformly spaced wavelength midpoints spans 380–780 nm. Colors are integrated under D65 illumination using the CIE 1931 color-matching functions. The manuscript figures use 128 samples.',
      'レンズと交差する光線は、各画素の中心で評価します。レンズに遮られない背景では、1画素あたり12 × 12点をサンプリングし、線形輝度を平均します。分散を含む例では、380〜780 nmを指定した数の等幅区間に分け、各区間の中央波長で評価します。D65光源とCIE 1931等色関数を用いて色を積算します。掲載図では128分割を使用しています。',
    ],
    paperDiagnosticsNote: [
      'Omitted contribution is the ray weight discarded by the tracing limits, relative to an incident weight of 1. Spectral diagnostic counts include a separate evaluation for each pixel and wavelength.',
      '省略寄与は、入射光の重みを1としたときに、追跡の打ち切りによって評価しなかった寄与です。分散を含む計算の診断件数は、画素と波長の組ごとに数えます。',
    ],
    paperReferenceTitle: [
      'Figures from the article and supplement',
      '本文・補足資料の掲載図との比較',
    ],
    paperReferenceNote: [
      'Figures 1–9 belong to the article; Figures S1–S26 belong to Supplement 1. The experiment selector follows the complete series in Figures S2–S16, S18–S21 and S23. Representative images also appear in article Figures 2–4 and 7–9. Trajectory, difference and quantitative plots are available for comparison; their analysis scripts are included in the download above.',
      '図1〜9は本文、図S1〜S26は補足資料の掲載図です。実験の選択欄は、全条件を収録した補足資料の図S2〜S16・S18〜S21・S23に対応しています。代表画像は本文の図2〜4・7〜9にも掲載しています。軌跡、画像差分、定量解析の図も参照でき、追加解析のスクリプトは上のダウンロードに収録しています。',
    ],
    paperReferenceLabel: ['Figure to display', '表示する掲載図'],
    paperImageTitle: ['Calculated image', '選択した実験条件による計算画像'],
  };

  Object.assign(labels, {
    paperPreferred: ['Manuscript experiment — GPU preferred', '論文の実験条件（GPU優先）'],
    paperModeLabel: ['Calculation mode', '計算モード'],
    paperArchived: ['Archived CPU reference', '掲載画像と同じCPU基準計算'],
    paperCustom: ['Adjust calculation settings', '計算条件を変更して比較'],
    paperModeNote: [
      'Manuscript experiment keeps the published scene, image resolution and wavelength sampling, with GPU preferred where available. CPU reference restores the archived numerical implementation and tolerances. Adjust calculation settings also permits changes to image resolution and wavelength sampling.',
      '「論文の実験条件」では、掲載時の場面設定・解像度・波長分割数を保持し、利用可能な場合にGPUを優先します。「掲載画像と同じCPU基準計算」では、保存済みの計算実装と許容誤差を使用します。「計算条件を変更して比較」では、解像度や波長分割数も変更できます。',
    ],
    paperRestoreAll: ['Restore manuscript experiment', '論文の実験条件に戻す'],
    paperResultJSON: ['Save calculation record (JSON)', '計算結果と設定を保存（JSON）'],
    paperAnalysisTitle: [
      'Data and scripts for the quantitative results',
      '定量解析・独立検証のデータと再計算',
    ],
    paperAnalysisNote: [
      'The archive contains the trajectory records and original image arrays for all 80 conditions, together with the calculation scripts and data for article Figures 5–8, supplemental Figure S22, and the supporting numerical checks. It includes normalization by image size, the exact twist setting ω = π, and the direct/reflected radiance decomposition. Run these analyses with Python and Node.js as described in the archive; the image button recalculates camera images only.',
      '全80条件の代表軌道と元の画像配列に加え、本文の図5〜8、補足資料の図S22、および精度を確認する数値計算に対応する計算スクリプト・入力・測定データを収録しています。像の大きさによる正規化、ねじれω = πの条件、直接透過・反射成分の分離も含みます。定量解析と独立検証は、アーカイブの手順に従ってPythonとNode.jsで再計算します。画像計算ボタンの対象は、各条件のカメラ画像です。',
    ],
    paperAnalysisDownload: [
      'Download analysis code and data (ZIP)',
      '解析コードとデータをダウンロード（ZIP）',
    ],
  });

  function modeLabel(mode) {
    return mode === 'archived'
      ? tr('Archived CPU reference', '掲載画像と同じCPU基準計算')
      : mode === 'manuscript'
        ? tr('Manuscript experiment', '論文の実験条件')
        : tr('Adjusted calculation settings', '変更した計算条件');
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function selected() {
    return catalog.cases.find((c) => c.id === $('paperCase').value);
  }
  function displayLabel(c) {
    if (c.kind === 'constant') return tr('Wavelength-independent indices', '屈折率の分散なし');
    if (c.kind === 'spectral') return tr('Cauchy dispersion', 'Cauchy型の分散');
    return c.label
      .replace(/\^\\circ/g, '°')
      .replace('R_r', 'Rᵣ')
      .replace('r_i', 'rᵢ')
      .replace('g_a', 'gₐ')
      .replace(/\\theta/g, 'θ')
      .replace(/\\varphi/g, 'φ')
      .replace(/\\nu_o/g, 'νₒ')
      .replace(/\\omega/g, 'ω')
      .replace(/\\pi/g, 'π')
      .replace(/\\(?:mathrm|rm)\{([^}]+)\}/g, '$1')
      .replace(/[{}$]/g, '')
      .replace(/\\/g, '');
  }
  function updateReference() {
    const f = catalog.figures.find((f) => String(f.number) === $('paperReference').value);
    $('paperReferenceImage').src = f.file + '?sha256=' + f.sha256;
    $('paperReferenceImage').alt = tr('Manuscript Figure ', '論文の図 ') + f.number;
  }
  function outputRecipe() {
    return PaperSelection.create(catalog, $('paperCase').value, {
      mode: $('paperMode').value,
      resolution: +$('paperResolution').value,
      backend: $('paperBackend').value,
      samples: +$('paperSamples').value,
    });
  }
  function controlState(value = !!worker) {
    const mode = $('paperMode').value;
    for (const id of ['paperResolution', 'paperExact', 'paperSamples', 'paperSamplesExact'])
      $(id).disabled = value || mode !== 'custom';
    $('paperBackend').disabled = value || mode === 'archived';
  }
  function restoreAll() {
    $('paperMode').value = 'manuscript';
    $('paperBackend').value = navigator.gpu ? 'gpu' : 'cpu';
    updateRecipe();
  }
  function updateRecipe() {
    const c = selected(),
      q = c.config;
    if ($('paperMode').value !== 'custom') {
      if ($('paperMode').value === 'archived') $('paperBackend').value = 'cpu';
      $('paperResolution').value = q.resolution;
      if (c.kind !== 'mono') $('paperSamples').value = q.spectralSamples;
    }
    controlState();
    const n = +$('paperResolution').value;
    const spectral = c.kind !== 'mono',
      samples = +$('paperSamples').value,
      originalSamples = q.spectralSamples;
    $('paperSpectralControls').hidden = !spectral;
    if (spectral) {
      const step = (q.spectralMax - q.spectralMin) / samples;
      for (const option of $('paperSamples').options) {
        const count = +option.value,
          width = (q.spectralMax - q.spectralMin) / count;
        option.textContent =
          count +
          tr(' samples', '分割') +
          ' · ' +
          width +
          ' nm' +
          (count === originalSamples ? tr(' (manuscript)', '（掲載図）') : '');
      }
      $('paperSamplesExact').textContent =
        tr('Restore manuscript sampling', '掲載図と同じ分割数に戻す') + ' — ' + originalSamples;
      $('paperSamplesNote').textContent =
        (c.kind === 'spectral'
          ? tr(
              'Fewer samples reduce the number of wavelength-dependent ray traces and shorten the calculation. Coarse sampling can change colors near the checker and landmark edges. ',
              '分割数を減らすと、波長ごとの光線追跡の回数が減り、計算時間を短縮できます。ただし、チェッカーや目印の境界付近では色の出方が変わる場合があります。',
            )
          : tr(
              'With wavelength-independent indices, the background spectra are integrated before tracing. Ray tracing is performed once; reducing the sample count changes the color integration and has little effect on total calculation time. ',
              '屈折率の分散なしの場合は、背景の反射スペクトルを先に積算し、光線追跡を1回だけ行います。分割数の変更は色の積算に反映されますが、計算時間の短縮はわずかです。',
            )) +
        tr('The manuscript uses ', '掲載図は') +
        originalSamples +
        tr(' samples. Selected: ', '分割です。選択中：') +
        samples +
        tr(' samples, ', '分割、波長刻み') +
        step +
        ' nm. ' +
        tr(
          'Image resolution is unchanged. Numerical precision depends on the calculation device.',
          '画像の解像度は変更しません。数値精度は選択した計算装置によって異なります。',
        );
    }
    $('paperResolutionValue').textContent = n + ' × ' + n + tr(' pixels', '画素');
    const requested = $('paperBackend').value,
      policy = GPUOpticsSupport.support({
        ...q,
        computeBackend: requested,
        gpuPrecision: 'validated-f32',
      });
    $('paperBackendNote').textContent =
      requested === 'cpu'
        ? tr(
            'The archived double-precision CPU implementation will be used.',
            '保存済みの倍精度CPU実装で計算します。',
          )
        : !navigator.gpu
          ? tr(
              'WebGPU is unavailable in this browser. The image will be calculated on CPU.',
              'このブラウザではWebGPUを利用できないため、CPUで計算します。',
            )
          : !policy.ok
            ? tr(
                'The selected conditions require CPU calculation: ',
                '選択した条件ではCPUで計算します：',
              ) + (I18n?.translate(policy.reason) || policy.reason)
            : tr(
                'These conditions support GPU ray tracing, including inhomogeneous media in the aspherical lens. GPU uses single precision; unresolved pixels are recalculated with the archived CPU tolerances. Background sampling and wavelength accumulation use CPU. Numerical controls are described below.',
                '非球面レンズ内の不均一媒質を含め、この条件はGPUで光線追跡できます。GPUは単精度を使用し、精度判定を通らない画素は元の許容誤差でCPU再計算します。背景サンプリングと波長間の積算はCPUで行います。計算精度の詳細は下欄に示します。',
              );
    $('paperRecipeSummary').textContent =
      modeLabel($('paperMode').value) +
      '\n' +
      tr('Fig. ', '図 ') +
      c.figure +
      ' (' +
      c.panel +
      ') · ' +
      displayLabel(c) +
      '\n' +
      (c.mainLocations?.length
        ? tr('Also shown in the article: ', '本文での掲載箇所：') +
          c.mainLocations.map((l) => 'Fig. ' + l.figure + ' (' + l.panel + ')').join(', ') +
          '\n'
        : '') +
      tr('Original image: ', '論文用計算：') +
      q.resolution +
      ' × ' +
      q.resolution +
      tr(' pixels. Selected output: ', '画素。今回の出力：') +
      n +
      ' × ' +
      n +
      tr(' pixels', '画素') +
      (n === q.resolution
        ? tr(' (manuscript resolution).', '（掲載画像と同じ解像度）。')
        : tr(' (custom resolution).', '（指定した解像度）。')) +
      '\n' +
      (spectral
        ? tr('Wavelength sampling: ', '波長方向の分割数：') +
          samples +
          tr(' (manuscript: ', '（掲載図：') +
          originalSamples +
          ')\n'
        : '') +
      (q.paperDirectOnly
        ? tr(
            'This experiment includes directly transmitted light and excludes reflected paths.',
            'この実験では反射経路を除外し、直接透過する光を計算します。',
          )
        : tr(
            'Transmitted and reflected contributions are combined. Ray tracing uses the termination criteria specified for the manuscript experiment.',
            '透過光と反射光の寄与を合成します。光線の追跡には、論文の実験で指定した打ち切り条件を適用します。',
          )) +
      '\n' +
      tr(
        'The same lens geometry is used throughout: a plane front surface and an aspherical rear surface.',
        'レンズ形状は全条件で共通です。前面が平面、後面が非球面で構成されたレンズを使用します。',
      );
    $('paperConfig').textContent = JSON.stringify(outputRecipe().config, null, 2);
    $('paperExact').textContent =
      tr('Restore manuscript resolution', '掲載画像の解像度に戻す') +
      ' — ' +
      q.resolution +
      ' × ' +
      q.resolution;
    $('paperReference').value = String(c.figure);
    updateReference();
    $('paperSelectionNotice').textContent =
      result &&
      (result.id !== c.id ||
        result.execution.mode !== $('paperMode').value ||
        result.config.resolution !== n ||
        result.config.computeBackend !== requested ||
        (spectral && result.config.spectralSamples !== samples))
        ? tr(
            'The displayed image was calculated with the previous settings. Select Calculate image to apply the current selection.',
            '表示中の画像は変更前の条件で計算したものです。選択中の条件を反映するには、再度画像を計算してください。',
          )
        : '';
  }
  function populateCases(resetResolution = false) {
    const prior = $('paperCase').value;
    $('paperCase').replaceChildren();
    for (const c of catalog.cases.filter((c) => c.group === $('paperGroup').value))
      $('paperCase').add(new Option('(' + c.panel + ') ' + displayLabel(c), c.id));
    if ([...$('paperCase').options].some((o) => o.value === prior)) $('paperCase').value = prior;
    if (resetResolution) $('paperResolution').value = selected().config.resolution;
    updateRecipe();
  }
  function status() {
    if (error) {
      $('paperStatus').textContent =
        tr(
          'The image calculation could not be completed. Details: ',
          '画像の計算を完了できませんでした。詳細：',
        ) + (globalThis.I18n?.translate(error) || error);
      return;
    }
    if (!result) {
      $('paperStatus').textContent = tr(
        'Select a figure panel, then choose Calculate image to start the calculation.',
        '図中のパネルを選択し、「選択した条件で画像を計算」を押すと計算を開始します。',
      );
      return;
    }
    const p = progress || {},
      r = result,
      prefix = completed
        ? tr('Calculation complete', '画像の計算が完了しました')
        : worker
          ? tr('Calculating image', '画像を計算中')
          : tr(
              'Calculation stopped; the image is incomplete',
              '計算を停止しました。表示中の画像は計算途中のものです',
            );
    $('paperStatus').textContent =
      prefix +
      ' · ' +
      modeLabel(r.execution.mode) +
      ' · Fig. ' +
      r.figure +
      ' (' +
      r.panel +
      ') · ' +
      r.config.resolution +
      ' × ' +
      r.config.resolution +
      (r.kind !== 'mono'
        ? tr(' · Spectral samples: ', ' · 波長分割数：') + r.config.spectralSamples
        : '') +
      (p.backend ? ' · ' + p.backend : '') +
      ' · ' +
      Math.round((p.progress || 0) * 100) +
      '% · ' +
      ((p.ms || 0) / 1000).toFixed(1) +
      ' s' +
      (p.samples > 1
        ? tr(' · Wavelength samples: ', ' · 計算済み波長：') + p.sample + '/' + p.samples
        : '') +
      (p.verified
        ? '\n' +
          tr(
            'Archived CPU files and experiment settings verified.',
            '保存済みCPU実装と実験設定の照合が完了しました。',
          )
        : '') +
      (p.stats
        ? '\n' +
          tr('Failed pixel evaluations: ', '正常に完了しなかった画素評価数：') +
          p.stats.errors +
          ' · ' +
          tr('Maximum omitted contribution: ', '1画素評価あたりの最大省略寄与：') +
          p.stats.maxDropped.toExponential(2)
        : '') +
      (p.stats?.gpu
        ? '\n' +
          tr('Calculation device: ', '使用した計算装置：') +
          p.stats.gpu.actual +
          ' · GPU ' +
          p.stats.gpu.gpuPixels +
          ' / CPU ' +
          p.stats.gpu.cpuPixels +
          (p.stats.gpu.gpuPixels
            ? tr(
                ' ray evaluations; background sampling uses CPU.',
                '光線評価（背景サンプリングはCPU）。',
              )
            : '') +
          (p.stats.gpu.precision
            ? '\n' +
              tr(
                'GPU RKF45 tolerances (relative / absolute position / absolute momentum): ',
                'GPUのRKF45許容誤差（相対／位置絶対／運動量絶対）：',
              ) +
              [
                p.stats.gpu.precision.effectiveODE.odeRtol,
                p.stats.gpu.precision.effectiveODE.odeAtolPosition,
                p.stats.gpu.precision.effectiveODE.odeAtolMomentum,
              ]
                .map((x) => x.toExponential(0))
                .join(' / ') +
              ' · ' +
              tr('CPU supplementation: ', 'CPU補完：') +
              p.stats.gpu.cpuFallbackPixels +
              tr(' pixel evaluations.', '画素評価。')
            : '') +
          (p.stats.gpu.fallbackReason
            ? '\n' + (I18n?.translate(p.stats.gpu.fallbackReason) || p.stats.gpu.fallbackReason)
            : '')
        : '');
  }
  function busy(value) {
    for (const id of [
      'paperGroup',
      'paperCase',
      'paperMode',
      'paperRestoreAll',
      'paperResolution',
      'paperBackend',
      'paperExact',
      'paperSamples',
      'paperSamplesExact',
      'paperRun',
    ])
      $(id).disabled = value;
    $('paperStop').disabled = !value;
    $('paperPNG').disabled = value || !completed;
    $('paperResultJSON').disabled = value || !completed;
    controlState(value);
  }
  function stop() {
    job++;
    worker?.terminate();
    worker = null;
    busy(false);
    status();
  }
  function run() {
    stop();
    error = '';
    completed = false;
    progress = null;
    result = outputRecipe();
    const n = result.config.resolution,
      canvas = $('paperCanvas');
    canvas.width = n;
    canvas.height = n;
    canvas.hidden = false;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#152238';
    ctx.fillRect(0, 0, n, n);
    $('paperSelectionNotice').textContent = '';
    busy(true);
    const token = ++job;
    try {
      worker = idleWorker || new Worker('paper/worker.js?v=20261114-gpu-asphere1');
      idleWorker = null;
      worker.onmessage = ({ data: r }) => {
        if (token !== job) return;
        if (r.error) {
          error = r.error;
          stop();
          return;
        }
        if (r.pixels) ctx.putImageData(new ImageData(r.pixels, n, r.rows), 0, r.y);
        progress = { ...progress, ...r };
        if (r.done) {
          completed = true;
          progress.progress = 1;
          if (result.config.computeBackend === 'gpu') {
            idleWorker = worker;
            idleWorker.onmessage = null;
            idleWorker.onerror = () => {
              idleWorker?.terminate();
              idleWorker = null;
            };
          } else worker.terminate();
          worker = null;
          busy(false);
        }
        status();
      };
      worker.onerror = (e) => {
        if (token !== job) return;
        error = e.message;
        stop();
      };
      worker.postMessage(result);
      status();
    } catch (e) {
      error = e.message;
      stop();
    }
  }
  function localize() {
    for (const [id, pair] of Object.entries(labels)) $(id).textContent = tr(...pair);
    if (!catalog) return;
    const reference = $('paperReference').value;
    for (const option of $('paperGroup').options) {
      const g = catalog.groups.find((g) => g.id === option.value);
      option.textContent = tr('Fig. ', '図 ') + g.figure + ' · ' + tr(g.title, groupJA[g.id]);
    }
    populateCases();
    if (reference) {
      $('paperReference').value = reference;
      updateReference();
    }
    status();
    $('paperCanvas').setAttribute(
      'aria-label',
      tr(
        'Image calculated with the selected manuscript settings',
        '選択した論文の実験条件から計算した画像',
      ),
    );
  }
  async function init() {
    const panel = $('panel-paper');
    panel.classList.add('paper-panel');
    panel.setAttribute('data-own-i18n', '');
    panel.innerHTML =
      '<h2 id="paperHeading"></h2><p id="paperIntro" class="panel-intro"></p>' +
      '<div class="paper-mode"><label><span id="paperModeLabel"></span><select id="paperMode"><option value="manuscript" id="paperPreferred"></option><option value="archived" id="paperArchived"></option><option value="custom" id="paperCustom"></option></select></label><button type="button" id="paperRestoreAll"></button></div><p id="paperModeNote" class="hint"></p>' +
      '<div class="paper-controls"><label><span id="paperGroupLabel"></span><select id="paperGroup"></select></label>' +
      '<label><span id="paperCaseLabel"></span><select id="paperCase"></select></label>' +
      '<label><span id="paperBackendLabel"></span><select id="paperBackend"><option value="gpu" id="paperGPU"></option><option value="cpu" id="paperCPU"></option></select></label></div>' +
      '<div class="paper-resolution"><label><span id="paperQualityLabel"></span><output id="paperResolutionValue" for="paperResolution"></output><input type="range" id="paperResolution" min="4" max="1024" step="1" value="256"></label><button id="paperExact" type="button"></button></div><p id="paperBackendNote" class="hint"></p>' +
      '<p id="paperResolutionNote" class="hint"></p>' +
      '<div id="paperSpectralControls" hidden><div class="paper-sampling"><label><span id="paperSamplesLabel"></span><select id="paperSamples">' +
      [8, 16, 32, 64, 128, 256]
        .map(
          (n) =>
            '<option value="' + n + '"' + (n === 128 ? ' selected' : '') + '>' + n + '</option>',
        )
        .join('') +
      '</select></label><button id="paperSamplesExact" type="button"></button></div><p id="paperSamplesNote" class="hint"></p></div>' +
      '<p id="paperRecipeSummary" class="paper-summary"></p>' +
      '<div class="paper-actions"><button id="paperRun" type="button" disabled></button><button id="paperStop" type="button" disabled></button><button id="paperPNG" type="button" disabled></button><button id="paperJSON" type="button" disabled></button><button id="paperResultJSON" type="button" disabled></button></div>' +
      '<p id="paperStatus" role="status" aria-live="polite"></p><p id="paperSelectionNotice" class="hint"></p>' +
      '<h3 id="paperImageTitle"></h3><canvas id="paperCanvas" hidden></canvas>' +
      '<details><summary id="paperDetailsTitle"></summary><p id="paperDetailsNote" class="hint"></p><p id="paperSampling" class="hint"></p><p id="paperDiagnosticsNote" class="hint"></p><pre id="paperConfig" translate="no"></pre></details>' +
      '<details><summary id="paperAnalysisTitle"></summary><p id="paperAnalysisNote" class="hint"></p><a id="paperAnalysisDownload" href="paper/analysis-reproduction.zip" download></a></details>' +
      '<details class="paper-reference"><summary id="paperReferenceTitle"></summary><p id="paperReferenceNote" class="hint"></p>' +
      '<label><span id="paperReferenceLabel"></span><select id="paperReference"></select></label><img id="paperReferenceImage" loading="lazy" alt=""></details>';
    $('paperBackend').value = navigator.gpu ? 'gpu' : 'cpu';
    localize();
    try {
      const response = await fetch('paper/experiments.json?v=20261114-gpu-asphere1');
      if (!response.ok) throw Error('HTTP ' + response.status);
      catalog = await response.json();
      const proof = await fetch('paper/provenance.json?v=20261114-gpu-asphere1', {
        cache: 'no-store',
      });
      if (!proof.ok) throw Error('Cannot load manuscript provenance.');
      provenance = await proof.json();
      for (const g of catalog.groups)
        $('paperGroup').add(new Option('Fig. ' + g.figure + ' · ' + g.title, g.id));
      for (const f of catalog.figures)
        $('paperReference').add(new Option('Fig. ' + f.number, String(f.number)));
      localize();
      updateRecipe();
      $('paperRun').disabled = false;
      $('paperJSON').disabled = false;
      status();
    } catch (e) {
      error =
        tr(
          'The experiment settings could not be loaded. Reload the page. If you opened the local files directly, use the supplied application launcher. Details: ',
          '実験設定を読み込めませんでした。ページを再読み込みしてください。ローカルのファイルから直接開いている場合は、付属の起動ファイルでアプリを起動してください。詳細：',
        ) + e.message;
      status();
    }
    $('paperMode').onchange = () => {
      if ($('paperMode').value !== 'archived')
        $('paperBackend').value = navigator.gpu ? 'gpu' : 'cpu';
      updateRecipe();
    };
    $('paperRestoreAll').onclick = restoreAll;
    $('paperGroup').onchange = () => populateCases(true);
    $('paperCase').onchange = () => {
      $('paperResolution').value = selected().config.resolution;
      updateRecipe();
    };
    $('paperResolution').oninput = updateRecipe;
    $('paperBackend').onchange = updateRecipe;
    $('paperExact').onclick = () => {
      $('paperResolution').value = selected().config.resolution;
      updateRecipe();
    };
    $('paperReference').onchange = updateReference;
    $('paperSamples').onchange = updateRecipe;
    $('paperSamplesExact').onclick = () => {
      $('paperSamples').value = selected().config.spectralSamples;
      updateRecipe();
    };
    $('paperRun').onclick = run;
    $('paperStop').onclick = stop;
    $('paperPNG').onclick = () => {
      if (completed)
        $('paperCanvas').toBlob((b) =>
          download(
            b,
            result.id +
              '-' +
              result.config.computeBackend +
              '-n' +
              result.config.resolution +
              (result.kind !== 'mono' ? '-s' + result.config.spectralSamples : '') +
              '.png',
          ),
        );
    };
    $('paperJSON').onclick = () => {
      const recipe = outputRecipe(),
        record = PaperSelection.documentFor(catalog, provenance, recipe);
      download(
        new Blob([JSON.stringify(record, null, 2) + '\n'], { type: 'application/json' }),
        recipe.id + '-selected-settings.json',
      );
    };
    $('paperResultJSON').onclick = async () => {
      if (!completed) return;
      const snapshot = JSON.parse(JSON.stringify(result)),
        p = progress,
        canvas = $('paperCanvas');
      const bytes = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (v) =>
        v.toString(16).padStart(2, '0'),
      ).join('');
      const outcome = {
        completed: true,
        recordedAt: new Date().toISOString(),
        elapsedMilliseconds: p.ms,
        actualBackend: p.stats.gpu.actual,
        verifiedArchivedFiles: p.verified === true,
        stats: p.stats,
        image: {
          width: snapshot.config.resolution,
          height: snapshot.config.resolution,
          encoding: 'RGBA8 sRGB',
          sha256: hash,
        },
      };
      const record = PaperSelection.documentFor(
        catalog,
        p.provenance || provenance,
        snapshot,
        outcome,
      );
      download(
        new Blob([JSON.stringify(record, null, 2) + '\n'], { type: 'application/json' }),
        snapshot.id + '-calculation-record.json',
      );
    };
    document.addEventListener('languagechange', localize);
  }
  addEventListener('pagehide', () => {
    worker?.terminate();
    idleWorker?.terminate();
  });
  globalThis.PaperUI = { init };
})();
