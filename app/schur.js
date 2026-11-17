/* Four-point Gauss--Legendre evaluation of the manuscript's Schur integral. */
(function (O) {
  O.schurAdvance = function (s, dz, c, mode) {
    if (globalThis.LiteratureMedia?.supported(c.material)) return null;
    if (
      [
        'radial',
        'sphericalSquared',
        'radialSquared',
        'molded2013',
        'moldedApprox',
        'molded2013Transform',
        'biaxial',
      ].includes(c.material)
    )
      return null;
    let v = O.velocity(s.slice(0, 3), s.slice(3), c, mode),
      sgn = Math.sign(v[2]),
      k = s.slice(3, 5);
    if (Math.abs(v[2]) < 1e-6) return null;
    function at(z) {
      let G = O.metric([s[0], s[1], z], c, mode),
        a = G[0][0],
        b = G[0][1],
        d = G[1][1],
        det = a * d - b * b;
      if (Math.abs(det) < 1e-10) return null;
      let M = [
          [d / det, -b / det],
          [-b / det, a / det],
        ],
        B = [G[0][2], G[1][2]],
        mk = O.mv(M, k),
        mb = O.mv(M, B),
        h = G[2][2] - O.dot(B, mb),
        D = 1 - O.dot(k, mk);
      if (!(h / D > 0) || Math.abs(D) < 1e-8 || Math.abs(h) < 1e-10) return null;
      return {
        u: O.add(O.mul(mk, sgn * Math.sqrt(h / D)), O.mul(mb, -1)),
        pz: O.dot(B, mk) + sgn * h * Math.sqrt(D / h),
      };
    }
    let end = at(s[2] + dz);
    if (!end || !at(s[2])) return null;
    let nodes = [-0.8611363115940526, -0.3399810435848563, 0.3399810435848563, 0.8611363115940526],
      weights = [0.3478548451374538, 0.6521451548625461, 0.6521451548625461, 0.3478548451374538],
      q = [0, 0];
    for (let i = 0; i < 4; i++) {
      let a = at(s[2] + (dz * (1 + nodes[i])) / 2);
      if (!a) return null;
      q = O.add(q, O.mul(a.u, (dz * weights[i]) / 2));
    }
    return [s[0] + q[0], s[1] + q[1], s[2] + dz, ...k, end.pz];
  };
  let previous = O.advance;
  O.advance = function (s, h, c, mode) {
    if (c.solver === 'schur') {
      let v = O.velocity(s.slice(0, 3), s.slice(3), c, mode),
        a = O.schurAdvance(s, h * v[2], c, mode);
      O.recordStep(a ? 'quadrature' : 'ode');
      return a || O.rkf45(s, h, c, mode);
    }
    return previous(s, h, c, mode);
  };
})(globalThis.Optics);
