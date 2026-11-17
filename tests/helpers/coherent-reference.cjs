/* Independent normal-incidence Maxwell reference in fixed laboratory fields
 * [Ex,Ey,Hx,Hy]. Both propagation directions are retained. The port media equal
 * the endpoint local materials: this tests bulk coupling, not cavity fringes.
 * Continuous 4x4 ODE (Berreman 1972 formulation), integrated by RK4. */
const P = require('../../app/polynomial.js'),
  C = P.C;
function port(z, c, sign) {
  const th = (c.tilt * Math.PI) / 180,
    ph = (c.azimuth * Math.PI) / 180 + c.twist * z;
  const neff =
    (c.no * c.ne) / Math.sqrt(c.no ** 2 * Math.sin(th) ** 2 + c.ne ** 2 * Math.cos(th) ** 2);
  return [0, 1].map((mode) => {
    const n = mode ? neff : c.no,
      a = Math.sqrt(2 / n),
      E = mode
        ? [a * Math.cos(ph), a * Math.sin(ph)]
        : [sign * a * Math.sin(ph), -sign * a * Math.cos(ph)];
    return [E[0], E[1], -sign * n * E[1], sign * n * E[0]].map((x) => [x, 0]);
  });
}
function matrix(z, c, k0) {
  const t = (c.tilt * Math.PI) / 180,
    p = (c.azimuth * Math.PI) / 180 + c.twist * z,
    a = [Math.sin(t) * Math.cos(p), Math.sin(t) * Math.sin(p), Math.cos(t)],
    de = c.ne ** 2 - c.no ** 2;
  const eps = a.map((x, i) => a.map((y, j) => (i === j ? c.no ** 2 : 0) + de * x * y));
  const E = eps
    .slice(0, 2)
    .map((row, i) => row.slice(0, 2).map((v, j) => v - (eps[i][2] * eps[2][j]) / eps[2][2]));
  return [
    [0, 0, 0, 1],
    [0, 0, -1, 0],
    [-E[1][0], -E[1][1], 0, 0],
    [E[0][0], E[0][1], 0, 0],
  ].map((row) => row.map((x) => x * k0));
}
function propagate(z0, z1, c, n) {
  const k0 = (2 * Math.PI * c.lengthUnitUm) / (c.wavelengthNm * 0.001),
    h = (z1 - z0) / n;
  let U = new Float64Array(32);
  for (let i = 0; i < 4; i++) U[2 * (i * 4 + i)] = 1;
  function rhs(A, v) {
    const out = new Float64Array(32);
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++)
        for (let k = 0; k < 4; k++) {
          const ij = 2 * (i * 4 + j),
            kj = 2 * (k * 4 + j);
          out[ij] -= A[i][k] * v[kj + 1];
          out[ij + 1] += A[i][k] * v[kj];
        }
    return out;
  }
  const plus = (x, y, a) => x.map((v, i) => v + a * y[i]);
  for (let step = 0; step < n; step++) {
    const z = z0 + step * h,
      A = matrix(z, c, k0),
      B = matrix(z + h / 2, c, k0),
      D = matrix(z + h, c, k0);
    const k1 = rhs(A, U),
      k2 = rhs(B, plus(U, k1, h / 2)),
      k3 = rhs(B, plus(U, k2, h / 2)),
      k4 = rhs(D, plus(U, k3, h));
    U = U.map((v, i) => v + (h * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i])) / 6);
  }
  return Array.from({ length: 4 }, (_, i) =>
    Array.from({ length: 4 }, (_, j) => [U[2 * (i * 4 + j)], U[2 * (i * 4 + j) + 1]]),
  );
}
function scatter(c, n = 8192, sign = 1) {
  const z0 = -sign,
    z1 = sign,
    U = propagate(z0, z1, c, n),
    I = port(z0, c, sign),
    R = port(z0, c, -sign),
    T = port(z1, c, sign);
  const mv = (v) => U.map((row) => row.reduce((s, q, i) => C.add(s, C.mul(q, v[i])), [0, 0]));
  const cols = [...T, ...R.map((v) => mv(v).map((z) => C.scale(z, -1)))],
    A = Array.from({ length: 4 }, (_, i) => cols.map((col) => col[i]));
  // Independent small Gaussian elimination; avoid renderer boundary solver.
  function solve(b) {
    const M = A.map((row, i) => [...row.map((z) => z.slice()), b[i].slice()]);
    for (let k = 0; k < 4; k++) {
      let p = k;
      for (let i = k + 1; i < 4; i++) if (C.abs(M[i][k]) > C.abs(M[p][k])) p = i;
      [M[p], M[k]] = [M[k], M[p]];
      for (let i = k + 1; i < 4; i++) {
        const q = C.div(M[i][k], M[k][k]);
        for (let j = k; j <= 4; j++) M[i][j] = C.sub(M[i][j], C.mul(q, M[k][j]));
      }
    }
    let x = [];
    for (let i = 3; i >= 0; i--) {
      let v = M[i][4];
      for (let j = i + 1; j < 4; j++) v = C.sub(v, C.mul(M[i][j], x[j]));
      x[i] = C.div(v, M[i][i]);
    }
    return x;
  }
  return I.map((v) => {
    const q = solve(mv(v)),
      T = q.slice(0, 2).map((z) => C.abs(z) ** 2),
      R = q.slice(2).map((z) => C.abs(z) ** 2);
    return { T, R, amplitudes: q.slice(0, 2), sum: [...T, ...R].reduce((a, b) => a + b, 0) };
  });
}
module.exports = { port, matrix, propagate, scatter };
