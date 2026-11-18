/* Scene settings and file migrations. No DOM or rendering side effects. */
(function (root) {
  'use strict';
  const parameters = {
    n: ['屈折率 n / n₀', 0.05, 3, 0.00001],
    outsideN: ['外部屈折率 nₑₓₜ', 0.05, 3, 0.00001],
    no: ['nₒ（hyperbolicは |εₒ|½）', 0.05, 3, 0.00001],
    ne: ['nₑ', 0.05, 3, 0.00001],
    nx: ['nₓ', 0.05, 3, 0.00001],
    ny: ['nᵧ', 0.05, 3, 0.00001],
    nz: ['n𝓏', 0.05, 3, 0.00001],
    gradient: ['空間分布の係数 g', -1, 1, 0.001],
    engStrength: ['ENG軸方向係数', 0, 20, 0.01],
    radialRadius: ['放射状媒質の半径尺度 R', 5.5, 12, 0.05],
    transformInner: ['座標変換の内半径 a', 0, 1.5, 0.01],
    transformOuter: ['座標変換の外半径 b', 4.6, 8, 0.05],
    tilt: ['光軸の傾き（＋zから）°', 0, 90, 1],
    azimuth: ['光軸の方位角 °', -180, 180, 1],
    roll: ['第3主軸まわりの回転 °', -180, 180, 1],
    twist: ['回転率 Ω', 0, 6.28, 0.01],
    shift: ['せん断変換の変位 Δx', -1, 1, 0.01],
    fov: ['透視投影の画角 °', 4, 70, 1],
    yaw: ['視点の水平角 °', -45, 45, 1],
    pitch: ['視点の仰角 °', -35, 35, 1],
    backgroundZ: ['背景面の z', -6, 6, 0.1],
  };

  const version = 15;
  const choices = {
    shape: ['sphere', 'cube', 'torus', 'slab', 'asphere'],
    mode: [0, 1, 2],
    solver: ['auto', 'rkf45', 'schur'],
    projection: ['perspective', 'ortho'],
    background: ['grid', 'uv', 'markers', 'white'],
    computeBackend: ['cpu', 'gpu'],
  };
  function standard() {
    return MaterialCatalog.apply(
      {
        ...Optics.defaults,
        ...Spectral.defaults,
        solver: 'auto',
        transport: 'polarized',
        branchModel: 'modal',
        branchDepth: 3,
      },
      'glass-N-BK7',
    );
  }
  function customize(input) {
    const c = { ...input };
    // Moving to custom settings must not erase the selected spectral curve.
    if (
      Spectral.enabled(c) &&
      (c.spectralModel ?? 'auto') === 'auto' &&
      Spectral.datasets[Spectral.source(c)]
    )
      c.spectralModel = Spectral.source(c);
    c.preset = 'custom';
    return c;
  }
  function preset(input, id) {
    if (id === 'custom') return customize(input);
    return { ...MaterialCatalog.apply(input, id), spectralModel: 'auto' };
  }
  function validateView(c) {
    if (!['positive', 'negative'].includes(c.cameraSide)) throw Error('観察する側が不正です');
    const behind =
      c.cameraSide === 'positive'
        ? c.backgroundZ >= -6 && c.backgroundZ <= -2
        : c.backgroundZ >= 2 && c.backgroundZ <= 6;
    if (!behind)
      throw Error('背景は物体の奥に設定してください（z正側から観察：−6〜−2、z負側：2〜6）');
  }
  function validate(c) {
    if (!MaterialCatalog.models[c.material]) throw Error('媒質モデルが不正です');
    validateView(c);
    if (!Number.isInteger(c.resolution) || c.resolution < 4 || c.resolution > 1024)
      throw Error('画像の一辺は4〜1024画素の整数で指定してください');
    for (const [key, entry] of Object.entries(parameters)) {
      if (!Number.isFinite(c[key]) || c[key] < entry[1] || c[key] > entry[2])
        throw Error(entry[0] + 'の範囲が不正です');
    }
    for (const [key, values] of Object.entries(choices))
      if (!values.includes(c[key])) throw Error('計算設定が不正です：' + key);
    if (!(c.step >= 0.005 && c.step <= 0.1))
      throw Error('交差を確認する間隔は0.005〜0.1で指定してください');
    Optics.odeSettings(c);
    Optics.outsideIndex(c);
    Optics.polarization.validateIsotropicProfile(c);
    if (c.transport === 'polarized') Optics.polarization.validate(c);
    else if (c.transport === 'legacy') Optics.branching.settings(c);
    else throw Error('光の計算方式が不正です');
    Spectral.validate(c);
    return c;
  }
  function fromDocument(document) {
    if (
      !document ||
      !Number.isInteger(document.version) ||
      document.version < 1 ||
      document.version > version ||
      !document.config ||
      typeof document.config !== 'object' ||
      Array.isArray(document.config)
    )
      throw Error('設定形式が不正です');
    const c = { ...document.config },
      warnings = [];
    if (c.solver === 'rk4') {
      c.solver = 'rkf45';
      warnings.push(
        '旧設定のRK4をRKF45へ移行しました。旧RK4画像の再現ではなく、指定された許容誤差で再計算します。',
      );
    }
    if (document.version <= 8 && c.branchModel === 'coherent') c.coherentInterface = 'retained';
    for (const [key, value] of Object.entries(Optics.polarization.coherent.defaults))
      c[key] ??= value;
    for (const [key, value] of Object.entries(Spectral.defaults)) c[key] ??= value;
    c.roll ??= 0;
    c.cameraSide ??= document.version < 4 ? 'negative' : 'positive';
    c.outsideN ??= 1;
    c.preset ??= 'custom';
    c.computeBackend ??= 'cpu';
    c.transport ??= 'legacy';
    c.branchModel ??= 'equal';
    if (document.version < 6) c.branchModel = 'equal';
    if (document.version < 5 && c.transport === 'polarized') c.branchPolicy = 'off';
    c.transportView ??= 'all';
    c.maxInterfaces ??= 6;
    c.minContribution ??= 1e-4;
    c.maxRayWork ??= 2048;
    c.untracedTolerance ??= document.version < 12 ? 0 : 0.001;
    if (!['legacy', 'polarized'].includes(c.transport)) throw Error('光の計算方式が不正です');
    const transport = Optics.polarization.supported(c) ? 'polarized' : 'legacy';
    if (c.transport !== transport)
      warnings.push(
        '媒質モデルに合わせて光の計算方式を設定しました。以前の簡易計算とは明るさが変わる場合があります。',
      );
    c.transport = transport;
    let settings = { ...Optics.defaults, ...c, maxSteps: 650 };
    if (settings.preset !== 'custom' && !MaterialCatalog.matchesPreset(settings, settings.preset))
      settings = customize(settings);
    validate(settings);
    return { config: settings, warnings };
  }
  function toDocument(c, result) {
    return { version, config: structuredClone(c), result };
  }
  root.SceneConfig = {
    version,
    parameters,
    choices,
    standard,
    preset,
    customize,
    validateView,
    validate,
    fromDocument,
    toDocument,
  };
})(globalThis);
