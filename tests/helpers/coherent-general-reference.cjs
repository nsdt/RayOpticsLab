/* Independent oblique-incidence Maxwell reference in fixed laboratory fields
 * [Ex,Ey,Hx,Hy]. Both propagation directions are retained. The port media equal
 * the endpoint local materials: this tests bulk coupling, not cavity fringes.
 * Continuous 4x4 ODE (Berreman 1972 formulation), integrated by RK4. */
const P = require('../../app/polynomial.js'),
  C = P.C;
// Independently build epsilon and plane-wave ports without renderer kernels.
function material(z, c) {
  if (c.material === 'axial2013Uniaxial')
    return { no: 1 + c.gradient * Math.sin(z), ne: 1, a: [0, 0, 1] };
  const t = (c.tilt * Math.PI) / 180,
    p = (c.azimuth * Math.PI) / 180 + (c.material === 'heliconical' ? c.twist * z : 0),
    scale =
      c.material === 'common'
        ? 1 / (1 + c.gradient * z)
        : c.material === 'quadratic'
          ? Math.sqrt(1 + c.gradient * z * z)
          : 1;
  return {
    no: c.no * scale,
    ne: c.ne * scale,
    a: [Math.sin(t) * Math.cos(p), Math.sin(t) * Math.sin(p), Math.cos(t)],
  };
}
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0),
  cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
function port(z, c, sign, k) {
  const { no, ne, a } = material(z, c),
    p2 = k[0] ** 2 + k[1] ** 2,
    ak = a[0] * k[0] + a[1] * k[1],
    g = 1 / no ** 2 - 1 / ne ** 2,
    A = 1 / ne ** 2 + g * a[2] ** 2,
    B = 2 * g * ak * a[2],
    D = p2 / ne ** 2 + g * ak ** 2 - 1;
  const roots = [
    sign * Math.sqrt(no ** 2 - p2),
    (-B + sign * Math.sqrt(B * B - 4 * A * D)) / (2 * A),
  ];
  return roots.map((pz, mode) => {
    const p = [...k, pz],
      eo = cross(a, p),
      disp = cross(p, eo),
      ap = dot(a, disp),
      E = mode ? disp.map((v, i) => (v - ap * a[i]) / no ** 2 + (ap * a[i]) / ne ** 2) : eo,
      H = cross(p, E),
      flux = 0.5 * (E[0] * H[1] - E[1] * H[0]);
    const factor = 1 / Math.sqrt(Math.abs(flux));
    return [E[0], E[1], H[0], H[1]].map((v) => [v * factor, 0]);
  });
}
function matrix(z, c, k0, k) {
  const { no, ne, a } = material(z, c),
    eps = a.map((v, i) => a.map((w, j) => (i === j ? no ** 2 : 0) + (ne ** 2 - no ** 2) * v * w)),
    [kx, ky] = k;
  const columns = [0, 1, 2, 3].map((j) => {
    const f = [0, 0, 0, 0];
    f[j] = 1;
    const [Ex, Ey, Hx, Hy] = f,
      Ez = (-eps[2][0] * Ex - eps[2][1] * Ey + ky * Hx - kx * Hy) / eps[2][2],
      Hz = kx * Ey - ky * Ex;
    return [
      Hy + kx * Ez,
      ky * Ez - Hx,
      kx * Hz - eps[1][0] * Ex - eps[1][1] * Ey - eps[1][2] * Ez,
      ky * Hz + eps[0][0] * Ex + eps[0][1] * Ey + eps[0][2] * Ez,
    ].map((v) => v * k0);
  });
  return [0, 1, 2, 3].map((i) => columns.map((col) => col[i]));
}
function propagate(z0, z1, c, n, k) {
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
      A = matrix(z, c, k0, k),
      B = matrix(z + h / 2, c, k0, k),
      D = matrix(z + h, c, k0, k);
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
function scatter(c, n = 8192, sign = 1, k = [0.2, 0.1]) {
  const z0 = -sign,
    z1 = sign,
    U = propagate(z0, z1, c, n, k),
    I = port(z0, c, sign, k),
    R = port(z0, c, -sign, k),
    T = port(z1, c, sign, k);
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
