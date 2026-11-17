/* Incoherent, piecewise homogeneous z layers. This changes the material model:
 * each cell uses the continuous profile at its z midpoint; rays are straight in
 * that cell. Tangential E/H continuity determines all reflected/transmitted modes.
 * Flux-normalized Jones scattering -> Mueller -> modal Stokes intensities.
 * Distinct eigenmode paths are dephased after each interface. No wavelength,
 * interference, absorption, tunnelling between interfaces, or continuous coupling.
 * Refining layers alone is NOT convergence to coherent Maxwell propagation.
 */
(function (O, F, P) {
  'use strict';
  const C = P.C,
    cv = F.cv,
    scale = (v, a) => v.map((z) => C.scale(z, a)),
    dot = (a, b) => a.reduce((s, z, i) => C.add(s, C.mul(z, b[i])), [0, 0]);
  const zero = () => [
    [
      [0, 0],
      [0, 0],
    ],
    [
      [0, 0],
      [0, 0],
    ],
  ];
  // S = [I,Q,U,V], rho01=(U-iV)/2, in the flux-normalized o/e modal basis.
  function coherency(S) {
    return [
      [
        [0.5 * (S[0] + S[1]), 0],
        [0.5 * S[2], -0.5 * S[3]],
      ],
      [
        [0.5 * S[2], 0.5 * S[3]],
        [0.5 * (S[0] - S[1]), 0],
      ],
    ];
  }
  function stokes(rho) {
    return [
      rho[0][0][0] + rho[1][1][0],
      rho[0][0][0] - rho[1][1][0],
      2 * rho[0][1][0],
      -2 * rho[0][1][1],
    ];
  }
  function jonesMueller(J) {
    const M = Array.from({ length: 4 }, () => Array(4).fill(0));
    for (let col = 0; col < 4; col++) {
      const S = [0, 0, 0, 0];
      S[col] = 1;
      const rho = coherency(S),
        out = zero();
      for (let i = 0; i < 2; i++)
        for (let j = 0; j < 2; j++)
          for (let k = 0; k < 2; k++)
            for (let l = 0; l < 2; l++)
              out[i][j] = C.add(out[i][j], C.mul(C.mul(J[i][k], rho[k][l]), C.conj(J[j][l])));
      stokes(out).forEach((v, i) => (M[i][col] = v));
    }
    return M;
  }
  const applyMueller = (M, S) => M.map((row) => row.reduce((s, v, j) => s + v * S[j], 0));
  function interfaceMatrices(from, to, t, N) {
    const I = F.modes(from, t, N, 1),
      T = F.modes(to, t, N, 1),
      R = F.modes(from, t, N, -1),
      [t1, t2] = F.basis(N);
    const g = (f) => [dot(cv(t1), f.E), dot(cv(t2), f.E), dot(cv(t1), f.H), dot(cv(t2), f.H)];
    // Evanescent modes remain in the boundary system; they carry no ray power.
    const out = [...T, ...R],
      columns = out.map((f, i) => scale(g(f), i < 2 ? 1 : -1)),
      A = [0, 1, 2, 3].map((i) => columns.map((v) => v[i]));
    const JT = zero(),
      JR = zero();
    let residual = 0;
    for (let col = 0; col < 2; col++) {
      if (!I[col].prop) continue;
      const b = scale(g(I[col]), 1 / Math.sqrt(Math.abs(I[col].F))),
        a = F.solve(A, b);
      for (let row = 0; row < 4; row++)
        if (out[row].prop)
          (row < 2 ? JT : JR)[row % 2][col] = C.scale(a[row], Math.sqrt(Math.abs(out[row].F)));
      residual = Math.max(
        residual,
        ...A.map((row, i) => C.abs(C.sub(dot(row, a), b[i])) / Math.max(...b.map(C.abs))),
      );
    }
    return { I, T, R, JT, JR, MT: jonesMueller(JT), MR: jonesMueller(JR), residual };
  }
  function scatter(packet, from, to, N, prepared) {
    const t = O.add(packet.p, O.mul(N, -O.dot(packet.p, N))),
      m = prepared || interfaceMatrices(from, to, t, N),
      input = m.I.findIndex((f) => f.mode === packet.mode && f.prop);
    if (input < 0 || O.norm(O.add(m.I[input].p, O.mul(packet.p, -1))) > 1e-6)
      throw Error('層の入射固有モードと波数が一致しません');
    const S = [1, input === 0 ? 1 : -1, 0, 0],
      children = [];
    for (const [group, M, reflection] of [
      [m.T, m.MT, false],
      [m.R, m.MR, true],
    ]) {
      const out = applyMueller(M, S);
      for (let i = 0; i < 2; i++) {
        const weight = (out[0] + (i === 0 ? 1 : -1) * out[1]) / 2;
        if (weight < -1e-10) throw Error('Mueller変換後の強度が負になりました');
        if (!group[i].prop || weight <= 1e-25) continue;
        children.push({
          p: group[i].p,
          E: group[i].E,
          mode: group[i].mode,
          weight,
          reflection,
          stokes: [weight, (i === 0 ? 1 : -1) * weight, 0, 0],
        });
      }
    }
    const error = Math.abs(children.reduce((s, ch) => s + ch.weight, 0) - 1);
    if (!Number.isFinite(error) || error > 2e-7)
      throw Error('層界面のエネルギー収支が不正です: ' + error);
    return {
      children,
      error,
      residual: m.residual,
      dispersionDrift: Math.max(...[...m.I, ...m.T, ...m.R].map((f) => f.dispersionDrift || 0)),
    };
  }
  const enabled = (c) =>
    c.transport === 'polarized' &&
    c.branchModel === 'layers' &&
    c.branchPolicy !== 'off' &&
    O.branching.supported(c);
  let cachedKey, cachedMesh;
  function settings(c) {
    const key = JSON.stringify(c);
    if (key === cachedKey) return cachedMesh;
    const cfg = O.branching.settings({ ...c, branchDepth: Math.max(1, c.branchDepth) }),
      zmax = c.shape === 'torus' ? 1.01 : 1;
    const planes = cfg.planes.filter((z) => z > -zmax + 1e-8 && z < zmax - 1e-8),
      edges = [-zmax, ...planes, zmax];
    if (!planes.length) throw Error('物体の内部に層境界を1面以上置いてください');
    for (let i = 1; i < edges.length; i++)
      if (edges[i] - edges[i - 1] < 1e-5) throw Error('層の厚さを0.00001以上にしてください');
    const mesh = {
      planes,
      edges,
      cells: edges.slice(1).map((z, i) => F.localMaterial(c, [0, 0, (z + edges[i]) / 2])),
      matrices: new Map(),
    };
    cachedKey = key;
    cachedMesh = mesh;
    return mesh;
  }
  function cellAt(z, dz, mesh) {
    return mesh.planes.filter((p) => p < z || (Math.abs(p - z) < 1e-10 && dz > 0)).length;
  }
  function nextEvent(v, c, mesh) {
    const local = mesh.cells[v.cell],
      d = F.rayDirection(v, local),
      x = F.interiorHit(v.o, d, c.shape);
    if (!x) throw Error('層内から外表面を検出できません');
    const distance = O.norm(O.add(x, O.mul(v.o, -1))),
      sign = Math.sign(d[2]),
      index = sign > 0 ? v.cell : v.cell - 1;
    if (Math.abs(d[2]) > 1e-12 && index >= 0 && index < mesh.planes.length) {
      const t = (mesh.planes[index] - v.o[2]) / d[2];
      if (t >= -1e-9 && t < distance - 1e-8) {
        const at = O.add(v.o, O.mul(d, Math.max(0, t)));
        at[2] = mesh.planes[index];
        if (O.sdf(at, c.shape) < -1e-8)
          return { x: at, plane: index, to: v.cell + sign, N: [0, 0, sign] };
      }
    }
    return { x };
  }
  const originalTrace = F.trace,
    originalValidate = F.validate;
  function validate(c) {
    originalValidate(c);
    if (enabled(c)) settings(c);
  }
  function trace(o, d, c) {
    validate(c);
    const mesh = settings(c),
      ext = { ...c, material: 'isotropic', n: O.outsideIndex(c) };
    const initial = F.basis(d).map((E) => ({
      o,
      p: O.mul(d, ext.n),
      E: cv(E),
      mode: 0,
      inside: false,
      weight: 0.5,
      depth: 0,
      internalDepth: 0,
      tag: 'direct',
      reflected: false,
    }));
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
      layerLimitWeight: 0,
      workLimitWeight: 0,
      failedWeight: 0,
      fluxError: 0,
      boundaryResidual: 0,
      fieldResidual: 0,
      rootResidual: 0,
      interfaces: 0,
      reflections: 0,
      bulkSegments: 0,
      bulkSteps: 0,
      layerSegments: 0,
      channels: { o: 0, e: 0, mode1: 0, mode2: 0, reflected: 0, direct: 0 },
    };
    let linear = [0, 0, 0];
    const stack = new F.TraceQueue(c, r, initial);
    while (stack.length) {
      const v = stack.pop();
      if (!v) break;
      r.maxDepth = Math.max(r.maxDepth, v.depth);
      try {
        const dir = O.unit(v.p),
          event = v.inside ? nextEvent(v, c, mesh) : { x: O.hit(v.o, dir, c.shape) },
          x = event.x;
        if (v.inside) {
          r.layerSegments++;
          if (O.evaluations) O.evaluations.layered = (O.evaluations.layered || 0) + 1;
        }
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
          )
            linear = O.add(linear, O.mul(O.bg(v.o, dir, c).map(F.decode), v.weight));
          continue;
        }
        const internal = event.plane !== undefined;
        if (internal ? v.internalDepth >= c.branchDepth : v.depth >= c.maxInterfaces) {
          F.recordCutoff(r, v.weight, internal ? 'internal' : 'interface');
          if (internal) r.layerLimitWeight += v.weight;
          continue;
        }
        const cell = v.inside ? v.cell : cellAt(x[2], dir[2], mesh),
          local = mesh.cells[cell];
        const N = internal ? event.N : O.mul(O.normal(x, c.shape), v.inside ? 1 : -1);
        let prepared;
        if (internal) {
          const t = O.add(v.p, O.mul(N, -O.dot(v.p, N))),
            key = JSON.stringify([cell, event.to, ...t]);
          prepared = mesh.matrices.get(key);
          if (!prepared) {
            prepared = interfaceMatrices(local, mesh.cells[event.to], t, N);
            if (mesh.matrices.size >= 1024) mesh.matrices.clear();
            mesh.matrices.set(key, prepared);
          }
        }
        const s = internal
          ? scatter(v, local, mesh.cells[event.to], N, prepared)
          : F.scatter(v, v.inside ? local : ext, v.inside ? ext : local, N);
        r.drift = Math.max(r.drift, s.dispersionDrift || 0);
        r.fluxError = Math.max(r.fluxError, s.error);
        r.boundaryResidual = Math.max(r.boundaryResidual, s.residual);
        r.branches += s.children.length - 1;
        if (internal) {
          r.internalBranches++;
          r.maxInternalDepth = Math.max(r.maxInternalDepth, v.internalDepth + 1);
          if (c.branchDebug) {
            r.events ??= [];
            r.events.push({
              position: x.slice(),
              plane: event.plane,
              depth: v.internalDepth + 1,
              parentWeight: v.weight,
              fromCell: cell,
              toCell: event.to,
              parentMode: v.mode,
              children: s.children.map((ch) => ({
                mode: ch.mode,
                reflection: ch.reflection,
                weight: ch.weight,
                stokes: ch.stokes,
              })),
              fluxError: s.error,
            });
          }
        } else r.interfaces++;
        for (const ch of s.children) {
          const weight = v.weight * ch.weight;
          if (ch.reflection) r.reflections++;
          if (weight < c.minContribution) {
            F.recordCutoff(r, weight, 'threshold');
            continue;
          }
          const inside = internal ? true : ch.reflection ? v.inside : !v.inside,
            newCell = internal ? (ch.reflection ? cell : event.to) : cell;
          const tag =
            v.depth === 0 && !internal
              ? ch.reflection
                ? 'reflected'
                : ch.mode === 0
                  ? 'o'
                  : 'e'
              : v.tag;
          stack.push({
            ...ch,
            o: inside ? x.slice() : O.add(x, O.mul(O.unit(ch.p), 2e-6)),
            inside,
            cell: newCell,
            weight,
            depth: v.depth + (internal ? 0 : 1),
            internalDepth: v.internalDepth + (internal ? 1 : 0),
            tag,
            reflected: v.reflected || ch.reflection,
          });
        }
      } catch (e) {
        r.status = 'error';
        r.failedWeight += v.weight;
        r.message = e.message;
      }
    }
    r.accounted = r.weightSum + r.dropped + r.failedWeight + r.unavailableWeight;
    r.color = linear.map(F.encode);
    return F.finishTraceBudget(c, r);
  }
  F.layered = {
    enabled,
    settings,
    cellAt,
    nextEvent,
    jonesMueller,
    applyMueller,
    coherency,
    stokes,
    interfaceMatrices,
    scatter,
    trace,
  };
  F.validate = validate;
  F.trace = (o, d, c) => (enabled(c) ? trace(o, d, c) : originalTrace(o, d, c));
})(globalThis.Optics, globalThis.Optics.polarization, globalThis.Polynomial);
