/* Finite-boundary extension of the z-stratified two-mode packet approximation.
 * Each actual interface resolves eigenrays at its own position and normal.
 * Bulk coherency is retained until spatial separation or the first packet
 * center reaches a boundary; the remaining center then travels adiabatically.
 * A non-monotone/unavailable z pair uses explicitly counted adiabatic transport.
 * No coherent curved-interface matching or interference between separate rays.
 */
(function (O, F) {
  'use strict';
  const G = F.coherentGeneral,
    Q = F.coherent;
  const shapes = ['cube', 'sphere', 'torus'];
  const selected = (c) => Q.selected(c) && c.coherentInterface === 'finite-resolved';
  const pairCondition = (e) =>
    /前方2モード|両モードの非接線|z折り返し|zが単調|光学軸付近で縮退/.test(e.message);
  const state = (v) => [...v.o, ...v.p];
  const packet = (s, m, c) => ({
    o: s.slice(0, 3),
    p: s.slice(3),
    mode: m,
    E: F.fields(F.cv(s.slice(3)), F.localMaterial(c, s), m).E,
  });
  const stats = () => ({
    status: 'ok',
    drift: 0,
    branches: 0,
    leaves: 0,
    maxDepth: 0,
    internalBranches: 0,
    maxInternalDepth: 0,
    weightSum: 0,
    dropped: 0,
    failedWeight: 0,
    accounted: 0,
    fluxError: 0,
    boundaryResidual: 0,
    fieldResidual: 0,
    rootResidual: 0,
    interfaces: 0,
    reflections: 0,
    coherentSegments: 0,
    coherentSplits: 0,
    coherentLimitWeight: 0,
    coherencyError: 0,
    phaseClosed: 0,
    phaseNumerical: 0,
    phaseIntegrationError: 0,
    phaseSurfaceDephasings: 0,
    phaseBoundaryProjections: 0,
    phaseAdiabaticSegments: 0,
    phaseAdiabaticWeight: 0,
    phaseBoundaryTails: 0,
    phaseReentries: 0,
    phaseEscapedDirect: 0,
    phaseEscapedReflected: 0,
    geometryResidual: 0,
    channels: { direct: 0, o: 0, e: 0, reflected: 0 },
  });
  function validate(c) {
    if (!shapes.includes(c.shape))
      throw Error('有限形状の位相輸送は立方体・球・トーラスを選んでください');
  }
  // Hamiltonian-parameter boundary search: the underlying advance still selects
  // exact trajectories, Schur quadrature, or RKF45. No straight-layer replacement.
  function travel(initial, mode, c) {
    const uniform =
      (c.material === 'heliconical' && (mode === 0 || c.twist === 0)) ||
      (['common', 'quadratic', 'axial2013Uniaxial'].includes(c.material) && c.gradient === 0);
    if (uniform && c.solver === 'auto') {
      const x = initial.slice(0, 3),
        p = initial.slice(3),
        v = O.velocity(x, p, c, mode),
        hit = F.interiorHit(x, O.unit(v), c.shape);
      if (!hit) throw Error('均質区間の出口を検出できません');
      O.recordStep('closed');
      return {
        state: [...hit, ...p],
        sign: Math.sign(v[2]),
        monotone: Math.abs(v[2]) > 1e-7,
        drift: Math.abs(2 * O.H(x, p, c, mode) - 1),
        length: O.norm(O.add(hit, O.mul(x, -1))),
      };
    }
    let s = initial.slice(),
      sign = Math.sign(O.velocity(s.slice(0, 3), s.slice(3), c, mode)[2]),
      monotone = !!sign,
      drift = 0,
      length = 0;
    const check = (q) => {
      if (!q?.every(Number.isFinite)) throw Error('有限形状の軌道が有限値ではありません');
      const d = Math.abs(2 * O.H(q.slice(0, 3), q.slice(3), c, mode) - 1);
      drift = Math.max(drift, d);
      if (d > 1e-5) throw Error('有限形状の軌道残差が大きすぎます。刻み幅を小さくしてください');
      if (sign * O.velocity(q.slice(0, 3), q.slice(3), c, mode)[2] <= 1e-7) monotone = false;
    };
    check(s);
    if (O.sdf(s.slice(0, 3), c.shape) > 2e-7)
      throw Error('有限形状の内部軌道が物体外から開始しました');
    for (let i = 0; i < (c.maxSteps || 650) * 3; i++) {
      const v = O.velocity(s.slice(0, 3), s.slice(3), c, mode),
        speed = O.norm(v),
        projected = F.interiorHit(s.slice(0, 3), O.unit(v), c.shape),
        dist = projected ? O.norm(O.add(projected, O.mul(s.slice(0, 3), -1))) : c.step;
      let h = Math.min(c.step, 0.025, Math.max(2e-6, 1.02 * dist)) / speed,
        mid,
        end;
      for (let retry = 0; retry < 16; retry++) {
        mid = O.advance(s, h / 2, c, mode);
        end = O.advance(s, h, c, mode);
        const residual = Math.max(
          ...[mid, end].map((q) =>
            q?.every(Number.isFinite)
              ? Math.abs(2 * O.H(q.slice(0, 3), q.slice(3), c, mode) - 1)
              : Infinity,
          ),
        );
        const bend =
          mid?.every(Number.isFinite) && end?.every(Number.isFinite)
            ? O.norm(O.add(mid.slice(0, 3), O.mul(O.add(s.slice(0, 3), end.slice(0, 3)), -0.5)))
            : Infinity;
        if (residual <= 1e-7 && bend < 1e-4) break;
        h *= 0.5;
      }
      check(mid);
      check(end);
      let crossed =
        O.sdf(mid.slice(0, 3), c.shape) >= 0
          ? h / 2
          : O.sdf(end.slice(0, 3), c.shape) >= 0
            ? h
            : null;
      if (crossed !== null) {
        const q = O.refineExit(s, crossed, c, mode).state;
        check(q);
        return {
          state: q,
          sign,
          monotone,
          drift,
          length: length + O.norm(O.add(q.slice(0, 3), O.mul(s.slice(0, 3), -1))),
        };
      }
      length += O.norm(O.add(end.slice(0, 3), O.mul(s.slice(0, 3), -1)));
      s = end;
    }
    throw Error('有限形状の表面探索が上限に達しました');
  }
  // A pair is attached to an already resolved incident eigenray. Curved-surface
  // roots have different world k_t and must NOT be combined as a common-k packet.
  function bulk(v, c, r) {
    const own = travel(state(v), v.mode, c);
    r.drift = Math.max(r.drift, own.drift);
    const fallback = (reason) => {
      r.phaseAdiabaticSegments++;
      r.phaseAdiabaticWeight += v.weight;
      r.phaseFallbackReasons ??= {};
      r.phaseFallbackReasons[reason] = (r.phaseFallbackReasons[reason] || 0) + 1;
      return [{ ...v, ...packet(own.state, v.mode, c), atSurface: true }];
    };
    if (!own.monotone) return fallback('z方向の折り返し・接線');
    let states, other;
    try {
      states = G.initialStates(v.o, v.p.slice(0, 2), c, own.sign);
      states[v.mode] = state(v);
      G.coefficients(v.o[2], v.p.slice(0, 2), c, own.sign);
    } catch (e) {
      if (pairCondition(e)) return fallback('対となる前方モードの条件外');
      throw e;
    }
    other = travel(states[1 - v.mode], 1 - v.mode, c);
    if (!other.monotone) return fallback('対となるモードのz折り返し');
    const exits = [];
    exits[v.mode] = own;
    exits[1 - v.mode] = other;
    const first = own.sign * (own.state[2] - other.state[2]) < 0 ? own : other,
      end = first.state[2];
    if (own.sign * (end - v.o[2]) <= 1e-7) return fallback('表面に接する短い共通区間');
    let sep, z, at, tr;
    try {
      sep = G.separation(states, end, c, own.sign);
      z = sep ?? end;
      at = G.advance(states, z, c);
      tr = G.transport([1, v.mode === 0 ? 1 : -1, 0, 0], v.o[2], z, v.p.slice(0, 2), c, own.sign);
    } catch (e) {
      if (pairCondition(e)) return fallback('共通区間内の前方モード条件外');
      throw e;
    }
    if (at.some((s) => O.sdf(s.slice(0, 3), c.shape) > 2e-6))
      throw Error('共通区間の光束が物体の外へ出ました');
    const weights = [(tr.S[0] + tr.S[1]) / 2, (tr.S[0] - tr.S[1]) / 2];
    r.coherentSegments++;
    r[tr.transfer.method === 'closed' ? 'phaseClosed' : 'phaseNumerical']++;
    r.phaseIntegrationError = Math.max(r.phaseIntegrationError, tr.transfer.error);
    r.coherencyError = Math.max(r.coherencyError, Math.abs(weights[0] + weights[1] - 1));
    if (sep !== null) {
      r.coherentSplits++;
      r.internalBranches++;
      r.maxInternalDepth = Math.max(r.maxInternalDepth, (v.internalDepth || 0) + 1);
      if ((v.internalDepth || 0) >= c.branchDepth) {
        r.coherentLimitWeight += v.weight;
        F.recordCutoff(r, v.weight, 'internal');
        return [];
      }
      return weights.map((w, m) => ({
        ...v,
        ...packet(at[m], m, c),
        weight: v.weight * Math.max(0, w),
        internalDepth: (v.internalDepth || 0) + 1,
      }));
    }
    r.phaseBoundaryProjections++;
    if (c.branchDebug) {
      r.events ??= [];
      r.events.push({
        kind: 'finite-boundary-projection',
        z,
        start: v.o,
        positions: at.map((s) => s.slice(0, 3)),
        surfacePositions: exits.map((a) => a.state.slice(0, 3)),
        weights,
        weight: v.weight,
      });
    }
    // Dephase once, at first surface contact. Follow the remaining independent
    // center to its own surface without coupling it to an exterior virtual mode.
    return weights.map((w, m) => {
      if (Math.abs(exits[m].state[2] - z) > 1e-6) r.phaseBoundaryTails++;
      return {
        ...v,
        ...packet(exits[m].state, m, c),
        weight: v.weight * Math.max(0, w),
        atSurface: true,
      };
    });
  }
  // The two incoherent external basis inputs share interior eigenray geometry.
  // Reuse that work within one pixel; weights and diagnostics remain per packet.
  function cachedBulk(v, c, r, memo) {
    if (c.branchDebug) return bulk(v, c, r);
    const key = JSON.stringify([v.mode, v.internalDepth, ...v.o, ...v.p]);
    let item = memo.get(key);
    if (!item) {
      const counters = stats(),
        children = bulk({ ...v, weight: 1 }, c, counters);
      item = { counters, children };
      memo.set(key, item);
    }
    const a = item.counters;
    for (const [key, value] of Object.entries(a.cutoffWeights || {}))
      r.cutoffWeights[key] += value * v.weight;
    for (const k of [
      'coherentSegments',
      'coherentSplits',
      'internalBranches',
      'phaseClosed',
      'phaseNumerical',
      'phaseBoundaryProjections',
      'phaseBoundaryTails',
      'phaseAdiabaticSegments',
    ])
      r[k] = (r[k] || 0) + a[k];
    for (const k of ['dropped', 'coherentLimitWeight', 'phaseAdiabaticWeight'])
      r[k] += a[k] * v.weight;
    for (const k of ['drift', 'maxInternalDepth', 'coherencyError', 'phaseIntegrationError'])
      r[k] = Math.max(r[k] || 0, a[k]);
    for (const [key, value] of Object.entries(a.phaseFallbackReasons || {})) {
      r.phaseFallbackReasons ??= {};
      r.phaseFallbackReasons[key] = (r.phaseFallbackReasons[key] || 0) + value;
    }
    return item.children.map((ch) => ({
      ...ch,
      depth: v.depth,
      tag: v.tag,
      reflected: v.reflected,
      weight: ch.weight * v.weight,
    }));
  }
  function trace(o, d, c) {
    F.validate(c);
    const r = stats(),
      ext = { ...c, material: 'isotropic', n: O.outsideIndex(c) },
      initial = F.basis(d).map((E) => ({
        o,
        p: O.mul(d, ext.n),
        E: F.cv(E),
        mode: 0,
        inside: false,
        weight: 0.5,
        depth: 0,
        internalDepth: 0,
        tag: 'direct',
        reflected: false,
      }));
    let linear = [0, 0, 0];
    const stack = new F.TraceQueue(c, r, initial),
      memo = new Map();
    while (stack.length) {
      const v = stack.pop();
      if (!v) break;
      r.maxDepth = Math.max(r.maxDepth, v.depth);
      if (v.inside && v.depth >= c.maxInterfaces) {
        F.recordCutoff(r, v.weight, 'interface');
        continue;
      }
      try {
        if (v.inside && !v.atSurface) {
          stack.push(...cachedBulk(v, c, r, memo));
          continue;
        }
        const dir = O.unit(v.p),
          x = v.inside ? v.o : O.hit(v.o, dir, c.shape);
        if (
          !v.inside &&
          (!x || O.backgroundDistance(v.o, dir, c) < O.norm(O.add(x, O.mul(v.o, -1))))
        ) {
          r.leaves++;
          r.weightSum += v.weight;
          r[v.reflected ? 'phaseEscapedReflected' : 'phaseEscapedDirect'] += v.weight;
          r.channels[v.tag] += v.weight;
          if (
            c.transportView === 'all' ||
            c.transportView === v.tag ||
            (c.transportView === 'reflected' && v.reflected)
          )
            linear = O.add(linear, O.mul(O.bg(v.o, dir, c).map(F.decode), v.weight));
          if (c.branchDebug) {
            r.rays ??= [];
            r.rays.push({ o: v.o, d: dir, weight: v.weight, reflected: v.reflected });
          }
          continue;
        }
        if (v.depth >= c.maxInterfaces) {
          F.recordCutoff(r, v.weight, 'interface');
          continue;
        }
        if (!v.inside && v.depth > 0) r.phaseReentries++;
        const local = F.localMaterial(c, x),
          N = O.mul(O.normal(x, c.shape), v.inside ? 1 : -1),
          s = F.scatter(v, v.inside ? local : ext, v.inside ? ext : local, N);
        r.interfaces++;
        r.phaseSurfaceDephasings++;
        r.branches += s.children.length - 1;
        r.geometryResidual = Math.max(r.geometryResidual, Math.abs(O.sdf(x, c.shape)));
        r.drift = Math.max(r.drift, s.dispersionDrift);
        r.fluxError = Math.max(r.fluxError, s.error);
        r.boundaryResidual = Math.max(r.boundaryResidual, s.residual);
        r.fieldResidual = Math.max(r.fieldResidual, s.fieldResidual);
        r.rootResidual = Math.max(r.rootResidual, s.rootResidual);
        for (const ch of s.children) {
          const inside = ch.reflection ? v.inside : !v.inside,
            weight = v.weight * ch.weight;
          if (ch.reflection) r.reflections++;
          if (weight < c.minContribution) {
            F.recordCutoff(r, weight, 'threshold');
            continue;
          }
          try {
            const next = inside
              ? F.launch(x, ch, c, r)
              : { ...ch, o: O.add(x, O.mul(O.unit(ch.p), 2e-6)) };
            stack.push({
              ...next,
              inside,
              atSurface: false,
              weight,
              depth: v.depth + 1,
              internalDepth: v.internalDepth || 0,
              tag:
                v.depth === 0 ? (ch.reflection ? 'reflected' : ch.mode === 0 ? 'o' : 'e') : v.tag,
              reflected: v.reflected || ch.reflection,
            });
          } catch (e) {
            r.status = 'error';
            r.message = e.message;
            r.failedWeight += weight;
          }
        }
      } catch (e) {
        r.status = 'error';
        r.message = e.message;
        r.failedWeight += v.weight;
      }
    }
    r.accounted = r.weightSum + r.dropped + r.failedWeight;
    r.color = linear.map(F.encode);
    return F.finishTraceBudget(c, r);
  }
  F.coherentFinite = { shapes, selected, validate, travel, bulk, trace };
  const old = F.trace;
  F.trace = (o, d, c) => (selected(c) ? trace(o, d, c) : old(o, d, c));
})(globalThis.Optics, globalThis.Optics.polarization);
