/* Spectral radiance sampling. Different wavelengths add as intensities. */
(function (root) {
  'use strict';
  const defaults = {
    spectralMode: 'off',
    spectralModel: 'auto',
    spectralMin: 380,
    spectralMax: 780,
    spectralSamples: 32,
    spectralBackground: 'checker',
    spectralReference: 587.6,
    cauchyB: 0.004,
    cauchyBo: 0.004,
    cauchyBe: 0.004,
    cauchyBx: 0.004,
    cauchyBy: 0.004,
    cauchyBz: 0.004,
    cauchyOutside: 0,
  };
  const scalar = [
    'isotropic',
    'sphericalSquared',
    'radialSquared',
    'axialSquared',
    'radial',
    'axial',
  ];
  const uniaxial = ['uniaxial', 'common', 'quadratic', 'heliconical'];
  const crystals = {
    calcite: {
      label: 'Calcite · Crysmit',
      type: 'uniaxial',
      min: 380,
      coefficients: [
        [2.69705, 0.0192064, 0.0182, 0.0151624],
        [2.18438, 0.0087309, 0.01018, 0.0024411],
      ],
      url: 'https://www.crysmit.com/Calcite',
    },
    bbo: {
      label: 'BBO · EKSMA',
      type: 'uniaxial',
      min: 380,
      coefficients: [
        [2.7366122, 0.018572, 0.0178746, 0.0143756],
        [2.3698703, 0.0128445, 0.0153064, 0.0029129],
      ],
      url: 'https://www.eksmaoptics.com/v/bbo-2203h/29736',
    },
    linbo: {
      label: 'LiNbO₃ · EKSMA',
      type: 'uniaxial',
      min: 420,
      coefficients: [
        [4.9048, 0.11768, 0.0475, 0.027169],
        [4.582, 0.099169, 0.04443, 0.02195],
      ],
      url: 'https://eksmaoptics.com/out/media/EKSMA_Optics_Laser_Components_Catalog_2017.pdf',
    },
    lbo: {
      label: 'LBO · EKSMA',
      type: 'biaxial',
      min: 380,
      coefficients: [
        [2.4542, 0.01125, 0.01135, 0.01388],
        [2.539, 0.01277, 0.01189, 0.01849, 4.3025e-5, -2.9131e-5],
        [2.5865, 0.0131, 0.01223, 0.01862, 4.5778e-5, -3.2526e-5],
      ],
      url: 'https://www.eksmaoptics.com/v/lbo-501/1436',
    },
    ktp: {
      label: 'KTP · CASTECH',
      type: 'biaxial',
      min: 380,
      coefficients: [
        [3.0065, 0.03901, 0.04251, 0.01327],
        [3.0333, 0.04154, 0.04547, 0.01408],
        [3.3134, 0.05694, 0.05658, 0.01682],
      ],
      url: 'https://www.castech.com/product/KTP---Potassium-Titanyl-Phosphate-186.html',
    },
  };
  function family(c) {
    return scalar.includes(c.material)
      ? 'scalar'
      : uniaxial.includes(c.material)
        ? 'uniaxial'
        : c.material === 'biaxial'
          ? 'biaxial'
          : c.material === 'hyperbolic'
            ? 'signed'
            : 'constitutive';
  }
  function keys(c) {
    return {
      scalar: ['n'],
      uniaxial: ['no', 'ne'],
      biaxial: ['nx', 'ny', 'nz'],
      signed: ['no', 'ne'],
      constitutive: [],
    }[family(c)];
  }
  const datasets = Object.fromEntries([
    ...Object.entries(root.SchottDispersion).map(([id, r]) => [
      'glass-' + id,
      {
        label: id + ' · SCHOTT',
        type: 'scalar',
        min: Math.max(380, 1000 * r.LD[0]),
        max: Math.min(780, 1000 * r.LD[1]),
        glass: r,
        url: 'https://www.schott.com/en-se/products/optical-glass-p1000267',
      },
    ]),
    ...Object.entries(crystals).map(([id, r]) => [id, { ...r, max: 780 }]),
  ]);
  function source(c) {
    const id = c.spectralModel ?? defaults.spectralModel;
    return id === 'auto' ? { bboIR: 'bbo', ktpIR: 'ktp' }[c.preset] || c.preset : id;
  }
  function coefficients(c, nm) {
    const id = source(c),
      data = datasets[id],
      l2 = (nm / 1000) ** 2;
    if (!data)
      throw Error(
        'この媒質には分散データが登録されていません。分散式を選ぶか、Cauchy近似・分散なしを明示的に選んでください。',
      );
    if (data.type !== family(c))
      throw Error('分散データの主屈折率の種類が媒質モデルに合いません。');
    if (nm < data.min - 1e-8 || nm > data.max + 1e-8)
      throw Error(
        data.label +
          ' のアプリ対応帯域は ' +
          data.min +
          '–' +
          data.max +
          ' nm です。積分する波長範囲を変更してください。',
      );
    const values = data.glass
      ? [
          Math.sqrt(
            1 +
              [0, 2, 4].reduce(
                (s, i) => s + (data.glass.CD[i] * l2) / (l2 - data.glass.CD[i + 1]),
                0,
              ),
          ),
        ]
      : data.coefficients.map(([a, b, d, e, f = 0, g = 0]) =>
          Math.sqrt(a + b / (l2 - d) - e * l2 + f * l2 * l2 + g * l2 * l2 * l2),
        );
    return Object.fromEntries(keys(c).map((key, i) => [key, values[i]]));
  }
  function sampleConfig(input, nm) {
    const c = { ...defaults, ...input },
      model = c.spectralModel,
      out = {
        ...c,
        spectralMode: 'off',
        spectralSample: true,
        captureLinear: true,
        wavelengthNm: nm,
        background:
          c.spectralBackground === 'landmarks'
            ? 'spectralLandmarks'
            : c.spectralBackground === 'white'
              ? 'white'
              : c.spectralBackground === 'smooth'
                ? 'spectralSmooth'
                : 'spectralChecker',
      };
    if (model === 'cauchy') {
      if (!keys(c).length)
        throw Error('この媒質モデルでは主屈折率を独立に指定できないため、Cauchy近似は選べません。');
      const bs = {
        n: 'cauchyB',
        no: 'cauchyBo',
        ne: 'cauchyBe',
        nx: 'cauchyBx',
        ny: 'cauchyBy',
        nz: 'cauchyBz',
      };
      for (const key of keys(c))
        out[key] =
          c[key] + c[bs[key]] * (1 / (nm / 1000) ** 2 - 1 / (c.spectralReference / 1000) ** 2);
    } else if (model !== 'constant') Object.assign(out, coefficients(c, nm));
    out.outsideN =
      c.outsideN + c.cauchyOutside * (1 / (nm / 1000) ** 2 - 1 / (c.spectralReference / 1000) ** 2);
    if ([...keys(c).map((k) => out[k]), out.outsideN].some((v) => !Number.isFinite(v) || v <= 0.05))
      throw Error('波長 ' + nm + ' nm で屈折率が非正または小さすぎます。');
    return out;
  }
  function enabled(c) {
    return c.spectralMode === 'on';
  }
  function validate(input) {
    const c = { ...defaults, ...input };
    if (!['off', 'on'].includes(c.spectralMode)) throw Error('分散の設定が不正です。');
    if (!enabled(c)) return;
    if (c.transport !== 'polarized')
      throw Error('スペクトル描画には反射・屈折の強度を定義できる媒質モデルが必要です。');
    if (!['auto', 'constant', 'cauchy', ...Object.keys(datasets)].includes(c.spectralModel))
      throw Error('分散モデルが不正です。');
    if (
      !Number.isFinite(c.spectralMin) ||
      !Number.isFinite(c.spectralMax) ||
      c.spectralMin < 380 ||
      c.spectralMax > 780 ||
      c.spectralMax - c.spectralMin < 10
    )
      throw Error('波長範囲は380–780 nm内、幅10 nm以上で指定してください。');
    if (![8, 16, 32, 64, 128, 256].includes(c.spectralSamples))
      throw Error('波長数の設定が不正です。');
    if (!['checker', 'white', 'smooth', 'landmarks'].includes(c.spectralBackground))
      throw Error('スペクトル背景の設定が不正です。');
    if (!(c.spectralReference >= 380 && c.spectralReference <= 1100))
      throw Error('基準波長は380–1100 nmで指定してください。');
    for (const k of [
      'cauchyB',
      'cauchyBo',
      'cauchyBe',
      'cauchyBx',
      'cauchyBy',
      'cauchyBz',
      'cauchyOutside',
    ])
      if (!Number.isFinite(c[k]) || Math.abs(c[k]) > 0.2)
        throw Error('Cauchy係数は−0.2〜0.2 μm²で指定してください。');
    const samples = [
      c.spectralMin,
      c.spectralMax,
      ...Array.from(
        { length: c.spectralSamples },
        (_, i) => c.spectralMin + ((i + 0.5) * (c.spectralMax - c.spectralMin)) / c.spectralSamples,
      ),
    ];
    for (const nm of samples) {
      const sc = sampleConfig(c, nm);
      root.Optics.polarization.validate(sc);
      root.Optics.polarization.validateIsotropicProfile(sc);
    }
  }
  function cie(nm) {
    const k = Math.max(0, Math.min(399, Math.floor(nm) - 380)),
      t = nm - (380 + k),
      a = root.CIEVisible[k],
      b = root.CIEVisible[k + 1];
    return [1, 2, 3, 4].map((i) => a[i] * (1 - t) + b[i] * t);
  }
  // Accurately integrate the known illuminant/CMF within each bin. Expensive
  // transport uses its midpoint. Constant spectra retain brightness at any N.
  function integrate(a, b) {
    const s = [0, 0, 0];
    for (let x = a; x < b; ) {
      const y = Math.min(b, Math.floor(x + 1e-10) + 1),
        h = y - x,
        v0 = cie(x),
        vm = cie((x + y) / 2),
        v1 = cie(y);
      for (let j = 0; j < 3; j++)
        s[j] += (h / 6) * (v0[j] * v0[3] + 4 * vm[j] * vm[3] + v1[j] * v1[3]);
      x = y;
    }
    return s;
  }
  const normalization = integrate(380, 780)[1];
  function plan(input) {
    const c = { ...defaults, ...input };
    validate(c);
    const h = (c.spectralMax - c.spectralMin) / c.spectralSamples;
    return Array.from({ length: c.spectralSamples }, (_, i) => {
      const a = c.spectralMin + i * h,
        b = a + h,
        nm = (a + b) / 2;
      return {
        nm,
        xyz: integrate(a, b).map((v) => v / normalization),
        config: sampleConfig(c, nm),
      };
    });
  }
  function rgb(x, y, z) {
    return [
      3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
      -0.969266 * x + 1.8760108 * y + 0.041556 * z,
      0.0556434 * x - 0.2040259 * y + 1.0572252 * z,
    ];
  }
  function description(c) {
    if (!enabled(c)) return '単色の物性値・従来のRGB背景';
    const d = datasets[source(c)];
    return (
      c.spectralMin +
      '–' +
      c.spectralMax +
      ' nm / ' +
      c.spectralSamples +
      '波長 / D65 / ' +
      (c.spectralModel === 'cauchy'
        ? '任意Cauchy近似'
        : c.spectralModel === 'constant'
          ? '屈折率の分散なし（位相は波長依存）'
          : d?.label || '分散データ未登録')
    );
  }
  root.Spectral = {
    defaults,
    enabled,
    validate,
    plan,
    sampleConfig,
    coefficients,
    datasets,
    source,
    family,
    keys,
    rgb,
    description,
    normalization,
  };
})(globalThis);
