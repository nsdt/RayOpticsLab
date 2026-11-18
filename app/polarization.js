/* Lossless interface transport: nonmagnetic dielectric modes, signed uniaxial
 * epsilon, and explicit epsilon=mu transformation tensors.
 * Bulk: adiabatic modes or exact coordinate pullback of polarization. Optional
 * prescribed z planes split power 1:1; this is NOT a mode-coupling prediction.
 * McClain et al. (1993), I Eqs. 24–35 / II Eqs. 62–67.
 * Pure Jones packets represent the two incoherent components of unpolarized
 * external light. Different geometrical paths are summed incoherently.
 * Flux-normalized reverse scattering transports reciprocal mode radiance.
 * Source and camera lie in the same isotropic external medium (n^2 cancels).
 */
(function (O, P) {
  'use strict';
  const C = P.C,
    cv = (v) => v.map((x) => (Array.isArray(x) ? x : [x, 0])),
    add = (a, b) => a.map((v, i) => C.add(v, b[i])),
    scale = (v, a) => v.map((x) => C.mul(x, a));
  const dot = (a, b) => a.reduce((s, x, i) => C.add(s, C.mul(x, b[i])), [0, 0]);
  const cross = (a, b) => [
    C.sub(C.mul(a[1], b[2]), C.mul(a[2], b[1])),
    C.sub(C.mul(a[2], b[0]), C.mul(a[0], b[2])),
    C.sub(C.mul(a[0], b[1]), C.mul(a[1], b[0])),
  ];
  const size = (v) => Math.sqrt(v.reduce((s, x) => s + C.abs(x) ** 2, 0)),
    normalize = (v) => scale(v, [1 / size(v), 0]);
  const isotropicGradientModels = [
    'sphericalSquared',
    'radialSquared',
    'axialSquared',
    'radial',
    'axial',
  ];
  const isotropicGradient = (c) => isotropicGradientModels.includes(c.material);
  const transformationModels = [
    'shear',
    'molded2013Transform',
    'sphericalTransform',
    'cylindricalTransform',
  ];
  const transformation = (c) =>
    transformationModels.includes(c.material) || c.material === 'transformation';
  const transpose = (A) => A[0].map((_, i) => A.map((row) => row[i]));
  const matcv = (A, v) => A.map((row) => dot(cv(row), v));
  function jacobian(c, x) {
    if (globalThis.LiteratureMedia?.transforms.includes(c.material))
      return globalThis.LiteratureMedia.transform(x, c).J;
    if (c.material === 'shear') {
      const t = (x[2] + 1) / 2,
        b = -c.shift * 3 * t * (1 - t);
      return [
        [1, 0, b],
        [0, 1, 0.45 * b],
        [0, 0, 1],
      ];
    }
    const a = c.n * c.n - c.gradient * x[0] * x[0],
      b = c.n * c.n - c.gradient * x[1] * x[1],
      d = 1 + 0.2 * x[2];
    if (!(a > 0 && b > 0 && d > 0)) throw Error('変換媒質の計量を正定値にしてください');
    return [
      [Math.sqrt(a), 0, 0],
      [0, Math.sqrt(b), 0],
      [0, 0, d],
    ];
  }
  function magnetic(k, E, c) {
    const h = cross(k, E);
    return c.material === 'transformation'
      ? matcv(O.inv(c.tensor), h)
      : c.material === 'engConstitutive'
        ? matcv(O.inv(c.muTensor), h)
        : h;
  }
  function coincident(c) {
    return (isIso(c) && !c.axialPair) || c.material === 'transformation';
  }
  // Parallel transport of the complex transverse field: de/ds = -t (e dot dt/ds).
  // Wang et al., ACM TOG 27(1), 2 (2008), Table I: double reflection of an RMF.
  // These are algebraic frame reflections, NOT extra reflected optical rays.
  function transportIsotropic(E, from, to) {
    const t0 = O.unit(from.slice(3)),
      t1 = O.unit(to.slice(3)),
      v1 = O.add(to.slice(0, 3), O.mul(from.slice(0, 3), -1)),
      c1 = O.dot(v1, v1);
    if (c1 < 1e-28) {
      if (O.norm(O.add(t0, O.mul(t1, -1))) > 1e-8)
        throw Error('偏光輸送の区間が退化しました。刻み幅を小さくしてください');
      return E;
    }
    const reflect = (v, e, q) => add(e, scale(cv(v), C.scale(dot(cv(v), e), -2 / q)));
    const eL = reflect(v1, E, c1),
      tL = O.add(t0, O.mul(v1, (-2 * O.dot(v1, t0)) / c1)),
      v2 = O.add(t1, O.mul(tL, -1)),
      c2 = O.dot(v2, v2);
    if (c2 < 1e-20) throw Error('偏光輸送の方向が退化しました。刻み幅を小さくしてください');
    return normalize(reflect(v2, eL, c2));
  }
  function bulkField(packet, state, c) {
    if (isotropicGradient(c))
      return transportIsotropic(packet.E, [...packet.o, ...packet.p], state);
    if (!transformationModels.includes(c.material))
      return fields(cv(state.slice(3)), localMaterial(c, state), packet.mode).E;
    // E = J^T E_virtual; J^{-T} p and E_virtual stay constant along the flat virtual ray.
    const virtual = matcv(O.inv(transpose(jacobian(c, packet.o))), packet.E);
    return normalize(matcv(transpose(jacobian(c, state)), virtual));
  }
  function axis(c) {
    let t = (c.tilt * Math.PI) / 180,
      f = (c.azimuth * Math.PI) / 180;
    return [Math.sin(t) * Math.cos(f), Math.sin(t) * Math.sin(f), Math.cos(t)];
  }
  function basis(v) {
    let a = O.unit(O.cross(v, Math.abs(v[2]) < 0.85 ? [0, 0, 1] : [0, 1, 0]));
    return [a, O.cross(v, a)];
  }
  function isIso(c) {
    if (isotropicGradient(c)) return true;
    if (c.material === 'axial2013Uniaxial') return Math.abs(c.gradient) < 1e-12;
    if (
      c.negativeOrdinary ||
      ['hyperbolic', 'eng2013Magnetic', 'engConstitutive'].includes(c.material)
    )
      return false;
    return (
      c.material === 'isotropic' ||
      (c.material === 'biaxial'
        ? Math.max(c.nx, c.ny, c.nz) - Math.min(c.nx, c.ny, c.nz) <
          1e-10 * Math.max(c.nx, c.ny, c.nz)
        : Math.abs(c.no - c.ne) < 1e-10 * Math.max(c.no, c.ne))
    );
  }
  function index(c) {
    return c.material === 'isotropic' ? c.n : c.material === 'biaxial' ? c.nx : c.no;
  }
  // Exact uniaxial limits are evaluated with the existing quadratic mode solver.
  function uniaxialLimit(c) {
    if (c.material !== 'biaxial' || isIso(c)) return null;
    const n = [c.nx, c.ny, c.nz],
      limit = 1e-10 * Math.max(...n);
    for (const [i, j, k] of [
      [0, 1, 2],
      [0, 2, 1],
      [1, 2, 0],
    ])
      if (Math.abs(n[i] - n[j]) < limit) {
        let a = O.principalAxes(c)[k];
        if (a[2] < 0) a = O.mul(a, -1);
        return {
          medium: {
            ...c,
            material: 'uniaxial',
            no: (n[i] + n[j]) / 2,
            ne: n[k],
            tilt: (Math.acos(Math.max(-1, Math.min(1, a[2]))) * 180) / Math.PI,
            azimuth: (Math.atan2(a[1], a[0]) * 180) / Math.PI,
          },
          ordinaryMode: n[i] > n[k] ? 0 : 1,
        };
      }
    return null;
  }
  function maxwellFields(k, c) {
    const eps = O.biaxialTensor(c),
      kk = dot(k, k),
      A = eps.map((row, i) =>
        row.map((v, j) => C.sub(C.add([v, 0], C.mul(k[i], k[j])), i === j ? kk : [0, 0])),
      );
    const candidates = [cross(A[0], A[1]), cross(A[0], A[2]), cross(A[1], A[2])];
    candidates.sort((a, b) => size(b) - size(a));
    const matrixSize = Math.hypot(...A.map(size));
    if (size(candidates[0]) < 1e-9 * matrixSize * matrixSize)
      throw Error('二軸の光軸付近で固有モードが縮退しています');
    const E = normalize(candidates[0]),
      H = cross(k, E),
      fieldResidual = size(A.map((row) => dot(row, E))) / matrixSize;
    if (!Number.isFinite(fieldResidual) || fieldResidual > 5e-8)
      throw Error('二軸の固有偏光を十分な精度で求められません');
    return { E, H, fieldResidual };
  }
  function fields(k, c, mode) {
    let E;
    if (c.material === 'engConstitutive') {
      const kv = [k[0], k[1], C.scale(k[2], 2)],
        virtual = {
          ...c,
          material: 'uniaxial',
          no: Math.sqrt(c.axialScale),
          ne: Math.sqrt(c.axialScale),
          tilt: 90,
          azimuth: 90,
          negativeOrdinary: true,
        };
      const f = fields(kv, virtual, mode);
      E = normalize([f.E[0], f.E[1], C.scale(f.E[2], 0.5)]);
      return { E, H: magnetic(k, E, c) };
    }
    if (c.material === 'transformation') {
      let pivot = 0;
      for (let i = 1; i < 3; i++) if (C.abs(k[i]) > C.abs(k[pivot])) pivot = i;
      const i = [0, 1, 2].filter((i) => i !== pivot)[mode],
        D = cv([0, 0, 0]);
      D[i] = [1, 0];
      D[pivot] = C.scale(C.div(k[i], k[pivot]), -1);
      E = normalize(matcv(O.inv(c.tensor), D));
      return { E, H: magnetic(k, E, c) };
    }
    if (c.material === 'biaxial' && !isIso(c)) {
      const limit = uniaxialLimit(c);
      return limit
        ? fields(k, limit.medium, mode === limit.ordinaryMode ? 0 : 1)
        : maxwellFields(k, c);
    }
    if (isIso(c) && !c.axialPair) {
      let kr = k.map((x) => x[0]),
        u = basis(O.unit(kr))[0]; // isotropic evanescent: choose s normal to Re(k), Im(k).
      let im = k.map((x) => x[1]),
        s = O.cross(kr, im);
      if (O.norm(s) > 1e-12) u = O.unit(s);
      E = mode === 0 ? cv(u) : cross(k, cv(u));
    } else {
      let a = axis(c),
        eo = cross(cv(a), k);
      if (size(eo) < 1e-10) {
        const re = k.map((z) => z[0]),
          im = k.map((z) => z[1]);
        eo = cv(basis(O.unit(O.norm(re) > 1e-12 ? re : im))[0]);
      }
      if (mode === 0) E = eo;
      else {
        let D = cross(k, eo),
          aD = dot(cv(a), D),
          epsO = (c.negativeOrdinary ? -1 : 1) * c.no ** 2;
        E = D.map((v, i) =>
          C.add(C.scale(v, 1 / epsO), C.scale(aD, a[i] * (1 / c.ne ** 2 - 1 / epsO))),
        );
      }
    }
    E = normalize(E);
    return { E, H: cross(k, E) };
  }
  function flux(E, H, N) {
    return (
      0.5 *
      O.dot(
        cross(E, H.map(C.conj)).map((z) => z[0]),
        N,
      )
    );
  }
  function biaxialModes(c, t, N, sign) {
    const limit = uniaxialLimit(c);
    if (limit)
      return modes(limit.medium, t, N, sign)
        .map((f) => ({ ...f, mode: f.mode === 0 ? limit.ordinaryMode : 1 - limit.ordinaryMode }))
        .sort((a, b) => a.mode - b.mode);
    const poly = O.biaxialPolynomial(t, N, c),
      solution = P.solve(poly),
      roots = solution.real.map((x) => [x, 0]);
    // P.solve supplies direct and reciprocal seeds; retain each distinct complex root once.
    for (const q of solution.complex) {
      if (
        !q.every(Number.isFinite) ||
        Math.abs(q[1]) < 2e-10 * Math.max(1, Math.abs(q[0])) ||
        P.residual(poly, q) > 2e-12
      )
        continue;
      if (!roots.some((r) => C.abs(C.sub(q, r)) < 2e-8 * Math.max(1, C.abs(q)))) roots.push(q);
    }
    if (roots.length !== 4) throw Error('二軸の4つの界面根を分離できません（縮退・臨界条件付近）');
    const out = [];
    for (const q of roots) {
      const prop = q[1] === 0;
      if (!prop && sign * q[1] <= 0) continue;
      const k = t.map((v, i) => C.add([v, 0], C.scale(q, N[i]))),
        p = k.map((z) => z[0]),
        f = maxwellFields(k, c),
        F = flux(f.E, f.H, N);
      let mode = null,
        dispersionDrift = 0;
      if (prop) {
        if (sign * F <= 1e-11) continue;
        const h = [0, 1].map((m) => Math.abs(2 * O.H([0, 0, 0], p, c, m) - 1));
        mode = h[0] <= h[1] ? 0 : 1;
        dispersionDrift = Math.min(...h);
        if (Math.min(...h) > 2e-7 || Math.abs(h[0] - h[1]) < 1e-8)
          throw Error('二軸の伝播モードを分離できません（光軸付近）');
      }
      out.push({ k, p, ...f, F, mode, prop, dispersionDrift, rootResidual: P.residual(poly, q) });
    }
    if (out.length !== 2) throw Error('二軸の出射・減衰モードを2つ選択できません');
    return out.sort((a, b) => (a.mode ?? 2) - (b.mode ?? 2));
  }
  function modes(c, t, N, sign) {
    if (c.material === 'biaxial' && !isIso(c)) return biaxialModes(c, t, N, sign);
    let out = [];
    for (let mode of [0, 1]) {
      let K =
        c.material === 'engConstitutive'
          ? O.inv(mode === 0 ? c.ordinaryG : c.extraordinaryG)
          : c.material === 'transformation'
            ? O.inv(c.transformG)
            : isIso(c)
              ? [
                  [1 / index(c) ** 2, 0, 0],
                  [0, 1 / index(c) ** 2, 0],
                  [0, 0, 1 / index(c) ** 2],
                ]
              : O.inv(O.metric([0, 0, 0], c, mode));
      const aa = O.dot(N, O.mv(K, N)),
        bb = 2 * O.dot(N, O.mv(K, t)),
        cc = O.dot(t, O.mv(K, t)) - 1;
      const roots = P.quad(aa, bb, cc);
      let chosen;
      for (const q of roots) {
        const k = t.map((v, i) => C.add([v, 0], C.scale(q, N[i]))),
          f = fields(k, c, mode),
          F = flux(f.E, f.H, N),
          prop = Math.abs(q[1]) < 1e-10;
        if (prop ? sign * F > 1e-11 : sign * q[1] > 0) {
          chosen = {
            k,
            p: k.map((z) => z[0]),
            ...f,
            F,
            mode,
            prop,
            dispersionDrift: prop
              ? Math.abs(
                  O.dot(
                    k.map((z) => z[0]),
                    O.mv(
                      K,
                      k.map((z) => z[0]),
                    ),
                  ) - 1,
                )
              : 0,
          };
          break;
        }
      }
      if (!chosen) throw Error('界面の接線・縮退条件を解けません');
      out.push(chosen);
    }
    return out;
  }
  function solve(A, b) {
    let n = b.length,
      M = A.map((row, i) => [...row.map((z) => z.slice()), b[i].slice()]);
    for (let k = 0; k < n; k++) {
      let p = k;
      for (let i = k + 1; i < n; i++) if (C.abs(M[i][k]) > C.abs(M[p][k])) p = i;
      if (C.abs(M[p][k]) < 1e-13) throw Error('界面行列が悪条件です');
      [M[p], M[k]] = [M[k], M[p]];
      for (let i = k + 1; i < n; i++) {
        let f = C.div(M[i][k], M[k][k]);
        for (let j = k; j <= n; j++) M[i][j] = C.sub(M[i][j], C.mul(f, M[k][j]));
      }
    }
    let x = Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let s = M[i][n];
      for (let j = i + 1; j < n; j++) s = C.sub(s, C.mul(M[i][j], x[j]));
      x[i] = C.div(s, M[i][i]);
    }
    return x;
  }
  // Match tangential E and H at one interface. Evanescent fields participate
  // in the boundary solve, but only propagating modes enter the ray queue.
  function scatter(incident, from, to, N) {
    const t = O.add(incident.p, O.mul(N, -O.dot(incident.p, N))),
      incH = magnetic(cv(incident.p), incident.E, from),
      Fin = flux(incident.E, incH, N);
    if (!(Fin > 1e-11)) throw Error('入射流束が接線または逆向きです');
    const T = modes(to, t, N, 1),
      R = modes(from, t, N, -1),
      [t1, t2] = basis(N),
      g = (f) => [dot(cv(t1), f.E), dot(cv(t2), f.E), dot(cv(t1), f.H), dot(cv(t2), f.H)];
    const columns = [...T.map(g), ...R.map((f) => g(f).map((z) => C.scale(z, -1)))],
      A = [0, 1, 2, 3].map((i) => columns.map((v) => v[i])),
      b = g({ E: incident.E, H: incH }),
      a = solve(A, b);
    let children = [];
    for (const [group, medium, reflection, offset] of [
      [T, to, false, 0],
      [R, from, true, 2],
    ]) {
      if (coincident(medium)) {
        if (!group[0].prop) continue;
        let E = add(scale(group[0].E, a[offset]), scale(group[1].E, a[offset + 1])),
          H = magnetic(group[0].k, E, medium),
          w = Math.abs(flux(E, H, N)) / Fin;
        if (w > 1e-25)
          children.push({ p: group[0].p, E: normalize(E), mode: 0, weight: w, reflection });
      } else
        for (let i = 0; i < 2; i++) {
          let f = group[i];
          if (!f.prop) continue;
          let w = (C.abs(a[offset + i]) ** 2 * Math.abs(f.F)) / Fin;
          if (w > 1e-25) children.push({ p: f.p, E: f.E, mode: f.mode, weight: w, reflection });
        }
    }
    const total = children.reduce((s, x) => s + x.weight, 0),
      error = Math.abs(total - 1);
    if (!Number.isFinite(error) || error > 2e-7)
      throw Error('界面のエネルギー収支が不正です: ' + error);
    let residual =
      Math.max(
        ...A.map((row, i) =>
          C.abs(
            C.sub(
              row.reduce((s, z, j) => C.add(s, C.mul(z, a[j])), [0, 0]),
              b[i],
            ),
          ),
        ),
      ) / Math.max(...b.map(C.abs));
    return {
      children,
      error,
      residual,
      dispersionDrift: Math.max(...[...T, ...R].map((f) => f.dispersionDrift || 0)),
      fieldResidual: Math.max(...[...T, ...R].map((f) => f.fieldResidual || 0)),
      rootResidual: Math.max(...[...T, ...R].map((f) => f.rootResidual || 0)),
    };
  }
  const varyingModels = [
    'common',
    'quadratic',
    'heliconical',
    'axial2013Uniaxial',
    'hyperbolic',
    'eng2013Magnetic',
    'radialAnisotropic',
    ...isotropicGradientModels,
    ...transformationModels,
  ];
  function supported(c) {
    return ['isotropic', 'uniaxial', 'biaxial', ...varyingModels].includes(c.material);
  }
  function varying(c) {
    if (globalThis.LiteratureMedia?.supported(c.material)) return true;
    if (c.material === 'eng2013Magnetic') return true;
    if (transformationModels.includes(c.material))
      return c.material === 'molded2013Transform' || Math.abs(c.shift) > 1e-12;
    return (
      varyingModels.includes(c.material) &&
      (c.material === 'heliconical'
        ? Math.abs(c.twist * Math.sin((c.tilt * Math.PI) / 180)) > 1e-12
        : Math.abs(c.gradient) > 1e-12)
    );
  }
  // G_e and G_o in optics.js correspond to this positive, nonmagnetic epsilon.
  function localMaterial(c, x) {
    if (!varyingModels.includes(c.material)) return c;
    if (isotropicGradient(c))
      return { ...c, material: 'isotropic', n: Math.sqrt(O.metric(x.slice(0, 3), c, 0)[0][0]) };
    if (c.material === 'eng2013Magnetic') {
      const a = 1 + (c.engStrength ?? 1) * x[2] * x[2];
      return {
        ...c,
        material: 'engConstitutive',
        axialScale: a,
        muTensor: [
          [0.5, 0, 0],
          [0, 0.5, 0],
          [0, 0, 2],
        ],
        epsilonTensor: [
          [-0.5 * a, 0, 0],
          [0, 0.5 * a, 0],
          [0, 0, -2 * a],
        ],
        ordinaryG: O.metric(x, c, 0),
        extraordinaryG: O.metric(x, c, 1),
      };
    }
    if (transformationModels.includes(c.material)) {
      const J = jacobian(c, x),
        det = globalThis.LiteratureMedia?.transforms.includes(c.material)
          ? globalThis.LiteratureMedia.transform(x, c).det
          : J[0][0] * J[1][1] * J[2][2],
        G = O.metric(x, c, 1),
        tensor = O.inv(G).map((row) => row.map((v) => det * v));
      return { ...c, material: 'transformation', transformG: G, tensor };
    }
    if (c.material === 'radialAnisotropic') {
      const a = globalThis.LiteratureMedia.radial(x, c);
      return {
        ...c,
        material: 'uniaxial',
        no: a.no,
        ne: a.ne,
        tilt: (Math.acos(a.axis[2]) * 180) / Math.PI,
        azimuth: (Math.atan2(a.axis[1], a.axis[0]) * 180) / Math.PI,
      };
    }
    if (c.material === 'axial2013Uniaxial') {
      const b = 1 + c.gradient * Math.sin(x[2]);
      if (!(b > 0)) throw Error('2013 axialの一軸媒質モデルの定義域外です');
      return { ...c, material: 'uniaxial', no: b, ne: 1, tilt: 0, azimuth: 0, axialPair: true };
    }
    const z = x[2],
      eta =
        c.material === 'common'
          ? 1 / (1 + c.gradient * z) ** 2
          : c.material === 'quadratic'
            ? 1 + c.gradient * z * z
            : c.material === 'hyperbolic'
              ? 1 + c.gradient * z
              : 1;
    if (!(eta > 0) || (c.material === 'common' && 1 + c.gradient * z <= 0))
      throw Error('局所屈折率の定義域外です');
    return {
      ...c,
      material: 'uniaxial',
      negativeOrdinary: c.material === 'hyperbolic',
      no: c.no * Math.sqrt(eta),
      ne: c.ne * Math.sqrt(eta),
      azimuth: c.azimuth + (c.material === 'heliconical' ? (c.twist * z * 180) / Math.PI : 0),
    };
  }
  function validateIsotropicProfile(c) {
    if (!isotropicGradient(c)) return;
    if (!Number.isFinite(c.n) || !Number.isFinite(c.gradient))
      throw Error('屈折率と勾配は有限値で指定してください');
    const g = c.gradient,
      zmax = c.shape === 'torus' ? 1.01 : 1,
      r2max =
        c.shape === 'cube' ? 3 : c.shape === 'asphere' ? 2 : c.shape === 'torus' ? 1.01 ** 2 : 1;
    const rho2max = c.shape === 'cube' ? 2 : c.shape === 'asphere' ? 1 : r2max;
    const min =
      c.material === 'radial'
        ? c.n + Math.min(g, 0) * r2max
        : c.material === 'axial'
          ? c.n - Math.abs(g) * zmax
          : c.material === 'axialSquared'
            ? c.n ** 2 - Math.abs(g) * zmax
            : c.n ** 2 - Math.max(g, 0) * (c.material === 'radialSquared' ? rho2max : r2max);
    if (!(c.n > 0.05 && min > (['radial', 'axial'].includes(c.material) ? 0.05 : 0.0025)))
      throw Error(
        'この形状には屈折率が非正または設定範囲外になる領域があります。n₀・gまたは形状を調整してください',
      );
  }
  function validate(c) {
    if (
      ['eng2013', 'eng2013Magnetic'].includes(c.material) &&
      !(Number.isFinite(c.engStrength ?? 1) && (c.engStrength ?? 1) >= 0)
    )
      throw Error('ENG axial strength must be finite and nonnegative');
    if (globalThis.LiteratureMedia?.supported(c.material)) globalThis.LiteratureMedia.parameters(c);
    O.odeSettings(c);
    traceSettings(c);
    validateIsotropicProfile(c);
    if (O.branching) O.branching.settings(c);
    if (!supported(c))
      throw Error(
        '偏光輸送は均一等方性・不均一等方性・均一一軸異方性・均一二軸異方性・正定値common-scale・heliconical・2013 axialの一軸媒質モデル・coordinate-shear・molded変換媒質・hyperbolic・磁気異方性を仮定したENGモデルに対応しています。',
      );
    if (!Number.isInteger(c.maxInterfaces) || c.maxInterfaces < 2 || c.maxInterfaces > 64)
      throw Error('最大界面回数は2〜64です');
    if (!(c.minContribution >= 1e-6 && c.minContribution <= 0.05))
      throw Error('寄与閾値は0.000001〜0.05です');
    if (!['all', 'o', 'e', 'mode1', 'mode2', 'reflected'].includes(c.transportView))
      throw Error('寄与表示が不正です');
    if (c.material === 'biaxial' && ![c.tilt, c.azimuth, c.roll ?? 0].every(Number.isFinite))
      throw Error('二軸媒質の主軸角度が不正です');
    const indices =
      c.material === 'isotropic' || isotropicGradient(c)
        ? [c.n]
        : c.material === 'biaxial'
          ? [c.nx, c.ny, c.nz]
          : [c.no, c.ne];
    if (!indices.every((n) => Number.isFinite(n) && n > 0))
      throw Error('正の有限な屈折率が必要です');
    if (varyingModels.includes(c.material)) {
      if (![c.gradient, c.twist, c.tilt, c.azimuth].every(Number.isFinite))
        throw Error('媒質パラメータが不正です');
      const zmax = c.shape === 'torus' ? 1.01 : 1;
      if (
        c.material === 'molded2013Transform' &&
        c.n * c.n - Math.max(0, c.gradient) * zmax * zmax <= 1e-6
      )
        throw Error('形状全域でmolded計量を正定値にしてください');
      if (c.material === 'axial2013Uniaxial' && 1 - Math.abs(c.gradient) * Math.sin(zmax) <= 1e-6)
        throw Error('2013 axialの形状全域で1+g sin zを正にしてください');
      if (c.material === 'common' && 1 - Math.abs(c.gradient) * zmax <= 1e-6)
        throw Error('形状内にcommon-scaleの特異点があります。勾配を小さくしてください');
      if (c.material === 'hyperbolic' && 1 - Math.abs(c.gradient) * zmax <= 1e-6)
        throw Error('形状全域でhyperbolicのscaleを正にしてください');
      if (c.material === 'quadratic' && 1 + Math.min(0, c.gradient) * zmax * zmax <= 1e-6)
        throw Error('形状全域でscaleを正にしてください');
      if (
        !isotropicGradient(c) &&
        !transformation(c) &&
        !['axial2013Uniaxial', 'hyperbolic', 'eng2013Magnetic'].includes(c.material) &&
        varying(c) &&
        Math.abs(c.no - c.ne) < 1e-7 * Math.max(c.no, c.ne)
      )
        throw Error('断熱追跡の等方縮退には未対応です。nₒとnₑを分離してください');
    }
  }
  function checkState(s, c, mode, stats) {
    if (!s.every(Number.isFinite)) throw Error('内部軌道が有限値ではありません');
    const drift = Math.abs(2 * O.H(s.slice(0, 3), s.slice(3), c, mode) - 1);
    stats.drift = Math.max(stats.drift || 0, drift);
    if (drift > 1e-5)
      throw Error('内部軌道の分散残差が許容値を超えました。刻み幅を小さくしてください');
    if (isotropicGradient(c) || transformation(c) || c.material === 'eng2013Magnetic') return;
    const local = localMaterial(c, s),
      separation = O.norm(O.cross(axis(local), O.unit(s.slice(3))));
    // Numerical degeneracy guard only, not a test of the physical adiabatic condition.
    if (c.material !== 'axial2013Uniaxial' && separation < 1e-5)
      throw Error('光軸付近のモード縮退は断熱追跡の対象外です');
  }
  function advanceBulk(s, h, c, mode) {
    // Near a z turning point the z-parameter formulas can fail; O.advance then uses RKF45.
    const next = O.advance(s, h, c, mode);
    if (!next || !next.every(Number.isFinite)) throw Error('内部軌道を伝播できません');
    return next;
  }
  function rayDirection(packet, c) {
    // Homogeneous biaxial propagation follows the Poynting vector of the computed eigenfield.
    if (c.material === 'biaxial')
      return O.unit(cross(packet.E, cross(cv(packet.p), packet.E).map(C.conj)).map((z) => z[0]));
    return O.unit(O.velocity(packet.o, packet.p, c, packet.mode));
  }
  function internalEvent(packet, s, h, c, advance) {
    const cfg = O.branching?.settings(c);
    if (!cfg?.planes.length || (packet.internalDepth || 0) >= cfg.branchDepth) return null;
    const visited = packet.visited || [],
      half = advance(h / 2),
      end = advance(h),
      pieces = [
        [0, s, h / 2, half],
        [h / 2, half, h, end],
      ];
    let best = null;
    for (const [ta, a, tb, b] of pieces)
      for (let index = 0; index < cfg.planes.length; index++) {
        if (
          O.polarization.modal?.enabled(c)
            ? Math.abs(cfg.planes[index] - packet.o[2]) < 1e-9
            : visited.includes(index)
        )
          continue;
        const z = cfg.planes[index],
          fa = a[2] - z,
          fb = b[2] - z;
        if (Math.abs(fa) > 1e-10 && !(fa * fb <= 0 && Math.abs(fb - fa) > 1e-12)) continue;
        let lo = ta,
          hi = tb;
        if (Math.abs(fa) < 1e-10) hi = ta;
        else
          for (let j = 0; j < 30; j++) {
            const t = (lo + hi) / 2,
              q = advance(t);
            if (fa * (q[2] - z) <= 0) hi = t;
            else lo = t;
          }
        const t = (lo + hi) / 2,
          q = advance(t);
        if (
          O.sdf(q.slice(0, 3), c.shape) >= -1e-8 ||
          Math.abs(O.velocity(q.slice(0, 3), q.slice(3), c, packet.mode)[2]) < 1e-9
        )
          continue;
        if (!best || t < best.t) best = { t, state: q, index, z };
      }
    if (!best) return null;
    const q = best.state;
    q[2] = best.z;
    return {
      ...packet,
      segmentStart: [...packet.o, ...packet.p],
      o: q.slice(0, 3),
      p: q.slice(3),
      E: fields(cv(q.slice(3)), localMaterial(c, q), packet.mode).E,
      internalPlane: { index: best.index, z: best.z },
    };
  }
  function splitInternal(packet, c) {
    if (O.polarization.modal?.enabled(c)) return O.polarization.modal.split(packet, c);
    const N = [0, 0, 1],
      forward = O.velocity(packet.o, packet.p, c, packet.mode)[2];
    return [0, 1].map((mode) => {
      const p =
        mode === packet.mode
          ? packet.p.slice()
          : O.boundary(packet.o, packet.p, N, c, mode, forward < 0);
      return p
        ? { p, E: fields(cv(p), localMaterial(c, packet.o), mode).E, mode, weight: 0.5 }
        : null;
    });
  }
  // Advance one interior packet to the next surface or configured internal
  // event. packet.o is position, packet.p momentum and packet.E a Jones field.
  // Surface reflection/transmission is handled later by trace(), not here.
  function propagate(packet, c, stats = { drift: 0 }) {
    const initial = [...packet.o, ...packet.p];
    if (!varying(c)) {
      const d = rayDirection(packet, c),
        x = interiorHit(packet.o, d, c.shape);
      if (!x) throw Error('内部界面を検出できません');
      const length = O.norm(O.add(x, O.mul(packet.o, -1))),
        event = internalEvent(packet, initial, length, c, (t) => [
          ...O.add(packet.o, O.mul(d, t)),
          ...packet.p,
        ]);
      O.recordStep('closed');
      return event || { ...packet, o: x };
    }
    stats.bulkSegments = (stats.bulkSegments || 0) + 1;
    let s = initial,
      E = packet.E;
    checkState(s, c, packet.mode, stats);
    for (let i = 0; i < (c.maxSteps || 650); i++) {
      let distance = O.sdf(s.slice(0, 3), c.shape),
        v = O.velocity(s.slice(0, 3), s.slice(3), c, packet.mode);
      if (
        O.polarization.modal?.enabled(c) &&
        (packet.internalDepth || 0) < c.branchDepth &&
        Math.sign(v[2]) !== Math.sign(O.velocity(packet.o, packet.p, c, packet.mode)[2])
      )
        throw Error('zの折り返しを含む区間のモード分配は未対応です');
      if (distance > 1e-7) throw Error('内部光線が物体の外から開始しました');
      // A distance-only step stalls for rays running almost parallel to a nearby face.
      // Use the forward straight-ray exit to propose a step, then inspect the curved midpoint.
      const projected = interiorHit(s.slice(0, 3), O.unit(v), c.shape),
        exitDistance = projected ? O.norm(O.add(projected, O.mul(s.slice(0, 3), -1))) : c.step;
      let h = Math.min(c.step, Math.max(2e-5, 1.05 * exitDistance)) / O.norm(v),
        next = advanceBulk(s, h, c, packet.mode);
      // This residual guard is not an error estimator for the trajectory itself.
      for (
        let retry = 0;
        retry < 10 &&
        (Math.abs(2 * O.H(next.slice(0, 3), next.slice(3), c, packet.mode) - 1) > 1e-6 ||
          (isotropicGradient(c) && O.dot(O.unit(s.slice(3)), O.unit(next.slice(3))) < 0.98));
        retry++
      ) {
        h *= 0.5;
        next = advanceBulk(s, h, c, packet.mode);
      }
      stats.bulkSteps = (stats.bulkSteps || 0) + 1;
      const mid = advanceBulk(s, h / 2, c, packet.mode);
      checkState(mid, c, packet.mode, stats);
      if (O.sdf(mid.slice(0, 3), c.shape) >= 0) {
        h /= 2;
        next = mid;
      }
      if (O.sdf(next.slice(0, 3), c.shape) >= 0) {
        const exit = O.refineExit(s, h, c, packet.mode, (t) => advanceBulk(s, t, c, packet.mode));
        const event = internalEvent(packet, s, exit.t, c, (t) => advanceBulk(s, t, c, packet.mode));
        if (event) return event;
        const previous = s;
        s = exit.state;
        stats.geometryResidual = Math.max(stats.geometryResidual || 0, exit.residual);
        // Recompute only the normal covector component on the local dispersion surface.
        // Tangential phase matching is retained. This prevents an ODE residual from
        // being amplified in the flux normalization of a nearly grazing interface.
        const pSurface = O.boundary(
          s.slice(0, 3),
          s.slice(3),
          O.normal(s.slice(0, 3), c.shape),
          c,
          packet.mode,
          false,
        );
        if (!pSurface) throw Error('出口の入射分散根を再構成できません');
        stats.maxCovectorCorrection = Math.max(
          stats.maxCovectorCorrection || 0,
          O.norm(O.add(pSurface, O.mul(s.slice(3), -1))) / Math.max(1, O.norm(s.slice(3))),
        );
        s = [...s.slice(0, 3), ...pSurface];
        checkState(s, c, packet.mode, stats);
        if (isotropicGradient(c)) E = transportIsotropic(E, previous, s);
        return {
          ...packet,
          o: s.slice(0, 3),
          p: s.slice(3),
          E: isotropicGradient(c) ? E : bulkField(packet, s, c),
        };
      }
      const event = internalEvent(packet, s, h, c, (t) => advanceBulk(s, t, c, packet.mode));
      if (event) return event;
      checkState(next, c, packet.mode, stats);
      if (isotropicGradient(c)) E = transportIsotropic(E, s, next);
      s = next;
    }
    throw Error('内部伝播が追跡上限に達しました。刻み幅・媒質・形状を確認してください');
  }
  // Launch into the interior by following the actual curved ray, updating p and E.
  function launch(x, ch, c, stats) {
    if (!varying(c)) return { ...ch, o: O.add(x, O.mul(rayDirection({ ...ch, o: x }, c), 2e-6)) };
    const s = [...x, ...ch.p];
    let h = 2e-6 / O.norm(O.velocity(x, ch.p, c, ch.mode)),
      q = advanceBulk(s, h, c, ch.mode);
    // A launch near an edge can cross an adjacent face. Recover from the same
    // interface state; never project the ray or covector onto another face.
    if (
      c.strictInteriorLaunch
        ? O.sdf(q.slice(0, 3), c.shape) >= 0
        : O.sdf(q.slice(0, 3), c.shape) > 1e-7
    ) {
      let recovered = false;
      for (let retry = 0; retry < 40; retry++) {
        h *= 0.5;
        q = advanceBulk(s, h, c, ch.mode);
        if (O.sdf(q.slice(0, 3), c.shape) < 0) {
          recovered = true;
          break;
        }
      }
      if (!recovered) throw Error('Could not launch the internal ray inside the body');
      stats.launchRefinements = (stats.launchRefinements || 0) + 1;
    }
    checkState(q, c, ch.mode, stats);
    return { ...ch, o: q.slice(0, 3), p: q.slice(3), E: bulkField({ ...ch, o: x }, q, c) };
  }
  function interiorHit(o, d, shape) {
    if (globalThis.Asphere.is(shape)) return globalThis.Asphere.hit(o, d, shape, true);
    if (shape === 'slab') {
      if (Math.abs(d[2]) < 1e-14) return null;
      const t = (Math.sign(d[2]) - o[2]) / d[2];
      return t > 1e-7 ? O.add(o, O.mul(d, t)) : null;
    }
    if (shape === 'sphere') {
      let b = O.dot(o, d),
        cc = O.dot(o, o) - 1,
        delta = b * b - cc;
      if (delta < 0) return null;
      let t = -b + Math.sqrt(delta);
      return t > 1e-7 ? O.add(o, O.mul(d, t)) : null;
    }
    if (shape === 'cube') {
      let t = Infinity;
      for (let i = 0; i < 3; i++)
        if (Math.abs(d[i]) > 1e-14) {
          let s = (Math.sign(d[i]) - o[i]) / d[i];
          if (s > 1e-7) t = Math.min(t, s);
        }
      return Number.isFinite(t) ? O.add(o, O.mul(d, t)) : null;
    }
    for (let t of O.torusRoots(o, d)) {
      if (t <= 1e-7) continue;
      let p = O.add(o, O.mul(d, t));
      if (O.dot(O.normal(p, shape), d) > 1e-9) return p;
    }
    return null;
  }
  const decode = (x) => {
    let s = x / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const encode = (x) =>
    255 * (x <= 0.0031308 ? 12.92 * Math.max(0, x) : 1.055 * Math.max(0, x) ** (1 / 2.4) - 0.055);

  // One queue per camera ray, shared by its two incoherent input polarizations.
  // Weights bound the remaining contribution for the current bounded background;
  // they do not bound errors in the optical or phase approximation.
  const traceDefaults = { maxRayWork: 2048, untracedTolerance: 0.001 };
  function traceSettings(c) {
    const maxRayWork = c.maxRayWork ?? traceDefaults.maxRayWork,
      untracedTolerance = c.untracedTolerance ?? traceDefaults.untracedTolerance;
    if (!Number.isInteger(maxRayWork) || maxRayWork < 1 || maxRayWork > 131072)
      throw Error('1画素の処理数上限は1〜131072の整数です');
    if (!Number.isFinite(untracedTolerance) || untracedTolerance < 0 || untracedTolerance > 0.1)
      throw Error('未追跡量の許容量は0〜10%です');
    return { maxRayWork, untracedTolerance };
  }
  function recordCutoff(r, weight, reason) {
    if (!Number.isFinite(weight) || weight < -1e-12) throw Error('打ち切りの重みが不正です');
    weight = Math.max(0, weight);
    r.cutoffWeights ??= { threshold: 0, work: 0, interface: 0, internal: 0, tolerance: 0 };
    r.cutoffWeights[reason] += weight;
    r.dropped = (r.dropped || 0) + weight;
    if (reason === 'work') r.workLimitWeight = (r.workLimitWeight || 0) + weight;
  }
  function finishTraceBudget(c, r) {
    const settings = traceSettings(c);
    r.cutoffWeights ??= { threshold: 0, work: 0, interface: 0, internal: 0, tolerance: 0 };
    r.processedRays ??= 0;
    r.maxPendingRays ??= 0;
    r.traceOrder = 'weight';
    r.unresolvedWeight = (r.dropped || 0) + (r.failedWeight || 0) + (r.unavailableWeight || 0);
    r.withinTolerance =
      r.status === 'ok' && r.unresolvedWeight <= settings.untracedTolerance + 1e-12;
    r.cutoffAccountingError = Math.abs(
      (r.dropped || 0) - Object.values(r.cutoffWeights).reduce((a, b) => a + b, 0),
    );
    return r;
  }
  class TraceQueue {
    constructor(c, r, initial = []) {
      this.c = c;
      this.r = r;
      this.settings = traceSettings(c);
      this.heap = [];
      this.serial = 0;
      this.pendingWeight = 0;
      r.processedRays = 0;
      r.maxPendingRays = 0;
      recordCutoff(r, 0, 'threshold');
      this.push(...initial);
    }
    get length() {
      return this.heap.length;
    }
    before(a, b) {
      return a.ray.weight > b.ray.weight || (a.ray.weight === b.ray.weight && a.serial < b.serial);
    }
    push(...rays) {
      for (const ray of rays) {
        if (!Number.isFinite(ray.weight) || ray.weight < -1e-12)
          throw Error('光線の重みが不正です');
        if (ray.weight <= 0) continue;
        if (ray.weight < this.c.minContribution) {
          recordCutoff(this.r, ray.weight, 'threshold');
          continue;
        }
        const node = { ray, serial: this.serial++ },
          h = this.heap;
        let i = h.length;
        h.push(node);
        while (i > 0) {
          const p = (i - 1) >> 1;
          if (!this.before(node, h[p])) break;
          h[i] = h[p];
          i = p;
        }
        h[i] = node;
        this.pendingWeight += ray.weight;
        this.r.maxPendingRays = Math.max(this.r.maxPendingRays, h.length);
      }
      return this.length;
    }
    drain(reason) {
      const weight = this.heap.reduce((s, n) => s + n.ray.weight, 0);
      recordCutoff(this.r, weight, reason);
      this.heap.length = 0;
      this.pendingWeight = 0;
    }
    pop() {
      const h = this.heap;
      if (!h.length) return null;
      const lost =
        (this.r.dropped || 0) + (this.r.failedWeight || 0) + (this.r.unavailableWeight || 0);
      if (
        this.settings.untracedTolerance > 0 &&
        lost + Math.max(0, this.pendingWeight) <= this.settings.untracedTolerance
      ) {
        this.drain('tolerance');
        return null;
      }
      if (this.r.processedRays >= this.settings.maxRayWork) {
        this.drain('work');
        return null;
      }
      const first = h[0],
        tail = h.pop();
      if (h.length) {
        let i = 0;
        while (2 * i + 1 < h.length) {
          let j = 2 * i + 1;
          if (j + 1 < h.length && this.before(h[j + 1], h[j])) j++;
          if (!this.before(h[j], tail)) break;
          h[i] = h[j];
          i = j;
        }
        h[i] = tail;
      }
      this.pendingWeight -= first.ray.weight;
      if (!h.length) this.pendingWeight = 0;
      this.r.processedRays++;
      return first.ray;
    }
  }

  // Trace a full camera-ray tree. Pure Jones input packets represent the two
  // incoherent components of unpolarized illumination. Add radiances across
  // distinct paths and account for every discarded packet in the weight budget.
  function trace(o, d, c) {
    validate(c);
    const ext = { ...c, material: 'isotropic', n: O.outsideIndex(c) },
      initial = basis(d).map((E) => ({
        o,
        p: O.mul(d, ext.n),
        E: cv(E),
        mode: 0,
        inside: false,
        weight: 0.5,
        depth: 0,
        internalDepth: 0,
        visited: [],
        tag: 'direct',
        reflected: false,
      }));
    let linear = [0, 0, 0],
      r = {
        status: 'ok',
        drift: 0,
        branches: 0,
        leaves: 0,
        maxDepth: 0,
        internalBranches: 0,
        maxInternalDepth: 0,
        unavailableWeight: 0,
        weightSum: 0,
        dropped: 0,
        failedWeight: 0,
        fluxError: 0,
        boundaryResidual: 0,
        fieldResidual: 0,
        rootResidual: 0,
        interfaces: 0,
        reflections: 0,
        bulkSegments: 0,
        bulkSteps: 0,
        channels: { o: 0, e: 0, mode1: 0, mode2: 0, reflected: 0, direct: 0 },
      },
      stack = new TraceQueue(c, r, initial);
    while (stack.length) {
      const v = stack.pop();
      if (!v) break;
      r.maxDepth = Math.max(r.maxDepth, v.depth);
      try {
        if (v.inside && v.depth >= c.maxInterfaces) {
          recordCutoff(r, v.weight, 'interface');
          continue;
        }
        const incoming = v.inside ? propagate(v, c, r) : v,
          dir = O.unit(v.p);
        if (incoming.internalPlane) {
          const plane = incoming.internalPlane,
            children = splitInternal(incoming, c),
            internalDepth = (v.internalDepth || 0) + 1,
            visited = [...(v.visited || []), plane.index];
          if (children.transfer) {
            r.modalClosed = (r.modalClosed || 0) + (children.transfer.method === 'closed' ? 1 : 0);
            r.modalQuadrature =
              (r.modalQuadrature || 0) + (children.transfer.method === 'quadrature' ? 1 : 0);
            r.modalWeightError = Math.max(r.modalWeightError || 0, children.transfer.weightError);
            r.modalQuadratureError = Math.max(r.modalQuadratureError || 0, children.transfer.error);
          }
          r.internalBranches++;
          r.branches++;
          r.maxInternalDepth = Math.max(r.maxInternalDepth, internalDepth);
          if (c.branchDebug) {
            r.events ??= [];
            r.events.push({
              position: incoming.o.slice(),
              plane: plane.index,
              depth: internalDepth,
              parentWeight: v.weight,
              modes: children.map((ch) => ch?.mode ?? null),
              weights: children.map((ch) => ch?.weight ?? 0.5),
              transfer: children.transfer,
            });
          }
          for (const ch of children) {
            const weight = v.weight * (ch?.weight ?? 0.5);
            if (!ch) {
              r.unavailableWeight += weight;
              continue;
            }
            if (weight < c.minContribution) {
              recordCutoff(r, weight, 'threshold');
              continue;
            }
            stack.push({
              ...v,
              ...ch,
              o: incoming.o.slice(),
              weight,
              internalDepth,
              visited: visited.slice(),
            });
          }
          continue;
        }
        let x = v.inside ? incoming.o : O.hit(v.o, dir, c.shape);
        if (
          !v.inside &&
          (!x || O.backgroundDistance(v.o, dir, c) < O.norm(O.add(x, O.mul(v.o, -1))))
        ) {
          r.leaves++;
          r.weightSum += v.weight;
          r.channels[v.tag] += v.weight;
          if (
            c.transportView === 'all' ||
            c.transportView === v.tag ||
            (c.transportView === 'reflected' && v.reflected)
          ) {
            let color = O.bg(v.o, dir, c).map(decode);
            linear = O.add(linear, O.mul(color, v.weight));
          }
          continue;
        }
        if (!x) throw Error('内部界面を検出できません');
        if (v.depth >= c.maxInterfaces) {
          recordCutoff(r, v.weight, 'interface');
          continue;
        }
        if (!v.inside) O.recordStep('closed');
        const local = localMaterial(c, x),
          N = O.mul(O.normal(x, c.shape), v.inside ? 1 : -1),
          s = scatter(incoming, v.inside ? local : ext, v.inside ? ext : local, N);
        r.drift = Math.max(r.drift, s.dispersionDrift);
        r.fluxError = Math.max(r.fluxError, s.error);
        r.boundaryResidual = Math.max(r.boundaryResidual, s.residual);
        r.fieldResidual = Math.max(r.fieldResidual, s.fieldResidual);
        r.rootResidual = Math.max(r.rootResidual, s.rootResidual);
        r.interfaces++;
        r.branches += s.children.length - 1;
        for (const ch of s.children) {
          let inside = ch.reflection ? v.inside : !v.inside;
          if (ch.reflection) r.reflections++;
          let tag =
            v.depth === 0
              ? ch.reflection
                ? 'reflected'
                : coincident(local)
                  ? 'direct'
                  : local.material === 'biaxial'
                    ? ch.mode === 0
                      ? 'mode1'
                      : 'mode2'
                    : ch.mode === 0
                      ? 'o'
                      : 'e'
              : v.tag;
          const weight = v.weight * ch.weight;
          if (weight < c.minContribution) {
            recordCutoff(r, weight, 'threshold');
            continue;
          }
          try {
            const next = inside
              ? launch(x, ch, c, r)
              : { ...ch, o: O.add(x, O.mul(O.unit(ch.p), 2e-6)) };
            stack.push({
              ...next,
              inside,
              weight,
              depth: v.depth + 1,
              internalDepth: v.internalDepth || 0,
              visited: v.visited || [],
              tag,
              reflected: v.reflected || ch.reflection,
            });
          } catch (e) {
            r.status = 'error';
            r.failedWeight += weight;
            r.message = e.message;
          }
        }
      } catch (e) {
        r.status = 'error';
        r.failedWeight += v.weight;
        r.message = e.message;
      }
    }
    r.accounted = r.weightSum + r.dropped + r.failedWeight + r.unavailableWeight;
    r.color = linear.map(encode);
    if (
      r.status === 'error' &&
      !c.strictInteriorLaunch &&
      ['内部光線が物体の外から開始しました', '出口を挟む内外の区間を確認できません'].includes(
        r.message,
      )
    ) {
      const recovered = trace(o, d, { ...c, strictInteriorLaunch: true });
      recovered.boundaryRecovery = {
        initialMessage: r.message,
        initialFailedWeight: r.failedWeight,
      };
      return recovered;
    }
    return finishTraceBudget(c, r);
  }
  O.polarization = {
    TraceQueue,
    recordCutoff,
    finishTraceBudget,
    traceSettings,
    traceDefaults,
    solve,
    isotropicGradient,
    validateIsotropicProfile,
    transportIsotropic,
    isIso,
    uniaxialLimit,
    biaxialModes,
    maxwellFields,
    rayDirection,
    supported,
    validate,
    scatter,
    modes,
    fields,
    basis,
    cv,
    flux,
    trace,
    decode,
    encode,
    interiorHit,
    localMaterial,
    varying,
    propagate,
    launch,
    internalEvent,
    splitInternal,
    transformation,
    jacobian,
    magnetic,
    bulkField,
  };
  Object.assign(O.defaults, traceDefaults, {
    transport: 'legacy',
    transportView: 'all',
    maxInterfaces: 6,
    minContribution: 1e-4,
  });
})(globalThis.Optics, globalThis.Polynomial);
