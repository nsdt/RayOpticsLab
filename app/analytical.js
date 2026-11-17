/* Closed trajectories evaluated between two z planes; no paraxial approximation. */
(function (O) {
  function blocks(G) {
    let a = G[0][0],
      b = G[0][1],
      d = G[1][1],
      det = a * d - b * b,
      M = [
        [d / det, -b / det],
        [-b / det, a / det],
      ],
      B = [G[0][2], G[1][2]],
      MB = O.mv(M, B);
    return { M, B, MB, h: G[2][2] - O.dot(B, MB) };
  }
  function exactAdvance(s, dz, c, mode) {
    let z0 = s[2],
      z = z0 + dz,
      k = s.slice(3, 5),
      m = c.material,
      G = O.metric(s.slice(0, 3), c, mode),
      b = blocks(G),
      v = O.velocity(s.slice(0, 3), s.slice(3), c, mode),
      sign = Math.sign(v[2]);
    if (Math.abs(v[2]) < 1e-6) return null;
    let q;
    if (m === 'axial2013' || (m === 'axial2013Uniaxial' && mode === 1)) {
      let A = z - z0 - c.gradient * (Math.cos(z) - Math.cos(z0)),
        D = 1 - O.dot(k, k);
      if (D <= 0 || 1 + c.gradient * Math.sin(z) <= 0) return null;
      q = O.mul(k, (sign * A) / Math.sqrt(D));
    } else if (
      (m === 'eng2013' || (m === 'eng2013Magnetic' && mode === 1)) &&
      Math.abs(k[0] * k[0] - k[1] * k[1]) < 1e-12
    ) {
      let g = c.engStrength ?? 1;
      if (g < 0) return null;
      let A =
        0.5 *
        sign *
        (g < 1e-14
          ? z - z0
          : (Math.asinh(Math.sqrt(g) * z) - Math.asinh(Math.sqrt(g) * z0)) / Math.sqrt(g));
      q = [k[0] * A, -k[1] * A];
    } else if (m === 'shear') {
      let D = 1 - O.dot(k, k);
      if (D <= 0) return null;
      let f = (z) => {
          let t = (z + 1) / 2;
          return -c.shift * (3 * t * t - 2 * t * t * t);
        },
        df = f(z) - f(z0);
      q = O.add(O.mul(k, (sign * dz) / Math.sqrt(D)), [-df, -0.45 * df]);
    } else if (m === 'common' || m === 'quadratic' || m === 'hyperbolic') {
      let eta = (t) =>
        m === 'common'
          ? 1 / (1 + c.gradient * t) ** 2
          : m === 'quadratic'
            ? 1 + c.gradient * t * t
            : 1 + c.gradient * t;
      let e0 = eta(z0),
        M = b.M.map((r) => r.map((v) => v * e0)),
        h = b.h / e0,
        Pi = O.dot(k, O.mv(M, k)),
        I,
        g = c.gradient;
      if (m === 'hyperbolic') {
        if (!(eta(z) > 0 && Pi > eta(z) && Pi > e0 && h < 0)) return null;
        I = (2 * dz) / (Math.sqrt(Pi - e0) + Math.sqrt(Pi - eta(z)));
        I *= Math.sqrt(-h);
      } else {
        if (!(eta(z) > Pi && e0 > Pi && h > 0)) return null;
        if (m === 'common') {
          let a = 1 + g * z0,
            bb = 1 + g * z;
          if (a <= 0 || bb <= 0) return null;
          I = (dz * (a + bb)) / (Math.sqrt(1 - Pi * a * a) + Math.sqrt(1 - Pi * bb * bb));
        } else {
          if (g < 0 || 1 <= Pi) return null;
          I =
            g < 1e-12
              ? dz / Math.sqrt(1 - Pi)
              : (Math.asinh((Math.sqrt(g) * z) / Math.sqrt(1 - Pi)) -
                  Math.asinh((Math.sqrt(g) * z0) / Math.sqrt(1 - Pi))) /
                Math.sqrt(g);
        }
        I *= Math.sqrt(h);
      }
      q = O.add(O.mul(O.mv(M, k), sign * I), O.mul(b.MB, -dz));
    } else if (m === 'heliconical' && O.norm(k) < 1e-10) {
      let t = (c.tilt * Math.PI) / 180,
        delta = c.no * c.no - c.ne * c.ne,
        w = (delta * Math.sin(t) * Math.cos(t)) / (c.ne * c.ne + delta * Math.sin(t) ** 2),
        om = c.twist,
        ph = (c.azimuth * Math.PI) / 180;
      if (mode === 0) q = [0, 0];
      else if (Math.abs(om) < 1e-10) q = [-w * Math.cos(ph) * dz, -w * Math.sin(ph) * dz];
      else
        q = [
          (w / om) * (Math.sin(om * z0 + ph) - Math.sin(om * z + ph)),
          (w / om) * (Math.cos(om * z + ph) - Math.cos(om * z0 + ph)),
        ];
    } else return null;
    let x = [s[0] + q[0], s[1] + q[1], z],
      end = blocks(O.metric(x, c, mode)),
      D = 1 - O.dot(k, O.mv(end.M, k));
    if (!(end.h / D > 0)) return null;
    let pz = O.dot(end.B, O.mv(end.M, k)) + sign * end.h * Math.sqrt(D / end.h);
    return [...x, ...k, pz];
  }
  O.exactAdvance = exactAdvance;
  const original = O.rkf45;
  O.advance = function (s, h, c, mode) {
    if (globalThis.LiteratureMedia?.supported(c.material)) {
      const a = c.solver !== 'rkf45' ? globalThis.LiteratureMedia.advance(s, h, c, mode) : null;
      O.recordStep(a ? 'closed' : 'ode');
      return a || O.rkf45(s, h, c, mode);
    }
    if (c.solver !== 'rkf45') {
      let v = O.velocity(s.slice(0, 3), s.slice(3), c, mode),
        r = exactAdvance(s, h * v[2], c, mode);
      if (r) {
        O.recordStep('closed');
        return r;
      }
      if (c.solver === 'auto' && !c.paperRKF45Fallback && O.schurAdvance) {
        let q = O.schurAdvance(s, h * v[2], c, mode);
        if (q) {
          O.recordStep('quadrature');
          return q;
        }
      }
    }
    O.recordStep('ode');
    return original(s, h, c, mode);
  };
})(globalThis.Optics);
