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
      label: 'Gibbons–Warnick：放射状光軸',
      form: '異常光線：直線の閉式解／常光線：RKF45',
      params: ['radialRadius'],
    },
    sphericalTransform: {
      type: 'aniGradient',
      label: '球対称の座標変換媒質（一部を切り出した形状）',
      form: '閉式解（逆座標写像）',
      params: ['transformInner', 'transformOuter'],
    },
    cylindricalTransform: {
      type: 'aniGradient',
      label: '円柱対称の座標変換媒質（一部を切り出した形状）',
      form: '閉式解（逆座標写像）',
      params: ['transformInner', 'transformOuter'],
    },
    isotropic: { type: 'isoUniform', label: '一定の屈折率', form: '閉式解（直線）', params: ['n'] },
    sphericalSquared: {
      type: 'isoGradient',
      label: '球対称：n² = n₀² − g r²（Luneburg型）',
      form: '閉式解',
      params: ['n', 'gradient'],
    },
    radialSquared: {
      type: 'isoGradient',
      label: '円柱対称：n² = n₀² − gρ²（Radial gradient）',
      form: '閉式解',
      params: ['n', 'gradient'],
    },
    axialSquared: {
      type: 'isoGradient',
      label: '軸方向：n² = n₀² + g z',
      form: '閉式解',
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
      form: '閉式解（直線）',
      params: ['no', 'ne', 'tilt', 'azimuth'],
    },
    biaxial: {
      type: 'aniUniform',
      label: '二軸結晶（Fresnelの分散関係の二つの解）',
      form: '閉式解（直線）／界面での波数は数値的に求めます',
      params: ['nx', 'ny', 'nz', 'tilt', 'azimuth', 'roll'],
    },
    axial2013Uniaxial: {
      type: 'aniGradient',
      label: '2013 axial：一軸媒質モデル（常光線・異常光線）',
      form: '異常光線：閉式解／常光線：数値求積・常微分方程式の数値積分',
      params: ['gradient'],
    },
    axial2013: {
      type: 'aniGradient',
      label: 'Nishidate 2013：軸方向の対角計量（axial）',
      form: '閉式解',
      params: ['gradient'],
    },
    eng2013Magnetic: {
      type: 'aniGradient',
      label: '2013 ENG：磁気異方性を仮定したモデル（異常光線）',
      form: '条件付き閉式解／一般光線は数値求積・ODE',
      params: ['engStrength'],
    },
    eng2013: {
      type: 'aniGradient',
      label: 'Nishidate 2013：負の誘電率を含む媒質（ENG）',
      form: '条件付き閉式解／一般光線は数値求積',
      params: ['engStrength'],
    },
    common: {
      type: 'aniGradient',
      label: '共通スケール：逆二乗型（Common-scale）',
      form: '条件付き閉式解',
      params: ['no', 'ne', 'gradient', 'tilt', 'azimuth'],
    },
    quadratic: {
      type: 'aniGradient',
      label: '共通スケール：二次型（Common-scale）',
      form: '条件付き閉式解',
      params: ['no', 'ne', 'gradient', 'tilt', 'azimuth'],
    },
    hyperbolic: {
      type: 'aniGradient',
      label: '双曲型媒質：線形スケール（Hyperbolic）',
      form: '条件付き閉式解',
      params: ['no', 'ne', 'gradient', 'tilt', 'azimuth'],
    },
    heliconical: {
      type: 'aniGradient',
      label: '螺旋状・螺旋円錐状の光軸（Helical / heliconical）',
      form: '一般光線は積分表示／横運動量ゼロで閉式解',
      params: ['no', 'ne', 'tilt', 'azimuth', 'twist'],
    },
    shear: {
      type: 'aniGradient',
      label: '座標のせん断変換による媒質（Coordinate-shear）',
      form: '閉式解',
      params: ['shift'],
    },
    molded2013Transform: {
      type: 'aniGradient',
      label: '2013 molded：変換媒質モデル（複屈折なし）',
      form: '常微分方程式の数値積分（小傾斜近似なし）',
      params: ['n', 'gradient'],
    },
    molded2013: {
      type: 'aniGradient',
      label: 'Nishidate 2013：成形媒質の計量（molded）',
      form: 'ODE数値積分',
      params: ['n', 'gradient'],
    },
    moldedApprox: {
      type: 'aniGradient',
      label: 'Nishidate 2013：moldedの小傾斜近似',
      form: '近似方程式の閉式解',
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
    '負の一軸結晶です。メーカーが掲載する630 nmでの屈折率を使います。光軸の向きは、このアプリの初期設定です。',
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
      'メーカーが掲載する指定波長での主屈折率を使います。主軸の向きは、このアプリの初期設定です。',
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
      'メーカーが掲載する指定波長での主屈折率を使い、Fresnelの分散関係に対応する二つのモードを追跡します。',
    );
  add(
    'positive',
    '正の一軸結晶（理想モデル）',
    '異方性・均一：理想モデル',
    { material: 'uniaxial', no: 1.5, ne: 1.7 },
    null,
    '特定の実在結晶を想定せず、主屈折率を設定した理想モデルです。',
  );
  add(
    'luneburg',
    'Luneburg · n²=2−r²（半径1の球）',
    '等方性・不均一：閉式解',
    { material: 'sphericalSquared', n: Math.SQRT2, gradient: 1 },
    grin,
    '標準的なLuneburgレンズの条件は、半径1の球、外部屈折率1です。形状と外部屈折率は別途設定してください。r²<2の範囲で、閉式解により三次元の光線軌道を計算します。',
  );
  add(
    'parabolic',
    'Radial gradient（Marchand）· n²=n₀²−gρ²',
    '等方性・不均一：閉式解',
    { material: 'radialSquared', n: 1.5, gradient: 0.3 },
    marchand,
    'Marchand (1978) §5.1・§5.3、pp.53, 59–61。ρ²=x²+y²はz軸からの距離の二乗。式(5.34)の n²=N₀²±b²ρ² に対応します。g>0は負符号（g=b²）、g<0は正符号です。光線軌道は近軸近似を使わず評価します。n₀=1.5、g=0.3はアプリ用設定です。',
  );
  add(
    'linearSquared',
    'Axial · n²=n₀²+gz',
    '等方性・不均一：閉式解',
    { material: 'axialSquared', n: 1.5, gradient: 0.3 },
    grin,
    '屈折率の二乗が軸方向に線形に変化する分布です。文献の座標軸と符号を、このアプリのzとgに合わせています。数値条件はアプリ用の設定です。',
  );
  add(
    'axial2013Uniaxial',
    models.axial2013Uniaxial.label,
    '異方性・不均一：2013年・現行原稿',
    { material: 'axial2013Uniaxial', gradient: 0.2 },
    nishidate,
    '2013 axialの計量に対応する一軸媒質モデルです。b=1+g sin z、ε=diag(b²,b²,1)、μ=1とします。異常光線の計量は2013 axialと一致し、常光線の計量はb²Iとなります。界面での反射・透過率は、この追加の仮定から計算します。光軸はz方向に固定します。',
  );
  add(
    'eng2013Magnetic',
    models.eng2013Magnetic.label,
    '異方性・不均一：2013年・現行原稿',
    { material: 'eng2013Magnetic' },
    nishidate,
    'このアプリでは、a=1+gENG z²（初期値gENG=1）、ε=diag(−a/2,a/2,−2a)、μ=diag(1/2,1/2,2)を仮定します。異常光線の計量が元のENG計量と一致し、常光線は伝播しません。原典とは異なる誘電率・透磁率の設定です。',
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
    'Gibbons–Warnick：螺旋状の光軸（積分表示）',
    '異方性・不均一：2013年・現行原稿',
    { material: 'heliconical', tilt: 90 },
    'https://doi.org/10.1103/PhysRevE.84.031709',
    '光軸がz方向に沿って回転し、常にz軸に垂直な面内を向くモデルです。一般の光線には数値求積を使います。数値条件はアプリ用の設定です。',
  );
  add(
    'molded2013Transform',
    models.molded2013Transform.label,
    '異方性・不均一：2013年・現行原稿',
    { material: 'molded2013Transform', n: 1.5, gradient: 0.2 },
    nishidate,
    '元のmolded計量Gに対応するよう、ε=μ=√det(G) G⁻¹としたモデルです。誘電率と透磁率の両方に異方性をもつ変換媒質で、通常の成形ガラスを表すものではありません。二つの偏光の軌道は一致します。界面での反射・透過と、軌道に沿った偏光の輸送を計算します。',
  );
  for (const m of ['moldedApprox', 'molded2013'])
    add(
      m,
      models[m].label,
      '比較用：近似・数値積分',
      { material: m, n: 1.5, gradient: 0.2 },
      nishidate,
      '小傾斜近似と元の計量のODE積分を分けて比較します。',
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
      '文献の媒質分布の中心位置と長さの尺度を変え、選択した形状の内部に配置します。放射状光軸のモデルでは中心(2,1,−3)、半径の尺度7、座標変換モデルでは中心(0.7,0,−3)、内半径0.7、外半径5を使います。円柱の軸はy方向です。変換媒質には誘電率・透磁率の両方の異方性がありますが、一部を切り出したこの形状は完全なクローキング装置にはなりません。',
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
