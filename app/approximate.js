/* 2013 molded-lens small-slope equations (25)-(28); not exact Maxwell transport. */
(function (O) {
  function approximate(s, dz, c, mode) {
    let x = s.slice(0, 3),
      p = s.slice(3),
      v = O.velocity(x, p, c, mode),
      u = [v[0] / v[2], v[1] / v[2]],
      g = c.gradient,
      n = c.n,
      z = x[2] + dz;
    if (Math.abs(v[2]) < 1e-7 || Math.max(...u.map(Math.abs)) > 0.25)
      throw Error('small-slope guard exceeded');
    let A = dz * (1 + 0.1 * (z + x[2])),
      b0 = 1 + 0.2 * x[2],
      b1 = 1 + 0.2 * z;
    if (b0 <= 0 || b1 <= 0) throw Error('axial factor nonpositive');
    let xx = [],
      uu = [];
    for (let i = 0; i < 2; i++) {
      let gi = n * n - g * x[i] * x[i];
      if (gi <= 0) throw Error('transverse metric nonpositive');
      let C = u[i] / Math.sqrt(gi) / b0,
        y;
      if (Math.abs(g) < 1e-10) y = x[i] + n * C * A;
      else if (g > 0) {
        let r = Math.sqrt(g),
          ang = Math.asin((r * x[i]) / n) + r * C * A;
        if (Math.abs(ang) >= Math.PI / 2) throw Error('approximate branch end');
        y = (n / r) * Math.sin(ang);
      } else {
        let r = Math.sqrt(-g);
        y = (n / r) * Math.sinh(Math.asinh((r * x[i]) / n) + r * C * A);
      }
      xx.push(y);
      uu.push(C * b1 * Math.sqrt(n * n - g * y * y));
    }
    if (Math.max(...uu.map(Math.abs)) > 0.25) throw Error('small-slope guard exceeded');
    let end = [...xx, z],
      t = [...uu, 1],
      G = O.metric(end, c, mode),
      pp = O.mul(O.mv(G, t), Math.sign(v[2]) / Math.sqrt(O.dot(t, O.mv(G, t))));
    return [...end, ...pp];
  }
  O.approximate = approximate;
  let previous = O.advance;
  O.advance = function (s, h, c, mode) {
    if (c.material === 'moldedApprox') {
      O.recordStep('approximate');
      return approximate(s, h * O.velocity(s.slice(0, 3), s.slice(3), c, mode)[2], c, mode);
    }
    return previous(s, h, c, mode);
  };
})(globalThis.Optics);
