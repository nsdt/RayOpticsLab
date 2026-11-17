/* Shared capability policy. Unsupported settings preserve the CPU optical model. */
(function (root) {
  'use strict';
  const anisotropic = [
    'common',
    'quadratic',
    'heliconical',
    'axial2013Uniaxial',
    'hyperbolic',
    'shear',
    'eng2013Magnetic',
    'radialAnisotropic',
    'sphericalTransform',
    'cylindricalTransform',
  ];
  const grin = ['sphericalSquared', 'radialSquared', 'axialSquared', 'radial', 'axial'];
  // CPU settings remain authoritative for fallback; f32 controls are recorded separately.
  function effectiveODE(c) {
    const requested = {
      odeRtol: c.odeRtol ?? 1e-6,
      odeAtolPosition: c.odeAtolPosition ?? 1e-7,
      odeAtolMomentum: c.odeAtolMomentum ?? 1e-7,
      odeMaxSteps: c.odeMaxSteps ?? 1024,
    };
    return {
      requested,
      effective: {
        ...requested,
        odeRtol: Math.max(requested.odeRtol, 1e-6),
        odeAtolPosition: Math.max(requested.odeAtolPosition, 1e-7),
        odeAtolMomentum: Math.max(requested.odeAtolMomentum, 1e-7),
      },
    };
  }
  function support(c) {
    if (root.Spectral?.enabled(c)) {
      try {
        return support(
          Spectral.sampleConfig(c, ((c.spectralMin ?? 380) + (c.spectralMax ?? 780)) / 2),
        );
      } catch (e) {
        return { ok: false, reason: e.message };
      }
    }
    if (
      (grin.includes(c.material) || anisotropic.includes(c.material)) &&
      c.gpuPrecision !== 'validated-f32' &&
      ((c.odeRtol ?? 1e-6) < 5e-7 ||
        (c.odeAtolPosition ?? 1e-7) < 5e-8 ||
        (c.odeAtolMomentum ?? 1e-7) < 5e-8)
    )
      return {
        ok: false,
        reason:
          '指定したODE許容誤差はGPU単精度に対して厳しいため、同じ許容誤差を保ってCPUで計算します。',
      };
    if (c.paperDirectOnly && !c.paperTarget && !c.paperXYZConstant)
      return { ok: false, reason: '反射経路を除外する設定は論文の計算で使用してください。' };
    if (
      ['radialAnisotropic', 'sphericalTransform', 'cylindricalTransform'].includes(c.material) &&
      c.branchPolicy !== 'off' &&
      c.branchDepth > 0
    )
      return { ok: false, reason: '放射状光学軸・座標変換媒質の内部モード分配はCPUで計算します。' };
    if (c.branchDebug)
      return { ok: false, reason: '光線イベントの詳細記録を指定した場合はCPUで計算します。' };
    if (c.transport !== 'polarized')
      return { ok: false, reason: 'GPU版は「反射・屈折と明るさを計算」に対応します。' };
    if (!['cube', 'sphere', 'torus', 'slab', 'asphere'].includes(c.shape))
      return { ok: false, reason: '指定した形状はCPUで計算します。' };
    if (!['isotropic', 'uniaxial', 'biaxial', ...anisotropic, ...grin].includes(c.material))
      return {
        ok: false,
        reason:
          'GPU版の媒質は等方均質・一軸均質・二軸均質・等方不均一・異方不均一の閉式・数値軌道に対応します。',
      };
    if (c.material === 'biaxial') {
      const indices = [c.nx, c.ny, c.nz],
        scale = Math.max(...indices),
        span = scale - Math.min(...indices);
      if (span >= 1e-10 * scale && span < 1e-6 * scale)
        return {
          ok: false,
          reason: '主屈折率がほぼ一致し、GPU単精度で固有モードを分離できないためCPUで計算します。',
        };
    }
    if (c.branchModel === 'layers')
      return { ok: false, reason: '比較用の均質層モデルはCPUで計算します。設定は変更しません。' };
    if (
      c.branchModel === 'coherent' &&
      !['common', 'quadratic', 'heliconical', 'axial2013Uniaxial'].includes(c.material)
    )
      return { ok: false, reason: '位相輸送は4種類の正定値一軸媒質を選択してください。' };
    if (
      c.branchModel === 'coherent' &&
      !['finite-resolved', 'resolved'].includes(c.coherentInterface)
    )
      return {
        ok: false,
        reason:
          '表面で相関を保持する平板比較方式はCPUで計算します。有限形状・独立光線の位相輸送はGPUに対応します。',
      };
    if (
      c.shape === 'slab' &&
      !['common', 'quadratic', 'heliconical', 'axial2013Uniaxial'].includes(c.material)
    )
      return { ok: false, reason: '平行平板の対象は4種類の正定値一軸媒質です。' };
    if (c.branchModel === 'coherent' && c.phaseTolerance < 1e-7)
      return {
        ok: false,
        reason:
          '指定した偏光積分の許容誤差はGPU単精度に対して厳しいためCPUで計算します。設定は変更しません。',
      };
    if (c.material === 'common' && Math.abs(c.no - c.ne) < 1e-6)
      return { ok: false, reason: 'common-scaleの等方極限はCPUで計算します。' };
    if (grin.includes(c.material)) {
      const method =
        c.solver === 'auto' &&
        ['sphericalSquared', 'radialSquared', 'axialSquared'].includes(c.material)
          ? '閉式軌道'
          : c.solver !== 'rkf45' && ['axialSquared', 'axial'].includes(c.material)
            ? '積分表示の数値求積（折り返し付近はRKF45）'
            : 'RKF45数値積分';
      return {
        ok: true,
        reason:
          '等方不均一の立方体・球・トーラス・非球面レンズに対応。内部は' +
          method +
          'と曲線に沿う偏光輸送、表面は局所屈折率による反射・透過をGPUで計算します。',
      };
    }
    if (anisotropic.includes(c.material)) {
      const internal =
        c.branchModel === 'coherent'
          ? '位相差を含む偏光輸送・光束の分離をGPU計算します。'
          : c.branchPolicy !== 'off' && c.branchDepth > 0 && root.Optics?.branching?.supported(c)
            ? '内部評価面での' +
              (c.branchModel === 'modal' ? 'モード結合による分配' : '等分配') +
              'もGPU計算します。'
            : '';
      const method = {
        auto: '閉式を優先し、条件外ではSchur求積、折り返し付近ではRKF45',
        schur: 'Schur求積を優先し、使えない区間ではRKF45',
        rkf45: 'Hamilton方程式のRKF45',
      }[c.solver];
      return {
        ok: true,
        reason:
          '立方体・球・トーラス・非球面レンズ・対応する平板で' +
          method +
          'をGPU計算します。数値精度・交点・偏光モデルの条件外は画素全体をCPUで再計算します。' +
          internal,
      };
    }
    return {
      ok: true,
      reason:
        '均一等方性・均一一軸異方性・均一二軸異方性媒質では、球・立方体・トーラス・非球面レンズの反射・透過と目印付き背景をGPUで計算します。',
    };
  }
  root.GPUOpticsSupport = { support, effectiveODE };
  if (root.Optics) root.Optics.defaults.computeBackend = root.navigator?.gpu ? 'gpu' : 'cpu';
})(globalThis);
