/* Material presets contain only verified scalar facts and explicit model assumptions.
   Glass indices: SCHOTT Optical Glass 2025, properties pp.108,110,112,126,128 (printed).
   Values are nd relative to standard air, 587.6 nm; no dispersion or vacuum correction. */
(function (root) {
  const types = {
    isoUniform: '等方性・均一',
    isoGradient: '等方性・不均一',
    aniUniform: '異方性・均一',
    aniGradient: '異方性・不均一',
  };
  const models = {
    radialAnisotropic: {
      type: 'aniGradient',
      label: 'Gibbons–Warnick：放射状光学軸',
      form: 'extraordinaryは直線の閉形式／ordinaryはRKF45',
      params: ['radialRadius'],
    },
    sphericalTransform: {
      type: 'aniGradient',
      label: '球面座標変換媒質の切り出し',
      form: '閉形式（逆座標写像）',
      params: ['transformInner', 'transformOuter'],
    },
    cylindricalTransform: {
      type: 'aniGradient',
      label: '円柱座標変換媒質の切り出し',
      form: '閉形式（逆座標写像）',
      params: ['transformInner', 'transformOuter'],
    },
    isotropic: { type: 'isoUniform', label: '一定の屈折率', form: '閉形式（直線）', params: ['n'] },
    sphericalSquared: {
      type: 'isoGradient',
      label: '球対称：n² = n₀² − g r²（Luneburg型）',
      form: '閉形式',
      params: ['n', 'gradient'],
    },
    radialSquared: {
      type: 'isoGradient',
      label: 'Radial gradient（円柱対称）：n² = n₀² − gρ²',
      form: '閉形式',
      params: ['n', 'gradient'],
    },
    axialSquared: {
      type: 'isoGradient',
      label: '軸方向：n² = n₀² + g z',
      form: '閉形式',
      params: ['n', 'gradient'],
    },
    radial: {
      type: 'isoGradient',
      label: '球対称：n = n₀ + g r²',
      form: 'ODE数値積分',
      params: ['n', 'gradient'],
    },
    axial: {
      type: 'isoGradient',
      label: '軸方向：n = n₀ + g z',
      form: '積分表示を数値求積（本実装）',
      params: ['n', 'gradient'],
    },
    uniaxial: {
      type: 'aniUniform',
      label: '一軸結晶',
      form: '閉形式（直線）',
      params: ['no', 'ne', 'tilt', 'azimuth'],
    },
    biaxial: {
      type: 'aniUniform',
      label: '二軸結晶・Maxwell Fresnel二根',
      form: '閉形式（直線）／界面根は数値探索',
      params: ['nx', 'ny', 'nz', 'tilt', 'azimuth', 'roll'],
    },
    axial2013Uniaxial: {
      type: 'aniGradient',
      label: '2013 axial：一軸媒質としての実現（o/e）',
      form: 'extraordinaryは閉形式／ordinaryは数値求積・ODE',
      params: ['gradient'],
    },
    axial2013: {
      type: 'aniGradient',
      label: 'Nishidate 2013：axial diagonal metric',
      form: '閉形式',
      params: ['gradient'],
    },
    eng2013Magnetic: {
      type: 'aniGradient',
      label: '2013 ENG：磁気異方性を加えた実現（extraordinary）',
      form: '条件付き閉形式／一般光線は数値求積・ODE',
      params: ['engStrength'],
    },
    eng2013: {
      type: 'aniGradient',
      label: 'Nishidate 2013：ENG meridional',
      form: '条件付き閉形式／一般光線は数値求積',
      params: ['engStrength'],
    },
    common: {
      type: 'aniGradient',
      label: 'Common-scale：reciprocal',
      form: '条件付き閉形式',
      params: ['no', 'ne', 'gradient', 'tilt', 'azimuth'],
    },
    quadratic: {
      type: 'aniGradient',
      label: 'Common-scale：quadratic',
      form: '条件付き閉形式',
      params: ['no', 'ne', 'gradient', 'tilt', 'azimuth'],
    },
    hyperbolic: {
      type: 'aniGradient',
      label: 'Hyperbolic：linear scale',
      form: '条件付き閉形式',
      params: ['no', 'ne', 'gradient', 'tilt', 'azimuth'],
    },
    heliconical: {
      type: 'aniGradient',
      label: 'Helical / heliconical axis',
      form: '一般光線は積分表示／横運動量ゼロで閉形式',
      params: ['no', 'ne', 'tilt', 'azimuth', 'twist'],
    },
    shear: {
      type: 'aniGradient',
      label: 'Coordinate-shear変換媒質',
      form: '閉形式',
      params: ['shift'],
    },
    molded2013Transform: {
      type: 'aniGradient',
      label: '2013 molded：変換媒質としての実現（非複屈折）',
      form: 'ODE数値積分（small-slopeを使わない）',
      params: ['n', 'gradient'],
    },
    molded2013: {
      type: 'aniGradient',
      label: 'Nishidate 2013：molded metric',
      form: 'ODE数値積分',
      params: ['n', 'gradient'],
    },
    moldedApprox: {
      type: 'aniGradient',
      label: 'Nishidate 2013：molded small-slope近似',
      form: '近似方程式の閉形式',
      params: ['n', 'gradient'],
    },
  };
  const schott =
    'https://media.schott.com/api/public/content/ff189abcb12f498aa221f54fd0b2055c?v=f4adcbf1';
  const eksma = 'https://eksmaoptics.com/out/media/EKSMA_Optics_Crystals_2016.pdf';
  const marchand =
    'https://www.sciencedirect.com/book/monograph/9780124707504/gradient-index-optics';
  const grin = 'https://doi.org/10.1364/OE.440410',
    nishidate = 'https://doi.org/10.1364/JOSAA.30.001373';
  const presets = [];
  function add(id, label, group, values, source, description) {
    presets.push({ id, label, group, values, source, description });
  }
  const glasses = [
    ['N-BK7', 1.5168],
    ['N-BK10', 1.49782],
    ['N-K5', 1.52249],
    ['K10', 1.50137],
    ['N-ZK7A', 1.50805],
    ['N-FK58', 1.456],
    ['N-FK5', 1.48749],
    ['N-FK51A', 1.48656],
    ['N-PK51', 1.52855],
    ['N-PK52A', 1.497],
    ['N-PSK3', 1.55232],
    ['N-PSK53A', 1.618],
    ['N-BAK1', 1.5725],
    ['N-BAK2', 1.53996],
    ['N-BAK4', 1.56883],
    ['N-SK2', 1.60738],
    ['N-SK4', 1.61272],
    ['N-SK5', 1.58913],
    ['N-SK11', 1.56384],
    ['N-SF1', 1.71736],
    ['N-SF2', 1.64769],
    ['N-SF4', 1.75513],
    ['N-SF5', 1.67271],
    ['N-SF6', 1.80518],
    ['N-SF8', 1.68894],
    ['N-SF10', 1.72828],
    ['N-SF11', 1.78472],
    ['N-LASF9', 1.85025],
    ['N-LASF31A', 1.883],
    ['N-LASF45', 1.80107],
    ['N-LASF46B', 1.90366],
    ['N-LASF55', 1.9538],
  ];
  for (const [name, n] of glasses)
    add(
      'glass-' + name,
      'SCHOTT ' + name + ' · nᴅ=' + n.toFixed(5),
      '等方性・均一：光学ガラス',
      { material: 'isotropic', n },
      schott,
      '587.6 nmの公称nᴅ。標準空気に対する屈折率を使用（真空補正なし）。単色モードの値です。スペクトルモードでは別途SCHOTTの分散式を使用します。温度依存・吸収は計算しません。',
    );
  add(
    'calcite',
    'Calcite · 630 nm',
    '異方性・均一：結晶',
    { material: 'uniaxial', no: 1.6557, ne: 1.4852 },
    'https://www.cm-optics.com/Calcite.html',
    '負の一軸結晶。メーカー表の630 nmの値。軸方向はアプリ用初期値です。',
  );
  for (const [id, label, no, ne] of [
    ['bbo', 'BBO · 532 nm', 1.675, 1.5555],
    ['bboIR', 'BBO · 1064 nm', 1.6551, 1.5426],
    ['linbo', 'LiNbO₃ · 1064 nm', 2.232, 2.156],
  ])
    add(
      id,
      label,
      '異方性・均一：結晶',
      { material: 'uniaxial', no, ne },
      eksma,
      'メーカー掲載の指定波長の主屈折率。軸方向はアプリ用初期値です。',
    );
  for (const [id, label, nx, ny, nz] of [
    ['lbo', 'LBO · 532 nm', 1.5785, 1.6065, 1.6212],
    ['ktp', 'KTP · 532 nm', 1.7797, 1.7897, 1.8877],
    ['ktpIR', 'KTP · 1064 nm', 1.7404, 1.7479, 1.8296],
  ])
    add(
      id,
      label,
      '異方性・均一：結晶',
      { material: 'biaxial', nx, ny, nz },
      eksma,
      'メーカー掲載の指定波長の主屈折率。二つのFresnel modeを扱います。',
    );
  add(
    'positive',
    '一軸正・理想モデル',
    '異方性・均一：理想モデル',
    { material: 'uniaxial', no: 1.5, ne: 1.7 },
    null,
    '特定の実在結晶に対応しない理想パラメータです。',
  );
  add(
    'luneburg',
    'Luneburg · n²=2−r²（半径1の球）',
    '等方性・不均一：閉形式',
    { material: 'sphericalSquared', n: Math.SQRT2, gradient: 1 },
    grin,
    '標準形は半径1の球、外部屈折率1。形状と外部屈折率は別途設定します。r²<2の有効領域で、三次元軌道を閉形式評価。',
  );
  add(
    'parabolic',
    'Radial gradient（Marchand）· n²=n₀²−gρ²',
    '等方性・不均一：閉形式',
    { material: 'radialSquared', n: 1.5, gradient: 0.3 },
    marchand,
    'Marchand (1978) §5.1・§5.3、pp.53, 59–61。ρ²=x²+y²はz軸からの距離の二乗。式(5.34)の n²=N₀²±b²ρ² に対応します。g>0は負符号（g=b²）、g<0は正符号です。光線軌道は近軸近似を使わず評価します。n₀=1.5、g=0.3はアプリ用設定です。',
  );
  add(
    'linearSquared',
    'Axial · n²=n₀²+gz',
    '等方性・不均一：閉形式',
    { material: 'axialSquared', n: 1.5, gradient: 0.3 },
    grin,
    '文献の軸・符号をzとgへ変更した二乗屈折率の線形分布。数値条件はアプリ用です。',
  );
  add(
    'axial2013Uniaxial',
    models.axial2013Uniaxial.label,
    '異方性・不均一：2013年・現行原稿',
    { material: 'axial2013Uniaxial', gradient: 0.2 },
    nishidate,
    'アプリで構成した一軸実現。b=1+g sin z、ε=diag(b²,b²,1)、μ=1。extraordinaryの計量が2013 axialと一致し、ordinaryの計量はb²I。原典が分配率を与えるという意味ではありません。光学軸はz固定。',
  );
  add(
    'eng2013Magnetic',
    models.eng2013Magnetic.label,
    '異方性・不均一：2013年・現行原稿',
    { material: 'eng2013Magnetic' },
    nishidate,
    'アプリの追加仮定：a=1+gENG z²（初期値gENG=1）、ε=diag(−a/2,a/2,−2a)、μ=diag(1/2,1/2,2)。元のENG計量がextraordinaryの分散面になる。ordinaryは非伝播。元論文の材料と同じ構成式であるという意味ではありません。',
  );
  for (const m of ['axial2013', 'eng2013'])
    add(
      m,
      models[m].label,
      '異方性・不均一：2013年・現行原稿',
      { material: m },
      nishidate,
      '原典に基づく単一光学計量。原論文の図の数値条件を再現するプリセットではありません。',
    );
  for (const m of ['common', 'quadratic', 'hyperbolic', 'heliconical', 'shear'])
    add(
      m,
      models[m].label,
      '異方性・不均一：2013年・現行原稿',
      { material: m, gradient: 0.2 },
      null,
      '現行JOSA A原稿の解を使うアプリ用設定。Table 1の成立条件を適用します。',
    );
  add(
    'helical',
    'Gibbons–Warnick：helical axis（積分表示）',
    '異方性・不均一：2013年・現行原稿',
    { material: 'heliconical', tilt: 90 },
    'https://doi.org/10.1103/PhysRevE.84.031709',
    '光学軸がzに垂直な面内で回転するモデル。一般の光線には数値求積。数値条件はアプリ用です。',
  );
  add(
    'molded2013Transform',
    models.molded2013Transform.label,
    '異方性・不均一：2013年・現行原稿',
    { material: 'molded2013Transform', n: 1.5, gradient: 0.2 },
    nishidate,
    '元のmolded計量Gをε=μ=√det(G) G⁻¹で実現するアプリの仮定。電気と磁気の異方性を持つ変換媒質で、通常の成形ガラスを意味しません。二偏光の軌道は一致。表面の反射・透過と偏光の輸送を計算します。',
  );
  for (const m of ['moldedApprox', 'molded2013'])
    add(
      m,
      models[m].label,
      '比較用：近似・数値積分',
      { material: m, n: 1.5, gradient: 0.2 },
      nishidate,
      'small-slope近似と元の計量のODE積分を分けて比較します。',
    );
  for (const m of ['radialAnisotropic', 'sphericalTransform', 'cylindricalTransform'])
    add(
      m,
      models[m].label,
      '異方性・不均一：文献の閉式解',
      { material: m },
      m === 'radialAnisotropic'
        ? 'https://doi.org/10.1103/PhysRevE.84.031709'
        : 'https://arxiv.org/abs/1109.5133',
      '原典の媒質を平行移動・尺度変更して有限形状内に配置。放射状光学軸は中心(2,1,−3)、半径尺度7。座標変換は中心(0.7,0,−3)、内半径0.7、外半径5、円柱軸はy。変換媒質は電気・磁気の異方性を持ち、切り出し後の物体は完全クロークではありません。',
    );
  const orientationKeys = ['tilt', 'azimuth', 'roll'];
  const materialKeys = [
    'material',
    'n',
    'no',
    'ne',
    'nx',
    'ny',
    'nz',
    'gradient',
    'tilt',
    'azimuth',
    'roll',
    'twist',
    'shift',
  ];
  function apply(c, id) {
    const p = presets.find((p) => p.id === id);
    if (!p) throw Error('未知のプリセット');
    const values = Object.fromEntries(materialKeys.map((k) => [k, root.Optics.defaults[k]]));
    return { ...c, ...values, ...p.values, preset: id, mode: 1, branchPolicy: 'off' };
  }
  // Orientation is independently editable, except where a named model fixes it (the helical preset).
  function matchesPreset(c, id) {
    const p = presets.find((p) => p.id === id);
    if (!p || Object.entries(p.values).some(([k, v]) => c[k] !== v)) return false;
    const initial = apply(c, id);
    return models[c.material].params
      .filter((k) => !orientationKeys.includes(k))
      .every((k) => c[k] === initial[k]);
  }
  root.MaterialCatalog = { types, models, presets, apply, orientationKeys, matchesPreset };
})(globalThis);
