/* Strong-overlap packet approximation on an infinite z-stratified slab.
 * Retains the full modal coherency at entry, exit, and internal reflections.
 * Original o/e trajectories define a common midpoint carrier at each surface.
 * This carrier assignment is an extra spatial approximation, not a beam solver.
 * Different round trips remain incoherent. No diffraction or bulk back coupling.
 */
(function (O, F) {
  'use strict';
  const G = F.coherentGeneral,
    L = F.layered,
    Q = F.coherent;
  Object.assign(Q.defaults, { commonMinOverlap: 0.99 });
  Object.assign(O.defaults, Q.defaults);
  const selected = (c) =>
    Q.selected(c) && ['coupled', 'coupled-dephased'].includes(c.coherentInterface);
  function validate(c) {
    if (!Number.isFinite(c.commonMinOverlap) || c.commonMinOverlap < 0.9 || c.commonMinOverlap >= 1)
      throw Error('共通光束の最小重なりは0.9以上1未満で指定してください');
    if (!['all', 'reflected'].includes(c.transportView))
      throw Error(
        '相関を保持する入口ではo/eの独立した寄与を定義しません。「すべての光」または「反射を経た光」を選んでください',
      );
  }
  const project = (S, c) =>
    c.coherentInterface === 'coupled-dephased' ? [S[0], S[1], 0, 0] : S.slice();
  const midpoint = (states) => states[0].slice(0, 3).map((v, i) => (v + states[1][i]) / 2);
  function overlap(states, c) {
    const d = Math.hypot(states[0][0] - states[1][0], states[0][1] - states[1][1]) * c.lengthUnitUm;
    return Math.exp((-d * d) / (2 * c.beamRadiusUm ** 2));
  }
  function segment(states, end, c, sign) {
    let q = states,
      minimum = overlap(q, c),
      start = q[0][2];
    const n = Math.max(
      16,
      Math.ceil(
        Math.abs(end - start) /
          Math.min(c.step, 0.02, 0.08 / (1 + Math.abs(c.material === 'heliconical' ? c.twist : 0))),
      ),
    );
    for (let i = 1; i <= n; i++) {
      q = G.advance(q, start + ((end - start) * i) / n, c);
      minimum = Math.min(minimum, overlap(q, c));
      if (minimum < c.commonMinOverlap) {
        const e = Error(
          '共通光束の重なりが設定値 ' +
            c.commonMinOverlap +
            ' 未満です。光束半径・厚さ・入射角を確認するか、従来の独立光線方式を選んでください',
        );
        e.minimumOverlap = minimum;
        throw e;
      }
    }
    return { states: G.advance(states, end, c), minimum };
  }
  function boundary(z, k, sign, c, incoming = false) {
    const ext = { ...c, material: 'isotropic', n: O.outsideIndex(c) },
      local = F.localMaterial(c, [0, 0, z]);
    return L.interfaceMatrices(
      incoming ? ext : local,
      incoming ? local : ext,
      [...k, 0],
      [0, 0, sign],
    );
  }
  // A one-pass, plane-wave observable: retains entrance/exit phases but excludes
  // all external-interface round trips. The local bulk propagator is unchanged.
  function onePass(d, c, input = [1, 0, 0, 0]) {
    const sign = Math.sign(d[2]),
      k = d.slice(0, 2).map((v) => v * O.outsideIndex(c)),
      entry = boundary(-sign, k, sign, c, true),
      exit = boundary(sign, k, sign, c);
    const T0 = project(L.applyMueller(entry.MT, input), c),
      R0 = L.applyMueller(entry.MR, input),
      tr = G.transfer(-sign, sign, k, c, sign),
      inside = L.applyMueller(tr.M, T0),
      incident = project(inside, c),
      T = L.applyMueller(exit.MT, incident),
      R = project(L.applyMueller(exit.MR, incident), c);
    return {
      transmitted: T,
      entryReflected: R0,
      exitReflected: R,
      inside,
      transfer: tr,
      accounted: T[0] + R[0] + R0[0],
    };
  }
  let cacheKey = '',
    cache = new Map();
  function paths(d, c) {
    const sign = Math.sign(d[2]),
      k = d.slice(0, 2).map((v) => v * O.outsideIndex(c)),
      entry = [0, 0, -sign],
      input = boundary(-sign, k, sign, c, true);
    const T = project(L.applyMueller(input.MT, [1, 0, 0, 0]), c),
      R = L.applyMueller(input.MR, [1, 0, 0, 0]);
    const r = {
      status: 'ok',
      rays: [],
      weightSum: 0,
      dropped: 0,
      failedWeight: 0,
      accounted: 0,
      drift: 0,
      branches: 1,
      leaves: 0,
      maxDepth: 1,
      interfaces: 1,
      reflections: 1,
      fluxError: Math.abs(T[0] + R[0] - 1),
      boundaryResidual: input.residual,
      coherentSegments: 0,
      coherentSplits: 0,
      coherencyError: 0,
      phaseClosed: 0,
      phaseNumerical: 0,
      phaseIntegrationError: 0,
      phaseSurfaceDephasings: c.coherentInterface === 'coupled-dephased' ? 1 : 0,
      phaseSurfaceRetentions: c.coherentInterface === 'coupled' ? 1 : 0,
      phaseTransmitted: 0,
      phaseReflected: 0,
      phaseUntracedReflection: 0,
      phaseMinOverlap: 1,
      phaseSurfaceCoherence: Math.hypot(T[2], T[3]),
      channels: { direct: 0, reflected: 0 },
    };
    const finish = (x, p, weight, reflected, S) => {
      if (weight <= 1e-25) return;
      r.weightSum += weight;
      r.leaves++;
      const back = Math.sign(p[2]) !== sign;
      r[back ? 'phaseReflected' : 'phaseTransmitted'] += weight;
      r.channels[reflected ? 'reflected' : 'direct'] += weight;
      r.rays.push({ o: x.slice(), d: O.unit(p), weight, reflected, stokes: S.slice() });
    };
    finish(entry, input.R[0].p, R[0], true, R);
    const initial =
      T[0] > 1e-25
        ? {
            states: G.initialStates(entry, k, c, sign),
            S: T.map((x) => x / T[0]),
            weight: T[0],
            sign,
            depth: 1,
            reflected: false,
          }
        : null;
    const stack = new F.TraceQueue(c, r, initial ? [initial] : []);
    while (stack.length) {
      const v = stack.pop();
      if (!v) break;
      if (v.depth >= c.maxInterfaces) {
        F.recordCutoff(r, v.weight, 'interface');
        break;
      }
      try {
        const geom = segment(v.states, v.sign, c, v.sign),
          states = geom.states,
          z = v.sign,
          z0 = v.states[0][2],
          tr = G.transport(v.S, z0, z, k, c, v.sign),
          at = project(tr.S, c),
          m = boundary(z, k, v.sign, c),
          T = L.applyMueller(m.MT, at),
          R = project(L.applyMueller(m.MR, at), c),
          x = midpoint(states);
        const error = Math.abs(T[0] + R[0] - 1);
        if (!Number.isFinite(error) || error > 2e-7 || Math.min(T[0], R[0]) < -1e-10)
          throw Error('相関を保持した界面の強度収支が不正です');
        const next =
          R[0] > 1e-25
            ? {
                states: G.initialStates(x, k, c, -v.sign),
                S: R.map((a) => a / R[0]),
                weight: v.weight * R[0],
                sign: -v.sign,
                depth: v.depth + 1,
                reflected: true,
              }
            : null;
        r.phaseMinOverlap = Math.min(r.phaseMinOverlap, geom.minimum);
        r.coherentSegments++;
        r[tr.transfer.method === 'closed' ? 'phaseClosed' : 'phaseNumerical']++;
        r.phaseIntegrationError = Math.max(r.phaseIntegrationError, tr.transfer.error);
        r.coherencyError = Math.max(r.coherencyError, Math.abs(tr.S[0] - 1));
        r.fluxError = Math.max(r.fluxError, error);
        r.boundaryResidual = Math.max(r.boundaryResidual, m.residual);
        r.interfaces++;
        r.maxDepth = Math.max(r.maxDepth, v.depth + 1);
        r.branches++;
        r.reflections++;
        r[
          c.coherentInterface === 'coupled' ? 'phaseSurfaceRetentions' : 'phaseSurfaceDephasings'
        ]++;
        r.phaseSurfaceCoherence = Math.max(r.phaseSurfaceCoherence, Math.hypot(tr.S[2], tr.S[3]));
        states.forEach(
          (s, i) =>
            (r.drift = Math.max(r.drift, Math.abs(2 * O.H(s.slice(0, 3), s.slice(3), c, i) - 1))),
        );
        finish(
          x,
          m.T[0].p,
          v.weight * Math.max(0, T[0]),
          v.reflected,
          T.map((a) => a * v.weight),
        );
        if (c.branchDebug) {
          r.exits ??= [];
          r.exits.push({
            z,
            positions: states.map((s) => s.slice(0, 3)),
            carrier: x,
            inside: tr.S,
            transmitted: T,
            reflected: R,
            weight: v.weight,
            minimumOverlap: geom.minimum,
          });
        }
        if (next) stack.push(next);
      } catch (e) {
        r.status = 'error';
        r.message = e.message;
        r.failedWeight += v.weight;
        if (e.minimumOverlap !== undefined)
          r.phaseMinOverlap = Math.min(r.phaseMinOverlap, e.minimumOverlap);
        break;
      }
    }
    r.phaseUntracedReflection = initial?.reflected
      ? r.dropped
      : Math.max(0, r.dropped - (initial && r.processedRays === 0 ? initial.weight : 0));
    r.accounted = r.weightSum + r.dropped + r.failedWeight;
    return F.finishTraceBudget(c, r);
  }
  function trace(o, d, c) {
    F.validate(c);
    if (Math.abs(d[2]) < 1e-6 || Math.abs(o[2]) <= 1)
      throw Error('カメラを平板外に置き、z方向に伝播する光線を使ってください');
    const entry = O.hit(o, d, 'slab');
    if (!entry || O.backgroundDistance(o, d, c) < O.norm(O.add(entry, O.mul(o, -1))))
      return {
        status: 'ok',
        color: O.bg(o, d, c),
        drift: 0,
        weightSum: 1,
        accounted: 1,
        phaseMinOverlap: 1,
      };
    const key = JSON.stringify({
      ...c,
      background: undefined,
      backgroundZ: undefined,
      resolution: undefined,
      transportView: undefined,
      branchDebug: undefined,
    });
    if (key !== cacheKey) {
      cacheKey = key;
      cache.clear();
    }
    const rayKey = JSON.stringify(d),
      cached = c.branchDebug ? null : cache.get(rayKey),
      r = cached || paths(d, c);
    if (!cached && r.status === 'ok' && !c.branchDebug) {
      if (cache.size >= 512) cache.clear();
      cache.set(rayKey, r);
    }
    let linear = [0, 0, 0];
    for (const ray of r.rays)
      if (c.transportView === 'all' || ray.reflected)
        linear = O.add(
          linear,
          O.mul(
            O.bg([ray.o[0] + entry[0], ray.o[1] + entry[1], ray.o[2]], ray.d, c).map(F.decode),
            ray.weight,
          ),
        );
    return {
      ...r,
      phaseExitStokes: r.rays.find((v) => !v.reflected)?.stokes,
      rays: undefined,
      color: r.status === 'ok' ? linear.map(F.encode) : [210, 50, 100],
      phasePathCacheHits: cached ? 1 : 0,
    };
  }
  F.phaseInterface = { selected, validate, overlap, segment, boundary, onePass, paths, trace };
  const oldTrace = F.trace;
  F.trace = (o, d, c) => (selected(c) ? trace(o, d, c) : oldTrace(o, d, c));
})(globalThis.Optics, globalThis.Optics.polarization);
