/* z-stratified positive uniaxial forward transport, conserved transverse k.
 * Unitary CF4 integration retains coherency at every numerical subdivision.
 * Resolved-interface model: project onto local modes ONLY at actual surfaces
 * or the explicit finite-envelope separation event. This is an additional
 * radiometric approximation; it is NOT a coherent slab scattering solution.
 * The earlier normal-incidence coherent-interface model remains selectable.
 */
(function (O, F, P) {
  'use strict';
  const C = P.C,
    L = F.layered,
    Q = F.coherent,
    models = ['heliconical', 'common', 'quadratic', 'axial2013Uniaxial'];
  Object.assign(Q.defaults, { phaseTolerance: 2e-6, coherentInterface: 'resolved' });
  Object.assign(O.defaults, Q.defaults);
  const selected = (c) => Q.selected(c) && c.coherentInterface !== 'retained';
  function validate(c) {
    if (F.coherentFinite?.selected(c)) F.coherentFinite.validate(c);
    if (!models.includes(c.material) || (c.shape !== 'slab' && !F.coherentFinite?.selected(c)))
      throw Error(
        '位相輸送の対象はHeliconical・2種のCommon-scale・2013 axialの一軸媒質モデルです。有限形状では「局所表面で光線を分ける近似」を選んでください。',
      );
    if (
      !['resolved', 'retained', 'coupled', 'coupled-dephased', 'finite-resolved'].includes(
        c.coherentInterface,
      )
    )
      throw Error('界面の偏光モデルが不正です');
    if (c.material !== 'axial2013Uniaxial' && Math.abs(c.no - c.ne) < 1e-7)
      throw Error('位相輸送には二つの屈折率を分離してください');
    for (const [key, lo, hi] of [
      ['wavelengthNm', 100, 10000],
      ['lengthUnitUm', 0.1, 10000],
      ['beamRadiusUm', 0.01, 100000],
      ['overlapCutoff', 1e-6, 0.1],
      ['phaseTolerance', 1e-8, 0.001],
    ])
      if (!Number.isFinite(c[key]) || c[key] < lo || c[key] > hi)
        throw Error(key + ' の設定範囲は ' + lo + '〜' + hi + ' です');
    if (!Number.isInteger(c.phaseSlices) || c.phaseSlices < 1 || c.phaseSlices > 256)
      throw Error('偏光計算の分割数は1〜256です');
    if (!Number.isInteger(c.branchDepth) || c.branchDepth < 0 || c.branchDepth > 6)
      throw Error('空間分離の最大回数は0〜6です');
    if (F.phaseInterface?.selected(c)) F.phaseInterface.validate(c);
    if (c.branchPolicy !== 'overlap') throw Error('位相輸送の分離条件は光束の重なりで指定します');
  }
  const ident = () => [
    [
      [1, 0],
      [0, 0],
    ],
    [
      [0, 0],
      [1, 0],
    ],
  ];
  const multiply = (A, B) =>
    [0, 1].map((i) => [0, 1].map((j) => C.add(C.mul(A[i][0], B[0][j]), C.mul(A[i][1], B[1][j]))));
  const difference = (A, B) =>
    Math.max(...A.flatMap((row, i) => row.map((z, j) => C.abs(C.sub(z, B[i][j])))));
  function exponential(g, delta, h) {
    const r = Math.hypot(g, delta),
      q = r ? Math.sin(r * h) / r : h,
      t = Math.cos(r * h);
    return [
      [
        [t, delta * q],
        [g * q, 0],
      ],
      [
        [-g * q, 0],
        [t, -delta * q],
      ],
    ];
  }
  function coefficients(z, k, c, sign) {
    const k0 = (2 * Math.PI * c.lengthUnitUm) / (c.wavelengthNm * 0.001);
    if (c.material === 'axial2013Uniaxial') {
      const b = 1 + c.gradient * Math.sin(z),
        p = k[0] ** 2 + k[1] ** 2;
      if (!(b > 0 && b * b - p > 1e-10 && 1 - p > 1e-10))
        throw Error('前方2モードがともに伝播するz区間が必要です');
      return { g: 0, delta: (k0 * sign * (Math.sqrt(b * b - p) - b * Math.sqrt(1 - p))) / 2 };
    }
    const fields = F.modal.frame(z, k, c, sign),
      delta = (k0 * (fields[0].p[2] - fields[1].p[2])) / 2;
    let g = 0;
    if (c.material === 'heliconical' && Math.hypot(...k) < 1e-10) g = Q.coefficients(c, sign).g;
    else if (
      Math.hypot(...k) >= 1e-10 &&
      ((c.material === 'heliconical' && c.twist !== 0) ||
        (c.material !== 'heliconical' && c.gradient !== 0))
    )
      g = F.modal.connection(z, k, c, sign);
    return { g, delta };
  }
  let transferConfig = '',
    transferCache = new Map();
  function transfer(z0, z1, k, c, sign) {
    const materialKey = JSON.stringify([
      c.material,
      c.no,
      c.ne,
      c.gradient,
      c.tilt,
      c.azimuth,
      c.twist,
      c.lengthUnitUm,
      c.wavelengthNm,
      c.phaseTolerance,
      c.phaseSlices,
    ]);
    if (materialKey !== transferConfig) {
      transferConfig = materialKey;
      transferCache.clear();
    }
    const key = JSON.stringify([z0, z1, k, sign]);
    if (transferCache.has(key)) return transferCache.get(key);
    let J = ident(),
      evaluations = 0,
      error = 0,
      accepted = 0,
      method = 'numerical';
    const memo = new Map();
    const at = (z) => {
      if (memo.has(z)) return memo.get(z);
      if (++evaluations > 50000)
        throw Error('偏光輸送が計算上限に達しました。実寸・波長・許容誤差を確認してください');
      const a = coefficients(z, k, c, sign);
      memo.set(z, a);
      return a;
    };
    if (z0 === z1) method = 'closed';
    else if (c.material === 'heliconical' && Math.hypot(...k) < 1e-10) {
      const a = at((z0 + z1) / 2);
      J = exponential(a.g, a.delta, z1 - z0);
      method = 'closed';
      accepted = 1;
    } else {
      // Fourth-order commutator-free Magnus pair. Late factor multiplies on left.
      const v = Math.sqrt(3) / 6,
        a = (3 - 2 * Math.sqrt(3)) / 12,
        b = (3 + 2 * Math.sqrt(3)) / 12;
      function cf(x, y) {
        const h = y - x,
          A = at(x + (0.5 - v) * h),
          B = at(x + (0.5 + v) * h);
        return multiply(
          exponential(a * A.g + b * B.g, a * A.delta + b * B.delta, h),
          exponential(b * A.g + a * B.g, b * A.delta + a * B.delta, h),
        );
      }
      function rec(x, y, tol, depth) {
        const mid = (x + y) / 2,
          left = cf(x, mid),
          right = cf(mid, y),
          fine = multiply(right, left),
          coarse = cf(x, y),
          err = difference(fine, coarse) / 15;
        const A = at(x),
          B = at(mid),
          D = at(y),
          beat =
            Math.max(Math.abs(A.delta), Math.abs(B.delta), Math.abs(D.delta)) * Math.abs(y - x);
        // Resolve the modal beat to avoid accepting an aliased oscillatory error.
        if (
          err <= tol &&
          (beat <= 1 || Math.max(Math.abs(A.g), Math.abs(B.g), Math.abs(D.g)) < 1e-14)
        ) {
          error += err;
          accepted += 2;
          return fine;
        }
        if (depth === 0) throw Error('偏光輸送が収束しません。条件を変更してください');
        return multiply(rec(mid, y, tol / 2, depth - 1), rec(x, mid, tol / 2, depth - 1));
      }
      const n = Math.max(
          c.phaseSlices || 1,
          Math.ceil(
            (Math.abs(z1 - z0) * (c.material === 'heliconical' ? Math.abs(c.twist) : 0)) / 0.2,
          ),
          1,
        ),
        tol = c.phaseTolerance || 2e-6;
      for (let i = 0; i < n; i++) {
        const x = z0 + ((z1 - z0) * i) / n,
          y = z0 + ((z1 - z0) * (i + 1)) / n;
        J = multiply(rec(x, y, tol / n, 18), J);
      }
    }
    const M = L.jonesMueller(J),
      result = { J, M, method, error, evaluations, accepted, conversion: C.abs(J[1][0]) ** 2 };
    if (transferCache.size >= 1024) transferCache.clear();
    transferCache.set(key, result);
    return result;
  }
  function transport(S, z0, z1, k, c, sign) {
    const tr = transfer(z0, z1, k, c, sign),
      out = L.applyMueller(tr.M, S);
    if (Math.abs(out[0] - S[0]) > 1e-9 || Math.hypot(...out.slice(1)) > out[0] + 1e-9)
      throw Error('偏光強度・偏光度の保存が不正です');
    return { S: out, transfer: tr };
  }
  function initialStates(x, k, c, sign) {
    return [0, 1].map((mode) => {
      const p = O.boundary(x, [...k, 0], [0, 0, 1], c, mode, sign < 0);
      if (!p) throw Error('前方2モードがともに伝播する区間が必要です');
      return [...x, ...p];
    });
  }
  function advanceState(s, z, c, mode) {
    const sign = Math.sign(O.velocity(s.slice(0, 3), s.slice(3), c, mode)[2]);
    if (!sign || sign * (z - s[2]) < -1e-10) throw Error('zが単調な伝播区間が必要です');
    if (c.solver === 'auto' && c.material === 'heliconical' && mode === 0) {
      const v = O.velocity(s.slice(0, 3), s.slice(3), c, mode),
        h = (z - s[2]) / v[2];
      O.recordStep('closed');
      return [s[0] + h * v[0], s[1] + h * v[1], z, ...s.slice(3)];
    }
    if (c.solver === 'auto') {
      const exact = O.exactAdvance(s, z - s[2], c, mode);
      if (exact) {
        O.recordStep('closed');
        return exact;
      }
    }
    let q = s.slice();
    const n = Math.max(
        1,
        Math.ceil(
          Math.abs(z - s[2]) /
            Math.min(c.step, 0.1 / (1 + Math.abs(c.material === 'heliconical' ? c.twist : 0))),
        ),
      ),
      h = (z - s[2]) / n;
    function rhs(v) {
      const f = O.rhs(v, c, mode);
      if (sign * f[2] <= 1e-8) throw Error('z折り返し・接線伝播は位相輸送の対象外です');
      return f.map((x) => x / f[2]);
    }
    for (let i = 0; i < n; i++) {
      const target = s[2] + (i + 1) * h;
      if (c.solver !== 'rkf45') {
        const a = O.schurAdvance(q, target - q[2], c, mode);
        if (a) {
          O.recordStep('quadrature');
          q = a;
          continue;
        }
      }
      q = O.rkf45(q, target - q[2], c, mode, rhs);
      q[2] = target;
      O.recordStep('ode');
    }
    if (
      !q.every(Number.isFinite) ||
      Math.abs(2 * O.H(q.slice(0, 3), q.slice(3), c, mode) - 1) > 1e-5
    )
      throw Error('軌道の分散残差が大きすぎます。追跡の刻み幅を小さくしてください');
    return q;
  }
  function advance(states, z, c) {
    return states.map((s, m) => advanceState(s, z, c, m));
  }
  function separation(states, end, c, sign) {
    const start = states[0][2],
      limit = (c.beamRadiusUm / c.lengthUnitUm) * Math.sqrt(-2 * Math.log(c.overlapCutoff));
    if (c.material === 'heliconical' && Math.hypot(...states[0].slice(3, 5)) < 1e-10)
      return Q.separationZ(states, end, c, sign);
    const value = (at) => Math.hypot(at[1][0] - at[0][0], at[1][1] - at[0][1]) - limit;
    if (value(states) >= 0) return start;
    // Geometric event search, unrelated to the polarization integration steps.
    // Use a conservative mesh plus midpoints, then bisect the first crossing.
    const n = Math.max(
      16,
      Math.ceil(
        Math.abs(end - start) /
          Math.min(0.02, c.step, 0.08 / (1 + Math.abs(c.material === 'heliconical' ? c.twist : 0))),
      ),
    );
    let a = start,
      prev = states;
    for (let i = 1; i <= 2 * n; i++) {
      const b = start + ((end - start) * i) / (2 * n),
        next = advance(prev, b, c);
      if (value(next) >= 0) {
        let lo = a,
          hi = b;
        for (let j = 0; j < 30; j++) {
          const mid = (lo + hi) / 2;
          if (value(advance(prev, mid, c)) >= 0) hi = mid;
          else lo = mid;
        }
        const root = (lo + hi) / 2;
        return sign * (end - root) > 1e-8 ? root : null;
      }
      a = b;
      prev = next;
    }
    return null;
  }
  let kernelKey = '',
    kernelCache = new Map();
  function trace(o, d, c) {
    F.validate(c);
    const sign = Math.sign(d[2]);
    if (!sign || Math.abs(d[2]) < 1e-6 || Math.abs(o[2]) <= 1)
      throw Error('カメラを平行平板の外に置き、z方向に進む光線を使ってください');
    const entry = O.hit(o, d, 'slab');
    if (!entry || O.backgroundDistance(o, d, c) < O.norm(O.add(entry, O.mul(o, -1))))
      return { status: 'ok', color: O.bg(o, d, c), drift: 0, weightSum: 1, accounted: 1 };
    const key = JSON.stringify({
      ...c,
      background: undefined,
      backgroundZ: undefined,
      resolution: undefined,
      transportView: undefined,
      branchDebug: undefined,
    });
    if (key !== kernelKey) {
      kernelKey = key;
      kernelCache.clear();
    }
    const rayKey = JSON.stringify(d),
      cached = c.branchDebug ? null : kernelCache.get(rayKey),
      kernel = cached || paths(d, c);
    if (!cached && kernel.status === 'ok' && !c.branchDebug) {
      if (kernelCache.size >= 512) kernelCache.clear();
      kernelCache.set(rayKey, kernel);
    }
    let linear = [0, 0, 0];
    for (const ray of kernel.rays)
      if (
        c.transportView === 'all' ||
        c.transportView === ray.tag ||
        (c.transportView === 'reflected' && ray.reflected)
      )
        linear = O.add(
          linear,
          O.mul(
            O.bg([ray.o[0] + entry[0], ray.o[1] + entry[1], ray.o[2]], ray.d, c).map(F.decode),
            ray.weight,
          ),
        );
    return {
      ...kernel,
      rays: undefined,
      color: linear.map(F.encode),
      phasePathCacheHits: cached ? 1 : 0,
    };
  }
  function paths(d, c) {
    const sign = Math.sign(d[2]),
      entry = [0, 0, -sign],
      ext = { ...c, material: 'isotropic', n: O.outsideIndex(c) },
      local = F.localMaterial(c, entry);
    const r = {
      status: 'ok',
      drift: 0,
      branches: 0,
      leaves: 0,
      maxDepth: 1,
      internalBranches: 0,
      maxInternalDepth: 0,
      unavailableWeight: 0,
      weightSum: 0,
      dropped: 0,
      failedWeight: 0,
      fluxError: 0,
      boundaryResidual: 0,
      interfaces: 1,
      reflections: 0,
      coherentSegments: 0,
      coherentSplits: 0,
      coherentLimitWeight: 0,
      workLimitWeight: 0,
      coherencyError: 0,
      phaseClosed: 0,
      phaseNumerical: 0,
      phaseIntegrationError: 0,
      phaseSurfaceDephasings: 0,
      phaseSurfaceCoherence: 0,
      channels: { o: 0, e: 0, reflected: 0, direct: 0 },
      rays: [],
    };
    const stack = new F.TraceQueue(c, r);
    const finish = (o, p, weight, tag, reflected) => {
      if (weight <= 0) return;
      r.weightSum += weight;
      r.leaves++;
      r.channels[tag] += weight;
      r.rays.push({ o: o.slice(), d: O.unit(p), weight, tag, reflected });
    };
    const make = (x, ch, weight, depth, internalDepth, tag, reflected) => ({
      states: initialStates(x, ch.p.slice(0, 2), c, Math.sign(O.velocity(x, ch.p, c, ch.mode)[2])),
      S: [1, ch.mode === 0 ? 1 : -1, 0, 0],
      weight,
      sign: Math.sign(O.velocity(x, ch.p, c, ch.mode)[2]),
      depth,
      internalDepth,
      tag,
      reflected,
    });
    const input = L.interfaceMatrices(ext, local, [d[0] * ext.n, d[1] * ext.n, 0], [0, 0, sign]),
      inputS = L.applyMueller(input.MT, [1, 0, 0, 0]);
    r.phaseSurfaceCoherence = Math.hypot(inputS[2], inputS[3]);
    for (const E of F.basis(d)) {
      const s = F.scatter({ p: O.mul(d, ext.n), E: F.cv(E) }, ext, local, [0, 0, sign]);
      r.fluxError = Math.max(r.fluxError, s.error);
      r.boundaryResidual = Math.max(r.boundaryResidual, s.residual);
      r.branches += s.children.length - 1;
      for (const ch of s.children) {
        const weight = 0.5 * ch.weight;
        if (ch.reflection) {
          finish(entry, ch.p, weight, 'reflected', true);
          r.reflections++;
        } else stack.push(make(entry, ch, weight, 1, 0, ch.mode === 0 ? 'o' : 'e', false));
      }
    }
    while (stack.length) {
      const v = stack.pop();
      if (!v) break;
      r.maxDepth = Math.max(r.maxDepth, v.depth);
      if (v.depth >= c.maxInterfaces) {
        F.recordCutoff(r, v.weight, 'interface');
        continue;
      }
      let allocated = 0;
      try {
        const end = v.sign,
          z0 = v.states[0][2],
          k = v.states[0].slice(3, 5),
          split = separation(v.states, end, c, v.sign),
          z = split === null ? end : split;
        const states = advance(v.states, z, c),
          p = transport(v.S, z0, z, k, c, v.sign),
          S = p.S;
        r.coherentSegments++;
        r[p.transfer.method === 'closed' ? 'phaseClosed' : 'phaseNumerical']++;
        r.phaseIntegrationError = Math.max(r.phaseIntegrationError, p.transfer.error);
        r.coherencyError = Math.max(r.coherencyError, Math.abs(S[0] - 1));
        states.forEach(
          (s, m) =>
            (r.drift = Math.max(r.drift, Math.abs(2 * O.H(s.slice(0, 3), s.slice(3), c, m) - 1))),
        );
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
              stokes: S,
              weights: [Q.power(S, 0), Q.power(S, 1)],
              depth: v.internalDepth + 1,
            });
          }
          const children = [0, 1].map((mode) => ({
            ...v,
            states: initialStates(states[mode].slice(0, 3), k, c, v.sign),
            S: [1, mode === 0 ? 1 : -1, 0, 0],
            weight: v.weight * Q.power(S, mode),
            internalDepth: v.internalDepth + 1,
          }));
          stack.push(...children);
          continue;
        }
        r.phaseSurfaceDephasings++;
        r.phaseSurfaceCoherence = Math.max(r.phaseSurfaceCoherence, Math.hypot(S[2], S[3]));
        if (c.branchDebug) {
          r.exits ??= [];
          r.exits.push({
            z,
            stokes: S,
            positions: states.map((s) => s.slice(0, 3)),
            weight: v.weight,
            tag: v.tag,
          });
        }
        for (let mode = 0; mode < 2; mode++) {
          const fraction = Q.power(S, mode),
            weight = v.weight * fraction;
          if (weight < c.minContribution) {
            F.recordCutoff(r, weight, 'threshold');
            allocated += weight;
            continue;
          }
          const state = states[mode],
            x = state.slice(0, 3),
            material = F.localMaterial(c, x),
            s = F.scatter(
              { p: state.slice(3), E: F.fields(F.cv(state.slice(3)), material, mode).E },
              material,
              ext,
              [0, 0, v.sign],
            );
          r.fluxError = Math.max(r.fluxError, s.error);
          r.boundaryResidual = Math.max(r.boundaryResidual, s.residual);
          r.interfaces++;
          r.maxDepth = Math.max(r.maxDepth, v.depth + 1);
          r.branches += s.children.length - 1;
          for (const ch of s.children) {
            const w = weight * ch.weight;
            if (ch.reflection) {
              r.reflections++;
              stack.push(make(x, ch, w, v.depth + 1, v.internalDepth, v.tag, true));
            } else finish(x, ch.p, w, v.tag, v.reflected);
            allocated += w;
          }
        }
      } catch (e) {
        r.status = 'error';
        r.failedWeight += Math.max(0, v.weight - allocated);
        r.message = e.message;
      }
    }
    r.phaseTransmitted = r.rays
      .filter((v) => Math.sign(v.d[2]) === sign)
      .reduce((s, v) => s + v.weight, 0);
    r.phaseReflected = r.weightSum - r.phaseTransmitted;
    r.accounted = r.weightSum + r.dropped + r.failedWeight;
    return F.finishTraceBudget(c, r);
  }
  F.coherentGeneral = {
    models,
    selected,
    validate,
    coefficients,
    transfer,
    transport,
    initialStates,
    advance,
    separation,
    paths,
    trace,
  };
  const oldTrace = F.trace;
  F.trace = (o, d, c) => (selected(c) ? trace(o, d, c) : oldTrace(o, d, c));
})(globalThis.Optics, globalThis.Optics.polarization, globalThis.Polynomial);
