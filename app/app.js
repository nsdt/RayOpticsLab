const APP_BUILD = '20261118-english1';
const $ = (id) => document.getElementById(id);
let config = SceneConfig.standard(),
  worker = null,
  finished = false,
  renderGeneration = 0,
  lastResult = null;
const visible = $('view'),
  buffer = document.createElement('canvas'),
  renderContext = buffer.getContext('2d'),
  display = visible.getContext('2d');
if (!renderContext || !display) throw Error('Canvas 2Dを初期化できませんでした');
$('backend').textContent = 'Canvas 2D表示 / Worker計算';
function paint() {
  display.drawImage(buffer, 0, 0, visible.width, visible.height);
}
// WebViews may retain a stale canvas surface after a hidden tab is revealed.
// Refresh from the render buffer only after the visible layout is available.
function refreshRenderView() {
  if (document.getElementById('panel-render')?.hidden) return;
  const box = visible.getBoundingClientRect();
  if (!(box.width > 0 && box.height > 0)) return;
  visible.width = buffer.width;
  visible.height = buffer.height;
  paint();
}
new ResizeObserver(() => requestAnimationFrame(refreshRenderView)).observe(visible.parentElement);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) requestAnimationFrame(refreshRenderView);
});

const spec = SceneConfig.parameters;
const groups = Object.fromEntries(
  Object.entries(MaterialCatalog.models).map(([k, v]) => [k, v.params]),
);
const notes = MaterialNotes;
function initCatalog() {
  MaterialPicker.init(() => config);
  for (const [id, label] of Object.entries(MaterialCatalog.types))
    $('materialType').append(new Option(label, id));
}
function customize() {
  config = SceneConfig.customize(config);
  sync();
  dirty();
}
function sliders(target, keys) {
  $(target).replaceChildren();
  for (const key of keys) {
    const [name, min, max, step] =
        key === 'backgroundZ'
          ? [spec[key][0], ...(config.cameraSide === 'negative' ? [2, 6] : [-6, -2]), 0.1]
          : spec[key],
      label = document.createElement('label'),
      row = document.createElement('div'),
      number = document.createElement('input'),
      input = document.createElement('input');
    const parameterName =
      config.material === 'biaxial' && key === 'tilt'
        ? '第3主軸の傾き（＋zから）°'
        : config.material === 'biaxial' && key === 'azimuth'
          ? '第3主軸の方位角 °'
          : name;
    label.textContent =
      key === 'no' && config.material !== 'hyperbolic'
        ? '常光線の屈折率 nₒ'
        : key === 'ne'
          ? '異常光線の主屈折率 nₑ'
          : key === 'n'
            ? config.material === 'isotropic'
              ? '屈折率 n'
              : '基準屈折率 n₀'
            : parameterName;
    row.className = 'parameter-value';
    input.type = 'range';
    number.type = 'number';
    input.id = key;
    number.id = key + 'Value';
    for (const e of [input, number]) {
      e.min = min;
      e.max = max;
      e.step = step;
      e.value = config[key];
      e.disabled = target === 'params' && config.preset !== 'custom';
      e.setAttribute('aria-label', parameterName);
    }
    const set = (value, other) => {
      const n = Number(value);
      if (!value || !Number.isFinite(n) || n < min || n > max) {
        $('status').textContent = name + 'は' + min + '〜' + max + 'で指定してください';
        return;
      }
      config[key] = n;
      other.value = n;
      if (target === 'orientation') {
        if (config.preset !== 'custom' && !MaterialCatalog.matchesPreset(config, config.preset)) {
          config.preset = 'custom';
          sync();
        } else syncOrientationNote();
      }
      syncBranches();
      syncTransport();
      dirty();
    };
    input.oninput = () => set(input.value, number);
    number.onchange = () => {
      set(number.value, input);
      number.value = config[key];
    };
    row.append(input, number);
    label.append(row);
    $(target).append(label);
  }
}

function syncODEControls() {
  const values = ['odeRtol', 'odeAtolPosition', 'odeAtolMomentum'].map(
    (k) => config[k] ?? Optics.defaults[k],
  );
  values.forEach((v, i) => ($(['odeRtol', 'odeAtolPosition', 'odeAtolMomentum'][i]).value = v));
  $('odePrecision').value = values.every((v, i) => v === [1e-6, 1e-7, 1e-7][i])
    ? 'standard'
    : values.every((v, i) => v === [1e-9, 1e-10, 1e-10][i])
      ? 'high'
      : 'custom';
}
$('odePrecision').onchange = () => {
  const p = $('odePrecision').value;
  if (p !== 'custom') {
    const v = p === 'high' ? [1e-9, 1e-10, 1e-10] : [1e-6, 1e-7, 1e-7];
    ['odeRtol', 'odeAtolPosition', 'odeAtolMomentum'].forEach((k, i) => (config[k] = v[i]));
    sync();
    dirty();
  }
};
for (const key of ['odeRtol', 'odeAtolPosition', 'odeAtolMomentum'])
  $(key).onchange = () => {
    const n = Number($(key).value);
    try {
      Optics.odeSettings({ ...config, [key]: n });
      config[key] = n;
      sync();
      dirty();
    } catch (e) {
      $('status').textContent = e.message;
      syncODEControls();
    }
  };

function syncOrientationNote() {
  const biax = config.material === 'biaxial',
    varying = config.material === 'heliconical';
  $('orientationNote').textContent =
    (biax
      ? '第3主軸の向きを指定します。二軸結晶の光軸とは異なります。'
      : '光軸の向きを指定します。') +
    'プリセットを選んだまま、軸の向きを変更できます。傾き0°は＋z方向です。方位角0°は＋x側、90°は＋y側を向きます。' +
    (varying
      ? ' 方位角はz=0での値です。helicalプリセットの傾き90°を変更すると任意指定になります。'
      : '') +
    (config.tilt === 0 && !biax ? ' 傾き0°では方位角を変えても軸方向は変わりません。' : '');
}
function dirty() {
  stop();
  SpectralUI.sync(config);
  $('renderWarning').hidden = true;
  $('traceStats').textContent = '';
  $('gpuRuntime').hidden = true;
  finished = false;
  lastResult = null;
  $('budgetPanel').hidden = true;
  CommonScaleComparison.sync(config);
  PhaseComparison.sync(config);
  GPUComparison.sync(config);
  GPUBackendUI.sync(config);
  $('exampleNotice').hidden = true;
  updateSummary();
  $('methodStats').textContent =
    '計算法ごとの使用回数は、現在の設定で画像を計算すると更新されます。';
  $('status').textContent = '設定を変更しました。画像を再計算すると表示が更新されます。';
}
function sync() {
  for (const [k, v] of Object.entries(Spectral.defaults)) config[k] ??= v;
  // The material determines whether constitutive boundary transport is available.
  config.transport = Optics.polarization.supported(config) ? 'polarized' : 'legacy';
  // Presets disable optional internal transport; uniform/single-mode models
  // must not inherit a phase model from a previously selected material.
  if (
    config.branchModel === 'coherent' &&
    (config.branchPolicy !== 'overlap' ||
      !['common', 'quadratic', 'heliconical', 'axial2013Uniaxial'].includes(config.material))
  ) {
    config.branchModel = 'modal';
    config.branchPolicy = 'off';
  }
  const model = MaterialCatalog.models[config.material],
    custom = config.preset === 'custom';
  config.cameraSide ??= 'positive';
  $('cameraSide').value = config.cameraSide;
  MaterialPicker.sync(config);
  $('preset').value = config.preset;
  $('materialType').value = model.type;
  $('materialType').disabled = !custom;
  $('material').replaceChildren();
  const modelOptions = Object.entries(MaterialCatalog.models).filter(
    ([id, m]) => m.type === model.type,
  );
  if (model.type.endsWith('Gradient')) {
    for (const [name, test] of [
      [
        '閉式解を利用できるモデル（条件付きも含む）',
        (m) => m.form.includes('閉式解') && !m.form.includes('近似方程式'),
      ],
      [
        '数値積分・近似モデル（比較用）',
        (m) => !m.form.includes('閉式解') || m.form.includes('近似方程式'),
      ],
    ]) {
      const group = document.createElement('optgroup');
      group.label = name;
      for (const [id, m] of modelOptions.filter(([, m]) => test(m)))
        group.append(new Option(m.label, id));
      if (group.children.length) $('material').append(group);
    }
  } else
    $('material').append(
      ...modelOptions.map(
        ([id, m]) =>
          new Option(
            id === 'uniaxial'
              ? '一軸結晶（主屈折率2種類）'
              : id === 'biaxial'
                ? '二軸結晶（主屈折率3種類）'
                : m.label,
            id,
          ),
      ),
    );
  $('material').disabled = !custom;
  $('customize').hidden = custom;
  syncEntryMode();
  for (const id of [
    'shape',
    'material',
    'mode',
    'solver',
    'projection',
    'background',
    'resolution',
    'step',
  ])
    $(id).value = config[id];
  $('resolutionValue').textContent = config.resolution + ' × ' + config.resolution + ' px';
  const orientation = groups[config.material].filter((k) =>
    MaterialCatalog.orientationKeys.includes(k),
  );
  sliders(
    'params',
    groups[config.material].filter((k) => !MaterialCatalog.orientationKeys.includes(k)),
  );
  sliders('orientation', orientation);
  $('orientationSection').hidden = !orientation.length;
  syncOrientationNote();
  sliders('outside', ['outsideN']);
  sliders('camera', ['yaw', 'pitch', 'fov', 'backgroundZ']);
  $('note').textContent = notes[config.material];
  $('solver').disabled = config.material === 'moldedApprox';
  const preset = MaterialCatalog.presets.find((p) => p.id === config.preset);
  $('presetNote').textContent = preset
    ? preset.description
    : '媒質の種類 → 媒質モデル → パラメータの順に指定します。';
  $('presetSource').replaceChildren();
  if (preset?.source) {
    const link = document.createElement('a');
    link.href = preset.source;
    link.textContent = 'プリセットの出典';
    link.target = '_blank';
    link.rel = 'noopener';
    $('presetSource').append(link);
  } else if (
    preset &&
    ['common', 'quadratic', 'hyperbolic', 'heliconical', 'shear'].includes(config.material)
  )
    $('presetSource').textContent = '出典：現行JOSA A原稿 Table 1（アプリ用パラメータ）';
  syncODEControls();
  syncBranches();
  syncTransport();
  updateSummary();
  CommonScaleComparison.sync(config);
  PhaseComparison.sync(config);
  GPUComparison.sync(config);
  GPUBackendUI.sync(config);
}
for (const id of [
  'shape',
  'material',
  'mode',
  'solver',
  'projection',
  'background',
  'resolution',
  'step',
])
  $(id).onchange = () => {
    config[id] = ['mode', 'resolution', 'step'].includes(id) ? +$(id).value : $(id).value;
    if (id === 'material') {
      config.preset = 'custom';
      sync();
    }
    if (id === 'mode' || id === 'shape' || id === 'projection') syncBranches();
    syncTransport();
    dirty();
  };
$('resolution').oninput = () => {
  config.resolution = +$('resolution').value;
  $('resolutionValue').textContent = config.resolution + ' × ' + config.resolution + ' px';
  dirty();
};
$('preset').onchange = () => {
  const id = $('preset').value;
  config = SceneConfig.preset(config, id);
  sync();
  dirty();
};
$('customize').onclick = customize;
$('materialType').onchange = () => {
  config.preset = 'custom';
  config.material = Object.keys(MaterialCatalog.models).find(
    (k) => MaterialCatalog.models[k].type === $('materialType').value,
  );
  sync();
  dirty();
};
function validateView(c) {
  return SceneConfig.validateView(c);
}
$('cameraSide').onchange = () => {
  config.cameraSide = $('cameraSide').value;
  config.backgroundZ = (config.cameraSide === 'negative' ? 1 : -1) * Math.abs(config.backgroundZ);
  sync();
  dirty();
};
function validateMedium() {
  return SceneConfig.validate(config);
}
function solverDescription() {
  if (Optics.polarization.coherent.selected(config))
    return '軌道は条件を満たす閉式解、Schur積分表示の数値求積、ODEから選びます。位相輸送は別の計算で、正面heliconicalでは行列指数の解析評価、一般条件では相関を保持する適応数値積分を使います。';
  const m = config.material;
  if (['isotropic', 'uniaxial', 'biaxial'].includes(m))
    return '内部は解析的な直線。球・立方体は解析交差、トーラスは四次方程式で交点を求めます。';
  if (m === 'moldedApprox')
    return '小傾斜近似方程式の閉式解です。元の光線方程式の厳密解とは区別します。';
  if (config.solver === 'rkf45') return '選択中：Hamilton方程式をRKF45で数値積分。';
  if (config.solver === 'schur')
    return '選択中：積分表示を4点Gauss–Legendreで数値求積。適用外はRKF45。未評価積分を含む表現は閉式解とは区別します。';
  return (
    (Optics.polarization.isotropicGradient(config) && config.transport === 'polarized'
      ? '以下は軌道の計算法です。偏光は曲がった軌道に沿って数値輸送し、表面の反射・透過率を局所屈折率から計算します。 '
      : '') +
    '自動：条件を満たす光線区間は閉式解、軸方向の積分表示が使える区間は数値求積、残りはODE数値積分。' +
    (m === 'heliconical' ? ' 螺旋閉式解は横運動量p⊥=0の光線に限定されます。' : '') +
    (config.transport === 'polarized'
      ? ' 表面の交点は数値探索し、指定分岐面以外の区間は同じ種類の光線を追跡します。'
      : ' 界面・指定分岐位置で区間を区切ります。')
  );
}
function stop() {
  GPUComparison.cancel();
  CommonScaleComparison.cancel();
  PhaseComparison.cancel();
  renderGeneration++;
  if (worker) worker.terminate();
  worker = null;
  $('render').disabled = false;
}

// Rendering has three UI stages: clear the previous image, consume worker
// tiles, and retain the final record. A generation token ignores late messages
// from a cancelled job before they can overwrite a newer image.
function resetRenderView() {
  finished = false;
  lastResult = null;
  visible.width = visible.height = buffer.width = buffer.height = config.resolution;
  renderContext.fillStyle = '#101b27';
  renderContext.fillRect(0, 0, buffer.width, buffer.height);
  paint();
  $('progress').value = 0;
  $('status').textContent = '計算中…';
  $('budgetPanel').hidden = true;
  $('methodStats').textContent = '計算法の使用状況を計測中…';
  $('traceStats').textContent = '';
  $('renderWarning').hidden = true;
}
function receiveRenderMessage(result, generation) {
  if (generation !== renderGeneration) return;
  if (RenderDiagnostics.progress(result)) return;
  if (result.fatalError) {
    stop();
    $('status').textContent = '計算エラー：' + result.fatalError;
    return;
  }
  if (result.build !== APP_BUILD) {
    stop();
    $('status').textContent = '計算コードの版が一致しません。ページを再読み込みしてください。';
    return;
  }
  renderContext.putImageData(
    new ImageData(result.pixels, config.resolution, result.rows),
    0,
    result.y,
  );
  paint();
  $('progress').value = result.progress ?? (result.y + result.rows) / config.resolution;
  RenderDiagnostics.update(result, config);
  if (result.done) {
    lastResult = {
      build: result.build,
      config: { ...config },
      stats: { ...result.stats },
      milliseconds: result.ms,
    };
    finished = true;
    stop();
  }
}

function render() {
  window.WorkspaceUI?.show('render');
  stop();
  try {
    validateMedium();
  } catch (e) {
    alert(e.message);
    return;
  }
  if (!(config.step >= 0.005 && config.step <= 0.1)) {
    alert('刻み幅は0.005〜0.1で指定してください');
    return;
  }
  resetRenderView();
  const generation = renderGeneration;
  $('render').disabled = true;
  try {
    worker = RenderWorkers.create(APP_BUILD, config.computeBackend);
  } catch (e) {
    $('status').textContent = 'Worker起動エラー: ' + e.message;
    $('render').disabled = false;
    return;
  }
  worker.onerror = (e) => {
    $('status').textContent = '計算エラー: ' + e.message;
    stop();
  };
  worker.onmessage = ({ data }) => receiveRenderMessage(data, generation);
  worker.postMessage({ ...config });
}
$('render').onclick = render;
$('cancel').onclick = () => {
  stop();
  $('status').textContent = '停止しました。表示は途中の画像です。';
};
$('reset').onclick = () => {
  stop();
  const url = new URL(location.href);
  url.searchParams.delete('demo');
  history.replaceState(null, '', url);
  config = SceneConfig.standard();
  sync();
  render();
};
function download(blob, name) {
  let a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$('png').onclick = () => {
  if (!finished) {
    alert('現在の設定の計算を完了してから保存してください');
    return;
  }
  buffer.toBlob((b) => download(b, 'ray-optics.png'));
};
$('json').onclick = () =>
  download(
    new Blob([JSON.stringify(SceneConfig.toDocument(config, lastResult), null, 2)], {
      type: 'application/json',
    }),
    'ray-optics.json',
  );
$('import').onclick = () => $('load').click();
$('load').onchange = async () => {
  const file = $('load').files[0];
  if (!file) return;
  try {
    const loaded = SceneConfig.fromDocument(JSON.parse(await file.text()));
    stop();
    config = loaded.config;
    sync();
    dirty();
    window.WorkspaceUI?.show('render');
    if (loaded.warnings.length) {
      $('exampleNotice').hidden = false;
      $('exampleNotice').textContent = loaded.warnings.join(' ');
    }
  } catch (e) {
    alert('設定を読み込めません：' + e.message);
  } finally {
    $('load').value = '';
  }
};
SpectralUI.init({
  getConfig: () => config,
  changed: () => {
    sync();
    dirty();
  },
  demo: () => {
    stop();
    config = MaterialCatalog.apply(
      {
        ...Optics.defaults,
        solver: 'auto',
        transport: 'polarized',
        projection: 'ortho',
        resolution: 128,
        computeBackend: 'gpu',
        ...Spectral.defaults,
        spectralMode: 'on',
      },
      'glass-N-SF11',
    );
    sync();
    dirty();
  },
});
initCatalog();
initBranches();
initTransport();
$('computeBackend').onchange = () => {
  config.computeBackend = $('computeBackend').value;
  sync();
  dirty();
};
GPUComparison.init({
  build: APP_BUILD,
  getConfig: () => ({ ...config }),
  beforeStart: stop,
  download,
});
PhaseComparison.init({
  build: APP_BUILD,
  getConfig: () => ({ ...config }),
  beforeStart: stop,
  download,
  applyConfig: (c) => {
    stop();
    config = SceneConfig.customize(c);
    sync();
    dirty();
    render();
  },
});
CommonScaleComparison.init({
  build: APP_BUILD,
  getConfig: () => ({ ...config }),
  beforeStart: stop,
  download,
  applyConfig: (c) => {
    stop();
    config = SceneConfig.customize(c);
    sync();
    dirty();
    render();
  },
});
sync();
{
  const demo = new URLSearchParams(location.search).get('demo'),
    id = {
      'gpu-numerical': 'gpuNumericalDemo',
      'gpu-rkf45': 'gpuRKDemo',
      'gpu-rk4': 'gpuRKDemo',
      'gpu-phase': 'gpuPhaseDemo',
      'gpu-modal': 'gpuModalDemo',
      'gpu-anisotropic': 'gpuAnisotropicDemo',
      'gpu-shear': 'gpuShearDemo',
      'gpu-grin': 'gpuGrinDemo',
      'gpu-biaxial': 'gpuBiaxialDemo',
      'gpu-sphere': 'gpuSphereDemo',
      'gpu-torus': 'gpuTorusDemo',
      'gpu-common': 'gpuCommonDemo',
      'gpu-calcite': 'gpuCalciteDemo',
      'finite-phase': 'finitePhaseDemo',
      'phase-compare': 'phaseComparisonDemo',
      'internal-polarization': 'coherentDemo',
      'phase-common': 'phaseCommonDemo',
      'phase-heliconical': 'phaseHelicalDemo',
      'phase-axial': 'phaseAxialDemo',
      'coherent-polarization': 'coherentDemo',
      'coherent-splitting': 'coherentSplitDemo',
      'phase-omitted': 'modalDemo',
      'layered-polarization': 'layerDemo',
      'radial-gradient': 'grinDemo',
      'axial-branches': 'axialBranchDemo',
      'common-compare': 'commonComparisonDemo',
      polarization: 'polarDemo',
      common: 'commonDemo',
      heliconical: 'helicalDemo',
      biaxial: 'biaxDemo',
    }[demo];
  if (id) $(id).click();
  if (demo === 'dispersion') {
    config = MaterialCatalog.apply(
      {
        ...Optics.defaults,
        solver: 'auto',
        transport: 'polarized',
        projection: 'ortho',
        resolution: 128,
        computeBackend: 'gpu',
        ...Spectral.defaults,
        spectralMode: 'on',
      },
      'glass-N-SF11',
    );
    sync();
  }
  if (demo === 'calcite') {
    config = MaterialCatalog.apply(
      {
        ...Optics.defaults,
        solver: 'auto',
        projection: 'ortho',
        resolution: 256,
        transport: 'polarized',
      },
      'calcite',
    );
    sync();
  }
}
render();

if (document.modelContext?.registerTool) {
  try {
    document.modelContext.registerTool({
      name: 'render_optics',
      description: '現在の設定で画像の計算を開始します。',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execute: () => {
        render();
        return { started: true, config: { ...config } };
      },
    });
  } catch (e) {
    console.warn('Optional model context unavailable', e);
  }
}

function syncEntryMode() {
  const single = [
    'isotropic',
    'radial',
    'axial',
    'sphericalSquared',
    'radialSquared',
    'axialSquared',
    'axial2013',
    'eng2013',
    'eng2013Magnetic',
    'molded2013',
    'moldedApprox',
    'molded2013Transform',
    'hyperbolic',
    'shear',
  ].includes(config.material);
  const biaxial = config.material === 'biaxial';
  const options = single
    ? [
        [
          1,
          ['hyperbolic', 'eng2013Magnetic'].includes(config.material)
            ? '異常光線 e（常光線は伝播しない）'
            : '透過光線（1種類）',
        ],
      ]
    : biaxial
      ? [
          [0, '光線1だけ'],
          [1, '光線2だけ'],
          [2, '光線1＋2（各50%）'],
        ]
      : [
          [0, '常光線 o（ordinary）だけ'],
          [1, '異常光線 e（extraordinary）だけ'],
          [2, '常光線 o＋異常光線 e（各50%）'],
        ];
  $('mode').replaceChildren(...options.map(([v, text]) => new Option(text, v)));
  if (single) config.mode = 1;
  $('mode').value = config.mode;
  $('mode').disabled = single;
  $('entryNote').textContent = single
    ? 'この媒質の簡易計算では、一種類の透過光線を追跡します。'
    : (biaxial
        ? '入口から光線1・2のどちらを追跡するか選びます。'
        : '入口から常光線・異常光線のどちらを追跡するか選びます。') +
      '両方を選ぶと各50%で合成します。偏光に応じた実際の分配率は使いません。';
}

function syncBranches() {
  const supported =
      Optics.branching.supported(config) || Optics.polarization.coherent.selected(config),
    uniform = Optics.branching.homogeneous(config);
  // Hidden controls must not leave an active artificial splitter in a uniform medium.
  if (!supported && config.branchModel !== 'coherent') config.branchPolicy = 'off';
  config.branchModel ??= 'equal';
  if (config.transport !== 'polarized' && config.branchModel !== 'equal') {
    config.branchModel = 'equal';
    if (config.branchPolicy === 'overlap') config.branchPolicy = 'off';
    config.branchDepth = Math.min(6, config.branchDepth);
  }
  const coherent = Optics.polarization.coherent.selected(config),
    layered = Optics.polarization.layered.enabled(config),
    modal = config.branchModel === 'modal' && config.transport === 'polarized' && supported,
    active = supported && config.branchPolicy !== 'off';
  $('branchModel').value = config.branchModel;
  $('branchModel').disabled = !supported;
  for (const model of ['layers', 'modal', 'coherent'])
    $('branchModel').querySelector('option[value=' + model + ']').disabled =
      config.transport !== 'polarized';
  $('branchDepth').max = config.branchModel === 'layers' ? 12 : 6;
  for (const id of [
    'branchPolicy',
    'branchDepth',
    'branchPlanes',
    'branchStart',
    'branchEnd',
    'branchCount',
  ]) {
    $(id).value = config[id];
    $('resolutionValue').textContent = config.resolution + ' × ' + config.resolution + ' px';
    $(id).disabled = !supported;
  }
  $('branchControls').hidden = !supported;
  $('branchExperiment').hidden = !supported;
  $('branchActive').hidden = !active;
  if (!supported) $('branchExperiment').open = false;
  else if (active) $('branchExperiment').open = true;
  $('branchPlanesLabel').hidden = config.branchPolicy !== 'planes';
  $('planesHelp').hidden = config.branchPolicy !== 'planes';
  $('distributedFields').hidden = config.branchPolicy !== 'distributed';
  $('branchNote').textContent = uniform
    ? 'この設定では媒質は均一です。入口からの光線はそれぞれ内部を直進します。内部に新たな分岐を加える設定はありません。'
    : supported
      ? '屈折率や軸の向きの変化に沿って光線を追跡します。区切らない場合は、内部で光線の種類を切り替えません。下の設定で、解析軌道を保つモード分配の近似や各50%の比較を追加できます。'
      : Optics.polarization.isotropicGradient(config)
        ? '屈折率の変化に応じて光線が曲がります。二つの偏光は同じ軌道を進み、常光線と異常光線への分離や、媒質内での1:1の分岐はありません。'
        : Optics.polarization.transformation(config)
          ? 'この変換媒質は非複屈折です。二つの偏光が同じ軌道を進むため、二本の異なる光線への内部分岐は設定しません。'
          : ['hyperbolic', 'eng2013Magnetic'].includes(config.material)
            ? 'この設定では異常光線 eだけが内部を伝播します。常光線 oは伝播できないため、内部で二本の光線に分ける設定はありません。'
            : ['axial2013', 'eng2013', 'molded2013', 'moldedApprox'].includes(config.material)
              ? 'この媒質は一種類の光学計量に沿った軌道を追跡します。別の物性の仮定を使うモデルへの切替は、「形状と媒質」欄で選べます。'
              : '二種類の光線に分離する設定ではないため、内部の1:1分岐は使いません。';
  $('materialRealizations').hidden = ![
    'axial2013',
    'eng2013',
    'molded2013',
    'moldedApprox',
  ].includes(config.material);
  $('engRealization').hidden = config.material !== 'eng2013';
  $('axialRealization').hidden = config.material !== 'axial2013';
  $('moldedRealization').hidden = !['molded2013', 'moldedApprox'].includes(config.material);
  $('moldedRealization').textContent =
    config.material === 'moldedApprox'
      ? '近似前の計量を変換媒質として使う（ε＝μ）'
      : '変換媒質モデルに切り替える（ε＝μ）';
  try {
    const planes = (
      layered ? Optics.polarization.layered.settings(config) : Optics.branching.settings(config)
    ).planes;
    $('branchPreview').textContent = planes.length
      ? '使用するz座標：' + planes.map((v) => Number(v.toFixed(4))).join(', ')
      : '媒質内に追加の分岐は設定しません。';
  } catch (e) {
    $('branchPreview').textContent = e.message;
  }
  const depth = config.branchDepth,
    roots = config.mode === 2 ? 2 : 1;
  $('branchModelNote').textContent = modal
    ? '元の連続媒質を、使える区間では閉式解で追跡します。条件外は数値求積・ODEへ切り替えます。分配だけを指定位置で近似し、子光線もその位置から元の解析軌道で進めます。'
    : layered
      ? '各層の中央zで元の屈折率と光軸を評価し、層内では一定にします。層境界で偏光依存の反射・透過を計算します。入口・出口にも、その層の物性を使います。'
      : '元の連続媒質の光線を追跡し、指定した面で各50%に分けます。偏光に基づく変換率の予測ではありません。';
  $('branchWeightNote').textContent = modal
    ? '区間内の局所固有モードの変化からMueller行列を求め、Stokesベクトルで表した光の強度を常光線・異常光線へ分配します。複屈折による位相差を省いた前方2モードの近似です。分配後の重みの合計は1ですが、実在する媒質の変換率を正確に予測する保証はありません。'
    : layered
      ? '接線方向の電場・磁場が連続になる条件からMueller行列を求め、Stokesベクトルを用いて各光線の重みを計算します。反射光を含む重みの合計は1です。異なるモード・経路の位相関係は層ごとに無視します。この仮定は、入射光が無偏光であることだけからは導けません。'
      : '各枝の重みは親の50%です。同じ種類を続ける枝も含みます。';
  $('branchConditions').textContent = modal
    ? '均一層への置換はしません。接線波数を保存して分配し、内部の反射枝は追加しません。実際の表面での反射・透過は従来どおり計算します。前回の分配点（最初は入口）から評価面までの変換を終端に集約し、その後は別の光線として強度を合成します。最後の評価面から出口までは同じモードです。zが単調で両方のモードが伝播する正則な区間が対象で、区間内のモードの空間的離隔や位相差を省きます。評価面の間隔を細かくすれば正しい変換率に収束するというモデルではありません。'
    : layered
      ? '層内は直線です。元の連続媒質に対する閉式解、数値求積、常微分方程式の数値積分は使いません。面に平行な波数を保存し、o/eの透過と反射を追跡します。反射後は同じ境界にも再び到達できます。減衰する場は境界条件に含めますが、層間のエバネッセント結合は扱いません。層数を増やすだけで連続媒質の正解に収束する保証はありません。計算量の上限は1画素あたり2048枝で、超過分も打ち切り寄与に含めます。'
      : '面に平行な波数を保存し、同じz方向へ進む根を選びます。この面での反射は計算しません。同じ面は1経路で一度だけ分岐します。伝播できない枝の重みは他方へ再配分しません。';
  $('depthNote').textContent = layered
    ? `層境界で最大${depth}回まで反射・透過を計算します。その次の層境界に達した光は打ち切り、失った寄与を画像下に表示します。表面での反射・屈折とは別の上限です。層を増やす際は、この回数も増やしてください。`
    : depth === 0
      ? '0は分岐なし。指定した面でも分岐しません。'
      : config.transport === 'polarized'
        ? `一つの経路で最大${depth}回まで分岐します。その後は同じ種類の光線を追跡します。表面での反射・屈折の回数とは別の上限です。`
        : `一つの経路で最大${depth}回まで分岐します。入口の選択を含めて最大${roots * 2 ** depth}本です。上限後は同じ種類の光線を追跡します。`;
  $('branchPolicyLabel').hidden = coherent;
  $('coherentFields').hidden = !coherent;
  $('branchPreview').hidden = coherent;
  if (coherent) {
    $('branchNote').textContent =
      '光束が重なる間は偏光の相関を保持して輸送します。内部で二本の光線に分ける条件は、指定したz面ではなく光束の重なりです。';
    for (const id of ['branchPlanesLabel', 'planesHelp', 'distributedFields', 'branchPreview'])
      $(id).hidden = true;
    $('branchModelNote').textContent =
      '各モードの解析軌道を保ち、複屈折の位相差と局所固有偏光の回転を同時に計算します。二つの偏光の相関を、計算の分割点では捨てません。';
    $('branchWeightNote').textContent =
      '光束が重なる区間はJones行列をMueller行列に変換してStokesベクトルを輸送します。数値分割時には相関を保持します。十分離れた時点でo/eの強度を独立した枝へ渡します。';
    $('branchConditions').textContent =
      '4種のz依存一軸媒質の前方2モード近似です。両モードが伝播し、zが単調な正則区間が対象です。z折り返し・接線伝播・一般の縮退付近は条件外です。2013 axialは固定されたTE/TMを使用します。内部の後方結合、回折、別の往復経路間の干渉を含みません。光束分離と一般入射の界面分配には追加の近似があり、画像全体のMaxwell検証は未実施です。出口まで位相輸送します。';
    $('depthNote').textContent =
      '一つの経路で、光束の分離を最大' +
      config.branchDepth +
      '回まで処理します。次に分離が必要になった光は打ち切り、その重みを結果に表示します。0でも位相輸送は計算します。表面での回数上限とは別です。';
  }
  syncCoherentFields();
}

function updateSummary() {
  const shape = I18n.sourceText($('shape').selectedOptions[0]) || config.shape,
    material = I18n.sourceText($('material').selectedOptions[0]) || config.material;
  $('sceneSummary').textContent = shape + ' / ' + material + ' / 外部 n=' + config.outsideN;
  const axisName = config.material === 'biaxial' ? '第3主軸' : '光軸';
  $('angleSummary').textContent =
    '視点：水平角 ' +
    config.yaw +
    '° ／ 仰角 ' +
    config.pitch +
    '°' +
    (groups[config.material].includes('tilt')
      ? ' · ' +
        axisName +
        '：傾き ' +
        config.tilt +
        '° ／ 方位角 ' +
        config.azimuth +
        '°' +
        (config.material === 'biaxial' ? ' ／ 主軸まわりの回転 ' + config.roll + '°' : '')
      : '');
  const positive = config.cameraSide !== 'negative';
  $('coordinateNote').textContent =
    '右手座標系。カメラはz' +
    (positive ? '正' : '負') +
    '側、背景面はz=' +
    config.backgroundZ +
    '。正面視ではx正方向が画面' +
    (positive ? '右' : '左') +
    '、y正方向が上です。赤いx軸・緑のy軸は背景面上の無限直線で、媒質越しには屈折します。低解像度では軸の表示幅を補正します。';
  $('cameraSideNote').textContent = positive
    ? '標準：z正側から原点を観察します。水平角・仰角0°で、xは右、yは上、zは手前です。'
    : 'z負側から原点を観察します。正面ではx正方向が左、y正方向が上です。観察する側を切り替えると背景も反対側へ移ります。';
  $('solutionForm').textContent = '軌道の解：' + MaterialCatalog.models[config.material].form;
  $('solutionNote').textContent = solverDescription();
  let entry = I18n.sourceText($('mode').selectedOptions[0]) || '',
    inside = '分岐なし';
  if (
    Optics.branching.supported(config) &&
    config.branchPolicy !== 'off' &&
    config.branchDepth > 0
  ) {
    try {
      const planes = Optics.branching.settings(config).planes;
      inside = `${config.branchPolicy === 'planes' ? '個別指定' : '等間隔'} ${planes.length}面・最大${config.branchDepth}回・各0.5`;
    } catch (e) {
      inside = '分岐設定を確認してください';
    }
  }
  const layered = Optics.polarization.layered.enabled(config),
    modal = Optics.polarization.modal.enabled(config);
  if (modal) inside = '連続軌道＋前方モード分配（位相差省略）・最大' + config.branchDepth + '回';
  if (layered) {
    try {
      inside =
        Optics.polarization.layered.settings(config).cells.length +
        '層・偏光による反射と透過・最大' +
        config.branchDepth +
        '回';
    } catch (e) {
      inside = e.message;
    }
  }
  if (layered) {
    $('solutionForm').textContent = '計算中の媒質：有限の均一層による近似';
    $('solutionNote').textContent =
      '各層は直線。元の連続媒質の解析軌道は、このモードでは使いません。';
  }
  if (Optics.polarization.coherent.selected(config))
    inside = '解析軌道／求積／ODE＋相対位相を保持・光束の重なりで分離';
  $('pathSummary').textContent =
    `簡易計算：${entry} → 内部：${Optics.branching.homogeneous(config) ? '直進' : inside} → 背景`;
  if (config.transport === 'polarized')
    $('pathSummary').textContent =
      '自然光を無偏光で近似 → 表面の反射・屈折（最大' +
      config.maxInterfaces +
      '界面）' +
      ' → 内部：' +
      (inside === '分岐なし'
        ? Optics.branching.homogeneous(config)
          ? '直進・新たな分岐なし'
          : Optics.polarization.isotropicGradient(config)
            ? '偏光を輸送しながら曲線を追跡'
            : Optics.polarization.transformation(config)
              ? '二つの偏光は同じ軌道'
              : '同じ種類の光線を追跡'
        : inside + (layered ? '（非干渉）' : modal ? '' : '（研究用の仮定）')) +
      ' → ' +
      I18n.sourceText($('transportView').selectedOptions[0]);
  SpectralUI.sync(config);
  if (Spectral.enabled(config))
    $('sceneSummary').textContent += ' / ' + Spectral.description(config);
  window.WorkspaceUI?.sync(config);
}
function initBranches() {
  $('finitePhaseDemo').onclick = () => {
    phaseGeneralDemo('heliconical');
    config.shape = 'sphere';
    config.coherentInterface = 'finite-resolved';
    config.yaw = 0;
    config.pitch = 0;
    config.maxInterfaces = 4;
    sync();
    dirty();
    $('exampleNotice').hidden = false;
    $('exampleNotice').textContent =
      '有限形状の位相輸送：球・Heliconical、正面0°、光軸55°／17°（このデモの設定）、64 px。形状から立方体・トーラスにも変更できます。局所表面で独立光線へ分ける近似です。';
  };
  $('phaseComparisonDemo').onclick = () => {
    phaseGeneralDemo('heliconical');
    config.coherentInterface = 'coupled';
    config.maxInterfaces = 2;
    config.transportView = 'all';
    sync();
    dirty();
    $('exampleNotice').hidden = false;
    $('exampleNotice').textContent =
      '界面相関の比較例：Heliconical、視点15°／6°、光軸55°／17°、厚さ10 μm。「偏光・分岐の比較」タブの「比較を実行」で3条件を並べます。比較は入口・出口の一回通過にそろえます。';
  };
  $('phaseCommonDemo').onclick = () => phaseGeneralDemo('common');
  $('phaseHelicalDemo').onclick = () => phaseGeneralDemo('heliconical');
  $('phaseAxialDemo').onclick = () => phaseGeneralDemo('axial2013Uniaxial');
  $('coherentDemo').onclick = () => coherentDemo(false);
  $('coherentSplitDemo').onclick = () => coherentDemo(true);
  for (const id of Object.keys(Optics.polarization.coherent.defaults))
    $(id).onchange = () => {
      config[id] = id === 'coherentInterface' ? $(id).value : Number($(id).value);
      syncBranches();
      syncTransport();
      dirty();
    };

  $('modalDemo').onclick = () => {
    stop();
    config = {
      ...Optics.defaults,
      solver: 'auto',
      preset: 'custom',
      material: 'heliconical',
      shape: 'cube',
      no: 1.658,
      ne: 1.486,
      tilt: 60,
      azimuth: 0,
      twist: 1,
      projection: 'ortho',
      resolution: 64,
      yaw: 0,
      pitch: 0,
      transport: 'polarized',
      transportView: 'all',
      maxInterfaces: 4,
      minContribution: 1e-4,
      branchModel: 'modal',
      branchPolicy: 'planes',
      branchPlanes: '-0.5, 0, 0.5',
      branchDepth: 3,
    };
    sync();
    dirty();
    $('exampleNotice').hidden = false;
    $('exampleNotice').textContent =
      'Heliconicalの元の解析軌道を使います。光軸60°・視点0°、立方体、64 px。z=−0.5,0,0.5でモードに応じて分配（最大3回）。複屈折の位相差は省略。均一層への置換はしません。';
  };
  $('layerDemo').onclick = () => {
    stop();
    config = {
      ...Optics.defaults,
      solver: 'auto',
      preset: 'custom',
      material: 'heliconical',
      shape: 'cube',
      no: 1.658,
      ne: 1.486,
      tilt: 60,
      azimuth: 0,
      twist: 1,
      projection: 'ortho',
      resolution: 64,
      yaw: 0,
      pitch: 0,
      transport: 'polarized',
      transportView: 'all',
      maxInterfaces: 6,
      minContribution: 1e-4,
      branchModel: 'layers',
      branchPolicy: 'planes',
      branchPlanes: '-0.5, 0, 0.5',
      branchDepth: 8,
    };
    sync();
    dirty();
    $('exampleNotice').hidden = false;
    $('exampleNotice').textContent =
      'Heliconicalを4層で近似：立方体、光軸の傾き60°、Ω=1、正面0°、64 px。z=−0.5,0,0.5で偏光による透過・反射を計算します。内部最大8回。デモ固有の配向で、通常の角度0°設定は変わりません。';
  };
  $('axialBranchDemo').onclick = () => {
    stop();
    config = {
      ...Optics.defaults,
      material: 'axial2013Uniaxial',
      preset: 'custom',
      gradient: 0.2,
      shape: 'sphere',
      solver: 'auto',
      resolution: 64,
      mode: 2,
      transport: 'polarized',
      transportView: 'all',
      maxInterfaces: 4,
      branchPolicy: 'planes',
      branchPlanes: '-0.5, 0.5',
      branchDepth: 2,
    };
    sync();
    dirty();
    $('exampleNotice').hidden = false;
    $('exampleNotice').textContent =
      '2013 axialの一軸媒質モデル：球、軸z固定・正面0°、64 px。表面は偏光分配、内部z=−0.5,+0.5で各0.5に分岐。最大2回。「レンダリング」で計算します。';
  };
  $('moldedRealization').onclick = () => {
    stop();
    config = {
      ...config,
      material: 'molded2013Transform',
      preset: 'custom',
      transport: 'polarized',
      transportView: 'all',
      branchPolicy: 'off',
    };
    sync();
    dirty();
  };
  $('engRealization').onclick = () => {
    stop();
    config = {
      ...config,
      material: 'eng2013Magnetic',
      preset: 'custom',
      transport: 'polarized',
      transportView: 'all',
      mode: 1,
      branchPolicy: 'off',
    };
    sync();
    dirty();
  };
  $('axialRealization').onclick = () => {
    stop();
    config = {
      ...config,
      material: 'axial2013Uniaxial',
      preset: 'custom',
      transport: 'polarized',
      transportView: 'all',
      mode: 2,
      branchPolicy: 'off',
    };
    sync();
    dirty();
  };
  for (let id of [
    'branchModel',
    'branchPolicy',
    'branchDepth',
    'branchPlanes',
    'branchStart',
    'branchEnd',
    'branchCount',
  ])
    $(id).onchange = () => {
      config[id] = ['branchModel', 'branchPolicy', 'branchPlanes'].includes(id)
        ? $(id).value
        : Number($(id).value);
      if (id === 'branchModel') {
        config.branchPolicy =
          config.branchModel === 'coherent'
            ? 'overlap'
            : config.branchPolicy === 'overlap'
              ? 'planes'
              : config.branchPolicy;
      }
      if (id === 'branchModel' && config.branchModel !== 'layers')
        config.branchDepth = Math.min(6, config.branchDepth);
      syncBranches();
      syncTransport();
      dirty();
    };
  $('branchDemo').onclick = () => {
    stop();
    config = {
      ...Optics.defaults,
      solver: 'auto',
      material: 'heliconical',
      shape: 'cube',
      mode: 0,
      projection: 'ortho',
      tilt: 35,
      azimuth: 25,
      twist: 3.14,
      no: 1.658,
      ne: 1.486,
      resolution: 64,
      yaw: 0,
      pitch: 0,
      branchPolicy: 'distributed',
      branchDepth: 3,
      branchStart: -1,
      branchEnd: 1,
      branchCount: 5,
    };
    $('preset').value = 'custom';
    sync();
    dirty();
    $('exampleNotice').hidden = false;
    $('exampleNotice').textContent =
      'Heliconicalのアプリ用設定例を読み込みました。立方体・入口Ordinary・内部5面/最大3回・平行投影・64 pxです。「レンダリング」で表示を更新します。';
  };
}

function syncTransport() {
  const supported = Optics.polarization.supported(config);
  config.transport = supported ? 'polarized' : 'legacy';
  config.transport ??= 'polarized';
  config.transportView ??= 'all';
  config.maxInterfaces ??= 6;
  config.minContribution ??= 1e-4;
  config.maxRayWork ??= 2048;
  config.untracedTolerance ??= 0.001;
  const physical = config.transport === 'polarized',
    layered = Optics.polarization.layered.enabled(config),
    modal = Optics.polarization.modal.enabled(config);
  $('solver').disabled = layered || config.material === 'moldedApprox';
  $('step').disabled = layered;
  $('layerSolverNote').hidden = !layered;
  $('transport').value = config.transport;
  $('transport').querySelector('option[value="polarized"]').disabled = !supported;
  $('transportGuide').textContent =
    '媒質モデルから自動設定します。誘電率・透磁率が定義されたモデルは表面の分配と偏光輸送を計算し、光学計量のみのモデルは透過像の位置を計算します。';
  $('transportNote').textContent = physical
    ? '像の位置に加え、表面での反射・屈折による光の強度分配を計算します。各経路の強さから、画像の色と明るさを合成します。'
    : supported
      ? '選んだ透過光線を通して、背景がどの位置に見えるかを比べます。反射光と偏光による明るさの変化は計算しません。'
      : 'この媒質は軌道を調べるモデルで、現在は像の位置を比べる簡易計算のみ利用できます。';
  if (['axial2013', 'eng2013', 'molded2013', 'moldedApprox'].includes(config.material))
    $('transportNote').textContent +=
      ' 誘電率・透磁率を補って明るさも計算する別モデルは、「形状と媒質」欄で選べます。';
  const split =
    Optics.branching.supported(config) && config.branchPolicy !== 'off' && config.branchDepth > 0;
  $('adiabaticNote').hidden =
    !physical || Optics.branching.homogeneous(config) || !Optics.polarization.varying(config);
  $('adiabaticNote').textContent = Optics.polarization.coherent.selected(config)
    ? '波長と実寸から偏光の相対位相を計算します。元の閉式解による軌道を保つ前方2モード近似で、光束の空間分離には別の近似を使います。'
    : modal
      ? '軌道は元の連続媒質の解、分配は位相差を省いた前方2モード近似です。解析解を使う範囲と、分配を近似する範囲を分けています。'
      : layered
        ? '現在は非干渉の層近似です。滑らかな媒質の解析軌道と連続的なモード変換を同時に解く方式ではありません。層厚と位相関係を失う仮定が結果に影響します。'
        : Optics.polarization.isotropicGradient(config)
          ? '内部では、曲がった光線に沿って偏光を連続的に輸送します。表面では、その位置の屈折率と到達した偏光から反射・透過の明るさを計算します。'
          : config.material === 'eng2013Magnetic'
            ? '磁気異方性を仮定した誘電率・透磁率から、界面での反射・透過率を計算します。媒質内では、伝播できる異常光線だけを追跡します。'
            : config.material === 'hyperbolic'
              ? '界面の計算には減衰する場も含めますが、内部を進む光線としては異常光線 eだけを追跡します。'
              : Optics.polarization.transformation(config)
                ? '座標変換に従って偏光を輸送します。表面では誘電率と透磁率の両方から反射・透過を計算します。'
                : split
                  ? '指定した面と面の間では、同じ種類の光線を追跡します。面での各50%という分配は、追加した仮定です。'
                  : '内部では光線の種類を維持する断熱近似を使います。連続的な偏光間の変換や、波長・実寸法に基づく近似の適用判定は計算していません。';
  const biax = config.material === 'biaxial',
    singleExtra = ['hyperbolic', 'eng2013Magnetic'].includes(config.material),
    aniso =
      !Optics.polarization.isIso(config) &&
      [
        'uniaxial',
        'biaxial',
        'common',
        'quadratic',
        'heliconical',
        'axial2013Uniaxial',
        'hyperbolic',
        'eng2013Magnetic',
      ].includes(config.material);
  $('modeDefinition').hidden = !aniso;
  $('modeDefinition').textContent = biax
    ? '二軸媒質の二つの固有偏光に対応する光線を、ここでは「光線1」「光線2」と呼びます。'
    : singleExtra
      ? 'この媒質では異常光線 eが伝播できます。常光線 oは伝播しません。'
      : '一軸媒質の偏光に対応する二種類の光線を、常光線 o（ordinary）・異常光線 e（extraordinary）と呼びます。';
  const views = [
    ['all', 'すべての光を合成（通常）'],
    ...(aniso && !Optics.polarization.phaseInterface.selected(config)
      ? biax
        ? [
            ['mode1', '入口で光線1となった光'],
            ['mode2', '入口で光線2となった光'],
          ]
        : [
            ['o', '入口で常光線 oとなった光'],
            ['e', '入口で異常光線 eとなった光'],
          ]
      : []),
    ['reflected', '反射を経た光だけ'],
  ];
  $('transportView').replaceChildren(...views.map(([value, label]) => new Option(label, value)));
  if (
    !views.some(([v]) => v === config.transportView) ||
    (singleExtra && config.transportView === 'o')
  )
    config.transportView = 'all';
  for (const id of ['transportView', 'maxInterfaces', 'minContribution', 'maxRayWork'])
    $(id).value = config[id];
  $('resolutionValue').textContent = config.resolution + ' × ' + config.resolution + ' px';
  $('untracedTolerance').value = 100 * config.untracedTolerance;
  if (singleExtra) $('transportView').querySelector('option[value="o"]').disabled = true;
  $('contributionNote').textContent = aniso
    ? '入口はカメラ側の最初の透過面を指します。その後に反射や内部での分岐を経た光も含めます。個別表示でも明るさは再調整しません。「反射を経た光」は入口での分類と重なる場合があります。'
    : '通常はすべての光を合成します。反射が画像にどう影響するかは、「反射を経た光だけ」で確認できます。';
  if (Optics.polarization.phaseInterface.selected(config))
    $('contributionNote').textContent =
      '入口で二つのモードの相関を保持するため、入口o/eへの独立した寄与分解は表示しません。全光または反射を経た光を同じ露光で確認できます。';
  $('biaxialNote').hidden = !biax;
  $('physicalTransport').hidden = !physical;
  $('entryHeading').hidden = physical;
  $('mode').closest('label').hidden = physical;
  $('entryNote').hidden = physical;
  syncCoherentFields();
}

function adiabaticDemo(material) {
  stop();
  config = {
    ...Optics.defaults,
    solver: 'auto',
    preset: 'custom',
    material,
    shape: 'cube',
    no: 1.6557,
    ne: 1.4852,
    gradient: 0.18,
    tilt: 35,
    azimuth: 25,
    twist: 1.3,
    projection: 'ortho',
    resolution: 64,
    yaw: 0,
    pitch: 0,
    transport: 'polarized',
    transportView: 'all',
    maxInterfaces: 4,
    minContribution: 0.0001,
    branchPolicy: 'off',
  };
  sync();
  dirty();
  $('exampleNotice').hidden = false;
  $('exampleNotice').textContent =
    (material === 'common' ? 'Common-scale：η=(1+0.18z)⁻²。' : 'Heliconical：光軸の回転率Ω=1.3。') +
    'z正側からの正面視です。断熱近似で内部で光線の種類を維持し、実際の表面で偏光依存の反射・透過を計算します。64 px・最大4界面。論文の図と同一条件ではありません。';
}
function initTransport() {
  $('gpuCalciteDemo').onclick = () => {
    stop();
    config = MaterialCatalog.apply(
      {
        ...Optics.defaults,
        solver: 'auto',
        computeBackend: 'gpu',
        shape: 'cube',
        projection: 'ortho',
        resolution: 64,
        transport: 'polarized',
        branchModel: 'modal',
        branchPolicy: 'off',
      },
      'calcite',
    );
    config.tilt = 35;
    config.azimuth = 17;
    config.preset = 'custom';
    sync();
    dirty();
    $('exampleNotice').hidden = false;
    $('exampleNotice').textContent =
      'GPU検証例：Calciteを模した立方体、光軸35°／17°、正面、64 px。レンダリングで計算します。';
  };
  for (const [id, shape] of [
    ['gpuSphereDemo', 'sphere'],
    ['gpuTorusDemo', 'torus'],
  ])
    $(id).onclick = () => {
      stop();
      config = MaterialCatalog.apply(
        {
          ...Optics.defaults,
          solver: 'auto',
          computeBackend: 'gpu',
          shape,
          projection: 'ortho',
          resolution: 64,
          transport: 'polarized',
          transportView: 'all',
          branchModel: 'modal',
          branchPolicy: 'off',
          maxInterfaces: 12,
        },
        'calcite',
      );
      config.tilt = 0;
      config.azimuth = 0;
      config.yaw = 0;
      config.pitch = shape === 'torus' ? 30 : 0;
      sync();
      dirty();
      $('exampleNotice').hidden = false;
      $('exampleNotice').textContent =
        'GPU例：Calcite・' +
        (shape === 'sphere' ? '球、光軸0°、正面' : 'トーラス、光軸0°、視点の仰角30°') +
        '、64 px。表面最大12回。レンダリングで計算します。';
    };
  $('gpuNumericalDemo').onclick = () => {
    stop();
    config = {
      ...Optics.defaults,
      material: 'heliconical',
      preset: 'custom',
      shape: 'cube',
      solver: 'auto',
      computeBackend: 'gpu',
      transport: 'polarized',
      projection: 'ortho',
      resolution: 64,
      yaw: 12,
      pitch: 0,
      tilt: 35,
      azimuth: 0,
      twist: 2.1,
      branchModel: 'coherent',
      branchPolicy: 'overlap',
      branchDepth: 3,
      coherentInterface: 'finite-resolved',
      lengthUnitUm: 1,
      wavelengthNm: 550,
      beamRadiusUm: 0.03,
      overlapCutoff: 0.001,
      phaseSlices: 1,
      phaseTolerance: 2e-6,
      maxInterfaces: 4,
    };
    sync();
    dirty();
    $('exampleNotice').hidden = false;
    $('exampleNotice').textContent =
      'GPU数値軌道例：Heliconical・立方体、光軸35°・水平12°（この例の設定）、64 px。閉式解を優先し、一般入射の軌道はSchur求積、位相を含む偏光輸送は数値積分します。';
  };
  $('gpuRKDemo').onclick = () => {
    stop();
    config = {
      ...Optics.defaults,
      material: 'axial2013Uniaxial',
      preset: 'custom',
      shape: 'sphere',
      solver: 'rkf45',
      computeBackend: 'gpu',
      transport: 'polarized',
      projection: 'ortho',
      resolution: 64,
      yaw: 0,
      pitch: 0,
      tilt: 0,
      azimuth: 0,
      gradient: 0.2,
      branchModel: 'modal',
      branchPolicy: 'off',
      maxInterfaces: 4,
    };
    sync();
    dirty();
    $('exampleNotice').hidden = false;
    $('exampleNotice').textContent =
      'GPU RKF45例：2013 axialの一軸媒質モデル・球、g=0.2、正面0°、64 px。両モードをHamilton方程式の数値積分で追跡し、表面の反射・透過を計算します。';
  };
  for (const [id, phase] of [
    ['gpuPhaseDemo', true],
    ['gpuModalDemo', false],
  ])
    $(id).onclick = () => {
      stop();
      config = {
        ...Optics.defaults,
        material: 'heliconical',
        preset: 'custom',
        shape: 'cube',
        solver: 'auto',
        computeBackend: 'gpu',
        transport: 'polarized',
        transportView: 'all',
        projection: 'ortho',
        resolution: 64,
        yaw: 0,
        pitch: 0,
        tilt: 35,
        azimuth: 0,
        twist: 2.1,
        branchModel: phase ? 'coherent' : 'modal',
        branchPolicy: phase ? 'overlap' : 'planes',
        branchPlanes: '-0.5, 0, 0.5',
        branchDepth: 3,
        coherentInterface: 'finite-resolved',
        lengthUnitUm: 1,
        wavelengthNm: 550,
        beamRadiusUm: 0.02,
        overlapCutoff: 0.001,
        phaseSlices: 1,
        phaseTolerance: 2e-6,
        maxInterfaces: phase ? 4 : 2,
      };
      sync();
      dirty();
      $('exampleNotice').hidden = false;
      $('exampleNotice').textContent =
        'GPU偏光例：Heliconical・立方体、光軸35°（この例の設定）、視点0°、64 px。' +
        (phase
          ? '閉式解による軌道を優先して位相差を保持し、光束の重なりと実際の表面で分離します。'
          : 'z=−0.5,0,0.5で位相を省略するモード分配を計算します。') +
        ' 条件外の画素はCPUで再計算します。';
    };
  for (const [id, preset, shape] of [
    ['gpuAnisotropicDemo', 'quadratic', 'sphere'],
    ['gpuShearDemo', 'shear', 'sphere'],
  ])
    $(id).onclick = () => {
      stop();
      config = MaterialCatalog.apply(
        {
          ...Optics.defaults,
          solver: 'auto',
          computeBackend: 'gpu',
          shape,
          projection: 'ortho',
          resolution: 64,
          transport: 'polarized',
          transportView: 'all',
          branchModel: 'modal',
          branchPolicy: 'off',
          maxInterfaces: 8,
        },
        preset,
      );
      Object.assign(config, { tilt: 0, azimuth: 0, roll: 0, yaw: 0, pitch: 0 });
      sync();
      dirty();
      $('exampleNotice').hidden = false;
      $('exampleNotice').textContent =
        'GPU例：' +
        (preset === 'quadratic'
          ? 'Quadratic common-scale・球、g=0.2、光軸0°'
          : 'Coordinate-shear・球、shift=0.5') +
        '、正面0°、64 px。閉式解による軌道と表面の反射・透過を計算します。閉式解の条件外では数値軌道を使い、精度不足の場合はCPUで再計算します。';
    };
  $('gpuGrinDemo').onclick = () => {
    stop();
    config = MaterialCatalog.apply(
      {
        ...Optics.defaults,
        solver: 'auto',
        computeBackend: 'gpu',
        shape: 'sphere',
        projection: 'ortho',
        resolution: 64,
        transport: 'polarized',
        transportView: 'all',
        branchModel: 'modal',
        branchPolicy: 'off',
        maxInterfaces: 8,
      },
      'parabolic',
    );
    Object.assign(config, { tilt: 0, azimuth: 0, roll: 0, yaw: 0, pitch: 0 });
    sync();
    dirty();
    $('exampleNotice').hidden = false;
    $('exampleNotice').textContent =
      'GPU例：Radial gradient・球、n₀=1.5、g=0.3、正面0°、64 px。閉式解による軌道、曲線に沿う偏光輸送、表面での反射・透過を計算します。';
  };
  $('gpuBiaxialDemo').onclick = () => {
    stop();
    config = MaterialCatalog.apply(
      {
        ...Optics.defaults,
        solver: 'auto',
        computeBackend: 'gpu',
        shape: 'cube',
        projection: 'ortho',
        resolution: 64,
        transport: 'polarized',
        transportView: 'all',
        branchModel: 'modal',
        branchPolicy: 'off',
        maxInterfaces: 8,
      },
      'ktpIR',
    );
    Object.assign(config, { tilt: 0, azimuth: 0, roll: 0, yaw: 0, pitch: 0 });
    sync();
    dirty();
    $('exampleNotice').hidden = false;
    $('exampleNotice').textContent =
      'GPU例：KTP・1064 nm、立方体、主軸と視点の角度0°、64 px。固有モード1・2の界面分配と多重反射を計算します。球・トーラスにも変更できます。';
  };
  $('gpuCommonDemo').onclick = () => {
    stop();
    config = {
      ...Optics.defaults,
      solver: 'auto',
      computeBackend: 'gpu',
      preset: 'custom',
      material: 'common',
      shape: 'cube',
      no: 1.658,
      ne: 1.486,
      gradient: 0.18,
      tilt: 35,
      azimuth: 25,
      projection: 'ortho',
      resolution: 64,
      yaw: 12,
      pitch: 0,
      transport: 'polarized',
      transportView: 'all',
      branchModel: 'modal',
      branchPolicy: 'off',
      maxInterfaces: 6,
    };
    sync();
    dirty();
    $('exampleNotice').hidden = false;
    $('exampleNotice').textContent =
      'GPU検証例：Common-scaleの閉式解による軌道と断熱輸送、立方体、光軸35°／25°、水平12°、64 px。内部分岐・位相輸送は使わない条件です。レンダリングで計算します。';
  };

  $('grinDemo').onclick = () => {
    stop();
    config = MaterialCatalog.apply(
      {
        ...Optics.defaults,
        solver: 'auto',
        shape: 'sphere',
        projection: 'ortho',
        resolution: 64,
        transport: 'polarized',
        maxInterfaces: 6,
      },
      'parabolic',
    );
    sync();
    dirty();
    $('exampleNotice').hidden = false;
    $('exampleNotice').textContent =
      'Radial gradient（Marchandの特殊な二乗屈折率分布）：球、n₀=1.5、g=0.3、64 px、正面0°。曲線に沿う偏光輸送と表面での反射・透過を計算します。数値条件はアプリ用です。「レンダリング」で表示します。';
  };
  $('commonComparisonDemo').onclick = () => {
    stop();
    config = {
      ...Optics.defaults,
      preset: 'custom',
      material: 'common',
      shape: 'cube',
      solver: 'auto',
      no: 1.6557,
      ne: 1.4852,
      gradient: 0.18,
      tilt: 35,
      azimuth: 25,
      projection: 'ortho',
      resolution: 64,
      yaw: 12,
      pitch: 0,
      transport: 'polarized',
      transportView: 'all',
      maxInterfaces: 4,
      minContribution: 1e-4,
      branchPolicy: 'off',
    };
    sync();
    dirty();
    $('exampleNotice').hidden = false;
    $('exampleNotice').textContent =
      'common-scale比較用：立方体、軸傾斜35°・方位25°、視点水平12°、64 px。正面平行板の特殊条件を避け、勾配による像位置と界面での強度分配の変化を比較します。「軌道・媒質の比較」タブで実行できます。';
  };
  $('biaxDemo').onclick = () => {
    stop();
    config = MaterialCatalog.apply(
      {
        ...Optics.defaults,
        solver: 'auto',
        shape: 'cube',
        projection: 'ortho',
        resolution: 64,
        yaw: 0,
        pitch: 0,
        transport: 'polarized',
        transportView: 'all',
        maxInterfaces: 6,
        minContribution: 1e-4,
      },
      'ktpIR',
    );
    Object.assign(config, { tilt: 35, azimuth: 25 });
    sync();
    dirty();
    $('exampleNotice').hidden = false;
    $('exampleNotice').textContent =
      'KTPの1064 nmの主屈折率を使う均一二軸異方性の例です。二重像を比較するため、このデモでは傾き35°・方位角25°に設定しています。通常の媒質選択では0°です。z正側の正面視、自然光（無偏光）を仮定、64 px。「レンダリング」で表示します。固有モード1・2の寄与を個別に確認できます。';
  };
  $('commonDemo').onclick = () => adiabaticDemo('common');
  $('helicalDemo').onclick = () => adiabaticDemo('heliconical');
  for (const id of [
    'transport',
    'transportView',
    'maxInterfaces',
    'minContribution',
    'maxRayWork',
    'untracedTolerance',
  ])
    $(id).onchange = () => {
      config[id] = ['maxInterfaces', 'minContribution', 'maxRayWork', 'untracedTolerance'].includes(
        id,
      )
        ? Number($(id).value) / (id === 'untracedTolerance' ? 100 : 1)
        : $(id).value;
      if (id === 'transport') syncBranches();
      syncTransport();
      dirty();
    };
  $('polarDemo').onclick = () => {
    stop();
    config = {
      ...Optics.defaults,
      solver: 'auto',
      preset: 'custom',
      material: 'uniaxial',
      shape: 'cube',
      no: 1.6557,
      ne: 1.4852,
      tilt: 35,
      azimuth: 25,
      projection: 'ortho',
      resolution: 64,
      yaw: 0,
      transport: 'polarized',
      transportView: 'all',
      maxInterfaces: 6,
      minContribution: 1e-4,
      branchPolicy: 'off',
    };
    sync();
    dirty();
    $('exampleNotice').hidden = false;
    $('exampleNotice').textContent =
      'Calciteを模した均一板の反射・透過例です。このデモは傾き35°・方位角25°。通常の媒質選択では0°です。自然光（無偏光）を仮定、64 px。「レンダリング」で計算します。o/e寄与は個別に表示できます。';
  };
}

function coherentDemo(split) {
  stop();
  config = {
    ...Optics.defaults,
    solver: 'auto',
    preset: 'custom',
    material: 'heliconical',
    shape: 'slab',
    no: 1.658,
    ne: 1.486,
    tilt: 60,
    azimuth: 0,
    twist: 1,
    projection: 'ortho',
    resolution: 64,
    yaw: 0,
    pitch: 0,
    transport: 'polarized',
    transportView: 'all',
    maxInterfaces: 6,
    minContribution: 1e-5,
    branchModel: 'coherent',
    branchPolicy: 'overlap',
    branchDepth: 6,
    wavelengthNm: 550,
    lengthUnitUm: split ? 1000 : 10,
    beamRadiusUm: split ? 30 : 10,
    overlapCutoff: 0.001,
    phaseSlices: 1,
    coherentInterface: 'retained',
  };
  sync();
  dirty();
  $('exampleNotice').hidden = false;
  $('exampleNotice').textContent =
    '位相を含む偏光輸送：側面のない平行平板、光軸60°、正面0°。厚さ' +
    (split ? '2 mm、光束半径30 μm' : '20 μm、光束半径10 μm') +
    '、波長550 nm。各モードは元の閉式解による軌道を進みます。光束分離の回数上限は6回。';
}
function syncCoherentFields() {
  const finite = config.shape !== 'slab';
  if (Optics.polarization.coherent.selected(config)) {
    if (finite) config.coherentInterface = 'finite-resolved';
    else if (config.coherentInterface === 'finite-resolved') config.coherentInterface = 'resolved';
  }
  for (const option of $('coherentInterface').options)
    option.disabled = finite
      ? option.value !== 'finite-resolved'
      : option.value === 'finite-resolved';
  for (const key of Object.keys(Optics.polarization.coherent.defaults))
    $(key).value = config[key] ?? Optics.polarization.coherent.defaults[key];
  if (!Optics.polarization.coherent.selected(config)) {
    $('branchDepth').parentElement.hidden = false;
    $('depthNote').hidden = false;
    return;
  }
  const retained = config.coherentInterface === 'retained',
    coupled = Optics.polarization.phaseInterface.selected(config);
  $('commonMinOverlapLabel').hidden = $('commonCarrierNote').hidden = !coupled;
  $('overlapCutoff').disabled = coupled;
  $('branchDepth').disabled = coupled;
  $('branchDepth').parentElement.hidden = coupled;
  $('depthNote').hidden = coupled;
  if (coupled) {
    $('branchNote').textContent =
      '光束が十分重なる範囲に限定し、入口・内部・出口と反射後の偏光を接続します。条件外で従来方式へ自動的には切り替えません。';
    $('branchWeightNote').textContent =
      '二本の解析軌道の中点を共通光束の代表位置とする近似です。媒質内に分岐面を指定せず、光束の重なりを確認しながら追跡します。';
  }
  $('coherentInterfaceNote').textContent = finite
    ? '有限形状：入口では局所法線からo/e光線を求め、内部の共通区間は位相を保持します。一方が表面に到達した時点で相関を捨て、各光線の位置・法線で反射と透過を計算します。z折り返しやもう一方のモードが使えない区間は単独モード近似とし、回数を表示します。'
    : coupled
      ? (config.coherentInterface === 'coupled'
          ? '4媒質の斜入射に対応。光束が十分重なる条件で、入口・出口・反射後も相関を保持します。'
          : '比較用：共通光束の位置は同じですが、実際の表面で二モードの相関を捨てます。') +
        ' 二重像の各中心ではなく、共通光束の代表位置で背景を評価します。'
      : retained
        ? '正面heliconical専用です。実際の表面で反射した二モードの相関も保持します。以前の位相輸送デモと同じ界面モデルです。'
        : '一般入射では、実際の表面で二モードの相関を捨て、固有光線ごとに反射・透過率を計算する追加近似を使います。媒質内部の数値分割点では相関を捨てません。板全体のコヒーレントな反射・透過解ではありません。';
  $('phaseTolerance').disabled = retained;
  try {
    Optics.polarization.coherent.validate(config);
    const distance = config.beamRadiusUm * Math.sqrt(-2 * Math.log(config.overlapCutoff)),
      rayleigh =
        (Math.PI * Math.min(config.no, config.ne) * config.beamRadiusUm ** 2) /
        (config.wavelengthNm * 0.001);
    let detail =
      '一般条件の偏光積分の許容誤差 ' +
      config.phaseTolerance +
      '。初期分割数 ' +
      config.phaseSlices +
      '。';
    if (retained) {
      const q = Optics.polarization.coherent.transfer(-1, 1, config, 1);
      detail =
        '空間分離なし・表面を除く1通過のモード変換率 ' +
        (100 * q.conversion).toPrecision(5) +
        '%（位相差を省くと ' +
        (100 * Math.sin(2 * q.g) ** 2).toFixed(2) +
        '%）。';
    }
    $('coherentMetrics').textContent =
      (finite
        ? '座標1単位 ' + config.lengthUnitUm + ' μm（球の直径・立方体の辺は2単位）。'
        : '厚さ ' + 2 * config.lengthUnitUm + ' μm。') +
      detail +
      (coupled
        ? '共通光束の最小重なり ' + config.commonMinOverlap + '。'
        : '光束中心間の分離判定距離 ' + distance.toPrecision(4) + ' μm。') +
      (2 * config.lengthUnitUm > rayleigh
        ? ' この光束幅では厚さがGaussian光束のRayleigh長の目安を超えます。回折を省く本モデルの結果は探索用として扱ってください。'
        : '');
  } catch (e) {
    $('coherentMetrics').textContent = e.message;
  }
}
function phaseGeneralDemo(material) {
  stop();
  config = {
    ...Optics.defaults,
    solver: 'auto',
    preset: 'custom',
    material,
    shape: 'slab',
    no: 1.658,
    ne: 1.486,
    tilt: material === 'axial2013Uniaxial' ? 0 : 55,
    azimuth: 17,
    twist: 0.7,
    gradient: 0.12,
    projection: 'ortho',
    resolution: 64,
    yaw: 15,
    pitch: 6,
    transport: 'polarized',
    transportView: 'all',
    maxInterfaces: 4,
    minContribution: 1e-5,
    branchModel: 'coherent',
    branchPolicy: 'overlap',
    branchDepth: 6,
    wavelengthNm: 550,
    lengthUnitUm: 5,
    beamRadiusUm: 20,
    overlapCutoff: 0.001,
    phaseSlices: 1,
    phaseTolerance: 2e-6,
    coherentInterface: 'resolved',
  };
  sync();
  dirty();
  $('exampleNotice').hidden = false;
  $('exampleNotice').textContent =
    '一般の位相輸送：平行平板、視点水平15°・仰角6°、厚さ10 μm。軌道と偏光を別々に計算します。媒質内部は相関を保持し、実際の表面では独立した光線へ分ける近似です。';
}
