/* Finite-segment forward-mode mixing on the ORIGINAL continuous ray medium.
 * Geometry always uses O.advance: exact formulas / Schur quadrature / RKF45.
 * Modal fields are orthonormal in the signed normal Poynting-flux form.
 * Project d(Phi c)/dz onto the two forward modes and omit dynamic relative phase:
 * dc/dz = -A c, A_ij=<Phi_i,dPhi_j/dz>_flux. For real lossless modes A is
 * real antisymmetric. Integrate its scalar rotation, then convert J to Mueller.
 * Mode powers are dephased and launched at prescribed nodes. This is a finite-
 * segment, phase-omitted hypothesis, NOT general continuous Maxwell transport.
 * It ignores backward coupling and modal spatial separation within a segment.
 */
(function (O, F) {
  'use strict';
  const enabled = (c) =>
    c.transport === 'polarized' &&
    c.branchModel === 'modal' &&
    c.branchPolicy !== 'off' &&
    c.branchDepth > 0 &&
    O.branching.supported(c);
  function inner(f, g, sign) {
    return sign * 0.25 * (O.cross(f.E, g.H)[2] + O.cross(g.E, f.H)[2]);
  }
  function frame(z, k, c, sign) {
    const local = F.localMaterial(c, [0, 0, z]),
      out = F.modes(local, [...k, 0], [0, 0, sign], 1);
    if (out.some((f) => !f.prop || !(f.F > 1e-9)))
      throw Error('前方2モードの分配近似には、両モードの非接線伝播が必要です');
    const modes = out.map((f) => ({
      p: f.p,
      E: f.E.map((v) => v[0] / Math.sqrt(f.F)),
      H: f.H.map((v) => v[0] / Math.sqrt(f.F)),
    }));
    if (c.material !== 'axial2013Uniaxial') {
      const th = (local.tilt * Math.PI) / 180,
        ph = (local.azimuth * Math.PI) / 180,
        a = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
      if (modes.some((f) => O.norm(O.cross(a, O.unit(f.p))) < 1e-5))
        throw Error('固有モードが光軸付近で縮退しています');
    }
    if (
      Math.abs(inner(modes[0], modes[1], sign)) > 1e-6 ||
      modes.some((f) => Math.abs(inner(f, f, sign) - 1) > 1e-6)
    )
      throw Error('固有モードの流束規格化が不正です');
    return modes;
  }
  function connection(z, k, c, sign) {
    const h = 2e-5 / Math.max(1, Math.abs(c.twist)),
      center = frame(z, k, c, sign),
      left = frame(z - h, k, c, sign),
      right = frame(z + h, k, c, sign);
    // Align only the arbitrary +/- eigenvector signs. Do not rotate modes into
    // each other or use a Euclidean electric-field dot product as a power weight.
    for (let i = 0; i < 2; i++)
      for (const side of [left, right])
        if (inner(center[i], side[i], sign) < 0) {
          side[i].E = O.mul(side[i].E, -1);
          side[i].H = O.mul(side[i].H, -1);
        }
    const deriv = left.map((f, i) => ({
      E: O.mul(O.add(right[i].E, O.mul(f.E, -1)), 1 / (2 * h)),
      H: O.mul(O.add(right[i].H, O.mul(f.H, -1)), 1 / (2 * h)),
    }));
    return 0.5 * (inner(center[1], deriv[0], sign) - inner(center[0], deriv[1], sign));
  }
  function integrate(f, a, b, tol = 2e-6) {
    if (a === b) return { value: 0, error: 0, evaluations: 0 };
    let evaluations = 0;
    const at = (z) => {
      if (++evaluations > 4096)
        throw Error('分配係数の求積が収束しません。評価区間を短くしてください');
      return f(z);
    };
    function rec(a, b, fa, fm, fb, whole, eps, depth) {
      const m = (a + b) / 2,
        fl = at((a + m) / 2),
        fr = at((m + b) / 2),
        l = ((m - a) * (fa + 4 * fl + fm)) / 6,
        r = ((b - m) * (fm + 4 * fr + fb)) / 6,
        err = Math.abs(l + r - whole) / 15;
      if (err <= eps) return { value: l + r + (l + r - whole) / 15, error: err };
      if (depth <= 0) throw Error('分配係数の求積が収束しません。評価区間を短くしてください');
      const x = rec(a, m, fa, fl, fm, l, eps / 2, depth - 1),
        y = rec(m, b, fm, fr, fb, r, eps / 2, depth - 1);
      return { value: x.value + y.value, error: x.error + y.error };
    }
    // Predivide by director rotation: a whole turn must not alias to constant samples.
    const parts = Math.max(1, Math.ceil((Math.abs(b - a) * Math.abs(f.rotationRate || 0)) / 0.3));
    let value = 0,
      error = 0;
    for (let i = 0; i < parts; i++) {
      const x = a + ((b - a) * i) / parts,
        y = a + ((b - a) * (i + 1)) / parts,
        m = (x + y) / 2,
        fx = at(x),
        fy = at(y),
        fm = at(m),
        q = rec(x, y, fx, fm, fy, ((y - x) * (fx + 4 * fm + fy)) / 6, tol / parts, 10);
      value += q.value;
      error += q.error;
    }
    return { value, error, evaluations };
  }
  let cacheKey = '',
    cache = new Map();
  function transfer(z0, z1, k, c, sign) {
    const materialKey = JSON.stringify([
      c.material,
      c.no,
      c.ne,
      c.gradient,
      c.tilt,
      c.azimuth,
      c.twist,
    ]);
    if (materialKey !== cacheKey) {
      cacheKey = materialKey;
      cache.clear();
    }
    const key = JSON.stringify([z0, z1, ...k, sign]);
    if (cache.has(key)) return cache.get(key);
    let angle = 0,
      error = 0,
      evaluations = 0,
      method = 'closed';
    // Fixed axial director: TE/TM cannot couple, including the b(z)=1 crossing.
    if (c.material === 'axial2013Uniaxial') angle = 0;
    else if (Math.hypot(...k) < 1e-10) {
      if (c.material === 'heliconical') {
        const t = (c.tilt * Math.PI) / 180,
          neff =
            (c.no * c.ne) /
            Math.sqrt(c.no * c.no * Math.sin(t) ** 2 + c.ne * c.ne * Math.cos(t) ** 2);
        angle =
          sign * 0.5 * (Math.sqrt(c.no / neff) + Math.sqrt(neff / c.no)) * c.twist * (z1 - z0);
      } // Fixed-axis common scales have no modal rotation at k_perp=0.
    } else {
      const fn = (z) => connection(z, k, c, sign);
      fn.rotationRate = c.material === 'heliconical' ? c.twist : 0;
      const q = integrate(fn, z0, z1);
      angle = q.value;
      error = q.error;
      evaluations = q.evaluations;
      method = 'quadrature';
    }
    const co = Math.cos(angle),
      si = Math.sin(angle),
      J = [
        [
          [co, 0],
          [si, 0],
        ],
        [
          [-si, 0],
          [co, 0],
        ],
      ],
      M = F.layered.jonesMueller(J),
      r = { angle, error, evaluations, method, M };
    if (cache.size >= 1024) cache.clear();
    cache.set(key, r);
    return r;
  }
  function split(packet, c) {
    const start = packet.segmentStart;
    if (!start) throw Error('分配区間の始点がありません');
    const sign = Math.sign(O.velocity(packet.o, packet.p, c, packet.mode)[2]),
      initialSign = Math.sign(O.velocity(start.slice(0, 3), start.slice(3), c, packet.mode)[2]);
    if (!sign || sign !== initialSign || sign * (packet.o[2] - start[2]) < -1e-8)
      throw Error('zの折り返しを含む区間のモード分配は未対応です');
    if (Math.hypot(packet.p[0] - start[3], packet.p[1] - start[4]) > 2e-6)
      throw Error('区間で接線波数が保存されていません');
    const tr = transfer(start[2], packet.o[2], packet.p.slice(0, 2), c, sign),
      S = F.layered.applyMueller(tr.M, [1, packet.mode === 0 ? 1 : -1, 0, 0]),
      children = [];
    for (let mode = 0; mode < 2; mode++) {
      const weight = (S[0] + (mode === 0 ? S[1] : -S[1])) / 2;
      if (weight < -1e-10) throw Error('モード分配の強度が負です');
      if (weight <= 1e-20) continue;
      const p =
        mode === packet.mode
          ? packet.p.slice()
          : O.boundary(packet.o, packet.p, [0, 0, 1], c, mode, sign < 0);
      if (!p) throw Error('分配先のモードがこの位置で伝播できません');
      children.push({
        p,
        E: F.fields(F.cv(p), F.localMaterial(c, packet.o), mode).E,
        mode,
        weight,
        stokes: [weight, mode === 0 ? weight : -weight, 0, 0],
      });
    }
    const weightError = Math.abs(children.reduce((s, ch) => s + ch.weight, 0) - 1);
    if (weightError > 1e-10) throw Error('モード分配の重みが保存されません');
    children.transfer = { ...tr, weightError, startZ: start[2], endZ: packet.o[2] };
    return children;
  }
  F.modal = { enabled, inner, frame, connection, integrate, transfer, split };
})(globalThis.Optics, globalThis.Optics.polarization);
