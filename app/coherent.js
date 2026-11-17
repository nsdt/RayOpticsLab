/* Coherent forward packets on original heliconical trajectories. Normal
 * incidence, infinite slab, lossless nonmagnetic medium. Relative modal phase
 * is retained across subdivisions and reflections. A finite-envelope overlap
 * rule resolves separated rays. No diffraction or bulk backward coupling. */
(function (O, F, P) {
  'use strict';
  const C = P.C,
    L = F.layered;
  const defaults = {
    wavelengthNm: 550,
    lengthUnitUm: 10,
    beamRadiusUm: 10,
    overlapCutoff: 0.001,
    phaseSlices: 1,
  };
  Object.assign(O.defaults, defaults);
  const selected = (c) => c.transport === 'polarized' && c.branchModel === 'coherent';
  function validate(c) {
    if (!selected(c)) return;
    if (F.coherentGeneral && c.coherentInterface !== 'retained')
      return F.coherentGeneral.validate(c);
    if (
      c.material !== 'heliconical' ||
      c.shape !== 'slab' ||
      c.projection !== 'ortho' ||
      Math.abs(c.yaw) + Math.abs(c.pitch) > 1e-10
    )
      throw Error(
        '位相を含む連続輸送は、Heliconical・平行平板（側面なし）・平行投影・視点0°で使用できます。専用デモで設定できます。',
      );
    if (!(c.tilt > 1e-3 && c.tilt <= 90) || Math.abs(c.no - c.ne) < 1e-7)
      throw Error('位相輸送には、光学軸の傾きと二つの屈折率の差が必要です（縮退は対象外）。');
    for (const [key, lo, hi] of [
      ['wavelengthNm', 100, 10000],
      ['lengthUnitUm', 0.1, 10000],
      ['beamRadiusUm', 0.01, 100000],
      ['overlapCutoff', 1e-6, 0.1],
    ])
      if (!Number.isFinite(c[key]) || c[key] < lo || c[key] > hi)
        throw Error(key + ' の設定範囲は ' + lo + '〜' + hi + ' です');
    if (!Number.isInteger(c.phaseSlices) || c.phaseSlices < 1 || c.phaseSlices > 256)
      throw Error('偏光計算の分割数は1〜256です');
    if (!Number.isInteger(c.branchDepth) || c.branchDepth < 0 || c.branchDepth > 6)
      throw Error('空間分離の最大回数は0〜6です');
    if (c.branchPolicy !== 'overlap') throw Error('位相輸送の分離条件は光束の重なりで指定します');
  }
  function coefficients(c, sign) {
    const theta = (c.tilt * Math.PI) / 180,
      neff =
        (c.no * c.ne) /
        Math.sqrt(c.no ** 2 * Math.sin(theta) ** 2 + c.ne ** 2 * Math.cos(theta) ** 2);
    const k0 = (2 * Math.PI * c.lengthUnitUm) / (c.wavelengthNm * 0.001),
      g = sign * 0.5 * (Math.sqrt(c.no / neff) + Math.sqrt(neff / c.no)) * c.twist;
    return { g, delta: (sign * k0 * (c.no - neff)) / 2, neff, k0 };
  }
  // exp([[i*delta,g],[-g,-i*delta]] dz), with common phase removed.
  function transfer(z0, z1, c, sign) {
    const { g, delta } = coefficients(c, sign),
      r = Math.hypot(g, delta),
      a = r * (z1 - z0),
      q = r ? Math.sin(a) / r : z1 - z0,
      t = Math.cos(a);
    const J = [
      [
        [t, delta * q],
        [g * q, 0],
      ],
      [
        [-g * q, 0],
        [t, -delta * q],
      ],
    ];
    return { J, M: L.jonesMueller(J), conversion: (g * q) ** 2, g, delta };
  }
  function transport(S, z0, z1, c, sign) {
    const n = c.phaseSlices || 1,
      M = transfer(z0, z0 + (z1 - z0) / n, c, sign).M;
    let result = S.slice();
    for (let i = 0; i < n; i++) result = L.applyMueller(M, result);
    if (
      !result.every(Number.isFinite) ||
      Math.abs(result[0] - S[0]) > 2e-10 ||
      Math.hypot(...result.slice(1)) > result[0] + 2e-10
    )
      throw Error('偏光輸送の強度・偏光度が不正です');
    return result;
  }
  function initialStates(x, c, sign) {
    return [0, 1].map((mode) => {
      const p = O.boundary(x, [0, 0, 0], [0, 0, 1], c, mode, sign < 0);
      if (!p) throw Error('平行平板のモードが伝播しません');
      return [...x, ...p];
    });
  }
  function advance(states, z, c, stats) {
    return states.map((s, mode) => {
      let q = s.slice();
      // O.advance remains the geometry evaluator, including the RKF45 comparator.
      const parts = c.solver === 'auto' ? 1 : Math.max(1, Math.ceil(Math.abs(z - s[2]) / c.step));
      for (let i = 0; i < parts; i++) {
        const dz = (z - s[2]) / parts,
          vz = O.velocity(q.slice(0, 3), q.slice(3), c, mode)[2];
        q = O.advance(q, dz / vz, c, mode);
      }
      const error = Math.abs(2 * O.H(q.slice(0, 3), q.slice(3), c, mode) - 1);
      if (stats) stats.drift = Math.max(stats.drift, error);
      if (!q.every(Number.isFinite) || error > 1e-5 || Math.abs(q[2] - z) > 1e-7)
        throw Error('位相輸送の解析軌道が分散式・z座標を満たしません');
      return q;
    });
  }
  // Gaussian fields exp(-r^2/w^2): overlap exp(-d^2/(2w^2)). This rule is
  // a finite-envelope approximation, not a beam solution or numerical step.
  // Solve the FIRST threshold crossing analytically, even over full helix turns.
  function separationZ(states, endZ, c, sign) {
    if (Math.abs(c.twist) < 1e-14) return null;
    const start = states[0][2],
      limit = (c.beamRadiusUm / c.lengthUnitUm) * Math.sqrt(-2 * Math.log(c.overlapCutoff));
    const dx = states[1][0] - states[0][0],
      dy = states[1][1] - states[0][1];
    if (Math.hypot(dx, dy) >= limit * (1 - 1e-12)) return start;
    const th = (c.tilt * Math.PI) / 180,
      de = c.no ** 2 - c.ne ** 2,
      w = (de * Math.sin(th) * Math.cos(th)) / (c.ne ** 2 + de * Math.sin(th) ** 2),
      r = w / c.twist;
    const phi = (c.azimuth * Math.PI) / 180 + c.twist * start,
      cx = dx + r * Math.sin(phi),
      cy = dy - r * Math.cos(phi),
      a = -2 * r * cx,
      b = 2 * r * cy,
      R = Math.hypot(a, b);
    if (R < 1e-25) return null;
    const value = (limit ** 2 - cx ** 2 - cy ** 2 - r ** 2) / R;
    if (value >= 1 || value <= -1) return null;
    const offset = Math.atan2(b, a),
      base = Math.asin(value),
      direction = Math.sign(c.twist * sign);
    let best = null;
    for (const root of [base, Math.PI - base]) {
      const angle = root - offset,
        period = 2 * Math.PI;
      let travel = direction * (angle - phi);
      travel = ((travel % period) + period) % period;
      if (travel < 1e-11) travel += period;
      const z = start + (sign * travel) / Math.abs(c.twist);
      if (sign * (endZ - z) > 1e-9 && (best === null || sign * (z - best) < 0)) best = z;
    }
    return best;
  }
  const power = (S, mode) => Math.max(0, (S[0] + (mode === 0 ? 1 : -1) * S[1]) / 2);
  let surfaceKey = '',
    surfaceCache = new Map();
  function surfaces(z, sign, c) {
    const key = JSON.stringify([c.no, c.ne, c.tilt, c.azimuth, c.twist, c.outsideN]);
    if (key !== surfaceKey) {
      surfaceKey = key;
      surfaceCache.clear();
    }
    const id = z + ':' + sign;
    if (surfaceCache.has(id)) return surfaceCache.get(id);
    const local = F.localMaterial(c, [0, 0, z]),
      ext = { ...c, material: 'isotropic', n: O.outsideIndex(c) },
      out = L.interfaceMatrices(local, ext, [0, 0, 0], [0, 0, sign]);
    if (C.abs(out.JR[0][1]) + C.abs(out.JR[1][0]) > 1e-9)
      throw Error('平行平板の法線入射条件が満たされていません');
    out.transmission = [0, 1].map((i) => out.JT.reduce((s, row) => s + C.abs(row[i]) ** 2, 0));
    surfaceCache.set(id, out);
    return out;
  }
  function trace(o, d, c) {
    F.validate(c);
    if (Math.hypot(d[0], d[1]) > 1e-10 || Math.abs(o[2]) <= 1)
      throw Error('位相輸送は平行平板の外から法線入射する光線が対象です');
    const sign = Math.sign(d[2]),
      entry = O.hit(o, d, 'slab');
    const r = {
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
      interfaces: 0,
      reflections: 0,
      coherentSegments: 0,
      coherentSplits: 0,
      coherentLimitWeight: 0,
      workLimitWeight: 0,
      coherencyError: 0,
      channels: { o: 0, e: 0, reflected: 0, direct: 0 },
    };
    let linear = [0, 0, 0];
    const stack = new F.TraceQueue(c, r);
    function finish(x, direction, weight, tag, reflected) {
      if (weight < 1e-25) return;
      r.weightSum += weight;
      r.leaves++;
      r.channels[tag] += weight;
      if (
        c.transportView === 'all' ||
        c.transportView === tag ||
        (c.transportView === 'reflected' && reflected)
      )
        linear = O.add(linear, O.mul(O.bg(x, direction, c).map(F.decode), weight));
    }
    if (!entry) {
      finish(o, d, 1, 'direct', false);
      r.accounted = 1;
      r.color = linear.map(F.encode);
      return F.finishTraceBudget(c, r);
    }
    const local = F.localMaterial(c, entry),
      ext = { ...c, material: 'isotropic', n: O.outsideIndex(c) },
      input = L.interfaceMatrices(ext, local, [0, 0, 0], [0, 0, sign]);
    const transmitted = L.applyMueller(input.MT, [1, 0, 0, 0]),
      reflected = L.applyMueller(input.MR, [1, 0, 0, 0]);
    r.fluxError = Math.abs(transmitted[0] + reflected[0] - 1);
    r.boundaryResidual = input.residual;
    r.interfaces = 1;
    r.maxDepth = 1;
    finish(entry, [0, 0, -sign], reflected[0], 'reflected', true);
    // Unpolarized normal entry is diagonal in the local eigenbasis. Separate
    // incoherent ensembles preserve the entry-o/e contribution views.
    for (let mode = 0; mode < 2; mode++) {
      const weight = power(transmitted, mode);
      stack.push({
        states: initialStates(entry, c, sign),
        S: [1, mode === 0 ? 1 : -1, 0, 0],
        weight,
        sign,
        depth: 1,
        internalDepth: 0,
        tag: mode === 0 ? 'o' : 'e',
        reflected: false,
      });
    }
    while (stack.length) {
      const v = stack.pop();
      if (!v) break;
      r.maxDepth = Math.max(r.maxDepth, v.depth);
      if (v.depth >= c.maxInterfaces) {
        F.recordCutoff(r, v.weight, 'interface');
        continue;
      }
      try {
        const end = v.sign,
          z0 = v.states[0][2],
          split = separationZ(v.states, end, c, v.sign),
          z = split === null ? end : split;
        const states = advance(v.states, z, c, r),
          S = transport(v.S, z0, z, c, v.sign);
        r.coherentSegments++;
        r.coherencyError = Math.max(r.coherencyError, Math.abs(S[0] - 1));
        if (split !== null) {
          if (v.internalDepth >= c.branchDepth) {
            F.recordCutoff(r, v.weight, 'internal');
            r.coherentLimitWeight += v.weight;
            continue;
          }
          r.internalBranches++;
          r.coherentSplits++;
          r.branches++;
          r.maxInternalDepth = Math.max(r.maxInternalDepth, v.internalDepth + 1);
          if (c.branchDebug) {
            r.events ??= [];
            r.events.push({
              z,
              positions: states.map((s) => s.slice(0, 3)),
              stokes: S.slice(),
              weights: [power(S, 0), power(S, 1)],
              depth: v.internalDepth + 1,
            });
          }
          for (let mode = 0; mode < 2; mode++)
            stack.push({
              ...v,
              states: initialStates(states[mode].slice(0, 3), c, v.sign),
              S: [1, mode === 0 ? 1 : -1, 0, 0],
              weight: v.weight * power(S, mode),
              internalDepth: v.internalDepth + 1,
            });
          continue;
        }
        const surface = surfaces(z, v.sign, c),
          ref = L.applyMueller(surface.MR, S),
          refWeight = Math.max(0, ref[0]);
        const transmittedPower = [0, 1].map((mode) => power(S, mode) * surface.transmission[mode]);
        r.fluxError = Math.max(
          r.fluxError,
          Math.abs(transmittedPower[0] + transmittedPower[1] + refWeight - 1),
        );
        r.boundaryResidual = Math.max(r.boundaryResidual, surface.residual);
        r.interfaces++;
        r.maxDepth = Math.max(r.maxDepth, v.depth + 1);
        for (let mode = 0; mode < 2; mode++)
          finish(
            states[mode].slice(0, 3),
            [0, 0, v.sign],
            v.weight * transmittedPower[mode],
            v.tag,
            v.reflected,
          );
        if (c.branchDebug) {
          r.exits ??= [];
          r.exits.push({
            z,
            stokes: S.slice(),
            positions: states.map((s) => s.slice(0, 3)),
            weight: v.weight,
            transmittedPower,
            depth: v.depth + 1,
            tag: v.tag,
          });
        }
        if (refWeight > 1e-25) {
          r.reflections++;
          r.branches++;
          const reverse = states.map((s, mode) => initialStates(s.slice(0, 3), c, -v.sign)[mode]);
          stack.push({
            ...v,
            states: reverse,
            sign: -v.sign,
            S: ref.map((x) => x / refWeight),
            weight: v.weight * refWeight,
            depth: v.depth + 1,
            reflected: true,
          });
        }
      } catch (e) {
        r.status = 'error';
        r.failedWeight += v.weight;
        r.message = e.message;
      }
    }
    r.accounted = r.weightSum + r.dropped + r.failedWeight;
    r.color = linear.map(F.encode);
    return F.finishTraceBudget(c, r);
  }
  const oldTrace = F.trace,
    oldValidate = F.validate;
  F.validate = (c) => {
    oldValidate(c);
    validate(c);
    if (
      c.shape === 'slab' &&
      (!['heliconical', 'common', 'quadratic', 'axial2013Uniaxial'].includes(c.material) ||
        c.transport !== 'polarized')
    )
      throw Error('平行平板は4種の正定値・z依存一軸媒質の通常計算で使用できます');
  };
  F.trace = (o, d, c) => (selected(c) ? trace(o, d, c) : oldTrace(o, d, c));
  F.coherent = {
    defaults,
    selected,
    validate,
    coefficients,
    transfer,
    transport,
    initialStates,
    advance,
    separationZ,
    surfaces,
    power,
    trace,
  };
})(globalThis.Optics, globalThis.Optics.polarization, globalThis.Polynomial);
