/* Closed plano-aspherical body. Default: exact axial focus for n=1.3, f=2.
 * The conic branch and polynomial departures are explicit; normals are analytic.
 * Coefficients A4,A6,... may be supplied through the geometry API. */
(function (root) {
  'use strict';
  const defaults = {
    front: -1,
    vertex: 1,
    radius: 1,
    curvature: -1 / 0.6,
    conic: -1.69,
    coefficients: [],
  };
  const parameters = (shape) => (typeof shape === 'object' ? { ...defaults, ...shape } : defaults);
  const is = (shape) => shape === 'asphere' || shape?.type === 'asphere';
  function sag(r, shape) {
    const p = parameters(shape),
      u = r * r,
      w = Math.sqrt(1 - (1 + p.conic) * p.curvature * p.curvature * u);
    if (!Number.isFinite(w)) throw Error('Non-real asphere sag');
    return (
      p.vertex +
      (p.curvature * u) / (1 + w) +
      p.coefficients.reduce((s, a, j) => s + a * u ** (j + 2), 0)
    );
  }
  function slope(r, shape) {
    const p = parameters(shape),
      w = Math.sqrt(1 - (1 + p.conic) * p.curvature * p.curvature * r * r);
    return (
      (p.curvature * r) / w +
      p.coefficients.reduce((s, a, j) => s + (2 * j + 4) * a * r ** (2 * j + 3), 0)
    );
  }
  function residual(x, shape) {
    const p = parameters(shape),
      r = Math.hypot(x[0], x[1]);
    return Math.max(
      p.front - x[2],
      r - p.radius,
      (x[2] - sag(Math.min(r, p.radius), shape)) /
        Math.hypot(1, slope(Math.min(r, p.radius), shape)),
    );
  }
  function normal(x, shape) {
    const p = parameters(shape),
      r = Math.hypot(x[0], x[1]),
      d = [Math.abs(x[2] - p.front), Math.abs(r - p.radius), Math.abs(x[2] - sag(r, shape))];
    if (d[0] <= d[1] && d[0] <= d[2]) return [0, 0, -1];
    if (d[1] < d[2]) return [x[0] / r, x[1] / r, 0];
    const v = r ? slope(r, shape) / r : 0,
      n = [-v * x[0], -v * x[1], 1],
      q = Math.hypot(...n);
    return n.map((v) => v / q);
  }
  function roots(o, d, shape) {
    const p = parameters(shape),
      list = [];
    const add = (t) => {
      if (!(t > 1e-8) || !Number.isFinite(t)) return;
      const x = o.map((v, i) => v + t * d[i]);
      if (Math.abs(residual(x, shape)) < 2e-8) list.push(t);
    };
    const quadratic = (a, b, c) =>
      root.Polynomial.quad(a, b, c)
        .filter((x) => Math.abs(x[1]) < 1e-12)
        .map((x) => x[0]);
    if (Math.abs(d[2]) > 1e-14) add((p.front - o[2]) / d[2]);
    for (const t of quadratic(
      d[0] ** 2 + d[1] ** 2,
      2 * (o[0] * d[0] + o[1] * d[1]),
      o[0] ** 2 + o[1] ** 2 - p.radius ** 2,
    ))
      add(t);
    const w = o[2] - p.vertex,
      c = p.curvature,
      k = 1 + p.conic;
    if (p.coefficients.every((a) => a === 0)) {
      for (const t of quadratic(
        d[0] ** 2 + d[1] ** 2 + k * d[2] ** 2,
        2 * (o[0] * d[0] + o[1] * d[1] + k * w * d[2] - d[2] / c),
        o[0] ** 2 + o[1] ** 2 + k * w * w - (2 * w) / c,
      ))
        add(t);
    } else {
      // Eliminate the conic square root with v=z-zv-P(r²): r²+k*v²-2*v/c=0.
      // Polynomial real-root isolation includes even-multiplicity tangencies.
      const plus = (a, b) =>
        Array.from({ length: Math.max(a.length, b.length) }, (_, i) => (a[i] || 0) + (b[i] || 0));
      const times = (a, b) => {
        const q = Array(a.length + b.length - 1).fill(0);
        a.forEach((v, i) => b.forEach((w, j) => (q[i + j] += v * w)));
        return q;
      };
      const u = [o[0] ** 2 + o[1] ** 2, 2 * (o[0] * d[0] + o[1] * d[1]), d[0] ** 2 + d[1] ** 2];
      let pow = u,
        v = [w, d[2]];
      for (const a of p.coefficients) {
        pow = times(pow, u);
        v = plus(
          v,
          pow.map((w) => -a * w),
        );
      }
      const f = plus(
        plus(
          u,
          times(v, v).map((w) => k * w),
        ),
        v.map((w) => (-2 * w) / c),
      );
      function realRoots(a) {
        while (a.length > 1 && a.at(-1) === 0) a.pop();
        const n = a.length - 1;
        if (n < 1) return [];
        if (n === 1) return [-a[0] / a[1]];
        const critical = realRoots(a.slice(1).map((v, i) => v * (i + 1))),
          bound = 1 + Math.max(...a.slice(0, -1).map((v) => Math.abs(v / a.at(-1)))),
          points = [
            -bound,
            ...critical.filter((v) => v > -bound && v < bound).sort((a, b) => a - b),
            bound,
          ],
          value = (x) => a.reduceRight((y, v) => y * x + v, 0),
          out = critical.filter((x) => root.Polynomial.residual(a, [x, 0]) < 1e-14);
        for (let i = 1; i < points.length; i++) {
          let l = points[i - 1],
            r = points[i],
            fl = value(l);
          if (fl * value(r) >= 0) continue;
          for (let j = 0; j < 160; j++) {
            const m = (l + r) / 2,
              fm = value(m);
            if (fm === 0) {
              l = r = m;
              break;
            }
            if (fl * fm < 0) r = m;
            else {
              l = m;
              fl = fm;
            }
            if (r - l < 4 * Number.EPSILON * Math.max(1, Math.abs(m))) break;
          }
          out.push((l + r) / 2);
        }
        return out;
      }
      for (const t of realRoots(f)) add(t);
    }
    return list.sort((a, b) => a - b).filter((t, i, a) => i === 0 || Math.abs(t - a[i - 1]) > 1e-8);
  }
  function hit(o, d, shape, inside = false) {
    for (const t of roots(o, d, shape)) {
      const x = o.map((v, i) => v + t * d[i]),
        v = normal(x, shape).reduce((s, w, i) => s + w * d[i], 0);
      if (inside ? v > 1e-10 : v < -1e-10) return x;
    }
    return null;
  }
  root.Asphere = { defaults, is, parameters, sag, slope, residual, normal, roots, hit };
  if (typeof module !== 'undefined') module.exports = root.Asphere;
})(globalThis);
