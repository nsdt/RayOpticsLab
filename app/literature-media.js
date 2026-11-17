/* Additional analytical media. Physical realizations and validity domains are explicit.
 * Gibbons--Warnick (2011), Eqs. (15),(16): radial uniaxial metric (scaled/translated).
 * Zhang--Zhao--Ge (2011), radial maps: smooth portions of spherical/cylindrical shells.
 * Cutting these media with an arbitrary body does NOT reproduce an invisible cloak. */
(function (root) {
  'use strict';
  const names = ['radialAnisotropic', 'sphericalTransform', 'cylindricalTransform'],
    transforms = names.slice(1);
  const O = () => root.Optics,
    identity = () => [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    transpose = (A) => A[0].map((_, i) => A.map((r) => r[i]));
  const center = (c) =>
    c.material === 'radialAnisotropic'
      ? c.radialCenter || [2, 1, -3]
      : c.transformCenter || [0.7, 0, -3];
  const parameters = (c) => {
    const radius = c.radialRadius ?? 7,
      inner = c.transformInner ?? 0.7,
      outer = c.transformOuter ?? 5;
    if (
      !(
        Number.isFinite(radius) &&
        radius > 0 &&
        Number.isFinite(inner) &&
        inner >= 0 &&
        Number.isFinite(outer) &&
        outer > inner
      )
    )
      throw Error('Invalid radial-medium parameters');
    if (!Array.isArray(center(c)) || center(c).length !== 3 || !center(c).every(Number.isFinite))
      throw Error('Invalid radial-medium centre');
    return { radius, inner, outer, scale: outer / (outer - inner) };
  };
  const relative = (x, c) => O().add(x.slice(0, 3), O().mul(center(c), -1));
  function radial(x, c) {
    const { radius } = parameters(c),
      r = relative(x, c),
      u = O().dot(r, r) / radius ** 2;
    if (!(u < 1)) throw Error('Radial anisotropy outside r<R');
    return { r, u, no: 1 / (1 - u), ne: 1 / Math.sqrt(1 - u), axis: O().unit(r) };
  }
  function transform(x, c) {
    const { inner, scale } = parameters(c),
      r = relative(x, c),
      axes = c.material === 'sphericalTransform' ? [0, 1, 2] : [0, 2],
      rho = Math.hypot(...axes.map((i) => r[i]));
    if (!(rho > inner)) throw Error('Radial transformation at singular inner radius');
    const alpha = scale * (1 - inner / rho),
      J = identity(),
      X = r.slice();
    for (const i of axes) {
      X[i] = alpha * r[i];
      for (const j of axes)
        J[i][j] = alpha * (i === j ? 1 : 0) + (scale * inner * r[i] * r[j]) / rho ** 3;
    }
    return { J, X, r, rho, axes, det: scale * alpha ** (axes.length - 1) };
  }
  function inverse(X, c) {
    const { inner, scale } = parameters(c),
      axes = c.material === 'sphericalTransform' ? [0, 1, 2] : [0, 2],
      rho = Math.hypot(...axes.map((i) => X[i]));
    if (!(rho > 0)) throw Error('Ray reaches singular transformation centre');
    const r = X.slice();
    for (const i of axes) r[i] = ((inner + rho / scale) * X[i]) / rho;
    return O().add(center(c), r);
  }
  function metric(x, c, mode) {
    const o = O(),
      { radius } = parameters(c);
    if (c.material === 'radialAnisotropic') {
      const a = radial(x, c);
      if (mode === 0) return identity().map((row) => row.map((v) => v * a.no ** 2));
      return identity().map((row, i) =>
        row.map((v, j) => v / (1 - a.u) + (a.r[i] * a.r[j]) / (radius ** 2 * (1 - a.u) ** 2)),
      );
    }
    const { J } = transform(x, c);
    return transpose(J).map((row) =>
      J[0].map((_, j) =>
        o.dot(
          row,
          J.map((r) => r[j]),
        ),
      ),
    );
  }
  function rhs(s, c, mode) {
    const o = O(),
      { radius, inner, scale } = parameters(c),
      x = s.slice(0, 3),
      p = s.slice(3),
      v = o.velocity(x, p, c, mode),
      r = relative(x, c);
    let force;
    if (c.material === 'radialAnisotropic') {
      const u = o.dot(r, r) / radius ** 2,
        b = 1 / radius ** 2,
        q = o.dot(r, p),
        A = o.dot(p, p) - b * q * q;
      force =
        mode === 0
          ? o.mul(r, 2 * b * (1 - u) * o.dot(p, p))
          : o.add(o.mul(r, b * A), o.mul(p, b * (1 - u) * q));
    } else {
      const a = transform(x, c),
        w = o.mv(o.inv(transpose(a.J)), p);
      force = [0, 0, 0];
      const rho = a.rho,
        C = scale * inner;
      for (let k = 0; k < 3; k++)
        for (const i of a.axes)
          for (const j of a.axes) {
            const dj = a.axes.includes(k)
              ? (C * ((k === i ? r[j] : 0) + (k === j ? r[i] : 0) + (i === j ? r[k] : 0))) /
                  rho ** 3 -
                (3 * C * r[i] * r[j] * r[k]) / rho ** 5
              : 0;
            force[k] += w[i] * dj * v[j];
          }
    }
    return [...v, ...force];
  }
  function advance(s, h, c, mode) {
    const o = O();
    if (c.material === 'radialAnisotropic') {
      if (mode === 0) return null;
      const d = o.unit(o.velocity(s.slice(0, 3), s.slice(3), c, mode)),
        x = o.add(
          s.slice(0, 3),
          o.mul(d, h * o.norm(o.velocity(s.slice(0, 3), s.slice(3), c, mode))),
        ),
        G = metric(x, c, mode),
        gd = o.mv(G, d),
        p = o.mul(gd, 1 / Math.sqrt(o.dot(d, gd)));
      return [...x, ...p];
    }
    const a = transform(s, c),
      pVirtual = o.mv(o.inv(transpose(a.J)), s.slice(3)),
      X = o.add(a.X, o.mul(pVirtual, h)),
      x = inverse(X, c),
      p = o.mv(transpose(transform(x, c).J), pVirtual);
    return [...x, ...p];
  }
  root.LiteratureMedia = {
    names,
    transforms,
    supported: (m) => names.includes(m),
    center,
    parameters,
    radial,
    transform,
    inverse,
    metric,
    rhs,
    advance,
  };
  if (typeof module !== 'undefined') module.exports = root.LiteratureMedia;
})(globalThis);
